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

    const newBlock = `    // Ahead must look at the route in FRONT of the aircraft, not merely shift
    // the camera around the aircraft. At close zoom pick a real route sample
    // ahead of the current position and keep that piece of Earth in the centre.
    const desiredAheadAngle = THREE.MathUtils.lerp(0.012, 0.075, easedZoomIn)
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

    // Lens composition: the route ahead owns the centre of the view. The
    // aircraft stays low as a reference, with progressively more offset only
    // when zooming close. This preserves map detail instead of showing sky.
    const cameraLift = THREE.MathUtils.lerp(0.08, 0.25, easedZoomIn)
    camera.position.x = 0
    camera.position.y = cameraLift
    camera.up.set(0, 1, 0)
    camera.lookAt(routeFocus)`

    if (!code.includes(oldBlock)) throw new Error('Could not locate final Ahead zoom composition block')
    return { code: code.replace(oldBlock, newBlock), map: null }
  }
})

export default defineConfig({
  ...routeConfig,
  plugins: [...(routeConfig.plugins || []), closeAheadComposition()]
})
