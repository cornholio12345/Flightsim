const EARTH_RADIUS_NM = 3440.065
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const toRad = value => value * Math.PI / 180
const toDeg = value => value * 180 / Math.PI

export const calculateDistanceNm = (lat1, lon1, lat2, lon2) => {
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dPhi = toRad(lat2 - lat1)
  const dLambda = toRad(lon2 - lon1)
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  return 2 * EARTH_RADIUS_NM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dLambda = toRad(lon2 - lon1)
  const y = Math.sin(dLambda) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

const interpolateGreatCircle = (start, end, fraction) => {
  const f = clamp(fraction, 0, 1)
  const lat1 = toRad(start.lat)
  const lon1 = toRad(start.lon)
  const lat2 = toRad(end.lat)
  const lon2 = toRad(end.lon)
  const angular = calculateDistanceNm(start.lat, start.lon, end.lat, end.lon) / EARTH_RADIUS_NM

  if (angular < 1e-8) return { lat: start.lat, lon: start.lon }

  const sinAngular = Math.sin(angular)
  const a = Math.sin((1 - f) * angular) / sinAngular
  const b = Math.sin(f * angular) / sinAngular
  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2)
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2)
  const z = a * Math.sin(lat1) + b * Math.sin(lat2)
  return {
    lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lon: toDeg(Math.atan2(y, x))
  }
}

export const prepareRoute = rawNodes => {
  const nodes = (rawNodes || [])
    .filter(node => Number.isFinite(Number(node?.lat)) && Number.isFinite(Number(node?.lon)))
    .map(node => ({ ...node, lat: Number(node.lat), lon: Number(node.lon) }))

  if (nodes.length < 2) throw new Error('A route needs at least two valid points.')

  let cumulativeNm = 0
  const prepared = nodes.map((node, index) => {
    if (index > 0) {
      const previous = nodes[index - 1]
      cumulativeNm += calculateDistanceNm(previous.lat, previous.lon, node.lat, node.lon)
    }
    return { ...node, distanceFromStartNm: cumulativeNm }
  })

  return { nodes: prepared, totalNm: cumulativeNm }
}

export const positionAtProgress = (preparedRoute, progress) => {
  const route = preparedRoute?.nodes ? preparedRoute : prepareRoute(preparedRoute)
  const p = clamp(Number(progress || 0), 0, 1)
  const targetNm = route.totalNm * p
  const nodes = route.nodes

  if (p <= 0) return { ...nodes[0], progress: 0 }
  if (p >= 1) return { ...nodes[nodes.length - 1], progress: 1 }

  let endIndex = nodes.findIndex(node => node.distanceFromStartNm >= targetNm)
  if (endIndex <= 0) endIndex = 1
  const start = nodes[endIndex - 1]
  const end = nodes[endIndex]
  const segmentNm = Math.max(0.0001, end.distanceFromStartNm - start.distanceFromStartNm)
  const segmentProgress = (targetNm - start.distanceFromStartNm) / segmentNm
  const point = interpolateGreatCircle(start, end, segmentProgress)

  return {
    ...point,
    progress: p,
    ident: segmentProgress < 0.5 ? start.ident : end.ident,
    nextIdent: end.ident || null,
    distanceFromStartNm: targetNm,
    bearing: calculateBearing(start.lat, start.lon, end.lat, end.lon)
  }
}

export const getFlightState = ({ route, progress, cruiseAltitudeFt = 36000, cruiseSpeedKt = 465 }) => {
  const prepared = route?.nodes ? route : prepareRoute(route)
  const p = clamp(Number(progress || 0), 0, 1)
  const position = positionAtProgress(prepared, p)
  const takeoffEnd = 0.01
  const climbEnd = 0.12
  const descentStart = 0.86
  const cruiseAltitude = clamp(Number(cruiseAltitudeFt || 36000), 18000, 43000)
  const cruiseSpeed = clamp(Number(cruiseSpeedKt || 465), 250, 560)

  let phase = 'Cruise'
  let altitudeFt = cruiseAltitude
  let speedKt = cruiseSpeed

  if (p < takeoffEnd) {
    const f = p / takeoffEnd
    phase = 'Takeoff'
    altitudeFt = 1500 * Math.pow(f, 1.8)
    speedKt = 170 * Math.min(1, f * 1.15)
  } else if (p < climbEnd) {
    const f = (p - takeoffEnd) / (climbEnd - takeoffEnd)
    phase = 'Climb'
    altitudeFt = 1500 + (cruiseAltitude - 1500) * Math.sin((f * Math.PI) / 2)
    speedKt = 170 + (cruiseSpeed - 170) * f
  } else if (p > descentStart) {
    const f = (p - descentStart) / (1 - descentStart)
    phase = f > 0.9 ? 'Approach' : 'Descent'
    altitudeFt = cruiseAltitude * Math.cos((f * Math.PI) / 2)
    speedKt = cruiseSpeed - (cruiseSpeed - 150) * f
  }

  return {
    ...position,
    phase,
    altitudeFt: Math.max(0, Math.round(altitudeFt / 100) * 100),
    speedKt: Math.max(0, Math.round(speedKt)),
    travelledNm: Math.round(prepared.totalNm * p),
    remainingNm: Math.max(0, Math.round(prepared.totalNm * (1 - p)))
  }
}

export const nearestProgressOnRoute = (preparedRoute, lat, lon) => {
  const route = preparedRoute?.nodes ? preparedRoute : prepareRoute(preparedRoute)
  let best = { progress: 0, distanceNm: Infinity }

  route.nodes.slice(0, -1).forEach((start, index) => {
    const end = route.nodes[index + 1]
    const segmentStartNm = start.distanceFromStartNm
    const segmentNm = end.distanceFromStartNm - segmentStartNm
    const samples = Math.max(4, Math.min(30, Math.ceil(segmentNm / 25)))

    for (let i = 0; i <= samples; i += 1) {
      const f = i / samples
      const point = interpolateGreatCircle(start, end, f)
      const distanceNm = calculateDistanceNm(lat, lon, point.lat, point.lon)
      if (distanceNm < best.distanceNm) {
        best = {
          progress: route.totalNm ? (segmentStartNm + segmentNm * f) / route.totalNm : 0,
          distanceNm
        }
      }
    }
  })

  return best
}

export const formatDuration = minutes => {
  const total = Math.max(0, Math.round(Number(minutes || 0)))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  return `${hours}h ${String(mins).padStart(2, '0')}m`
}
