import { defineConfig } from 'vite'
import baseConfig from './vite.config.js'

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

  // Prefer the tangent of the actual rendered route. That keeps the aircraft nose
  // glued to the route even on long great-circle legs where a raw bearing can drift.
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
      const oldBlock = `    planeElement.style.transform = \`translate(-50%, -50%) rotate(\${Number(aircraftState.bearing || 0) - 45}deg)\``
      const newBlock = `    let rotationDeg = Number(aircraftState.bearing || 0) - 45
    const routePoint = coordinateAtProgress(currentProgress)
    if (routePoint && routeSamples.length > 1) {
      const nextIndex = Math.min(routeSamples.length - 1, Math.max(routePoint.upperIndex, routePoint.lowerIndex + 1))
      const nextCoord = routeSamples[nextIndex]?.coord
      if (nextCoord) {
        const nextPoint = screenPoint(nextCoord)
        const dx = nextPoint.x - point.x
        const dy = nextPoint.y - point.y
        if (Math.hypot(dx, dy) > 0.5) rotationDeg = Math.atan2(dy, dx) * 180 / Math.PI + 45
      }
    }
    planeElement.style.transform = \`translate(-50%, -50%) rotate(\${rotationDeg}deg)\``
      if (!code.includes(oldBlock)) throw new Error('Could not locate detail-map aircraft rotation block')
      return { code: code.replace(oldBlock, newBlock), map: null }
    }

    return null
  }
})

export default defineConfig({
  ...baseConfig,
  plugins: [routeAlignedAircraft(), ...(baseConfig.plugins || [])]
})
