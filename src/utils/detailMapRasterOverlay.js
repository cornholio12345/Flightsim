import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { getFlightState } from './routeUtils'

const BASE_SOURCE = 'detail-osm'
const ROUTE_SOURCE = 'detail-route'
const FLOWN_SOURCE = 'detail-route-flown'
const REMAINING_SOURCE = 'detail-route-remaining'

const RASTER_STYLE = {
  version: 8,
  sources: {
    [BASE_SOURCE]: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [{
    id: 'detail-osm-layer',
    type: 'raster',
    source: BASE_SOURCE,
    paint: {
      'raster-opacity': 1,
      'raster-brightness-max': 0.72,
      'raster-saturation': -0.22,
      'raster-contrast': 0.08
    }
  }]
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const toRad = value => Number(value) * Math.PI / 180
const toDeg = value => Number(value) * 180 / Math.PI

const greatCircle = (a, b, t) => {
  const lat1 = toRad(a[1])
  const lon1 = toRad(a[0])
  const lat2 = toRad(b[1])
  const lon2 = toRad(b[0])
  const v1 = [Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)]
  const v2 = [Math.cos(lat2) * Math.cos(lon2), Math.cos(lat2) * Math.sin(lon2), Math.sin(lat2)]
  const dot = clamp(v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2], -1, 1)
  const omega = Math.acos(dot)
  if (omega < 1e-9) return [Number(a[0]), Number(a[1])]
  const sinOmega = Math.sin(omega)
  const aa = Math.sin((1 - t) * omega) / sinOmega
  const bb = Math.sin(t * omega) / sinOmega
  const x = aa * v1[0] + bb * v2[0]
  const y = aa * v1[1] + bb * v2[1]
  const z = aa * v1[2] + bb * v2[2]
  return [toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.hypot(x, y)))]
}

const angularDistance = (a, b) => {
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const dLat = lat2 - lat1
  const dLon = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * Math.asin(Math.sqrt(clamp(h, 0, 1)))
}

const sampleRoute = nodes => {
  if (!nodes?.length || nodes.length < 2) return []
  const coords = nodes.map(node => [Number(node.lon), Number(node.lat)])
  const lengths = []
  let total = 0
  for (let i = 0; i < coords.length - 1; i += 1) {
    const length = angularDistance(coords[i], coords[i + 1])
    lengths.push(length)
    total += length
  }
  total = Math.max(total, 1e-9)
  const samples = []
  let cumulative = 0
  for (let i = 0; i < coords.length - 1; i += 1) {
    const length = lengths[i]
    const steps = Math.max(10, Math.ceil(length * 35))
    for (let step = 0; step < steps; step += 1) {
      const local = step / steps
      samples.push({
        coord: greatCircle(coords[i], coords[i + 1], local),
        progress: clamp((cumulative + length * local) / total, 0, 1)
      })
    }
    cumulative += length
  }
  samples.push({ coord: coords[coords.length - 1], progress: 1 })
  return samples
}

const lineFeature = coordinates => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: coordinates.length >= 2 ? coordinates : [[0, 0], [0, 0]] }
})

const planeElement = () => {
  const element = document.createElement('div')
  element.className = 'detail-plane-marker'
  element.innerHTML = '<span>✈</span>'
  return element
}

export const mountDetailMapRasterOverlay = store => {
  const panel = document.querySelector('.globe-panel')
  const globeCanvas = document.getElementById('globe-canvas')
  if (!panel || !globeCanvas) return () => {}

  const detailContainer = document.createElement('div')
  detailContainer.id = 'detail-map-raster'
  detailContainer.className = 'detail-map-container'
  detailContainer.style.display = 'none'
  panel.insertBefore(detailContainer, panel.firstChild)

  const status = document.createElement('div')
  status.className = 'detail-map-status'
  status.style.display = 'none'
  detailContainer.appendChild(status)

  const switcher = document.createElement('div')
  switcher.className = 'map-mode-switch'
  const offlineButton = document.createElement('button')
  const detailButton = document.createElement('button')
  offlineButton.type = detailButton.type = 'button'
  offlineButton.textContent = 'Offline globe'
  detailButton.textContent = 'Detail map'
  offlineButton.className = 'map-mode-button active'
  detailButton.className = 'map-mode-button'
  switcher.append(offlineButton, detailButton)
  panel.appendChild(switcher)

  const globeOnly = [...panel.querySelectorAll('.hud, .compare-hint, .globe-empty')]
  let map = null
  let planeMarker = null
  let mode = 'offline'
  let baseReady = false
  let routeSamples = []
  let currentTripId = null
  let currentState = null
  let syncTimer = null

  const setStatus = text => {
    status.textContent = text || ''
    status.style.display = text ? 'block' : 'none'
  }

  const setGlobeUiVisible = visible => {
    globeOnly.forEach(element => { element.style.display = visible ? '' : 'none' })
  }

  const ensureRouteLayers = () => {
    if (!map?.isStyleLoaded()) return
    if (!map.getSource(ROUTE_SOURCE)) map.addSource(ROUTE_SOURCE, { type: 'geojson', data: lineFeature([]) })
    if (!map.getSource(FLOWN_SOURCE)) map.addSource(FLOWN_SOURCE, { type: 'geojson', data: lineFeature([]) })
    if (!map.getSource(REMAINING_SOURCE)) map.addSource(REMAINING_SOURCE, { type: 'geojson', data: lineFeature([]) })
    if (!map.getLayer('detail-route-base')) map.addLayer({
      id: 'detail-route-base', type: 'line', source: ROUTE_SOURCE,
      paint: { 'line-color': '#d8e5e8', 'line-opacity': 0.6, 'line-width': 3 }
    })
    if (!map.getLayer('detail-route-remaining')) map.addLayer({
      id: 'detail-route-remaining', type: 'line', source: REMAINING_SOURCE,
      paint: { 'line-color': '#80a9b4', 'line-opacity': 0.9, 'line-width': 4 }
    })
    if (!map.getLayer('detail-route-flown')) map.addLayer({
      id: 'detail-route-flown', type: 'line', source: FLOWN_SOURCE,
      paint: { 'line-color': '#66e0aa', 'line-opacity': 1, 'line-width': 5 }
    })
  }

  const showRoute = nodes => {
    routeSamples = sampleRoute(nodes)
    if (!routeSamples.length || !map?.isStyleLoaded()) return
    ensureRouteLayers()
    const coords = routeSamples.map(item => item.coord)
    map.getSource(ROUTE_SOURCE)?.setData(lineFeature(coords))
    map.getSource(REMAINING_SOURCE)?.setData(lineFeature(coords))
    map.getSource(FLOWN_SOURCE)?.setData(lineFeature([coords[0], coords[0]]))
    const bounds = new maplibregl.LngLatBounds()
    coords.forEach(coord => bounds.extend(coord))
    map.fitBounds(bounds, { padding: 48, duration: 350, maxZoom: 6 })
  }

  const updateProgress = (progress, state) => {
    if (!routeSamples.length || !map?.isStyleLoaded()) return
    const p = clamp(Number(progress || 0), 0, 1)
    let upper = routeSamples.findIndex(item => item.progress >= p)
    if (upper < 0) upper = routeSamples.length - 1
    const lower = Math.max(0, upper - 1)
    const current = [Number(state.lon), Number(state.lat)]
    const flown = [...routeSamples.slice(0, lower + 1).map(item => item.coord), current]
    const remaining = [current, ...routeSamples.slice(upper).map(item => item.coord)]
    map.getSource(FLOWN_SOURCE)?.setData(lineFeature(flown))
    map.getSource(REMAINING_SOURCE)?.setData(lineFeature(remaining))
  }

  const syncTrip = () => {
    const saved = Array.isArray(store.savedTrips) ? store.savedTrips : []
    const trip = store.activeTrip || saved[0]
    if (!trip?.route?.nodes?.length || !map?.isStyleLoaded()) return
    if (trip.id !== currentTripId) {
      currentTripId = trip.id
      showRoute(trip.route.nodes)
    }
    if (!trip.startedAt || !trip.blockMinutes) return
    const elapsedMinutes = Math.max(0, (Date.now() - Number(trip.startedAt)) / 60_000)
    const progress = clamp(elapsedMinutes / Number(trip.blockMinutes) + Number(trip.progressOffset || 0), 0, 1)
    const state = getFlightState({
      route: trip.route,
      progress,
      elapsedMinutes,
      blockMinutes: Number(trip.blockMinutes),
      cruiseAltitudeFt: trip.maxAltitudeFt || 36000
    })
    if (!state) return
    currentState = state
    if (!planeMarker) planeMarker = new maplibregl.Marker({ element: planeElement(), rotationAlignment: 'map' })
    planeMarker.setLngLat([state.lon, state.lat]).setRotation(Number(state.bearing || 0) - 90).addTo(map)
    updateProgress(progress, state)
  }

  const initializeMap = () => {
    if (map || mode !== 'detail') return
    setStatus('Loading map tiles…')
    try {
      map = new maplibregl.Map({
        container: detailContainer,
        style: RASTER_STYLE,
        center: [18, 35],
        zoom: 2.3,
        minZoom: 1,
        maxZoom: 17,
        attributionControl: true,
        renderWorldCopies: false
      })
      map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: true }), 'bottom-right')
      map.on('load', () => {
        ensureRouteLayers()
        map.resize()
        syncTrip()
      })
      map.on('sourcedata', event => {
        if (event.sourceId === BASE_SOURCE && event.isSourceLoaded && !baseReady) {
          baseReady = true
          setStatus('')
          syncTrip()
        }
      })
      map.on('error', event => {
        console.warn('Detail raster map error', event?.error || event)
        if (!baseReady) setStatus(navigator.onLine ? 'Map tiles failed to load' : 'Detail map needs internet')
      })
    } catch (error) {
      console.warn('Detail raster map could not start', error)
      setStatus('Detail map could not start')
      map = null
    }
  }

  const setMode = next => {
    mode = next
    const detail = mode === 'detail'
    offlineButton.classList.toggle('active', !detail)
    detailButton.classList.toggle('active', detail)
    globeCanvas.style.display = detail ? 'none' : 'block'
    detailContainer.style.display = detail ? 'block' : 'none'
    setGlobeUiVisible(!detail)
    if (detail) {
      if (!baseReady) setStatus('Loading map tiles…')
      requestAnimationFrame(() => requestAnimationFrame(() => {
        initializeMap()
        map?.resize()
        syncTrip()
      }))
    }
  }

  offlineButton.addEventListener('click', () => setMode('offline'))
  detailButton.addEventListener('click', () => setMode('detail'))

  const interceptFollow = event => {
    if (mode !== 'detail') return
    const target = event.target?.closest?.('.follow-btn')
    if (!target || !currentState || !map) return
    event.preventDefault()
    event.stopImmediatePropagation()
    map.easeTo({ center: [currentState.lon, currentState.lat], zoom: Math.max(map.getZoom(), 6), duration: 350 })
  }
  panel.addEventListener('click', interceptFollow, true)

  const resize = () => { if (mode === 'detail') map?.resize() }
  window.addEventListener('resize', resize)
  syncTimer = window.setInterval(() => { if (mode === 'detail') syncTrip() }, 1000)

  return () => {
    clearInterval(syncTimer)
    window.removeEventListener('resize', resize)
    panel.removeEventListener('click', interceptFollow, true)
    planeMarker?.remove()
    map?.remove()
    switcher.remove()
    detailContainer.remove()
    setGlobeUiVisible(true)
  }
}
