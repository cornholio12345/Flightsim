const API_BASE = 'https://api.flightplandatabase.com'
const API_HEADERS = {
  Accept: 'application/vnd.fpd.v1+json',
  'X-Units': 'AVIATION'
}
const AIRPORT_DATA_BASE = 'https://airport-data.com/api/ap_info.json'

const clean = value => String(value || '').trim()

export const normalizeFlightNumber = value => clean(value).replace(/\s+/g, '').toUpperCase()

const requestJson = async path => {
  const response = await fetch(`${API_BASE}${path}`, { headers: API_HEADERS })
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      const messages = Array.isArray(body?.errors)
        ? body.errors.map(item => typeof item === 'string' ? item : item?.message).filter(Boolean)
        : []
      if (messages.length) detail = messages.join(', ')
      else if (body?.message) detail = body.message
    } catch (_) {
      // Keep the HTTP status as fallback.
    }
    const error = new Error(`Flight Plan Database request failed: ${detail}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

const resolveAirport = async value => {
  const query = clean(value).toUpperCase()
  if (!query) return null

  // Flight Plan Database supports exact ICAO matching directly.
  if (/^[A-Z0-9]{4}$/.test(query)) {
    return { icao: query, iata: '', name: query }
  }

  // The UI intentionally accepts IATA codes. Resolve those to ICAO first so the
  // route search can use Flight Plan Database's exact fromICAO/toICAO filters.
  if (/^[A-Z]{3}$/.test(query)) {
    try {
      const response = await fetch(`${AIRPORT_DATA_BASE}?iata=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json' }
      })
      if (response.ok) {
        const airport = await response.json()
        if (airport?.status === 200 && airport?.icao) {
          return {
            icao: String(airport.icao).toUpperCase(),
            iata: String(airport.iata || query).toUpperCase(),
            name: airport.name || airport.location || query
          }
        }
      }
    } catch (_) {
      // Airport resolution is a convenience. Fall back to Flight Plan Database's
      // broader text search if this auxiliary service is unavailable.
    }
  }

  return { icao: '', iata: '', name: clean(value), query: clean(value) }
}

const scorePlan = (plan, normalizedFlight = '') => {
  const tags = new Set((plan.tags || []).map(tag => String(tag).toLowerCase()))
  let score = Number(plan.popularity || 0)
  if (normalizeFlightNumber(plan.flightNumber) === normalizedFlight && normalizedFlight) score += 2000
  if (tags.has('commercial')) score += 500
  if (tags.has('real')) score += 300
  if (tags.has('decoded')) score += 100
  score += Math.min(100, Number(plan.waypoints || 0))
  return score
}

const buildPlanSearchPath = params => `/search/plans?${new URLSearchParams({ ...params, limit: '20' }).toString()}`

const dedupePlans = plans => {
  const seen = new Set()
  return plans.filter(plan => {
    const id = Number(plan?.id)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export const searchFlightPlans = async ({ flightNumber, from, to }) => {
  const normalizedFlight = normalizeFlightNumber(flightNumber)
  const fromQuery = clean(from)
  const toQuery = clean(to)

  if (!normalizedFlight && !fromQuery && !toQuery) {
    throw new Error('Enter a flight number or a departure/destination pair.')
  }

  const [resolvedFrom, resolvedTo] = await Promise.all([
    fromQuery ? resolveAirport(fromQuery) : Promise.resolve(null),
    toQuery ? resolveAirport(toQuery) : Promise.resolve(null)
  ])

  const searches = []
  const errors = []

  // Search by commercial flight number independently. Community flight-plan data
  // does not consistently contain airline flight numbers, and a server-side error
  // here must never prevent the route fallback from running.
  if (normalizedFlight) {
    try {
      const byFlight = await requestJson(buildPlanSearchPath({ flightNumber: normalizedFlight }))
      if (Array.isArray(byFlight)) searches.push(...byFlight)
    } catch (error) {
      errors.push(error)
    }
  }

  // Route lookup is the reliable fallback for our use case: we need a plausible
  // route to approximate progress, not necessarily a community plan tagged with
  // the exact commercial flight number.
  if (fromQuery && toQuery) {
    try {
      const routeParams = resolvedFrom?.icao && resolvedTo?.icao
        ? { fromICAO: resolvedFrom.icao, toICAO: resolvedTo.icao, sort: 'popularity' }
        : { from: fromQuery, to: toQuery, sort: 'popularity' }
      const byRoute = await requestJson(buildPlanSearchPath(routeParams))
      if (Array.isArray(byRoute)) searches.push(...byRoute)
    } catch (error) {
      errors.push(error)
    }
  }

  // A flight-number-only query has no useful fallback if the upstream endpoint
  // itself fails. Surface that error; otherwise prefer returning route results.
  if (!searches.length && errors.length && !(fromQuery && toQuery)) {
    throw errors[0]
  }

  const plans = dedupePlans(searches)

  return plans
    .filter(plan => plan?.id && plan?.fromICAO && plan?.toICAO)
    .sort((a, b) => scorePlan(b, normalizedFlight) - scorePlan(a, normalizedFlight))
    .slice(0, 12)
    .map(plan => ({
      id: plan.id,
      flightNumber: plan.flightNumber || normalizedFlight || '',
      fromICAO: plan.fromICAO,
      toICAO: plan.toICAO,
      fromName: plan.fromName || plan.fromICAO,
      toName: plan.toName || plan.toICAO,
      distanceNm: Math.round(Number(plan.distance || 0)),
      maxAltitudeFt: Number(plan.maxAltitude || 0),
      waypoints: Number(plan.waypoints || 0),
      tags: plan.tags || [],
      popularity: Number(plan.popularity || 0),
      updatedAt: plan.updatedAt || null,
      resolvedFrom: resolvedFrom || null,
      resolvedTo: resolvedTo || null
    }))
}

export const fetchFlightPlan = async id => {
  const plan = await requestJson(`/plan/${encodeURIComponent(id)}`)
  const nodes = (plan?.route?.nodes || [])
    .filter(node => Number.isFinite(Number(node?.lat)) && Number.isFinite(Number(node?.lon)))
    .map(node => ({
      ident: node.ident || '',
      name: node.name || null,
      type: node.type || 'UKN',
      lat: Number(node.lat),
      lon: Number(node.lon),
      altitudeFt: Number(node.alt || 0),
      via: node.via || null
    }))

  if (nodes.length < 2) {
    throw new Error('The selected flight plan does not contain a usable route.')
  }

  return {
    id: plan.id,
    flightNumber: plan.flightNumber || '',
    fromICAO: plan.fromICAO,
    toICAO: plan.toICAO,
    fromName: plan.fromName || plan.fromICAO,
    toName: plan.toName || plan.toICAO,
    distanceNm: Number(plan.distance || 0),
    maxAltitudeFt: Number(plan.maxAltitude || 0),
    updatedAt: plan.updatedAt || null,
    tags: plan.tags || [],
    nodes,
    source: {
      name: 'Flight Plan Database',
      url: `https://flightplandatabase.com/plan/${plan.id}`,
      simulationOnly: true
    }
  }
}

export const estimateBlockMinutes = distanceNm => {
  const distance = Math.max(0, Number(distanceNm || 0))
  // Rough block-time model: taxi + climb/descent overhead + cruise at ~465 kt.
  return Math.max(35, Math.round((distance / 465) * 60 + 35))
}
