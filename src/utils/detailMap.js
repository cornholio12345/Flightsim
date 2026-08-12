import '../detailMapDom.css'
import { getOfflineMapTile, OFFLINE_MAX_ZOOM, VERSATILES_TILE_URL } from './offlineMapStore'
import { renderVersaTile } from './vectorTileRenderer'

const TILE_SIZE = 256
const MIN_ZOOM = 2
const MAX_ZOOM = 14
const SVG_NS = 'http://www.w3.org/2000/svg'
const MEMORY_TILE_LIMIT = 140

let container
let tilePane
let overlaySvg
let planeElement
let attributionElement
let resizeObserver
let interactionCleanup
let tileWatchdog
let onReadyCallback
let onErrorCallback
let readyNotified = false
let anyTileLoaded = false
let terminalTileError = false
let tileErrors = 0
let center = { lat: 50.11, lon: 8.68 }
let zoom = 3
let tiles = new Map()
let memoryTileData = new Map()
let tileGeneration = 0
let routeSamples = []
let routeLabels = {}
let currentProgress = 0
let aircraftState = null
let alternativeRoutes = []
let selectedAlternativeId = null
let activeTripId = null

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

const worldSize = z => TILE_SIZE * (2 ** z)

const project = (lat, lon, z = zoom) => {
  const size = worldSize(z)
  const limitedLat = clamp(Number(lat), -85.05112878, 85.05112878)
  const sin = Math.sin(toRad(limitedLat))
  return {
    x: ((Number(lon) + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size
  }
}

const unproject = (x, y, z = zoom) => {
  const size = worldSize(z)
  const lon = (x / size) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / size
  const lat = toDeg(Math.atan(Math.sinh(n)))
  return { lat: clamp(lat, -85.05112878, 85.05112878), lon: ((lon + 540) % 360) - 180 }
}

const dimensions = () => ({
  width: Math.max(1, container?.clientWidth || 1),
  height: Math.max(1, container?.clientHeight || 1)
})

const centerWorld = (z = zoom) => project(center.lat, center.lon, z)

const nearestWrappedX = (x, referenceX, z = zoom) => {
  const size = worldSize(z)
  return x + Math.round((referenceX - x) / size) * size
}

const screenPoint = (coord, z = zoom, centerPoint = centerWorld(z)) => {
  const { width, height } = dimensions()
  const projected = project(coord[1], coord[0], z)
  const wrappedX = nearestWrappedX(projected.x, centerPoint.x, z)
  return {
    x: wrappedX - centerPoint.x + width / 2,
    y: projected.y - centerPoint.y + height / 2
  }
}

const notifyReady = () => {
  if (readyNotified) return
  readyNotified = true
  clearTimeout(tileWatchdog)
  onReadyCallback?.()
}

const notifyTerminalError = message => {
  if (terminalTileError || anyTileLoaded) return
  terminalTileError = true
  clearTimeout(tileWatchdog)
  onErrorCallback?.(new Error(message))
}

const rememberTile = (key, data) => {
  memoryTileData.set(key, data)
  if (memoryTileData.size <= MEMORY_TILE_LIMIT) return
  const oldest = memoryTileData.keys().next().value
  if (oldest) memoryTileData.delete(oldest)
}

const loadTileData = async (z, x, y) => {
  const sourceKey = `${z}/${x}/${y}`
  if (activeTripId) {
    const stored = await getOfflineMapTile(activeTripId, z, x, y)
    if (stored) return { data: stored, offline: true }
  }
  const remembered = memoryTileData.get(sourceKey)
  if (remembered) return { data: remembered, offline: false }
  if (!navigator.onLine) {
    const error = new Error('This area or zoom level is not in the downloaded offline map.')
    error.code = 'OFFLINE_TILE_MISS'
    throw error
  }
  const response = await fetch(VERSATILES_TILE_URL(z, x, y), {
    cache: 'default',
    headers: { Accept: 'application/vnd.mapbox-vector-tile, application/x-protobuf, */*' }
  })
  if (!response.ok) throw new Error(`VersaTiles tile request failed with HTTP ${response.status}.`)
  const data = await response.arrayBuffer()
  rememberTile(sourceKey, data)
  return { data, offline: false }
}

const paintTile = async (canvas, z, x, y, generation, key) => {
  try {
    const result = await loadTileData(z, x, y)
    if (generation !== tileGeneration || !canvas.isConnected || canvas.dataset.tileKey !== key) return
    renderVersaTile(canvas, result.data, { zoom: z })
    canvas.classList.add('loaded')
    canvas.classList.toggle('offline', result.offline)
    anyTileLoaded = true
    notifyReady()
  } catch (error) {
    if (generation !== tileGeneration || !canvas.isConnected || canvas.dataset.tileKey !== key) return
    canvas.classList.add('failed')
    tileErrors += 1
    if (!anyTileLoaded && tileErrors >= 6) {
      notifyTerminalError(error?.code === 'OFFLINE_TILE_MISS'
        ? 'Offline detail map is not downloaded for this route or zoom level'
        : (error?.message || 'Map tile host is not reachable from this device'))
    }
  }
}

const clearVisibleTiles = () => {
  tileGeneration += 1
  tiles.forEach(tile => tile.remove())
  tiles.clear()
}

const renderTiles = () => {
  if (!container || !tilePane) return
  const { width, height } = dimensions()
  const centerPoint = centerWorld()
  const n = 2 ** zoom
  const minTileX = Math.floor((centerPoint.x - width / 2) / TILE_SIZE) - 1
  const maxTileX = Math.floor((centerPoint.x + width / 2) / TILE_SIZE) + 1
  const minTileY = Math.max(0, Math.floor((centerPoint.y - height / 2) / TILE_SIZE) - 1)
  const maxTileY = Math.min(n - 1, Math.floor((centerPoint.y + height / 2) / TILE_SIZE) + 1)
  const required = new Set()
  const generation = tileGeneration

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    const wrappedX = ((tileX % n) + n) % n
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      const key = `${zoom}/${tileX}/${tileY}`
      required.add(key)
      let canvas = tiles.get(key)
      if (!canvas) {
        canvas = document.createElement('canvas')
        canvas.className = 'dom-map-tile'
        canvas.width = TILE_SIZE
        canvas.height = TILE_SIZE
        canvas.dataset.tileKey = key
        const placeholder = canvas.getContext('2d')
        if (placeholder) {
          placeholder.fillStyle = '#203a36'
          placeholder.fillRect(0, 0, TILE_SIZE, TILE_SIZE)
        }
        tilePane.appendChild(canvas)
        tiles.set(key, canvas)
        paintTile(canvas, zoom, wrappedX, tileY, generation, key)
      }
      canvas.style.left = `${tileX * TILE_SIZE - centerPoint.x + width / 2}px`
      canvas.style.top = `${tileY * TILE_SIZE - centerPoint.y + height / 2}px`
    }
  }

  tiles.forEach((tile, key) => {
    if (required.has(key)) return
    tile.remove()
    tiles.delete(key)
  })
}

const svgElement = (name, attributes = {}) => {
  const element = document.createElementNS(SVG_NS, name)
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)))
  return element
}

const pathForSamples = samples => {
  if (!samples?.length) return ''
  const centerPoint = centerWorld()
  return samples.map((item, index) => {
    const point = screenPoint(item.coord, zoom, centerPoint)
    return `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`
  }).join(' ')
}

const coordinateAtProgress = progress => {
  if (!routeSamples.length) return null
  const p = clamp(Number(progress || 0), 0, 1)
  let upperIndex = routeSamples.findIndex(item => item.progress >= p)
  if (upperIndex < 0) upperIndex = routeSamples.length - 1
  const lowerIndex = Math.max(0, upperIndex - 1)
  const lower = routeSamples[lowerIndex]
  const upper = routeSamples[upperIndex]
  const span = Math.max(1e-9, upper.progress - lower.progress)
  const local = clamp((p - lower.progress) / span, 0, 1)
  return {
    coord: greatCircle(lower.coord, upper.coord, local),
    lowerIndex,
    upperIndex
  }
}

const addRoutePath = (samples, className) => {
  if (!samples?.length) return
  const d = pathForSamples(samples)
  if (!d) return
  overlaySvg.appendChild(svgElement('path', { d, class: className, fill: 'none' }))
}

const addEndpoint = (sample, label, className) => {
  if (!sample) return
  const point = screenPoint(sample.coord)
  const group = svgElement('g', { class: `dom-map-endpoint ${className}` })
  group.appendChild(svgElement('circle', { cx: point.x, cy: point.y, r: 5 }))
  const text = svgElement('text', { x: point.x, y: point.y + 19, 'text-anchor': 'middle' })
  text.textContent = String(label || '')
  group.appendChild(text)
  overlaySvg.appendChild(group)
}

const renderOverlay = () => {
  if (!overlaySvg || !container) return
  const { width, height } = dimensions()
  overlaySvg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  overlaySvg.innerHTML = ''

  alternativeRoutes.forEach(route => {
    const selected = route.id === (selectedAlternativeId || '')
    const path = svgElement('path', {
      d: pathForSamples(route.samples),
      class: `dom-map-alt-route${selected ? ' selected' : ''}`,
      fill: 'none'
    })
    overlaySvg.appendChild(path)
  })

  if (routeSamples.length) {
    addRoutePath(routeSamples, 'dom-map-route-base')
    const progressPoint = coordinateAtProgress(currentProgress)
    if (progressPoint) {
      const currentCoord = aircraftState
        ? [Number(aircraftState.lon), Number(aircraftState.lat)]
        : progressPoint.coord
      const flownSamples = routeSamples.slice(0, progressPoint.lowerIndex + 1).map(item => ({ ...item }))
      flownSamples.push({ coord: currentCoord, progress: currentProgress })
      const remainingSamples = [{ coord: currentCoord, progress: currentProgress }, ...routeSamples.slice(progressPoint.upperIndex)]
      addRoutePath(remainingSamples, 'dom-map-route-remaining')
      addRoutePath(flownSamples, 'dom-map-route-flown')
    }
    addEndpoint(routeSamples[0], routeLabels.fromLabel || 'DEP', 'departure')
    addEndpoint(routeSamples[routeSamples.length - 1], routeLabels.toLabel || 'ARR', 'arrival')
  }

  if (aircraftState && planeElement) {
    const point = screenPoint([Number(aircraftState.lon), Number(aircraftState.lat)])
    planeElement.style.display = 'grid'
    planeElement.style.left = `${point.x}px`
    planeElement.style.top = `${point.y}px`
    planeElement.style.transform = `translate(-50%, -50%) rotate(${Number(aircraftState.bearing || 0) - 45}deg)`
  } else if (planeElement) {
    planeElement.style.display = 'none'
  }
}

const render = () => {
  renderTiles()
  renderOverlay()
}

const circularMeanLon = samples => {
  let x = 0
  let y = 0
  samples.forEach(item => {
    const lon = toRad(item.coord[0])
    x += Math.cos(lon)
    y += Math.sin(lon)
  })
  return toDeg(Math.atan2(y, x))
}

const fitRoute = samples => {
  if (!samples?.length || !container) return
  const { width, height } = dimensions()
  const lats = samples.map(item => item.coord[1])
  center = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: circularMeanLon(samples)
  }

  let selectedZoom = MIN_ZOOM
  for (let candidate = 8; candidate >= MIN_ZOOM; candidate -= 1) {
    const candidateCenter = project(center.lat, center.lon, candidate)
    const points = samples.map(item => screenPoint(item.coord, candidate, candidateCenter))
    const xs = points.map(point => point.x)
    const ys = points.map(point => point.y)
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanY = Math.max(...ys) - Math.min(...ys)
    if (spanX <= Math.max(80, width - 100) && spanY <= Math.max(80, height - 100)) {
      selectedZoom = candidate
      break
    }
  }
  zoom = selectedZoom
  clearVisibleTiles()
  render()
}

const currentMaxZoom = () => navigator.onLine ? MAX_ZOOM : OFFLINE_MAX_ZOOM

const changeZoom = delta => {
  const next = clamp(zoom + delta, MIN_ZOOM, currentMaxZoom())
  if (next === zoom) return
  zoom = next
  clearVisibleTiles()
  render()
}

const installInteractions = () => {
  const pointers = new Map()
  let dragStart = null
  let pinchStartDistance = null
  let pinchStartZoom = zoom

  const pointerDistance = () => {
    if (pointers.size < 2) return null
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const onPointerDown = event => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    container.setPointerCapture?.(event.pointerId)
    if (pointers.size === 1) {
      const world = centerWorld()
      dragStart = { x: event.clientX, y: event.clientY, centerX: world.x, centerY: world.y }
    } else {
      dragStart = null
      pinchStartDistance = pointerDistance()
      pinchStartZoom = zoom
    }
  }

  const onPointerMove = event => {
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size >= 2) {
      const distance = pointerDistance()
      if (!distance || !pinchStartDistance) return
      const target = clamp(Math.round(pinchStartZoom + Math.log2(distance / pinchStartDistance)), MIN_ZOOM, currentMaxZoom())
      if (target !== zoom) {
        zoom = target
        clearVisibleTiles()
        render()
      }
      return
    }
    if (!dragStart) return
    const dx = event.clientX - dragStart.x
    const dy = event.clientY - dragStart.y
    center = unproject(dragStart.centerX - dx, dragStart.centerY - dy)
    render()
  }

  const onPointerEnd = event => {
    pointers.delete(event.pointerId)
    if (!pointers.size) {
      dragStart = null
      pinchStartDistance = null
    } else if (pointers.size === 1) {
      const [remaining] = pointers.values()
      const world = centerWorld()
      dragStart = { x: remaining.x, y: remaining.y, centerX: world.x, centerY: world.y }
    }
  }

  const onWheel = event => {
    event.preventDefault()
    changeZoom(event.deltaY < 0 ? 1 : -1)
  }

  container.style.touchAction = 'none'
  container.addEventListener('pointerdown', onPointerDown)
  container.addEventListener('pointermove', onPointerMove)
  container.addEventListener('pointerup', onPointerEnd)
  container.addEventListener('pointercancel', onPointerEnd)
  container.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    container?.removeEventListener('pointerdown', onPointerDown)
    container?.removeEventListener('pointermove', onPointerMove)
    container?.removeEventListener('pointerup', onPointerEnd)
    container?.removeEventListener('pointercancel', onPointerEnd)
    container?.removeEventListener('wheel', onWheel)
  }
}

const createControls = () => {
  const controls = document.createElement('div')
  controls.className = 'dom-map-zoom-controls'
  const plus = document.createElement('button')
  plus.type = 'button'
  plus.textContent = '+'
  plus.setAttribute('aria-label', 'Zoom in')
  plus.addEventListener('click', () => changeZoom(1))
  const minus = document.createElement('button')
  minus.type = 'button'
  minus.textContent = '−'
  minus.setAttribute('aria-label', 'Zoom out')
  minus.addEventListener('click', () => changeZoom(-1))
  controls.append(plus, minus)
  container.appendChild(controls)
}

export const initializeDetailMap = (containerId, { onReady, onError } = {}) => {
  if (container) return { container }
  container = document.getElementById(containerId)
  if (!container) {
    onError?.(new Error('Detail map container not found.'))
    return null
  }

  onReadyCallback = onReady
  onErrorCallback = onError
  readyNotified = false
  anyTileLoaded = false
  terminalTileError = false
  tileErrors = 0
  container.classList.add('dom-detail-map')
  container.innerHTML = ''

  tilePane = document.createElement('div')
  tilePane.className = 'dom-map-tiles'
  overlaySvg = svgElement('svg', { class: 'dom-map-overlay', 'aria-hidden': 'true' })
  planeElement = document.createElement('div')
  planeElement.className = 'dom-map-plane'
  planeElement.textContent = '✈'
  planeElement.style.display = 'none'
  attributionElement = document.createElement('div')
  attributionElement.className = 'dom-map-attribution'
  attributionElement.textContent = '© OpenStreetMap contributors · tiles VersaTiles'

  container.append(tilePane, overlaySvg, planeElement, attributionElement)
  createControls()
  interactionCleanup = installInteractions()

  resizeObserver = new ResizeObserver(() => render())
  resizeObserver.observe(container)
  tileWatchdog = window.setTimeout(() => {
    if (!anyTileLoaded) notifyTerminalError(navigator.onLine
      ? 'VersaTiles did not return a map tile within 8 seconds'
      : 'No downloaded offline map is available for this view')
  }, 8000)

  render()
  return { container }
}

export const setDetailMapTrip = tripId => {
  const next = tripId ? String(tripId) : null
  if (next === activeTripId) return
  activeTripId = next
  clearVisibleTiles()
  if (container) render()
}

export const refreshDetailMapTiles = () => {
  clearVisibleTiles()
  tileErrors = 0
  terminalTileError = false
  if (container) render()
}

export const setDetailRoute = (nodes, labels = {}) => {
  routeSamples = samplesForNodes(nodes)
  routeLabels = labels || {}
  currentProgress = 0
  aircraftState = null
  if (routeSamples.length) fitRoute(routeSamples)
  else renderOverlay()
}

export const setDetailRouteAlternatives = (plans, selectedId = null) => {
  selectedAlternativeId = selectedId ? String(selectedId) : null
  alternativeRoutes = (plans || [])
    .filter(plan => plan?.previewNodes?.length >= 2)
    .map(plan => ({ id: String(plan.id), samples: samplesForNodes(plan.previewNodes) }))
  renderOverlay()
}

export const highlightDetailRouteAlternative = planId => {
  selectedAlternativeId = planId ? String(planId) : null
  renderOverlay()
}

export const updateDetailProgress = (progress, aircraftPosition = null) => {
  currentProgress = clamp(Number(progress || 0), 0, 1)
  if (aircraftPosition && Number.isFinite(Number(aircraftPosition.lat)) && Number.isFinite(Number(aircraftPosition.lon))) {
    aircraftState = { ...aircraftState, lat: Number(aircraftPosition.lat), lon: Number(aircraftPosition.lon) }
  }
  renderOverlay()
}

export const updateDetailAircraft = (lat, lon, bearing = 0, follow = false) => {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return
  aircraftState = { lat: Number(lat), lon: Number(lon), bearing: Number(bearing || 0) }
  if (follow) center = { lat: Number(lat), lon: Number(lon) }
  render()
}

export const recenterDetailAircraft = (lat, lon) => {
  if (!container || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return false
  center = { lat: Number(lat), lon: Number(lon) }
  zoom = Math.min(currentMaxZoom(), Math.max(zoom, 7))
  clearVisibleTiles()
  render()
  return true
}

export const resizeDetailMap = () => { if (container) render() }

export const destroyDetailMap = () => {
  clearTimeout(tileWatchdog)
  resizeObserver?.disconnect?.()
  resizeObserver = null
  interactionCleanup?.()
  interactionCleanup = null
  clearVisibleTiles()
  memoryTileData.clear()
  routeSamples = []
  routeLabels = {}
  alternativeRoutes = []
  selectedAlternativeId = null
  aircraftState = null
  currentProgress = 0
  activeTripId = null
  try { container?.replaceChildren?.() } catch (_) { /* no-op */ }
  container = null
  tilePane = null
  overlaySvg = null
  planeElement = null
  attributionElement = null
  onReadyCallback = null
  onErrorCallback = null
  readyNotified = false
  anyTileLoaded = false
  terminalTileError = false
  tileErrors = 0
  center = { lat: 50.11, lon: 8.68 }
  zoom = 3
}
