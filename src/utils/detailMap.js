import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

let map
let tileLayer
let routeBase
let routeRemaining
let routeFlown
let alternativeLayer
let airportLayer
let planeMarker
let routeSamples = []
let selectedAlternativeId = null
let alternativeLines = new Map()
let readyNotified = false

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
  if (omega < 1e-9) return [a[0], a[1]]
  const s = Math.sin(omega)
  const aa = Math.sin((1 - t) * omega) / s
  const bb = Math.sin(t * omega) / s
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

const samplesForNodes = nodes => {
  if (!nodes?.length || nodes.length < 2) return []
  const coords = nodes.map(node => [Number(node.lon), Number(node.lat)])
  const lengths = []
  let total = 0
  for (let index = 0; index < coords.length - 1; index += 1) {
    const length = angularDistance(coords[index], coords[index + 1])
    lengths.push(length)
    total += length
  }
  total = Math.max(total, 1e-9)
  const samples = []
  let cumulative = 0
  for (let index = 0; index < coords.length - 1; index += 1) {
    const length = lengths[index]
    const steps = Math.max(12, Math.ceil(length * 45))
    for (let step = 0; step < steps; step += 1) {
      const local = step / steps
      samples.push({
        coord: greatCircle(coords[index], coords[index + 1], local),
        progress: clamp((cumulative + length * local) / total, 0, 1)
      })
    }
    cumulative += length
  }
  samples.push({ coord: coords[coords.length - 1], progress: 1 })
  return samples
}

const latLng = coord => [Number(coord[1]), Number(coord[0])]
const latLngs = samples => samples.map(item => latLng(item.coord))

const removeLayer = layer => {
  try { layer?.remove?.() } catch (_) { /* no-op */ }
}

const clearRouteLayers = () => {
  removeLayer(routeBase)
  removeLayer(routeRemaining)
  removeLayer(routeFlown)
  removeLayer(airportLayer)
  routeBase = routeRemaining = routeFlown = airportLayer = null
}

const clearAlternativeLayers = () => {
  removeLayer(alternativeLayer)
  alternativeLayer = null
  alternativeLines = new Map()
}

const planeIcon = () => L.divIcon({
  className: 'detail-plane-leaflet-icon',
  html: '<span>✈</span>',
  iconSize: [32, 32],
  iconAnchor: [16, 16]
})

const endpointMarker = (node, label, color) => {
  const marker = L.circleMarker([Number(node.lat), Number(node.lon)], {
    radius: 5,
    color: '#07131b',
    weight: 2,
    fillColor: color,
    fillOpacity: 1,
    interactive: false
  })
  marker.bindTooltip(String(label), {
    permanent: true,
    direction: 'bottom',
    offset: [0, 7],
    className: 'detail-airport-label'
  })
  return marker
}

const updateAlternativePaint = () => {
  alternativeLines.forEach((line, id) => {
    const selected = id === (selectedAlternativeId || '')
    line.setStyle({
      color: selected ? '#78ecba' : '#6c93aa',
      opacity: selected ? 0.95 : 0.38,
      weight: selected ? 4 : 2
    })
  })
}

export const initializeDetailMap = (containerId, { onReady, onError } = {}) => {
  if (map) return map
  const container = document.getElementById(containerId)
  if (!container) {
    onError?.(new Error('Detail map container not found.'))
    return null
  }

  try {
    readyNotified = false
    map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
      worldCopyJump: true,
      minZoom: 2,
      maxZoom: 18
    }).setView([50.11, 8.68], 3)

    tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      minZoom: 2,
      maxZoom: 18,
      crossOrigin: true,
      attribution: '&copy; OpenStreetMap contributors'
    })

    const notifyReady = () => {
      if (readyNotified) return
      readyNotified = true
      onReady?.()
    }

    tileLayer.once('load', notifyReady)
    tileLayer.on('tileerror', event => {
      onError?.(event?.error || new Error('Detail map tile failed to load.'))
    })
    tileLayer.addTo(map)

    map.whenReady(() => {
      try { map?.invalidateSize(false) } catch (_) { /* no-op */ }
    })
  } catch (error) {
    try { map?.remove() } catch (_) { /* no-op */ }
    map = null
    tileLayer = null
    onError?.(error)
    return null
  }

  return map
}

export const setDetailRoute = (nodes, labels = {}) => {
  routeSamples = samplesForNodes(nodes)
  if (!map || !routeSamples.length) return

  clearRouteLayers()
  clearAlternativeLayers()
  const coords = latLngs(routeSamples)

  routeBase = L.polyline(coords, {
    color: '#88a9b3',
    opacity: 0.5,
    weight: 2.2,
    interactive: false
  }).addTo(map)
  routeRemaining = L.polyline(coords, {
    color: '#85a7b0',
    opacity: 0.62,
    weight: 3,
    interactive: false
  }).addTo(map)
  routeFlown = L.polyline([coords[0], coords[0]], {
    color: '#75efb9',
    opacity: 1,
    weight: 4,
    dashArray: '7 5',
    interactive: false
  }).addTo(map)

  const start = nodes[0]
  const end = nodes[nodes.length - 1]
  airportLayer = L.layerGroup([
    endpointMarker(start, labels.fromLabel || start.ident || 'DEP', '#ffd65d'),
    endpointMarker(end, labels.toLabel || end.ident || 'ARR', '#83efc0')
  ]).addTo(map)

  try {
    map.fitBounds(L.latLngBounds(coords), { padding: [55, 55], maxZoom: 5, animate: false })
  } catch (_) { /* no-op */ }
}

export const setDetailRouteAlternatives = (plans, selectedId = null) => {
  selectedAlternativeId = selectedId ? String(selectedId) : null
  if (!map) return
  clearAlternativeLayers()

  const viable = (plans || []).filter(plan => plan?.previewNodes?.length >= 2)
  if (!viable.length) return

  const group = []
  const allCoordinates = []
  viable.forEach(plan => {
    const coordinates = latLngs(samplesForNodes(plan.previewNodes))
    allCoordinates.push(...coordinates)
    const id = String(plan.id)
    const line = L.polyline(coordinates, {
      color: '#6c93aa',
      opacity: 0.38,
      weight: 2,
      interactive: false
    })
    alternativeLines.set(id, line)
    group.push(line)
  })
  alternativeLayer = L.layerGroup(group).addTo(map)
  updateAlternativePaint()

  if (allCoordinates.length) {
    try { map.fitBounds(L.latLngBounds(allCoordinates), { padding: [55, 55], maxZoom: 5, animate: false }) } catch (_) { /* no-op */ }
  }
}

export const highlightDetailRouteAlternative = planId => {
  selectedAlternativeId = planId ? String(planId) : null
  updateAlternativePaint()
}

export const updateDetailProgress = (progress, aircraftPosition = null) => {
  if (!map || !routeSamples.length || !routeFlown || !routeRemaining) return
  const p = clamp(Number(progress || 0), 0, 1)
  let upperIndex = routeSamples.findIndex(item => item.progress >= p)
  if (upperIndex < 0) upperIndex = routeSamples.length - 1
  const lowerIndex = Math.max(0, upperIndex - 1)
  const lower = routeSamples[lowerIndex]
  const upper = routeSamples[upperIndex]
  const span = Math.max(1e-9, upper.progress - lower.progress)
  const local = clamp((p - lower.progress) / span, 0, 1)
  const interpolated = greatCircle(lower.coord, upper.coord, local)
  const currentCoord = aircraftPosition
    ? [Number(aircraftPosition.lon), Number(aircraftPosition.lat)]
    : interpolated
  const current = latLng(currentCoord)
  const flown = routeSamples.slice(0, lowerIndex + 1).map(item => latLng(item.coord))
  flown.push(current)
  const remaining = [current, ...routeSamples.slice(upperIndex).map(item => latLng(item.coord))]
  routeFlown.setLatLngs(flown.length >= 2 ? flown : [current, current])
  routeRemaining.setLatLngs(remaining.length >= 2 ? remaining : [current, current])
}

export const updateDetailAircraft = (lat, lon, bearing = 0, follow = false) => {
  if (!map || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return
  const position = [Number(lat), Number(lon)]
  if (!planeMarker) {
    planeMarker = L.marker(position, { icon: planeIcon(), interactive: false, keyboard: false }).addTo(map)
  } else {
    planeMarker.setLatLng(position)
    if (!map.hasLayer(planeMarker)) planeMarker.addTo(map)
  }
  const element = planeMarker.getElement()?.querySelector('span')
  if (element) element.style.transform = `rotate(${Number(bearing || 0) - 45}deg)`
  if (follow) map.setView(position, Math.max(map.getZoom(), 5), { animate: false })
}

export const recenterDetailAircraft = (lat, lon) => {
  if (!map || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return false
  map.setView([Number(lat), Number(lon)], Math.max(map.getZoom(), 5), { animate: true })
  return true
}

export const resizeDetailMap = () => {
  try { map?.invalidateSize(false) } catch (_) { /* no-op */ }
}

export const destroyDetailMap = () => {
  routeSamples = []
  selectedAlternativeId = null
  alternativeLines = new Map()
  try { planeMarker?.remove() } catch (_) { /* no-op */ }
  planeMarker = null
  clearRouteLayers()
  clearAlternativeLayers()
  try { map?.remove() } catch (_) { /* no-op */ }
  map = null
  tileLayer = null
  readyNotified = false
}
