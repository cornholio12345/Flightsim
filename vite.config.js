import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import populatedPlaces from './src/data/populatedPlaces.generated.js'

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

    // Billboard sprites always face the camera and were scaled from their individual
    // camera distance. That makes map text appear to hover and slide across the globe.
    // Turn labels into tangent planes fixed to the Earth and only use one global zoom
    // scale. City texture x=42 is kept exactly on the real city coordinate.
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

    return { code: transformed, map: null }
  }
})

export default defineConfig({
  plugins: [offlineCityData(), vue()],
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
