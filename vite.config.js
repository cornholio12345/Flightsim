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

    // City labels are billboard sprites. Their world position used to land at the
    // centre of the whole 512 px label texture even though the visible city dot is
    // drawn at x=42. That shifted every city marker away from its true coordinate,
    // while the independent night-light sprite stayed on the real coordinate.
    // Anchor the city sprite on its dot and use the same radius as the light layer.
    const oldLabelAnchor = `  const sprite = new THREE.Sprite(material)
  sprite.position.copy(latLonVector(lat, lon, RADIUS + 0.034))
  sprite.renderOrder = 8`
    const newLabelAnchor = `  const sprite = new THREE.Sprite(material)
  const cityLabel = kind === 'city'
  sprite.position.copy(latLonVector(lat, lon, cityLabel ? RADIUS + 0.038 : RADIUS + 0.034))
  if (cityLabel) sprite.center.set(42 / 512, 0.5)
  sprite.renderOrder = cityLabel ? 10 : 8`
    if (!transformed.includes(oldLabelAnchor)) throw new Error('Could not locate map label anchor block in globeUtils.js')
    transformed = transformed.replace(oldLabelAnchor, newLabelAnchor)

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
          'three': ['three'],
          'leaflet': ['leaflet']
        }
      }
    }
  }
})
