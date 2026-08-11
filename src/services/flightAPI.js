const API_BASE = 'https://api.flightplandatabase.com'
const API_HEADERS = {
  Accept: 'application/vnd.fpd.v1+json',
  'X-Units': 'AVIATION'
}

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
    } catch (_) {
      // Keep the HTTP status as fallback.
    }
    throw new Error(`Flight Plan Database request failed: ${detail}`)
  }
  return response.json()
}

const scorePlan = plan => {
  const tags = new Set((plan.tags || []).map(tag => String(tag).toLowerCase()))
  let score = Number(plan.popularity || 0)
  if (tags.has('commercial')) score += 500
  if (tags.has('real')) score += 300
  if (tags.has('decoded')) score += 100
  score += Math.min(100, Number(plan.waypoints || 0))
  return score
}

export const searchFlightPlans = async ({ flightNumber, from, to }) => {
  const normalizedFlight = normalizeFlightNumber(flightNumber)
  const fromQuery = clean(from)
  const toQuery = clean(to)

  if (!normalizedFlight && !fromQuery && !toQuery) {
    throw new Error('Enter a flight number or a departure/destination pair.')
  }

  const params = new URLSearchParams({ limit: '20' })
  if (normalizedFlight) params.set('flightNumber', normalizedFlight)
  if (fromQuery) params.set('from', fromQuery)
  if (toQuery) params.set('to', toQuery)

  let plans = await requestJson(`/search/plans?${params.toString()}`)

  // Flight numbers are not consistently populated in community plans. If an exact
  // flight-number search comes back empty, retry with the supplied route pair.
  if (!plans.length && normalizedFlight && fromQuery && toQuery) {
    const fallback = new URLSearchParams({ from: fromQuery, to: toQuery, limit: '20' })
    plans = await requestJson(`/search/plans?${fallback.toString()}`)
  }

  return plans
    .filter(plan => plan?.id && plan?.fromICAO && plan?.toICAO)
    .sort((a, b) => scorePlan(b) - scorePlan(a))
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
      updatedAt: plan.updatedAt || null
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
