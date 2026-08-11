import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const ROUTE_SOURCE = 'flightsim-route'
const ROUTE_REMAINING = 'flightsim-route-remaining'
const ROUTE_FLOWN = 'flightsim-route-flown'
const ALTERNATIVES_SOURCE = 'flightsim-alternatives'
const ALTERNATIVES_LAYER = 'flightsim-alternatives-layer'
const AIRPORTS_SOURCE = 'flightsim-airports'
const AIRPORTS_CIRCLES = 'flightsim-airport-circles'
const AIRPORTS_LABELS = 'flightsim-airport-labels'

let map
let planeMarker
let routeSamples = []
let selectedAlternativeId = null
let pending = []

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

const routeFeature = coordinates => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates }
})

const emptyLine = () => routeFeature([[0, 0], [0, 0]])

const runWhenReady = fn => {
  if (!map) return
  if (map.isStyleLoaded()) fn()
  else pending.push(fn)
}

const flushPending = () => {
  const work = pending
  pending = []
  work.forEach(fn => {
    try { fn() } catch (_) { /* map may have been switched while loading */ }
  })
}

const ensureSources = () => {
  if (!map || !map.isStyleLoaded()) return
  if (!map.getSource(ROUTE_SOURCE)) map.addSource(ROUTE_SOURCE, { type: 'geojson', data: emptyLine() })
  if (!map.getSource(ROUTE_REMAINING)) map.addSource(ROUTE_REMAINING, { type: 'geojson', data: emptyLine() })
  if (!map.getSource(ROUTE_FLOWN)) map.addSource(ROUTE_FLOWN, { type: 'geojson', data: emptyLine() })
  if (!map.getSource(ALTERNATIVES_SOURCE)) map.addSource(ALTERNATIVES_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  if (!map.getSource(AIRPORTS_SOURCE)) map.addSource(AIRPORTS_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

  if (!map.getLayer(ALTERNATIVES_LAYER)) map.addLayer({
    id: ALTERNATIVES_LAYER,
    type: 'line',
    source: ALTERNATIVES_SOURCE,
    paint: {
      'line-color': ['case', ['==', ['get', 'id'], selectedAlternativeId || ''], '#78ecba', '#6c93aa'],
      'line-opacity': ['case', ['==', ['get', 'id'], selectedAlternativeId || ''], 0.95, 0.38],
      'line-width': ['case', ['==', ['get', 'id'], selectedAlternativeId || ''], 4, 2]
    }
  })
  if (!map.getLayer('flightsim-route-base')) map.addLayer({
    id: 'flightsim-route-base',
    type: 'line',
    source: ROUTE_SOURCE,
    paint: { 'line-color': '#88a9b3', 'line-opacity': 0.5, 'line-width': 2.2 }
  })
  if (!map.getLayer('flightsim-route-remaining')) map.addLayer({
    id: 'flightsim-route-remaining',
    type: 'line',
    source: ROUTE_REMAINING,
    paint: { 'line-color': '#85a7b0', 'line-opacity': 0.62, 'line-width': 3 }
  })
  if (!map.getLayer('flightsim-route-flown')) map.addLayer({
    id: 'flightsim-route-flown',
    type: 'line',
    source: ROUTE_FLOWN,
    paint: { 'line-color': '#75efb9', 'line-opacity': 1, 'line-width': 4, 'line-dasharray': [1.5, 1.1] }
  })
  if (!map.getLayer(AIRPORTS_CIRCLES)) map.addLayer({
    id: AIRPORTS_CIRCLES,
    type: 'circle',
    source: AIRPORTS_SOURCE,
    paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': '#07131b' }
  })
  if (!map.getLayer(AIRPORTS_LABELS)) map.addLayer({
    id: AIRPORTS_LABELS,
    type: 'symbol',
    source: AIRPORTS_SOURCE,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 13,
      'text-offset': [0, 1.05],
      'text-anchor': 'top',
      'text-allow-overlap': true
    },
    paint: { 'text-color': '#f5faf8', 'text-halo-color': '#061018', 'text-halo-width': 1.5, 'text-opacity': 0.78 }
  })
}

const planeElement = () => {
  const element = document.createElement('div')
  element.className = 'detail-plane-marker'
  element.innerHTML = '<span>✈</span>'
  return element
}

export const initializeDetailMap = containerId => {
  if (map) return map
  const container = document.getElementById(containerId)
  if (!container) return null
  map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: [8.68, 50.11],
    zoom: 2.1,
    minZoom: 1,
    maxZoom: 17,
    attributionControl: true,
    antialias: true,
    renderWorldCopies: false
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'bottom-right')
  map.on('style.load', () => {
    try { map.setProjection({ type: 'globe' }) } catch (_) { /* older renderer fallback */ }
    ensureSources()
    flushPending()
  })
  planeMarker = new maplibregl.Marker({ element: planeElement(), rotationAlignment: 'map', pitchAlignment: 'map' })
  return map
}

export const setDetailRoute = (nodes, labels = {}) => {
  routeSamples = samplesForNodes(nodes)
  if (!routeSamples.length) return
  runWhenReady(() => {
    ensureSources()
    map.getSource(ROUTE_SOURCE)?.setData(routeFeature(routeSamples.map(item => item.coord)))
    map.getSource(ROUTE_REMAINING)?.setData(routeFeature(routeSamples.map(item => item.coord)))
    map.getSource(ROUTE_FLOWN)?.setData(routeFeature([routeSamples[0].coord, routeSamples[0].coord]))
    map.getSource(ALTERNATIVES_SOURCE)?.setData({ type: 'FeatureCollection', features: [] })
    const start = nodes[0]
    const end = nodes[nodes.length - 1]
    map.getSource(AIRPORTS_SOURCE)?.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { label: labels.fromLabel || start.ident || 'DEP', color: '#ffd65d' }, geometry: { type: 'Point', coordinates: [Number(start.lon), Number(start.lat)] } },
        { type: 'Feature', properties: { label: labels.toLabel || end.ident || 'ARR', color: '#83efc0' }, geometry: { type: 'Point', coordinates: [Number(end.lon), Number(end.lat)] } }
      ]
    })
    const bounds = new maplibregl.LngLatBounds()
    routeSamples.forEach(item => bounds.extend(item.coord))
    map.fitBounds(bounds, { padding: 55, duration: 550, maxZoom: 5 })
  })
}

export const setDetailRouteAlternatives = (plans, selectedId = null) => {
  selectedAlternativeId = selectedId ? String(selectedId) : null
  const viable = (plans || []).filter(plan => plan?.previewNodes?.length >= 2)
  runWhenReady(() => {
    ensureSources()
    const features = viable.map(plan => ({
      type: 'Feature',
      properties: { id: String(plan.id), rank: Number(plan.recommendationRank || 99) },
      geometry: { type: 'LineString', coordinates: samplesForNodes(plan.previewNodes).map(item => item.coord) }
    }))
    map.getSource(ALTERNATIVES_SOURCE)?.setData({ type: 'FeatureCollection', features })
    updateAlternativePaint()
    if (features.length) {
      const bounds = new maplibregl.LngLatBounds()
      features.forEach(feature => feature.geometry.coordinates.forEach(coord => bounds.extend(coord)))
      map.fitBounds(bounds, { padding: 55, duration: 500, maxZoom: 5 })
    }
  })
}

const updateAlternativePaint = () => {
  if (!map?.getLayer(ALTERNATIVES_LAYER)) return
  const selected = selectedAlternativeId || ''
  map.setPaintProperty(ALTERNATIVES_LAYER, 'line-color', ['case', ['==', ['get', 'id'], selected], '#78ecba', '#6c93aa'])
  map.setPaintProperty(ALTERNATIVES_LAYER, 'line-opacity', ['case', ['==', ['get', 'id'], selected], 0.95, 0.38])
  map.setPaintProperty(ALTERNATIVES_LAYER, 'line-width', ['case', ['==', ['get', 'id'], selected], 4, 2])
}

export const highlightDetailRouteAlternative = planId => {
  selectedAlternativeId = planId ? String(planId) : null
  runWhenReady(updateAlternativePaint)
}

export const updateDetailProgress = (progress, aircraftPosition = null) => {
  if (!routeSamples.length) return
  const p = clamp(Number(progress || 0), 0, 1)
  let upperIndex = routeSamples.findIndex(item => item.progress >= p)
  if (upperIndex < 0) upperIndex = routeSamples.length - 1
  const lowerIndex = Math.max(0, upperIndex - 1)
  const lower = routeSamples[lowerIndex]
  const upper = routeSamples[upperIndex]
  const span = Math.max(1e-9, upper.progress - lower.progress)
  const local = clamp((p - lower.progress) / span, 0, 1)
  const interpolated = greatCircle(lower.coord, upper.coord, local)
  const current = aircraftPosition ? [Number(aircraftPosition.lon), Number(aircraftPosition.lat)] : interpolated
  runWhenReady(() => {
    map.getSource(ROUTE_FLOWN)?.setData(routeFeature([...routeSamples.slice(0, lowerIndex + 1).map(item => item.coord), current]))
    map.getSource(ROUTE_REMAINING)?.setData(routeFeature([current, ...routeSamples.slice(upperIndex).map(item => item.coord)]))
  })
}

export const updateDetailAircraft = (lat, lon, bearing = 0, follow = false) => {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return
  runWhenReady(() => {
    if (!planeMarker) planeMarker = new maplibregl.Marker({ element: planeElement(), rotationAlignment: 'map', pitchAlignment: 'map' })
    planeMarker.setLngLat([Number(lon), Number(lat)]).setRotation(Number(bearing || 0) - 90).addTo(map)
    if (follow) map.easeTo({ center: [Number(lon), Number(lat)], duration: 350 })
  })
}

export const recenterDetailAircraft = (lat, lon) => {
  if (!map || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return false
  map.easeTo({ center: [Number(lon), Number(lat)], zoom: Math.max(map.getZoom(), 5), duration: 450 })
  return true
}

export const resizeDetailMap = () => { try { map?.resize() } catch (_) { /* no-op */ } }

export const destroyDetailMap = () => {
  pending = []
  routeSamples = []
  selectedAlternativeId = null
  try { planeMarker?.remove() } catch (_) { /* no-op */ }
  planeMarker = null
  try { map?.remove() } catch (_) { /* no-op */ }
  map = null
}
