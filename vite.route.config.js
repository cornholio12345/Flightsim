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

    return { code: transformed, map: null }
  }
})

export default defineConfig({
  ...baseConfig,
  plugins: [routeAlignedAircraft(), ...(baseConfig.plugins || []), correctAheadView()]
})