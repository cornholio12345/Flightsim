import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import populatedPlaces from './src/data/populatedPlaces.generated.js'
import airportIndex from './src/data/airports.generated.js'

const offlineCityData = () => ({
  name: 'flightsim-offline-city-data',
  enforce: 'pre',
  transform(code, id) {
    const normalizedId = id.replace(/\\/g, '/')
    if (!normalizedId.endsWith('/src/utils/globeUtils.js')) return null

    const start = code.indexOf('const CITY_LABELS = [')
    const end = code.indexOf('\n\nconst SEA_LABELS', start)
    if (start < 0 || end < 0) throw new Error('Could not locate CITY_LABELS in globeUtils.js')

    let transformed = `${code.slice(0, start)}const CITY_LABELS = ${JSON.stringify(populatedPlaces)}${code.slice(end)}`
    const oldCityBlock = `  CITY_LABELS.forEach(([text, lat, lon]) => {
    const width = Math.min(0.9, Math.max(0.46, 0.34 + String(text).length * 0.028))
    addMapLabel({ text, lat, lon, kind: 'city', maxCameraZ: 3.55, width, height: 0.14 })
  })`
    const newCityBlock = `  CITY_LABELS.forEach(([text, lat, lon, importance = 5]) => {
    const width = Math.min(0.9, Math.max(0.46, 0.34 + String(text).length * 0.028))
    const maxCameraZ = importance <= 0 ? 4.15 : importance <= 1 ? 3.75 : importance <= 3 ? 3.25 : 2.72
    addMapLabel({ text, lat, lon, kind: 'city', maxCameraZ, width, height: 0.14 })
  })`
    if (!transformed.includes(oldCityBlock)) throw new Error('Could not locate city label zoom block in globeUtils.js')
    transformed = transformed.replace(oldCityBlock, newCityBlock)

    const oldAddMapLabel = `const addMapLabel = ({ text, lat, lon, kind, maxCameraZ, width, height }) => {
  const material = new THREE.SpriteMaterial({ map: buildMapLabelTexture(text, kind), transparent: true, depthTest: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.position.copy(latLonVector(lat, lon, RADIUS + 0.034))
  sprite.renderOrder = 8
  sprite.userData.maxCameraZ = maxCameraZ
  sprite.userData.baseWidth = width
  sprite.userData.baseHeight = height
  sprite.userData.kind = kind
  sprite.userData.normal = latLonVector(lat, lon, 1).normalize()
  sprite.visible = false
  earthGroup.add(sprite)
  mapLabels.push(sprite)
}`
    const newAddMapLabel = `const tangentFrame = (lat, lon) => {
  const normal = latLonVector(lat, lon, 1).normalize()
  let east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), normal)
  if (east.lengthSq() < 1e-8) east = new THREE.Vector3(0, 0, -1)
  east.normalize()
  const north = new THREE.Vector3().crossVectors(normal, east).normalize()
  const basis = new THREE.Matrix4().makeBasis(east, north, normal)
  return {
    normal,
    east,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(basis)
  }
}

const addMapLabel = ({ text, lat, lon, kind, maxCameraZ, width, height }) => {
  const material = new THREE.MeshBasicMaterial({
    map: buildMapLabelTexture(text, kind),
    transparent: true,
    depthTest: true,
    depthWrite: false,
    alphaTest: 0.02,
    side: THREE.DoubleSide
  })
  const label = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  const frame = tangentFrame(lat, lon)
  const surfaceRadius = RADIUS + 0.012
  label.position.copy(frame.normal.clone().multiplyScalar(surfaceRadius))
  label.quaternion.copy(frame.quaternion)
  label.renderOrder = kind === 'city' ? 10 : 8
  label.userData.maxCameraZ = maxCameraZ
  label.userData.baseWidth = width
  label.userData.baseHeight = height
  label.userData.kind = kind
  label.userData.normal = frame.normal
  label.userData.east = frame.east
  label.userData.surfaceRadius = surfaceRadius
  label.userData.anchorOffset = kind === 'city' ? (0.5 - 42 / 512) * width : 0
  label.visible = false
  earthGroup.add(label)
  mapLabels.push(label)
}`
    if (!transformed.includes(oldAddMapLabel)) throw new Error('Could not locate addMapLabel in globeUtils.js')
    transformed = transformed.replace(oldAddMapLabel, newAddMapLabel)

    const oldUpdateMapLabels = `const updateMapLabels = () => {
  if (!camera || !mapLabels.length) return
  const worldPosition = new THREE.Vector3()
  const toCamera = new THREE.Vector3()
  mapLabels.forEach(label => {
    if (camera.position.z > label.userData.maxCameraZ) {
      label.visible = false
      return
    }
    label.getWorldPosition(worldPosition)
    toCamera.copy(camera.position).sub(worldPosition).normalize()
    const facing = worldPosition.clone().normalize().dot(toCamera) > 0.04
    label.visible = facing
    if (!facing) return
    const distance = camera.position.distanceTo(worldPosition)
    const scaleFactor = THREE.MathUtils.clamp(distance / 3.4, 0.2, 1.05)
    label.scale.set(label.userData.baseWidth * scaleFactor, label.userData.baseHeight * scaleFactor, 1)
    if (label.userData.kind === 'city') {
      const daylight = label.userData.normal.dot(sunDirectionLocal)
      label.material.opacity = daylight < -0.08 ? 0.86 : 0.68
    }
  })
}`
    const newUpdateMapLabels = `const updateMapLabels = () => {
  if (!camera || !earthGroup || !mapLabels.length) return
  const worldPosition = new THREE.Vector3()
  const worldNormal = new THREE.Vector3()
  const toCamera = new THREE.Vector3()
  const zoomScale = THREE.MathUtils.clamp((camera.position.z - RADIUS) / 3.1, 0.42, 1.0)
  mapLabels.forEach(label => {
    if (camera.position.z > label.userData.maxCameraZ) {
      label.visible = false
      return
    }
    label.getWorldPosition(worldPosition)
    toCamera.copy(camera.position).sub(worldPosition).normalize()
    worldNormal.copy(label.userData.normal).applyQuaternion(earthGroup.quaternion).normalize()
    const facing = worldNormal.dot(toCamera) > 0.04
    label.visible = facing
    if (!facing) return

    label.scale.set(label.userData.baseWidth * zoomScale, label.userData.baseHeight * zoomScale, 1)
    label.position.copy(label.userData.normal).multiplyScalar(label.userData.surfaceRadius)
    if (label.userData.anchorOffset) {
      label.position.addScaledVector(label.userData.east, label.userData.anchorOffset * zoomScale)
    }
    if (label.userData.kind === 'city') {
      const daylight = label.userData.normal.dot(sunDirectionLocal)
      label.material.opacity = daylight < -0.08 ? 0.86 : 0.68
    }
  })
}`
    if (!transformed.includes(oldUpdateMapLabels)) throw new Error('Could not locate updateMapLabels in globeUtils.js')
    transformed = transformed.replace(oldUpdateMapLabels, newUpdateMapLabels)

    const oldCityLightRadius = `sprite.position.copy(normal.clone().multiplyScalar(RADIUS + 0.038))`
    const newCityLightRadius = `sprite.position.copy(normal.clone().multiplyScalar(RADIUS + 0.012))`
    if (!transformed.includes(oldCityLightRadius)) throw new Error('Could not locate city light radius in globeUtils.js')
    transformed = transformed.replace(oldCityLightRadius, newCityLightRadius)

    const oldAhead = `const orientAhead = () => {
  if (!earthGroup || !aircraftState) return false
  const normal = latLonVector(aircraftState.lat, aircraftState.lon, 1).normalize()
  const aheadCoord = destinationPoint(aircraftState.lat, aircraftState.lon, aircraftState.bearing, 0.05)
  const aheadNormal = latLonVector(aheadCoord.lat, aheadCoord.lon, 1).normalize()
  const forward = aheadNormal.clone().addScaledVector(normal, -aheadNormal.dot(normal)).normalize()
  if (forward.lengthSq() < 1e-8) return false
  const right = forward.clone().cross(normal).normalize()

  const targetNormal = new THREE.Vector3(0, -0.34, 1).normalize()
  const targetForward = new THREE.Vector3(0, 1, 0).addScaledVector(targetNormal, -targetNormal.y).normalize()
  const targetRight = targetForward.clone().cross(targetNormal).normalize()

  const localBasis = new THREE.Matrix4().makeBasis(right, forward, normal)
  const targetBasis = new THREE.Matrix4().makeBasis(targetRight, targetForward, targetNormal)
  const localQuaternion = new THREE.Quaternion().setFromRotationMatrix(localBasis)
  const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(targetBasis)
  earthGroup.quaternion.copy(targetQuaternion.multiply(localQuaternion.invert()))
  return true
}`
    const newAhead = `const orientAhead = () => {
  if (!earthGroup || !aircraftState) return false
  const normal = latLonVector(aircraftState.lat, aircraftState.lon, 1).normalize()
  const aheadCoord = destinationPoint(aircraftState.lat, aircraftState.lon, aircraftState.bearing, 0.05)
  const aheadNormal = latLonVector(aheadCoord.lat, aheadCoord.lon, 1).normalize()
  const forward = aheadNormal.clone().addScaledVector(normal, -aheadNormal.dot(normal)).normalize()
  if (forward.lengthSq() < 1e-8) return false
  const right = forward.clone().cross(normal).normalize()

  const targetNormal = new THREE.Vector3(0, -0.14, 1).normalize()
  const targetForward = new THREE.Vector3(0, 1, 0).addScaledVector(targetNormal, -targetNormal.y).normalize()
  const targetRight = targetForward.clone().cross(targetNormal).normalize()

  const localBasis = new THREE.Matrix4().makeBasis(right, forward, normal)
  const targetBasis = new THREE.Matrix4().makeBasis(targetRight, targetForward, targetNormal)
  const localQuaternion = new THREE.Quaternion().setFromRotationMatrix(localBasis)
  const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(targetBasis)
  earthGroup.quaternion.copy(targetQuaternion.multiply(localQuaternion.invert()))

  if (camera) {
    const aircraftWorld = latLonVector(aircraftState.lat, aircraftState.lon, ROUTE_RADIUS)
    earthGroup.localToWorld(aircraftWorld)
    const noseFocus = aircraftWorld.clone().addScaledVector(targetForward, 0.028)
    camera.position.x = 0
    camera.position.y = 0.08
    camera.up.set(0, 1, 0)
    camera.lookAt(noseFocus)
  }
  return true
}`
    if (!transformed.includes(oldAhead)) throw new Error('Could not locate Ahead camera block in globeUtils.js')
    transformed = transformed.replace(oldAhead, newAhead)

    const oldSetZoom = `  const setZoom = value => {
    if (camera) camera.position.z = THREE.MathUtils.clamp(value, MIN_CAMERA_Z, MAX_CAMERA_Z)
    markInteraction()
  }`
    const newSetZoom = `  const setZoom = value => {
    if (camera) camera.position.z = THREE.MathUtils.clamp(value, MIN_CAMERA_Z, MAX_CAMERA_Z)
    if (globeCameraMode === 'ahead') orientAhead()
    markInteraction()
  }`
    if (!transformed.includes(oldSetZoom)) throw new Error('Could not locate globe zoom handler')
    transformed = transformed.replace(oldSetZoom, newSetZoom)

    const oldDrag = `    if (!dragging || !earthGroup) return
    const dx = event.clientX - previousX`
    const newDrag = `    if (!dragging || !earthGroup) return
    if (globeCameraMode === 'ahead') return
    const dx = event.clientX - previousX`
    if (!transformed.includes(oldDrag)) throw new Error('Could not locate globe drag handler')
    transformed = transformed.replace(oldDrag, newDrag)

    const oldCameraMode = `export const setGlobeCameraMode = mode => {
  const requested = ['free', 'follow', 'ahead'].includes(mode) ? mode : 'free'
  if ((requested === 'follow' || requested === 'ahead') && !aircraftState) {
    globeCameraMode = 'free'
    followAircraft = false
    return globeCameraMode
  }
  globeCameraMode = requested
  followAircraft = requested === 'follow'
  if (requested === 'follow') centerCoordinate(aircraftState.lat, aircraftState.lon)
  if (requested === 'ahead') {
    orientAhead()
    if (camera && camera.position.z > 3.8) camera.position.z = 3.55
  }
  markInteraction()
  return globeCameraMode
}`
    const newCameraMode = `export const setGlobeCameraMode = mode => {
  const requested = ['free', 'follow', 'ahead'].includes(mode) ? mode : 'free'
  if ((requested === 'follow' || requested === 'ahead') && !aircraftState) {
    globeCameraMode = 'free'
    followAircraft = false
    return globeCameraMode
  }
  globeCameraMode = requested
  followAircraft = requested === 'follow'
  if (requested !== 'ahead' && camera) {
    const currentZoom = camera.position.z
    camera.position.set(0, 0.08, currentZoom)
    camera.rotation.set(0, 0, 0)
  }
  if (requested === 'follow') centerCoordinate(aircraftState.lat, aircraftState.lon)
  if (requested === 'ahead') {
    if (camera && camera.position.z > 4.2) camera.position.z = 3.9
    orientAhead()
  }
  markInteraction()
  return globeCameraMode
}`
    if (!transformed.includes(oldCameraMode)) throw new Error('Could not locate globe camera mode setter')
    transformed = transformed.replace(oldCameraMode, newCameraMode)

    return { code: transformed, map: null }
  }
})

const offlineAirportData = () => ({
  name: 'flightsim-offline-airport-data',
  enforce: 'pre',
  transform(code, id) {
    const normalizedId = id.replace(/\\/g, '/')
    if (!normalizedId.endsWith('/src/services/flightAPI.js')) return null

    const airportBase = `const AIRPORT_DATA_BASE = 'https://airport-data.com/api/ap_info.json'`
    const injectedBase = `${airportBase}\nconst LOCAL_IATA_ICAO = new Map(${JSON.stringify(airportIndex)})`
    if (!code.includes(airportBase)) throw new Error('Could not locate airport lookup constants')
    let transformed = code.replace(airportBase, injectedBase)

    const oldIataStart = `  if (/^[A-Z]{3}$/.test(query)) {\n    try {`
    const newIataStart = `  if (/^[A-Z]{3}$/.test(query)) {\n    const localIcao = LOCAL_IATA_ICAO.get(query)\n    if (localIcao) return { icao: localIcao, iata: query, name: query }\n\n    try {`
    if (!transformed.includes(oldIataStart)) throw new Error('Could not locate IATA airport resolver')
    transformed = transformed.replace(oldIataStart, newIataStart)

    return { code: transformed, map: null }
  }
})

export default defineConfig({
  plugins: [offlineCityData(), offlineAirportData(), vue()],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three']
        }
      }
    }
  }
})
