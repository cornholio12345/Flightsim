const EARTH_RADIUS_NM = 3440.065
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const toRad = value => value * Math.PI / 180
const toDeg = value => value * 180 / Math.PI
const smoothStep = value => {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}
const easeOutCubic = value => 1 - Math.pow(1 - clamp(value, 0, 1), 3)

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
    .map(node => ({
      ...node,
      lat: Number(node.lat),
      lon: Number(node.lon),
      altitudeFt: Number(node.altitudeFt ?? node.alt ?? 0)
    }))

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

const segmentAtDistance = (route, targetNm) => {
  const nodes = route.nodes
  let endIndex = nodes.findIndex(node => node.distanceFromStartNm >= targetNm)
  if (endIndex <= 0) endIndex = 1
  const start = nodes[endIndex - 1]
  const end = nodes[endIndex]
  const segmentNm = Math.max(0.0001, end.distanceFromStartNm - start.distanceFromStartNm)
  const segmentProgress = clamp((targetNm - start.distanceFromStartNm) / segmentNm, 0, 1)
  return { start, end, segmentProgress, endIndex }
}

export const positionAtProgress = (preparedRoute, progress) => {
  const route = preparedRoute?.nodes ? preparedRoute : prepareRoute(preparedRoute)
  const p = clamp(Number(progress || 0), 0, 1)
  const targetNm = route.totalNm * p
  const nodes = route.nodes

  if (p <= 0) {
    const next = nodes[1]
    return {
      ...nodes[0],
      progress: 0,
      nextIdent: next?.ident || null,
      distanceFromStartNm: 0,
      bearing: next ? calculateBearing(nodes[0].lat, nodes[0].lon, next.lat, next.lon) : 0
    }
  }
  if (p >= 1) return { ...nodes[nodes.length - 1], progress: 1, nextIdent: null, bearing: 0 }

  const { start, end, segmentProgress } = segmentAtDistance(route, targetNm)
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

const plannedAltitudeAtProgress = (route, progress) => {
  const targetNm = route.totalNm * clamp(progress, 0, 1)
  const { start, end, segmentProgress } = segmentAtDistance(route, targetNm)
  const startAlt = Number(start.altitudeFt || 0)
  const endAlt = Number(end.altitudeFt || 0)
  if (startAlt <= 0 && endAlt <= 0) return null
  if (startAlt > 0 && endAlt > 0) return startAlt + (endAlt - startAlt) * segmentProgress
  return startAlt > 0 ? startAlt : endAlt
}

const inferredCruiseAltitude = (route, fallback) => {
  const planned = route.nodes
    .map(node => Number(node.altitudeFt || 0))
    .filter(value => value >= 10000 && value <= 50000)
    .sort((a, b) => a - b)
  if (!planned.length) return fallback
  return planned[Math.floor(planned.length / 2)]
}

const nextWaypointInfo = (route, position, speedKt) => {
  const currentNm = Number(position.distanceFromStartNm || 0)
  const next = route.nodes.find((node, index) => index > 0 && node.distanceFromStartNm > currentNm + 0.05)
  if (!next) return { nextIdent: null, distanceToNextNm: 0, minutesToNext: 0 }
  const distanceToNextNm = Math.max(0, next.distanceFromStartNm - currentNm)
  const minutesToNext = speedKt > 40 ? (distanceToNextNm / speedKt) * 60 : null
  return {
    nextIdent: next.ident || next.name || null,
    distanceToNextNm,
    minutesToNext
  }
}

export const getFlightState = ({
  route,
  progress,
  elapsedMinutes = null,
  blockMinutes = null,
  cruiseAltitudeFt = 36000,
  cruiseSpeedKt = 465
}) => {
  const prepared = route?.nodes ? route : prepareRoute(route)
  const p = clamp(Number(progress || 0), 0, 1)
  const position = positionAtProgress(prepared, p)
  const totalMinutes = Math.max(20, Number(blockMinutes || 0) || 240)
  const elapsed = Number.isFinite(Number(elapsedMinutes))
    ? clamp(Number(elapsedMinutes), 0, totalMinutes)
    : totalMinutes * p
  const remainingMinutes = Math.max(0, totalMinutes - elapsed)

  const requestedCruiseAltitude = clamp(Number(cruiseAltitudeFt || 36000), 18000, 43000)
  const cruiseAltitude = clamp(inferredCruiseAltitude(prepared, requestedCruiseAltitude), 18000, 43000)
  const cruiseSpeed = clamp(Number(cruiseSpeedKt || 465), 250, 560)

  const takeoffMinutes = Math.min(4, Math.max(2.5, totalMinutes * 0.012))
  const climbMinutes = Math.min(24, Math.max(14, totalMinutes * 0.075))
  const approachMinutes = Math.min(9, Math.max(6, totalMinutes * 0.025))
  const descentMinutes = Math.min(30, Math.max(18, totalMinutes * 0.09))

  let phase = 'Cruise'
  let altitudeFt = cruiseAltitude
  let speedKt = cruiseSpeed

  if (elapsed < takeoffMinutes) {
    const f = elapsed / takeoffMinutes
    phase = 'Takeoff'
    altitudeFt = 2500 * smoothStep(f)
    speedKt = 185 * easeOutCubic(f)
  } else if (elapsed < takeoffMinutes + climbMinutes) {
    const f = (elapsed - takeoffMinutes) / climbMinutes
    phase = 'Climb'
    altitudeFt = 2500 + (cruiseAltitude - 2500) * Math.sin((clamp(f, 0, 1) * Math.PI) / 2)
    speedKt = 185 + (cruiseSpeed - 185) * easeOutCubic(Math.min(1, f * 1.35))
  } else if (remainingMinutes <= approachMinutes) {
    const f = 1 - (remainingMinutes / approachMinutes)
    phase = 'Approach'
    altitudeFt = 3200 * Math.pow(1 - clamp(f, 0, 1), 1.2)
    speedKt = 205 - 70 * smoothStep(f)
  } else if (remainingMinutes <= descentMinutes + approachMinutes) {
    const descentElapsed = descentMinutes + approachMinutes - remainingMinutes
    const f = clamp(descentElapsed / descentMinutes, 0, 1)
    phase = 'Descent'
    altitudeFt = 3200 + (cruiseAltitude - 3200) * Math.cos((f * Math.PI) / 2)
    speedKt = cruiseSpeed - (cruiseSpeed - 205) * smoothStep(f)
  } else {
    const plannedAltitude = plannedAltitudeAtProgress(prepared, p)
    if (Number.isFinite(plannedAltitude) && plannedAltitude >= 10000) {
      altitudeFt = clamp(plannedAltitude, 10000, 43000)
    }
  }

  speedKt = Math.max(0, speedKt)
  altitudeFt = Math.max(0, altitudeFt)
  const waypoint = nextWaypointInfo(prepared, position, speedKt)

  return {
    ...position,
    ...waypoint,
    phase,
    altitudeFt: Math.round(altitudeFt / 100) * 100,
    speedKt: Math.round(speedKt),
    travelledNm: Math.round(prepared.totalNm * p),
    remainingNm: Math.max(0, Math.round(prepared.totalNm * (1 - p))),
    elapsedMinutes,
    remainingMinutes
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
