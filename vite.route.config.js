import { defineConfig } from 'vite'
import baseConfig from './vite.config.js'
import airportDetails from './src/data/airportDetails.generated.js'

const routeAlignedAircraft = () => ({
  name: 'flightsim-route-aligned-aircraft',
  enforce: 'pre',
  transform(code, id) {
    const normalizedId = id.replace(/\\/g, '/')

    if (normalizedId.endsWith('/src/utils/globeUtils.js')) {
      const oldBlock = `const updateAircraftScreenRotation = () => {
  if (!aircraft?.visible || !aircraftState || !earthGroup || !camera) return
  const ahead = destinationPoint(aircraftState.lat, aircraftState.lon, aircraftState.bearing)
  const from = latLonVector(aircraftState.lat, aircraftState.lon, ROUTE_RADIUS)
  const to = latLonVector(ahead.lat, ahead.lon, ROUTE_RADIUS)
  earthGroup.localToWorld(from)
  earthGroup.localToWorld(to)
  from.project(camera)
  to.project(camera)
  aircraft.material.rotation = Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2
}`
      const newBlock = `const updateAircraftScreenRotation = () => {
  if (!aircraft?.visible || !aircraftState || !earthGroup || !camera) return

  const from = latLonVector(aircraftState.lat, aircraftState.lon, ROUTE_RADIUS)
  let to = null

  if (routeSamples.length > 1) {
    let nearestIndex = 0
    let nearestDistance = Infinity
    routeSamples.forEach((sample, index) => {
      const distance = sample.point.distanceToSquared(from)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })

    let aheadIndex = Math.min(routeSamples.length - 1, nearestIndex + 1)
    if (aheadIndex === nearestIndex && nearestIndex > 0) aheadIndex = nearestIndex
    to = routeSamples[aheadIndex]?.point?.clone?.() || null

    if (to && to.distanceToSquared(from) < 1e-8 && aheadIndex + 1 < routeSamples.length) {
      to = routeSamples[aheadIndex + 1].point.clone()
    }
  }

  if (!to) {
    const ahead = destinationPoint(aircraftState.lat, aircraftState.lon, aircraftState.bearing)
    to = latLonVector(ahead.lat, ahead.lon, ROUTE_RADIUS)
  }

  const fromWorld = from.clone()
  const toWorld = to.clone()
  earthGroup.localToWorld(fromWorld)
  earthGroup.localToWorld(toWorld)
  fromWorld.project(camera)
  toWorld.project(camera)

  const dx = toWorld.x - fromWorld.x
  const dy = toWorld.y - fromWorld.y
  if (Math.hypot(dx, dy) < 1e-5) return
  aircraft.material.rotation = Math.atan2(dy, dx) - Math.PI / 2
}`
      if (!code.includes(oldBlock)) throw new Error('Could not locate globe aircraft rotation block')
      return { code: code.replace(oldBlock, newBlock), map: null }
    }

    if (normalizedId.endsWith('/src/utils/detailMap.js')) {
      const oldPlane = `  planeElement.textContent = '✈'`
      const newPlane = `  planeElement.innerHTML = '<svg viewBox="0 0 32 36" width="100%" height="100%" aria-hidden="true"><path d="M16 1 L19 11 L30 17 L30 21 L19 19 L18 28 L23 31 L23 34 L16 32 L9 34 L9 31 L14 28 L13 19 L2 21 L2 17 L13 11 Z" fill="currentColor" stroke="rgba(5,24,34,.9)" stroke-width="1.2" stroke-linejoin="round"/></svg>'`
      if (!code.includes(oldPlane)) throw new Error('Could not locate detail-map aircraft glyph')
      let transformed = code.replace(oldPlane, newPlane)

      const oldBlock = `    planeElement.style.transform = \`translate(-50%, -50%) rotate(\${Number(aircraftState.bearing || 0) - 45}deg)\``
      const newBlock = `    let rotationDeg = Number(aircraftState.bearing || 0)
    if (routeSamples.length > 1) {
      let nearestIndex = 0
      let nearestDistance = Infinity
      routeSamples.forEach((sample, index) => {
        const samplePoint = screenPoint(sample.coord)
        const dx = samplePoint.x - point.x
        const dy = samplePoint.y - point.y
        const distance = dx * dx + dy * dy
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestIndex = index
        }
      })

      let fromPoint = point
      let toPoint = null
      if (nearestIndex < routeSamples.length - 1) {
        let targetIndex = nearestIndex + 1
        toPoint = screenPoint(routeSamples[targetIndex].coord)
        while (targetIndex < routeSamples.length - 1 && Math.hypot(toPoint.x - point.x, toPoint.y - point.y) < 8) {
          targetIndex += 1
          toPoint = screenPoint(routeSamples[targetIndex].coord)
        }
      } else if (nearestIndex > 0) {
        fromPoint = screenPoint(routeSamples[nearestIndex - 1].coord)
        toPoint = point
      }

      if (toPoint) {
        const dx = toPoint.x - fromPoint.x
        const dy = toPoint.y - fromPoint.y
        if (Math.hypot(dx, dy) > 0.5) rotationDeg = Math.atan2(dy, dx) * 180 / Math.PI + 90
      }
    }
    planeElement.style.transform = \`translate(-50%, -50%) rotate(\${rotationDeg}deg)\``
      if (!transformed.includes(oldBlock)) throw new Error('Could not locate detail-map aircraft rotation block')
      transformed = transformed.replace(oldBlock, newBlock)
      return { code: transformed, map: null }
    }

    return null
  }
})

const correctAheadView = () => ({
  name: 'flightsim-correct-ahead-view',
  enforce: 'post',
  transform(code, id) {
    const normalizedId = id.replace(/\\/g, '/')
    if (!normalizedId.endsWith('/src/utils/globeUtils.js')) return null

    const oldDirection = `  const aheadCoord = destinationPoint(aircraftState.lat, aircraftState.lon, aircraftState.bearing, 0.05)
  const aheadNormal = latLonVector(aheadCoord.lat, aheadCoord.lon, 1).normalize()
  const forward = aheadNormal.clone().addScaledVector(normal, -aheadNormal.dot(normal)).normalize()`
    const newDirection = `  let aheadNormal = null
  if (routeSamples.length > 1) {
    const aircraftPoint = latLonVector(aircraftState.lat, aircraftState.lon, ROUTE_RADIUS)
    let nearestIndex = 0
    let nearestDistance = Infinity
    routeSamples.forEach((sample, index) => {
      const distance = sample.point.distanceToSquared(aircraftPoint)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })
    const aheadIndex = Math.min(routeSamples.length - 1, nearestIndex + 1)
    aheadNormal = routeSamples[aheadIndex]?.point?.clone?.().normalize() || null
  }
  if (!aheadNormal) {
    const aheadCoord = destinationPoint(aircraftState.lat, aircraftState.lon, aircraftState.bearing, 0.05)
    aheadNormal = latLonVector(aheadCoord.lat, aheadCoord.lon, 1).normalize()
  }
  const forward = aheadNormal.clone().addScaledVector(normal, -aheadNormal.dot(normal)).normalize()`
    if (!code.includes(oldDirection)) throw new Error('Could not locate transformed Ahead direction block')
    let transformed = code.replace(oldDirection, newDirection)

    const oldNormal = `  const targetNormal = new THREE.Vector3(0, -0.14, 1).normalize()`
    const newNormal = `  const targetNormal = new THREE.Vector3(0, 0.24, 1).normalize()`
    if (!transformed.includes(oldNormal)) throw new Error('Could not locate transformed Ahead horizon block')
    transformed = transformed.replace(oldNormal, newNormal)

    const oldFocus = `    const noseFocus = aircraftWorld.clone().addScaledVector(targetForward, 0.028)
    camera.position.x = 0
    camera.position.y = 0.08
    camera.up.set(0, 1, 0)
    camera.lookAt(noseFocus)`
    const newFocus = `    // As the camera moves closer, shift the visual target farther along the route.
    // This keeps the aircraft low in frame and preserves useful map detail in front of the nose.
    const zoomIn = THREE.MathUtils.clamp((3.9 - camera.position.z) / (3.9 - MIN_CAMERA_Z), 0, 1)
    const easedZoomIn = zoomIn * zoomIn * (3 - 2 * zoomIn)
    const focusAhead = THREE.MathUtils.lerp(0.028, 0.24, easedZoomIn)
    const noseFocus = aircraftWorld.clone().addScaledVector(targetForward, focusAhead)
    camera.position.x = 0
    camera.position.y = 0.08
    camera.up.set(0, 1, 0)
    camera.lookAt(noseFocus)`
    if (!transformed.includes(oldFocus)) throw new Error('Could not locate Ahead camera focus block')
    transformed = transformed.replace(oldFocus, newFocus)

    return { code: transformed, map: null }
  }
})

const fpdServerFallback = () => ({
  name: 'flightsim-fpd-server-fallback',
  enforce: 'post',
  transform(code, id) {
    const normalizedId = id.replace(/\\/g, '/')

    if (normalizedId.endsWith('/src/services/flightAPI.js')) {
      let transformed = code
      const weatherBase = `const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast'`
      const detailRows = airportDetails.map(([iata, icao, lat, lon, name]) => [iata, { icao, lat, lon, name }])
      const detailsInjection = `${weatherBase}\nconst LOCAL_AIRPORT_DETAILS = new Map(${JSON.stringify(detailRows)})\nconst LOCAL_AIRPORT_DETAILS_BY_ICAO = new Map([...LOCAL_AIRPORT_DETAILS.values()].map(airport => [airport.icao, airport]))`
      if (!transformed.includes(weatherBase)) throw new Error('Could not locate weather constant for airport fallback data')
      transformed = transformed.replace(weatherBase, detailsInjection)

      const oldIcaoReturn = `  if (/^[A-Z0-9]{4}$/.test(query)) return { icao: query, iata: '', name: query }`
      const newIcaoReturn = `  if (/^[A-Z0-9]{4}$/.test(query)) {
    const localAirport = LOCAL_AIRPORT_DETAILS_BY_ICAO.get(query)
    if (localAirport) return { icao: query, iata: '', name: localAirport.name || query, lat: Number(localAirport.lat), lon: Number(localAirport.lon) }
    return { icao: query, iata: '', name: query }
  }`
      if (!transformed.includes(oldIcaoReturn)) throw new Error('Could not locate ICAO airport resolver')
      transformed = transformed.replace(oldIcaoReturn, newIcaoReturn)

      const oldLocalReturn = `    const localIcao = LOCAL_IATA_ICAO.get(query)
    if (localIcao) return { icao: localIcao, iata: query, name: query }`
      const newLocalReturn = `    const localIcao = LOCAL_IATA_ICAO.get(query)
    const localAirport = LOCAL_AIRPORT_DETAILS.get(query)
    if (localAirport) return {
      icao: localAirport.icao || localIcao,
      iata: query,
      name: localAirport.name || query,
      lat: Number(localAirport.lat),
      lon: Number(localAirport.lon)
    }
    if (localIcao) return { icao: localIcao, iata: query, name: query }`
      if (!transformed.includes(oldLocalReturn)) throw new Error('Could not locate local IATA airport resolver')
      transformed = transformed.replace(oldLocalReturn, newLocalReturn)

      const resolveStart = `const resolveAirport = async value => {`
      const retryHelpers = `const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const requestJsonWithRetry = async path => {
  const delays = [0, 350, 900]
  let lastError = null
  for (const delay of delays) {
    if (delay) await wait(delay)
    try {
      return await requestJson(path)
    } catch (error) {
      lastError = error
      if (![502, 503, 504].includes(Number(error?.status))) throw error
    }
  }
  throw lastError
}

${resolveStart}`
      if (!transformed.includes(resolveStart)) throw new Error('Could not locate airport resolver for retry helper')
      transformed = transformed.replace(resolveStart, retryHelpers)

      transformed = transformed.replace(
        `const byFlight = await requestJson(buildPlanSearchPath({ flightNumber: normalizedFlight }))`,
        `const byFlight = await requestJsonWithRetry(buildPlanSearchPath({ flightNumber: normalizedFlight }))`
      )
      transformed = transformed.replace(
        `const byRoute = await requestJson(buildPlanSearchPath(routeParams))`,
        `const byRoute = await requestJsonWithRetry(buildPlanSearchPath(routeParams))`
      )

      const searchStart = `export const searchFlightPlans = async ({ flightNumber, from, to }) => {`
      const fallbackHelpers = `const greatCircleFallbackNodes = (fromAirport, toAirport, steps = 40) => {
  const lat1 = Number(fromAirport.lat) * Math.PI / 180
  const lon1 = Number(fromAirport.lon) * Math.PI / 180
  const lat2 = Number(toAirport.lat) * Math.PI / 180
  const lon2 = Number(toAirport.lon) * Math.PI / 180
  const dot = Math.max(-1, Math.min(1,
    Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  ))
  const angle = Math.acos(dot)
  const sinAngle = Math.sin(angle)
  const nodes = []
  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps
    if (angle < 1e-8 || Math.abs(sinAngle) < 1e-8) {
      nodes.push({ ident: index === 0 ? fromAirport.icao : index === steps ? toAirport.icao : '', lat: Number(fromAirport.lat) + (Number(toAirport.lat) - Number(fromAirport.lat)) * fraction, lon: Number(fromAirport.lon) + (Number(toAirport.lon) - Number(fromAirport.lon)) * fraction })
      continue
    }
    const a = Math.sin((1 - fraction) * angle) / sinAngle
    const b = Math.sin(fraction * angle) / sinAngle
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2)
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2)
    const z = a * Math.sin(lat1) + b * Math.sin(lat2)
    nodes.push({
      ident: index === 0 ? fromAirport.icao : index === steps ? toAirport.icao : '',
      lat: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI,
      lon: Math.atan2(y, x) * 180 / Math.PI
    })
  }
  return nodes
}

const buildServerFallbackPlan = ({ resolvedFrom, resolvedTo, normalizedFlight }) => {
  const nodes = greatCircleFallbackNodes(resolvedFrom, resolvedTo)
  const distanceNm = Math.round(distanceNmBetween(resolvedFrom, resolvedTo))
  return {
    id: \`fallback:\${resolvedFrom.icao}:\${resolvedTo.icao}\`,
    source: 'local-fallback',
    flightNumber: normalizedFlight || '',
    fromICAO: resolvedFrom.icao,
    toICAO: resolvedTo.icao,
    fromIATA: resolvedFrom.iata || '',
    toIATA: resolvedTo.iata || '',
    fromName: resolvedFrom.name || resolvedFrom.icao,
    toName: resolvedTo.name || resolvedTo.icao,
    fromRegionName: '',
    toRegionName: '',
    fromTimeZone: '',
    toTimeZone: '',
    distanceNm,
    maxAltitudeFt: 36000,
    waypoints: nodes.length,
    tags: ['server fallback'],
    popularity: 0,
    updatedAt: null,
    baseScore: 0,
    recommendationScore: 0,
    recommendationRank: 1,
    weatherLabel: 'Direct fallback · Flight Plan Database unavailable',
    differenceLabel: 'Server fallback · direct great-circle route',
    viaSummary: 'Direct',
    previewNodes: nodes,
    nodes
  }
}

${searchStart}`
      if (!transformed.includes(searchStart)) throw new Error('Could not locate flight-plan search for fallback helper')
      transformed = transformed.replace(searchStart, fallbackHelpers)

      const oldErrorExit = `  if (!searches.length && errors.length) throw errors[0]`
      const newErrorExit = `  if (!searches.length && errors.length) {
    const serverError = errors.find(error => [502, 503, 504].includes(Number(error?.status)))
    const canFallback = serverError && hasRoutePair && resolvedFrom?.icao && resolvedTo?.icao && Number.isFinite(Number(resolvedFrom?.lat)) && Number.isFinite(Number(resolvedFrom?.lon)) && Number.isFinite(Number(resolvedTo?.lat)) && Number.isFinite(Number(resolvedTo?.lon))
    if (canFallback) return [buildServerFallbackPlan({ resolvedFrom, resolvedTo, normalizedFlight })]
    throw errors[0]
  }`
      if (!transformed.includes(oldErrorExit)) throw new Error('Could not locate flight-plan server error exit')
      transformed = transformed.replace(oldErrorExit, newErrorExit)

      return { code: transformed, map: null }
    }

    if (normalizedId.endsWith('/src/App.vue')) {
      let transformed = code
      const oldFetch = `    const fetched = await fetchFlightPlan(selectedPlan.value.id)`
      const newFetch = `    const fetched = selectedPlan.value.source === 'local-fallback'
      ? { ...selectedPlan.value, nodes: selectedPlan.value.nodes || selectedPlan.value.previewNodes }
      : await fetchFlightPlan(selectedPlan.value.id)`
      if (!transformed.includes(oldFetch)) throw new Error('Could not locate selected plan fetch')
      transformed = transformed.replace(oldFetch, newFetch)

      const oldResultBlock = `    if (results.value.length) {
      selectedPlan.value = results.value[0]
      blockMinutes.value = estimateBlockMinutes(results.value[0].distanceNm)
      if (!activeTrip.value) setRouteAlternatives(results.value, results.value[0].id)
    } else setMessage('No matching plans found. Try adding departure and destination.', true)`
      const newResultBlock = `    if (results.value.length) {
      selectedPlan.value = results.value[0]
      blockMinutes.value = estimateBlockMinutes(results.value[0].distanceNm)
      if (!activeTrip.value) setRouteAlternatives(results.value, results.value[0].id)
      if (results.value[0]?.source === 'local-fallback') setMessage('Flight Plan Database is temporarily unavailable. Using a direct fallback route.')
    } else setMessage('No matching plans found. Try adding departure and destination.', true)`
      if (!transformed.includes(oldResultBlock)) throw new Error('Could not locate route search result block')
      transformed = transformed.replace(oldResultBlock, newResultBlock)
      return { code: transformed, map: null }
    }

    return null
  }
})

export default defineConfig({
  ...baseConfig,
  plugins: [routeAlignedAircraft(), ...(baseConfig.plugins || []), correctAheadView(), fpdServerFallback()]
})
