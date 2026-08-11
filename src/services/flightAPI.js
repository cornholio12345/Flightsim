const API_BASE = 'https://api.flightplandatabase.com'
const API_HEADERS = {
  Accept: 'application/vnd.fpd.v1+json',
  'X-Units': 'AVIATION'
}
const AIRPORT_DATA_BASE = 'https://airport-data.com/api/ap_info.json'
const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast'

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

  if (/^[A-Z0-9]{4}$/.test(query)) {
    return { icao: query, iata: '', name: query }
  }

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
      // Airport resolution is a convenience. Route search can still fall back.
    }
  }

  return { icao: '', iata: '', name: clean(value), query: clean(value) }
}

const fetchAirportMetadata = async icao => {
  if (!icao) return null
  try {
    const airport = await requestJson(`/nav/airport/${encodeURIComponent(icao)}`)
    return {
      icao: airport?.ICAO || icao,
      iata: airport?.IATA || '',
      name: airport?.name || icao,
      regionName: airport?.regionName || '',
      timeZone: airport?.timezone?.name || '',
      utcOffsetSeconds: Number(airport?.timezone?.offset || 0),
      lat: Number(airport?.lat),
      lon: Number(airport?.lon)
    }
  } catch (_) {
    return null
  }
}

const freshnessScore = updatedAt => {
  const timestamp = Date.parse(updatedAt || '')
  if (!Number.isFinite(timestamp)) return 0
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000)
  return Math.max(0, 90 - ageDays)
}

const scorePlan = (plan, normalizedFlight = '') => {
  const tags = new Set((plan.tags || []).map(tag => String(tag).toLowerCase()))
  const popularity = Math.max(0, Number(plan.popularity || 0))
  let score = Math.min(120, Math.log2(popularity + 1) * 18)
  if (normalizeFlightNumber(plan.flightNumber) === normalizedFlight && normalizedFlight) score += 500
  if (tags.has('commercial')) score += 120
  if (tags.has('real')) score += 100
  if (tags.has('decoded')) score += 30
  score += Math.min(60, Number(plan.waypoints || 0))
  score += freshnessScore(plan.updatedAt)
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

const normalizeNodes = plan => (plan?.route?.nodes || [])
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

const calculateBearing = (a, b) => {
  const lat1 = Number(a.lat) * Math.PI / 180
  const lat2 = Number(b.lat) * Math.PI / 180
  const dLon = (Number(b.lon) - Number(a.lon)) * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

const distanceNmBetween = (a, b) => {
  const radiusNm = 3440.065
  const lat1 = Number(a.lat) * Math.PI / 180
  const lat2 = Number(b.lat) * Math.PI / 180
  const dLat = (Number(b.lat) - Number(a.lat)) * Math.PI / 180
  const dLon = (Number(b.lon) - Number(a.lon)) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * radiusNm * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}

const routeShapeSamples = nodes => {
  if (!nodes || nodes.length < 2) return []
  return [0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88].map(fraction => {
    const index = Math.min(nodes.length - 1, Math.max(0, Math.round((nodes.length - 1) * fraction)))
    return nodes[index]
  })
}

const routesEquivalent = (a, b) => {
  if (a.fromICAO !== b.fromICAO || a.toICAO !== b.toICAO) return false

  const distanceA = Number(a.distanceNm || 0)
  const distanceB = Number(b.distanceNm || 0)
  const distanceTolerance = Math.max(12, Math.min(distanceA, distanceB) * 0.012)
  if (Math.abs(distanceA - distanceB) > distanceTolerance) return false

  const samplesA = routeShapeSamples(a.routeNodesForRanking)
  const samplesB = routeShapeSamples(b.routeNodesForRanking)
  if (samplesA.length !== samplesB.length || !samplesA.length) return false

  const separations = samplesA.map((point, index) => distanceNmBetween(point, samplesB[index]))
  const average = separations.reduce((sum, value) => sum + value, 0) / separations.length
  const maximum = Math.max(...separations)
  return average <= 18 && maximum <= 42
}

const dedupeEquivalentRoutes = (plans, limit = 6) => {
  const kept = []
  for (const plan of plans) {
    if (kept.some(existing => routesEquivalent(plan, existing))) continue
    kept.push(plan)
    if (kept.length >= limit) break
  }
  return kept
}

const routeSamples = nodes => {
  if (!nodes || nodes.length < 2) return []
  const fractions = nodes.length < 5 ? [0, 0.5] : [0.18, 0.5, 0.82]
  return fractions.map(fraction => {
    const index = Math.min(nodes.length - 2, Math.max(0, Math.round((nodes.length - 2) * fraction)))
    return {
      lat: nodes[index].lat,
      lon: nodes[index].lon,
      course: calculateBearing(nodes[index], nodes[index + 1])
    }
  })
}

const viaSummary = nodes => {
  if (!nodes || nodes.length < 5) return ''
  const indices = [0.22, 0.42, 0.62, 0.82]
  const candidates = indices
    .map(fraction => nodes[Math.min(nodes.length - 2, Math.max(1, Math.round((nodes.length - 1) * fraction)))]?.ident)
    .filter(Boolean)
  return [...new Set(candidates)].slice(0, 4).join(' · ')
}

const annotateRouteDifferences = plans => {
  if (!plans.length) return plans
  const best = plans[0]
  return plans.map((plan, index) => {
    if (index === 0) return { ...plan, differenceLabel: 'Best overall match' }

    const parts = []
    if (plan.viaSummary && plan.viaSummary !== best.viaSummary) parts.push(`Different routing via ${plan.viaSummary}`)
    else parts.push('Different route corridor')

    const distanceDeltaKm = Math.round((Number(plan.distanceNm || 0) - Number(best.distanceNm || 0)) * 1.852)
    if (Math.abs(distanceDeltaKm) >= 10) parts.push(`${distanceDeltaKm > 0 ? '+' : ''}${distanceDeltaKm} km`)

    const wind = Number(plan.upperWindKmh)
    const bestWind = Number(best.upperWindKmh)
    if (Number.isFinite(wind) && Number.isFinite(bestWind)) {
      const windDelta = Math.round(wind - bestWind)
      if (Math.abs(windDelta) >= 10) parts.push(`${Math.abs(windDelta)} km/h ${windDelta > 0 ? 'better' : 'worse'} wind`)
    }

    return { ...plan, differenceLabel: parts.join(' · ') }
  })
}

const enrichPlansWithUpperWinds = async plans => {
  if (!plans.length) return plans

  const enrichedCandidates = await Promise.all(plans.map(async plan => {
    try {
      const full = await requestJson(`/plan/${encodeURIComponent(plan.id)}`)
      const nodes = normalizeNodes(full)
      return { ...plan, routeNodesForRanking: nodes, viaSummary: viaSummary(nodes) }
    } catch (_) {
      return plan
    }
  }))

  const enriched = dedupeEquivalentRoutes(enrichedCandidates, 6)
  const sampleEntries = []
  enriched.forEach((plan, planIndex) => {
    routeSamples(plan.routeNodesForRanking).forEach(sample => sampleEntries.push({ planIndex, ...sample }))
  })

  if (!sampleEntries.length) {
    const ranked = enriched.map(({ routeNodesForRanking, ...plan }, index) => ({
      ...plan,
      recommendationRank: index + 1,
      weatherLabel: 'Upper-wind data unavailable'
    }))
    return annotateRouteDifferences(ranked)
  }

  try {
    const params = new URLSearchParams({
      latitude: sampleEntries.map(item => item.lat.toFixed(3)).join(','),
      longitude: sampleEntries.map(item => item.lon.toFixed(3)).join(','),
      hourly: 'wind_speed_250hPa,wind_direction_250hPa',
      forecast_hours: '1',
      timezone: 'GMT'
    })
    const response = await fetch(`${WEATHER_BASE}?${params}`)
    if (!response.ok) throw new Error(`Weather ${response.status}`)
    const data = await response.json()
    const forecasts = Array.isArray(data) ? data : [data]
    const windByPlan = enriched.map(() => [])

    sampleEntries.forEach((sample, index) => {
      const forecast = forecasts[index]
      const speed = Number(forecast?.hourly?.wind_speed_250hPa?.[0])
      const directionFrom = Number(forecast?.hourly?.wind_direction_250hPa?.[0])
      if (!Number.isFinite(speed) || !Number.isFinite(directionFrom)) return
      const windTo = (directionFrom + 180) % 360
      const angle = (windTo - sample.course) * Math.PI / 180
      windByPlan[sample.planIndex].push(speed * Math.cos(angle))
    })

    const finiteDistances = enriched.map(plan => Number(plan.distanceNm || 0)).filter(Number.isFinite)
    const minDistance = finiteDistances.length ? Math.min(...finiteDistances) : 0
    const ranked = enriched
      .map((plan, index) => {
        const values = windByPlan[index]
        const upperWindKmh = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
        const distancePenalty = Math.max(0, Number(plan.distanceNm || 0) - minDistance) * 0.35
        const weatherBonus = Number.isFinite(upperWindKmh) ? Math.max(-120, Math.min(120, upperWindKmh)) * 1.5 : 0
        let weatherLabel = 'Upper-wind data unavailable'
        if (Number.isFinite(upperWindKmh)) {
          if (upperWindKmh >= 10) weatherLabel = `Tailwind +${upperWindKmh} km/h`
          else if (upperWindKmh <= -10) weatherLabel = `Headwind ${Math.abs(upperWindKmh)} km/h`
          else weatherLabel = 'Upper winds nearly neutral'
        }
        const { routeNodesForRanking, ...cleanPlan } = plan
        return {
          ...cleanPlan,
          upperWindKmh,
          weatherLabel,
          recommendationScore: Number(plan.baseScore || 0) + weatherBonus - distancePenalty
        }
      })
      .sort((a, b) => Number(b.recommendationScore || b.baseScore || 0) - Number(a.recommendationScore || a.baseScore || 0))
      .map((plan, index) => ({ ...plan, recommendationRank: index + 1 }))

    return annotateRouteDifferences(ranked)
  } catch (_) {
    const ranked = enriched.map(({ routeNodesForRanking, ...plan }, index) => ({
      ...plan,
      recommendationRank: index + 1,
      weatherLabel: 'Upper-wind data unavailable'
    }))
    return annotateRouteDifferences(ranked)
  }
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

  if (normalizedFlight) {
    try {
      const byFlight = await requestJson(buildPlanSearchPath({ flightNumber: normalizedFlight }))
      if (Array.isArray(byFlight)) searches.push(...byFlight)
    } catch (error) {
      errors.push(error)
    }
  }

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

  if (!searches.length && errors.length && !(fromQuery && toQuery)) throw errors[0]

  const basePlans = dedupePlans(searches)
    .filter(plan => plan?.id && plan?.fromICAO && plan?.toICAO)
    .map(plan => {
      const baseScore = scorePlan(plan, normalizedFlight)
      const fromIATA = resolvedFrom?.icao === plan.fromICAO ? resolvedFrom.iata : ''
      const toIATA = resolvedTo?.icao === plan.toICAO ? resolvedTo.iata : ''
      return {
        id: plan.id,
        flightNumber: plan.flightNumber || normalizedFlight || '',
        fromICAO: plan.fromICAO,
        toICAO: plan.toICAO,
        fromIATA,
        toIATA,
        fromName: plan.fromName || resolvedFrom?.name || plan.fromICAO,
        toName: plan.toName || resolvedTo?.name || plan.toICAO,
        distanceNm: Math.round(Number(plan.distance || 0)),
        maxAltitudeFt: Number(plan.maxAltitude || 0),
        waypoints: Number(plan.waypoints || 0),
        tags: plan.tags || [],
        popularity: Number(plan.popularity || 0),
        updatedAt: plan.updatedAt || null,
        baseScore
      }
    })
    .sort((a, b) => b.baseScore - a.baseScore)
    .slice(0, 14)

  return enrichPlansWithUpperWinds(basePlans)
}

export const fetchFlightPlan = async id => {
  const plan = await requestJson(`/plan/${encodeURIComponent(id)}`)
  const nodes = normalizeNodes(plan)
  if (nodes.length < 2) throw new Error('The selected flight plan does not contain a usable route.')

  const [fromAirport, toAirport] = await Promise.all([
    fetchAirportMetadata(plan.fromICAO),
    fetchAirportMetadata(plan.toICAO)
  ])

  return {
    id: plan.id,
    flightNumber: plan.flightNumber || '',
    fromICAO: plan.fromICAO,
    toICAO: plan.toICAO,
    fromIATA: fromAirport?.iata || '',
    toIATA: toAirport?.iata || '',
    fromName: plan.fromName || fromAirport?.name || plan.fromICAO,
    toName: plan.toName || toAirport?.name || plan.toICAO,
    fromRegionName: fromAirport?.regionName || '',
    toRegionName: toAirport?.regionName || '',
    fromTimeZone: fromAirport?.timeZone || '',
    toTimeZone: toAirport?.timeZone || '',
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
  return Math.max(35, Math.round((distance / 465) * 60 + 35))
}
