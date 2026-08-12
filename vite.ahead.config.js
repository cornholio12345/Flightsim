import { defineConfig } from 'vite'
import routeConfig from './vite.route.config.js'

const replaceSection = (code, startMarker, endMarker, replacement, label) => {
  const start = code.indexOf(startMarker)
  const end = code.indexOf(endMarker, start + startMarker.length)
  if (start < 0 || end < 0) throw new Error(`Could not locate ${label}`)
  return `${code.slice(0, start)}${replacement}${code.slice(end)}`
}

const opticalAheadView = () => ({
  name: 'flightsim-optical-ahead-view',
  enforce: 'post',
  transform(code, id) {
    const normalizedId = id.replace(/\\/g, '/')
    if (!normalizedId.endsWith('/src/utils/globeUtils.js')) return null

    let transformed = code

    // Ahead is a nose-camera-like view of the globe. At the widest FOV the
    // real aircraft point sits just below the lower edge and the Earth horizon
    // is roughly 20% below the top edge. Route-forward must recede away from
    // the camera. As FOV narrows, the principal point blends toward a route
    // target ahead, so the aircraft and horizon may leave frame while the zoom
    // stays focused in the destination direction.
    const modeState = `let globeCameraMode = 'free'`
    const opticalState = `let globeCameraMode = 'free'\nlet aheadFov = 30\nlet aheadFocusWorld = null\nconst AHEAD_CAMERA_Z = 3.55\nconst AHEAD_BASE_FOV = 30\nconst AHEAD_MIN_FOV = 6\nconst AHEAD_MAX_FOV = 30\nconst AHEAD_WIDE_AIRCRAFT_NDC_Y = -1.02\nconst AHEAD_FOCUS_MAX_ARC = THREE.MathUtils.degToRad(18)\nconst AHEAD_TARGET_NORMAL = new THREE.Vector3(0, 0.19218855364791623, 1).normalize()`
    if (!transformed.includes(modeState)) throw new Error('Could not locate globe camera state')
    transformed = transformed.replace(modeState, opticalState)

    // Use the same aircraft silhouette as Detail Map for Globe and Ahead. The
    // Detail Map keeps its SVG; the Three.js sprite renders the identical path
    // into a canvas texture so all map modes share one visual aircraft shape.
    const detailMapAircraftTexture = `const buildPlaneTexture = () => {\n  const canvas = document.createElement('canvas')\n  canvas.width = 160\n  canvas.height = 160\n  const context = canvas.getContext('2d')\n  context.save()\n  context.translate(16, 8)\n  context.scale(4, 4)\n  context.beginPath()\n  context.moveTo(16, 1)\n  context.lineTo(19, 11)\n  context.lineTo(30, 17)\n  context.lineTo(30, 21)\n  context.lineTo(19, 19)\n  context.lineTo(18, 28)\n  context.lineTo(23, 31)\n  context.lineTo(23, 34)\n  context.lineTo(16, 32)\n  context.lineTo(9, 34)\n  context.lineTo(9, 31)\n  context.lineTo(14, 28)\n  context.lineTo(13, 19)\n  context.lineTo(2, 21)\n  context.lineTo(2, 17)\n  context.lineTo(13, 11)\n  context.closePath()\n  context.fillStyle = '#ffffff'\n  context.shadowColor = 'rgba(0, 0, 0, 0.55)'\n  context.shadowBlur = 1.5\n  context.fill()\n  context.shadowBlur = 0\n  context.strokeStyle = 'rgba(5, 24, 34, 0.9)'\n  context.lineWidth = 1.2\n  context.lineJoin = 'round'\n  context.stroke()\n  context.restore()\n  const texture = new THREE.CanvasTexture(canvas)\n  texture.minFilter = THREE.LinearFilter\n  texture.magFilter = THREE.LinearFilter\n  texture.needsUpdate = true\n  return texture\n}\n\n`
    transformed = replaceSection(
      transformed,
      `const buildPlaneTexture = () => {`,
      `const buildTagTexture = (text, accent) => {`,
      detailMapAircraftTexture,
      'aircraft texture section'
    )

    const projectionHelpers = `const aheadOpticalScale = () => globeCameraMode === 'ahead'\n  ? Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(AHEAD_BASE_FOV) / 2)\n  : 1\n\nconst resetStandardProjection = () => {\n  if (!camera) return\n  camera.clearViewOffset?.()\n  camera.fov = 48\n  camera.updateProjectionMatrix()\n}\n\nconst applyAheadProjection = () => {\n  if (!camera || !renderer || !aircraft?.visible || globeCameraMode !== 'ahead') return false\n\n  aheadFov = THREE.MathUtils.clamp(Number(aheadFov || AHEAD_BASE_FOV), AHEAD_MIN_FOV, AHEAD_MAX_FOV)\n  camera.clearViewOffset?.()\n  camera.fov = aheadFov\n  camera.position.set(0, 0, AHEAD_CAMERA_Z)\n  camera.up.set(0, 1, 0)\n  camera.lookAt(0, 0, 0)\n  camera.updateMatrixWorld(true)\n  camera.updateProjectionMatrix()\n\n  const aircraftWorld = new THREE.Vector3()\n  aircraft.getWorldPosition(aircraftWorld)\n  const centeredAircraft = aircraftWorld.clone().project(camera)\n  const centeredFocus = aheadFocusWorld?.clone?.().project(camera) || null\n  const canvas = renderer.domElement\n  const width = Math.max(1, Number(canvas?.clientWidth || canvas?.width || 1))\n  const height = Math.max(1, Number(canvas?.clientHeight || canvas?.height || 1))\n\n  const wideOffsetX = 0\n  const wideOffsetY = (AHEAD_WIDE_AIRCRAFT_NDC_Y - centeredAircraft.y) * height / 2\n  const focusOffsetX = centeredFocus ? centeredFocus.x * width / 2 : wideOffsetX\n  const focusOffsetY = centeredFocus ? -centeredFocus.y * height / 2 : wideOffsetY\n  const zoomProgress = THREE.MathUtils.clamp(\n    (AHEAD_MAX_FOV - aheadFov) / Math.max(1e-6, AHEAD_MAX_FOV - AHEAD_MIN_FOV),\n    0,\n    1\n  )\n  const focusBlend = zoomProgress * zoomProgress * (3 - 2 * zoomProgress)\n  const offsetX = THREE.MathUtils.lerp(wideOffsetX, focusOffsetX, focusBlend)\n  const offsetY = THREE.MathUtils.lerp(wideOffsetY, focusOffsetY, focusBlend)\n\n  camera.setViewOffset(width, height, offsetX, offsetY, width, height)\n  camera.updateProjectionMatrix()\n  return true\n}\n\n`

    const orientAhead = `const orientAhead = () => {\n  if (!earthGroup || !aircraftState) return false\n\n  const normal = latLonVector(aircraftState.lat, aircraftState.lon, 1).normalize()\n  const aircraftPoint = latLonVector(aircraftState.lat, aircraftState.lon, ROUTE_RADIUS)\n  let aheadNormal = null\n  let focusLocal = null\n\n  // Prefer the actual route geometry over reported bearing. The immediate next\n  // sample defines forward; the furthest sample inside a modest look-ahead arc\n  // becomes the optical zoom target. If the destination is inside that arc it\n  // naturally becomes the target.\n  if (routeSamples.length > 1) {\n    let nearestIndex = 0\n    let nearestDistance = Infinity\n    routeSamples.forEach((sample, index) => {\n      const distance = sample.point.distanceToSquared(aircraftPoint)\n      if (distance < nearestDistance) {\n        nearestDistance = distance\n        nearestIndex = index\n      }\n    })\n\n    let aheadIndex = Math.min(routeSamples.length - 1, nearestIndex + 1)\n    while (aheadIndex < routeSamples.length - 1 && routeSamples[aheadIndex].point.distanceToSquared(aircraftPoint) < 1e-8) {\n      aheadIndex += 1\n    }\n    if (aheadIndex > nearestIndex) aheadNormal = routeSamples[aheadIndex]?.point?.clone?.().normalize() || null\n\n    const minDot = Math.cos(AHEAD_FOCUS_MAX_ARC)\n    focusLocal = routeSamples[aheadIndex]?.point?.clone?.() || null\n    for (let index = aheadIndex; index < routeSamples.length; index += 1) {\n      const sample = routeSamples[index]?.point\n      if (!sample) continue\n      const sampleNormal = sample.clone().normalize()\n      if (normal.dot(sampleNormal) < minDot) break\n      focusLocal = sample.clone()\n    }\n  }\n\n  if (!aheadNormal) {\n    const aheadCoord = destinationPoint(aircraftState.lat, aircraftState.lon, aircraftState.bearing, 0.05)\n    aheadNormal = latLonVector(aheadCoord.lat, aheadCoord.lon, 1).normalize()\n    focusLocal = latLonVector(aheadCoord.lat, aheadCoord.lon, ROUTE_RADIUS)\n  }\n\n  const forward = aheadNormal.clone().addScaledVector(normal, -aheadNormal.dot(normal))\n  if (forward.lengthSq() < 1e-8) return false\n  forward.normalize()\n  const right = forward.clone().cross(normal).normalize()\n\n  // Positive Y on the target normal is deliberate: it makes route-forward\n  // acquire a negative Z component, i.e. it recedes away from the camera rather\n  // than climbing toward it. This is the nose-camera perspective correction.\n  const targetNormal = AHEAD_TARGET_NORMAL.clone()\n  const targetForward = new THREE.Vector3(0, targetNormal.z, -targetNormal.y).normalize()\n  const targetRight = targetForward.clone().cross(targetNormal).normalize()\n\n  const localBasis = new THREE.Matrix4().makeBasis(right, forward, normal)\n  const targetBasis = new THREE.Matrix4().makeBasis(targetRight, targetForward, targetNormal)\n  const localQuaternion = new THREE.Quaternion().setFromRotationMatrix(localBasis)\n  const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(targetBasis)\n  earthGroup.quaternion.copy(targetQuaternion.multiply(localQuaternion.invert()))\n\n  if (focusLocal) {\n    aheadFocusWorld = focusLocal.clone()\n    earthGroup.localToWorld(aheadFocusWorld)\n  } else {\n    aheadFocusWorld = null\n  }\n\n  applyAheadProjection()\n  return true\n}\n\n`

    transformed = replaceSection(
      transformed,
      `const orientAhead = () => {`,
      `const focusRoute = nodes => {`,
      `${projectionHelpers}${orientAhead}`,
      'final Ahead orientation section'
    )

    const opticalScaleBlock = `const updateAircraftScale = () => {\n  if (!aircraft?.visible || !camera) return\n  if (globeCameraMode === 'ahead') {\n    // Ahead is a virtual nose camera. The actual aircraft position still drives\n    // all geometry, but the sprite itself does not need to be visible.\n    aircraft.scale.set(0, 0, 1)\n    return\n  }\n  const worldPosition = new THREE.Vector3()\n  aircraft.getWorldPosition(worldPosition)\n  const distance = camera.position.distanceTo(worldPosition)\n  const scale = THREE.MathUtils.clamp(distance * 0.043, AIRCRAFT_MIN_SCALE, AIRCRAFT_MAX_SCALE)\n  aircraft.scale.set(scale, scale, 1)\n}\n\n`
    transformed = replaceSection(
      transformed,
      `const updateAircraftScale = () => {`,
      `const createRouteMarker = (node, label, accentHex, accentCss) => {`,
      opticalScaleBlock,
      'aircraft scale section'
    )

    // Keep labels and markers readable instead of allowing optical zoom to blow
    // up every screen-facing map element.
    const oldMapLabelZoom = `  const zoomScale = THREE.MathUtils.clamp((camera.position.z - RADIUS) / 3.1, 0.42, 1.0)\n  mapLabels.forEach(label => {\n    if (camera.position.z > label.userData.maxCameraZ) {`
    const opticalMapLabelZoom = `  const opticalScale = aheadOpticalScale()\n  const zoomScale = THREE.MathUtils.clamp((camera.position.z - RADIUS) / 3.1, 0.42, 1.0) * opticalScale\n  const effectiveCameraZ = globeCameraMode === 'ahead'\n    ? RADIUS + (camera.position.z - RADIUS) * opticalScale\n    : camera.position.z\n  mapLabels.forEach(label => {\n    if (effectiveCameraZ > label.userData.maxCameraZ) {`
    if (!transformed.includes(oldMapLabelZoom)) throw new Error('Could not locate map label zoom block')
    transformed = transformed.replace(oldMapLabelZoom, opticalMapLabelZoom)

    const oldCityLightZoom = `    const zoomScale = THREE.MathUtils.clamp(distance / 3.5, 0.3, 1)`
    const opticalCityLightZoom = `    const zoomScale = THREE.MathUtils.clamp(distance / 3.5, 0.3, 1) * aheadOpticalScale()`
    if (!transformed.includes(oldCityLightZoom)) throw new Error('Could not locate city light zoom block')
    transformed = transformed.replace(oldCityLightZoom, opticalCityLightZoom)

    const oldRouteMarkerFactor = `    const factor = THREE.MathUtils.clamp(distance / 4.0, 0.12, 0.82)`
    const opticalRouteMarkerFactor = `    const factor = THREE.MathUtils.clamp(distance / 4.0, 0.12, 0.82) * aheadOpticalScale()`
    if (!transformed.includes(oldRouteMarkerFactor)) throw new Error('Could not locate route marker scale block')
    transformed = transformed.replace(oldRouteMarkerFactor, opticalRouteMarkerFactor)

    const opticalSetZoom = `  const setZoom = value => {\n    if (camera) {\n      if (globeCameraMode === 'ahead') {\n        // Pinch/wheel changes FOV only. The camera stays fixed while the lens\n        // centre blends from the aircraft origin toward the route target ahead.\n        const ratio = THREE.MathUtils.clamp(Number(value) / AHEAD_CAMERA_Z, 0.62, 1.62)\n        aheadFov = THREE.MathUtils.clamp(aheadFov * ratio, AHEAD_MIN_FOV, AHEAD_MAX_FOV)\n        orientAhead()\n      } else {\n        camera.position.z = THREE.MathUtils.clamp(value, MIN_CAMERA_Z, MAX_CAMERA_Z)\n        resetStandardProjection()\n      }\n    }\n    markInteraction()\n  }\n`
    transformed = replaceSection(
      transformed,
      `  const setZoom = value => {`,
      `  const pointerDistance = () => {`,
      opticalSetZoom,
      'globe zoom handler'
    )

    // Ahead remains locked against one-finger globe rotation.
    const oldDrag = `    if (!dragging || !earthGroup) return\n    const dx = event.clientX - previousX`
    const newDrag = `    if (!dragging || !earthGroup) return\n    if (globeCameraMode === 'ahead') return\n    const dx = event.clientX - previousX`
    if (transformed.includes(oldDrag)) transformed = transformed.replace(oldDrag, newDrag)

    const resizeProjection = `    camera.aspect = width / height\n    if (globeCameraMode === 'ahead') applyAheadProjection()\n    else camera.updateProjectionMatrix()\n    markInteraction()`
    const oldResizeProjection = `    camera.aspect = width / height\n    camera.updateProjectionMatrix()\n    markInteraction()`
    if (!transformed.includes(oldResizeProjection)) throw new Error('Could not locate globe resize projection block')
    transformed = transformed.replace(oldResizeProjection, resizeProjection)

    // Fully own camera-mode transitions here so no stale Ahead view offset can
    // leak back into Free/Follow.
    const cameraMode = `export const setGlobeCameraMode = mode => {\n  const requested = ['free', 'follow', 'ahead'].includes(mode) ? mode : 'free'\n  if ((requested === 'follow' || requested === 'ahead') && !aircraftState) {\n    globeCameraMode = 'free'\n    followAircraft = false\n    aheadFocusWorld = null\n    resetStandardProjection()\n    return globeCameraMode\n  }\n\n  globeCameraMode = requested\n  followAircraft = requested === 'follow'\n\n  if (requested !== 'ahead' && camera) {\n    aheadFocusWorld = null\n    const currentZoom = THREE.MathUtils.clamp(Number(camera.position.z || DEFAULT_CAMERA_Z), MIN_CAMERA_Z, MAX_CAMERA_Z)\n    camera.position.set(0, 0.08, currentZoom)\n    camera.rotation.set(0, 0, 0)\n    resetStandardProjection()\n  }\n\n  if (requested === 'follow') centerCoordinate(aircraftState.lat, aircraftState.lon)\n  if (requested === 'ahead') {\n    aheadFov = AHEAD_BASE_FOV\n    orientAhead()\n  }\n\n  markInteraction()\n  return globeCameraMode\n}\n\n`
    transformed = replaceSection(
      transformed,
      `export const setGlobeCameraMode = mode => {`,
      `export const destroyGlobe = () => {`,
      cameraMode,
      'globe camera mode setter'
    )

    // These older public helpers can also leave Ahead without going through the
    // camera-mode setter. Clear the off-axis projection in those paths too.
    const oldRecenter = `  globeCameraMode = 'follow'\n  followAircraft = true\n  centerCoordinate(aircraftState.lat, aircraftState.lon)`
    const newRecenter = `  globeCameraMode = 'follow'\n  followAircraft = true\n  aheadFocusWorld = null\n  resetStandardProjection()\n  centerCoordinate(aircraftState.lat, aircraftState.lon)`
    if (!transformed.includes(oldRecenter)) throw new Error('Could not locate aircraft recenter helper')
    transformed = transformed.replace(oldRecenter, newRecenter)

    const oldFollow = `  globeCameraMode = followAircraft ? 'follow' : 'free'\n  if (followAircraft && aircraftState) centerCoordinate(aircraftState.lat, aircraftState.lon)`
    const newFollow = `  globeCameraMode = followAircraft ? 'follow' : 'free'\n  aheadFocusWorld = null\n  resetStandardProjection()\n  if (followAircraft && aircraftState) centerCoordinate(aircraftState.lat, aircraftState.lon)`
    if (!transformed.includes(oldFollow)) throw new Error('Could not locate follow-aircraft helper')
    transformed = transformed.replace(oldFollow, newFollow)

    const oldFocusMode = `  followAircraft = false\n  globeCameraMode = 'free'`
    const newFocusMode = `  followAircraft = false\n  globeCameraMode = 'free'\n  aheadFocusWorld = null\n  resetStandardProjection()`
    if (!transformed.includes(oldFocusMode)) throw new Error('Could not locate route focus camera reset')
    transformed = transformed.replace(oldFocusMode, newFocusMode)

    return { code: transformed, map: null }
  }
})

export default defineConfig({
  ...routeConfig,
  plugins: [...(routeConfig.plugins || []), opticalAheadView()]
})
