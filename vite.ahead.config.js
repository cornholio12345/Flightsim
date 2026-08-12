import { defineConfig } from 'vite'
import routeConfig from './vite.route.config.js'

const closeAheadComposition = () => ({
  name: 'flightsim-close-ahead-composition',
  enforce: 'post',
  transform(code, id) {
    const normalizedId = id.replace(/\\/g, '/')
    if (!normalizedId.endsWith('/src/utils/globeUtils.js')) return null

    const oldBlock = `    const focusAhead = THREE.MathUtils.lerp(0.028, 0.24, easedZoomIn)
    const noseFocus = aircraftWorld.clone().addScaledVector(targetForward, focusAhead)
    camera.position.x = 0
    camera.position.y = 0.08
    camera.up.set(0, 1, 0)
    camera.lookAt(noseFocus)`

    const newBlock = `    // Ahead is a forward-looking view, not an aircraft-centred view. Keep a
    // substantial piece of the actual route in the middle of the screen. At
    // maximum zoom the visual target is about 20 degrees ahead of the aircraft.
    const desiredAheadAngle = THREE.MathUtils.lerp(0.24, 0.36, easedZoomIn)
    let routeFocus = null

    if (routeSamples.length > 1) {
      const aircraftLocalNormal = latLonVector(aircraftState.lat, aircraftState.lon, 1).normalize()
      let nearestIndex = 0
      let nearestDistance = Infinity
      routeSamples.forEach((sample, index) => {
        const distance = sample.point.clone().normalize().distanceToSquared(aircraftLocalNormal)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestIndex = index
        }
      })

      let focusIndex = Math.min(routeSamples.length - 1, nearestIndex + 1)
      for (let index = focusIndex; index < routeSamples.length; index += 1) {
        const sampleNormal = routeSamples[index].point.clone().normalize()
        const angle = Math.acos(THREE.MathUtils.clamp(aircraftLocalNormal.dot(sampleNormal), -1, 1))
        focusIndex = index
        if (angle >= desiredAheadAngle) break
      }

      if (focusIndex > nearestIndex) {
        routeFocus = routeSamples[focusIndex].point.clone()
        earthGroup.localToWorld(routeFocus)
      }
    }

    if (!routeFocus) {
      const surfaceFocusNormal = targetNormal.clone()
        .multiplyScalar(Math.cos(desiredAheadAngle))
        .addScaledVector(targetForward, Math.sin(desiredAheadAngle))
        .normalize()
      routeFocus = surfaceFocusNormal.multiplyScalar(ROUTE_RADIUS)
    }

    // Keep the camera itself neutral. Moving the LOOK-AT point far ahead rotates
    // the whole composition forward while keeping Earth dominant in the frame.
    camera.position.x = 0
    camera.position.y = 0.08
    camera.up.set(0, 1, 0)
    camera.lookAt(routeFocus)`

    if (!code.includes(oldBlock)) throw new Error('Could not locate final Ahead zoom composition block')
    let transformed = code.replace(oldBlock, newBlock)

    // The full aircraft sprite is deliberately hidden in Ahead mode. A clipped
    // nose marker is drawn by CSS at the lower screen edge, so wings can never
    // cover the map we are trying to inspect.
    const visibleLine = `  aircraft.visible = true`
    const aheadVisibleLine = `  aircraft.visible = globeCameraMode !== 'ahead'`
    if (!transformed.includes(visibleLine)) throw new Error('Could not locate aircraft visibility update')
    transformed = transformed.replace(visibleLine, aheadVisibleLine)

    const modeState = `  globeCameraMode = requested\n  followAircraft = requested === 'follow'`
    const modeStateWithVisibility = `  globeCameraMode = requested\n  followAircraft = requested === 'follow'\n  if (aircraft) aircraft.visible = requested !== 'ahead'`
    if (!transformed.includes(modeState)) throw new Error('Could not locate globe camera mode state')
    transformed = transformed.replace(modeState, modeStateWithVisibility)

    return { code: transformed, map: null }
  }
})

export default defineConfig({
  ...routeConfig,
  plugins: [...(routeConfig.plugins || []), closeAheadComposition()]
})
