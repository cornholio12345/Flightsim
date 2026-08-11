import { describeGeoContext } from './geoContext'
import { positionAtProgress } from './routeUtils'

const toRad = value => Number(value) * Math.PI / 180
const toDeg = value => Number(value) * 180 / Math.PI
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const normalize180 = value => {
  let result = Number(value)
  while (result > 180) result -= 360
  while (result < -180) result += 360
  return result
}

const julianDate = timestamp => Number(timestamp) / 86_400_000 + 2440587.5

export const subsolarPoint = (timestamp = Date.now()) => {
  const jd = julianDate(timestamp)
  const days = jd - 2451545.0
  const meanAnomaly = toRad((357.529 + 0.98560028 * days) % 360)
  const meanLongitude = (280.459 + 0.98564736 * days) % 360
  const eclipticLongitude = toRad(meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.020 * Math.sin(2 * meanAnomaly))
  const obliquity = toRad(23.439 - 0.00000036 * days)
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude))
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude))
  const gmst = (280.1600 + 360.9856235 * days) % 360
  return {
    lat: toDeg(declination),
    lon: normalize180(toDeg(rightAscension) - gmst)
  }
}

const angularDistanceDeg = (lat1, lon1, lat2, lon2) => {
  const a = toRad(lat1)
  const b = toRad(lat2)
  const dLon = toRad(lon2 - lon1)
  const cosDistance = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dLon)
  return toDeg(Math.acos(clamp(cosDistance, -1, 1)))
}

const bearingTo = (lat1, lon1, lat2, lon2) => {
  const a = toRad(lat1)
  const b = toRad(lat2)
  const dLon = toRad(lon2 - lon1)
  const y = Math.sin(dLon) * Math.cos(b)
  const x = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dLon)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export const solarPassengerInfo = ({ lat, lon, bearing = 0, timestamp = Date.now() }) => {
  const sun = subsolarPoint(timestamp)
  const elevation = 90 - angularDistanceDeg(lat, lon, sun.lat, sun.lon)
  const sunBearing = bearingTo(lat, lon, sun.lat, sun.lon)
  const relative = normalize180(sunBearing - Number(bearing || 0))
  const side = relative >= 0 ? 'right' : 'left'

  const futureSun = subsolarPoint(timestamp + 5 * 60_000)
  const futureElevation = 90 - angularDistanceDeg(lat, lon, futureSun.lat, futureSun.lon)
  const nearHorizon = elevation >= -7 && elevation <= 8
  const horizonEvent = futureElevation < elevation ? 'Sunset' : 'Sunrise'

  let label
  if (nearHorizon) label = `${horizonEvent} on the ${side} · ${Math.round(elevation)}°`
  else if (elevation < -7) label = `Sun below horizon · ${side} side`
  else label = `Sun on the ${side} · ${Math.round(elevation)}° high`

  return { ...sun, elevation, sunBearing, relativeBearing: relative, side, nearHorizon, label }
}

const isWater = context => /ocean|sea|gulf|water/i.test(String(context || ''))

export const summarizeRouteContexts = route => {
  if (!route?.nodes?.length) return []
  const contexts = []
  for (let index = 0; index <= 40; index += 1) {
    const point = positionAtProgress(route, index / 40)
    const context = describeGeoContext(point.lat, point.lon)
    if (context && contexts[contexts.length - 1] !== context) contexts.push(context)
  }
  return contexts
}

export const buildPassengerMilestones = (route, blockMinutes) => {
  if (!route?.nodes?.length) return []
  const totalMinutes = Math.max(20, Number(blockMinutes || 0) || 240)
  const approachMinutes = Math.min(9, Math.max(6, totalMinutes * 0.025))
  const descentMinutes = Math.min(30, Math.max(18, totalMinutes * 0.09))
  const topOfDescentProgress = clamp((totalMinutes - descentMinutes - approachMinutes) / totalMinutes, 0.55, 0.93)

  const milestones = [
    { key: 'quarter', label: '25% complete', progress: 0.25 },
    { key: 'halfway', label: 'Halfway', progress: 0.5 },
    { key: 'threequarters', label: '75% complete', progress: 0.75 },
    { key: 'tod', label: 'Top of descent', progress: topOfDescentProgress }
  ]

  let previousContext = describeGeoContext(route.nodes[0].lat, route.nodes[0].lon)
  let sawOpenWater = isWater(previousContext)
  for (let index = 1; index <= 100; index += 1) {
    const progress = index / 100
    const point = positionAtProgress(route, progress)
    const context = describeGeoContext(point.lat, point.lon)
    const water = isWater(context)
    if (water) sawOpenWater = true
    if (sawOpenWater && isWater(previousContext) && !water && progress > 0.08 && progress < 0.95) {
      milestones.push({ key: 'landfall', label: `Landfall · ${context}`, progress })
      break
    }
    previousContext = context
  }

  return milestones
    .map(item => {
      const point = positionAtProgress(route, item.progress)
      return {
        ...item,
        minute: Math.round(totalMinutes * item.progress),
        context: describeGeoContext(point.lat, point.lon),
        lat: point.lat,
        lon: point.lon
      }
    })
    .sort((a, b) => a.progress - b.progress)
}
