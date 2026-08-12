import { defineConfig } from 'vite'
import routeConfig from './vite.route.config.js'

const opticalAheadView = () => ({
  name: 'flightsim-optical-ahead-view',
  enforce: 'post',
  transform(code, id) {
    const normalizedId = id.replace(/\\/g, '/')
    if (!normalizedId.endsWith('/src/utils/globeUtils.js')) return null

    let transformed = code

    // Ahead uses an optical zoom: camera distance stays fixed and pinch/wheel
    // changes only the field of view. The real aircraft point is re-anchored at
    // the bottom of the viewport after every zoom, so the map always starts at
    // the current position and expands forward along the route.
    const modeState = `let globeCameraMode = 'free'`
    const opticalState = `let globeCameraMode = 'free'\nlet aheadFov = 40\nconst AHEAD_CAMERA_Z = 3.55\nconst AHEAD_MIN_FOV = 12\nconst AHEAD_MAX_FOV = 46\nconst AHEAD_AIRCRAFT_NDC_Y = -1.075\nconst AHEAD_AIRCRAFT_SCREEN_HEIGHT = 0.20`
    if (!transformed.includes(modeState)) throw new Error('Could not locate globe camera state')
    transformed = transformed.replace(modeState, opticalState)

    const orientStart = `const orientAhead = () => {`
    const anchorHelper = `const aheadTargetNormal = () => {\n  // Solve the surface normal that projects the actual aircraft point to a\n  // stable screen Y. Camera position and look direction are fixed in Ahead,\n  // while FOV changes like binocular magnification.\n  const fov = THREE.MathUtils.clamp(Number(camera?.fov || aheadFov), AHEAD_MIN_FOV, AHEAD_MAX_FOV)\n  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov) / 2)\n  let low = -0.97\n  let high = -0.01\n  for (let iteration = 0; iteration < 28; iteration += 1) {\n    const y = (low + high) / 2\n    const z = Math.sqrt(Math.max(0.000001, 1 - y * y))\n    const depth = Math.max(0.05, AHEAD_CAMERA_Z - ROUTE_RADIUS * z)\n    const projectedY = (ROUTE_RADIUS * y) / (depth * tanHalf)\n    if (projectedY < AHEAD_AIRCRAFT_NDC_Y) low = y\n    else high = y\n  }\n  const y = (low + high) / 2\n  return new THREE.Vector3(0, y, Math.sqrt(Math.max(0.000001, 1 - y * y))).normalize()\n}\n\n${orientStart}`
    if (!transformed.includes(orientStart)) throw new Error('Could not locate Ahead orientation function')
    transformed = transformed.replace(orientStart, anchorHelper)

    const staticTargetNormal = `  const targetNormal = new THREE.Vector3(0, 0.24, 1).normalize()`
    const anchoredTargetNormal = `  const targetNormal = aheadTargetNormal()`
    if (!transformed.includes(staticTargetNormal)) throw new Error('Could not locate transformed Ahead target normal')
    transformed = transformed.replace(staticTargetNormal, anchoredTargetNormal)

    const oldFocusBlock = `    const focusAhead = THREE.MathUtils.lerp(0.028, 0.24, easedZoomIn)\n    const noseFocus = aircraftWorld.clone().addScaledVector(targetForward, focusAhead)\n    camera.position.x = 0\n    camera.position.y = 0.08\n    camera.up.set(0, 1, 0)\n    camera.lookAt(noseFocus)`
    const opticalFocusBlock = `    // Keep the optical axis fixed. Earth orientation places the real aircraft\n    // just below the screen edge and the actual route tangent straight ahead.\n    // Zoom is handled exclusively through camera.fov.\n    camera.position.set(0, 0, AHEAD_CAMERA_Z)\n    camera.fov = aheadFov\n    camera.up.set(0, 1, 0)\n    camera.lookAt(0, 0, 0)\n    camera.updateProjectionMatrix()`
    if (!transformed.includes(oldFocusBlock)) throw new Error('Could not locate transformed Ahead focus block')
    transformed = transformed.replace(oldFocusBlock, opticalFocusBlock)

    const oldScaleBlock = `const updateAircraftScale = () => {\n  if (!aircraft?.visible || !camera) return\n  const worldPosition = new THREE.Vector3()\n  aircraft.getWorldPosition(worldPosition)\n  const distance = camera.position.distanceTo(worldPosition)\n  const scale = THREE.MathUtils.clamp(distance * 0.043, AIRCRAFT_MIN_SCALE, AIRCRAFT_MAX_SCALE)\n  aircraft.scale.set(scale, scale, 1)\n}`
    const opticalScaleBlock = `const updateAircraftScale = () => {\n  if (!aircraft?.visible || !camera) return\n  const worldPosition = new THREE.Vector3()\n  aircraft.getWorldPosition(worldPosition)\n  const distance = camera.position.distanceTo(worldPosition)\n  if (globeCameraMode === 'ahead') {\n    // Preserve a constant on-screen aircraft size while FOV changes. With the\n    // aircraft centre just below NDC -1, this leaves only the real sprite nose\n    // clipped into the viewport; wings remain outside the screen.\n    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)\n    const scale = Math.max(0.012, distance * tanHalf * AHEAD_AIRCRAFT_SCREEN_HEIGHT)\n    aircraft.scale.set(scale, scale, 1)\n    return\n  }\n  const scale = THREE.MathUtils.clamp(distance * 0.043, AIRCRAFT_MIN_SCALE, AIRCRAFT_MAX_SCALE)\n  aircraft.scale.set(scale, scale, 1)\n}`
    if (!transformed.includes(oldScaleBlock)) throw new Error('Could not locate aircraft scale block')
    transformed = transformed.replace(oldScaleBlock, opticalScaleBlock)

    const oldSetZoom = `  const setZoom = value => {\n    if (camera) camera.position.z = THREE.MathUtils.clamp(value, MIN_CAMERA_Z, MAX_CAMERA_Z)\n    markInteraction()\n  }`
    const opticalSetZoom = `  const setZoom = value => {\n    if (camera) {\n      if (globeCameraMode === 'ahead') {\n        // Existing pinch/wheel callers express zoom as a requested camera-Z.\n        // Convert that relative change into FOV instead, leaving camera-Z fixed.\n        const ratio = THREE.MathUtils.clamp(Number(value) / AHEAD_CAMERA_Z, 0.62, 1.62)\n        aheadFov = THREE.MathUtils.clamp(aheadFov * ratio, AHEAD_MIN_FOV, AHEAD_MAX_FOV)\n        camera.position.set(0, 0, AHEAD_CAMERA_Z)\n        camera.fov = aheadFov\n        camera.up.set(0, 1, 0)\n        camera.lookAt(0, 0, 0)\n        camera.updateProjectionMatrix()\n        orientAhead()\n      } else {\n        camera.fov = 48\n        camera.position.z = THREE.MathUtils.clamp(value, MIN_CAMERA_Z, MAX_CAMERA_Z)\n        camera.updateProjectionMatrix()\n      }\n    }\n    markInteraction()\n  }`
    if (!transformed.includes(oldSetZoom)) throw new Error('Could not locate globe zoom handler')
    transformed = transformed.replace(oldSetZoom, opticalSetZoom)

    const dragGuard = `    if (!dragging || !earthGroup) return`
    const aheadDragGuard = `    if (!dragging || !earthGroup) return\n    // Ahead is a sight line, not a free globe. One-finger drag must not break\n    // the aircraft anchor; pinch remains available above for optical zoom.\n    if (globeCameraMode === 'ahead') return`
    if (!transformed.includes(dragGuard)) throw new Error('Could not locate globe drag guard')
    transformed = transformed.replace(dragGuard, aheadDragGuard)

    const cameraModeState = `  globeCameraMode = requested\n  followAircraft = requested === 'follow'`
    const cameraModeStateWithFov = `  globeCameraMode = requested\n  followAircraft = requested === 'follow'\n  if (camera && requested !== 'ahead' && camera.fov !== 48) {\n    camera.fov = 48\n    camera.updateProjectionMatrix()\n  }`
    if (!transformed.includes(cameraModeState)) throw new Error('Could not locate globe camera mode assignment')
    transformed = transformed.replace(cameraModeState, cameraModeStateWithFov)

    const oldAheadEntry = `  if (requested === 'ahead') {\n    orientAhead()\n    if (camera && camera.position.z > 3.8) camera.position.z = 3.55\n  }`
    const opticalAheadEntry = `  if (requested === 'ahead') {\n    if (camera) {\n      camera.position.set(0, 0, AHEAD_CAMERA_Z)\n      camera.fov = aheadFov\n      camera.up.set(0, 1, 0)\n      camera.lookAt(0, 0, 0)\n      camera.updateProjectionMatrix()\n    }\n    orientAhead()\n  }`
    if (!transformed.includes(oldAheadEntry)) throw new Error('Could not locate Ahead mode entry block')
    transformed = transformed.replace(oldAheadEntry, opticalAheadEntry)

    return { code: transformed, map: null }
  }
})

export default defineConfig({
  ...routeConfig,
  plugins: [...(routeConfig.plugins || []), opticalAheadView()]
})
