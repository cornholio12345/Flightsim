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

    const newBlock = `    // At close zoom the aircraft must stay low in frame so the map in front of
    // the nose remains visible. Keep the wide view subtle, then progressively
    // look farther along the route and lift the camera as we approach max zoom.
    const focusAhead = THREE.MathUtils.lerp(0.028, 0.85, easedZoomIn)
    const cameraLift = THREE.MathUtils.lerp(0.08, 0.18, easedZoomIn)
    const noseFocus = aircraftWorld.clone().addScaledVector(targetForward, focusAhead)
    camera.position.x = 0
    camera.position.y = cameraLift
    camera.up.set(0, 1, 0)
    camera.lookAt(noseFocus)`

    if (!code.includes(oldBlock)) throw new Error('Could not locate final Ahead zoom composition block')
    return { code: code.replace(oldBlock, newBlock), map: null }
  }
})

export default defineConfig({
  ...routeConfig,
  plugins: [...(routeConfig.plugins || []), closeAheadComposition()]
})
