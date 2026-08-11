import { getFlightState } from './routeUtils'
import {
  destroyDetailMap,
  initializeDetailMap,
  recenterDetailAircraft,
  resizeDetailMap,
  setDetailRoute,
  updateDetailAircraft,
  updateDetailProgress
} from './detailMap'

const labelsForTrip = trip => ({
  fromLabel: trip?.fromIATA || trip?.fromICAO || 'DEP',
  toLabel: trip?.toIATA || trip?.toICAO || 'ARR'
})

const buildButton = (text, active = false) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = text
  button.className = `map-mode-button${active ? ' active' : ''}`
  return button
}

export const mountDetailMapOverlay = store => {
  const panel = document.querySelector('.globe-panel')
  const canvas = document.getElementById('globe-canvas')
  if (!panel || !canvas) return () => {}

  const detailContainer = document.createElement('div')
  detailContainer.id = 'detail-map'
  detailContainer.className = 'detail-map-container'
  detailContainer.style.display = 'none'

  const detailCanvas = document.createElement('div')
  detailCanvas.id = 'detail-map-canvas'
  detailCanvas.className = 'detail-map-canvas'
  detailContainer.appendChild(detailCanvas)

  const detailStatus = document.createElement('div')
  detailStatus.className = 'detail-map-status'
  detailStatus.textContent = 'Loading detail map…'
  detailStatus.style.display = 'none'
  detailContainer.appendChild(detailStatus)
  panel.insertBefore(detailContainer, panel.firstChild)

  const switcher = document.createElement('div')
  switcher.className = 'map-mode-switch'
  const offlineButton = buildButton('Offline globe', true)
  const detailButton = buildButton('Detail map')
  switcher.append(offlineButton, detailButton)
  panel.appendChild(switcher)

  let mode = 'offline'
  let detailInitialized = false
  let detailReady = false
  let currentTripId = null
  let currentState = null
  let syncTimer = null

  const setStatus = (text = '') => {
    detailStatus.textContent = text
    detailStatus.style.display = text ? 'block' : 'none'
  }

  const syncTrip = () => {
    const trip = store.activeTrip
    if (!trip?.route?.nodes?.length) return
    if (trip.id !== currentTripId) {
      currentTripId = trip.id
      setDetailRoute(trip.route.nodes, labelsForTrip(trip))
    }
    const startedAt = Number(trip.startedAt || 0)
    const blockMinutes = Number(trip.blockMinutes || 0)
    if (!startedAt || !blockMinutes) return
    const elapsedMinutes = Math.max(0, (Date.now() - startedAt) / 60_000)
    const timeProgress = Math.min(1, Math.max(0, elapsedMinutes / blockMinutes))
    const progress = Math.min(1, Math.max(0, timeProgress + Number(trip.progressOffset || 0)))
    const state = getFlightState({
      route: trip.route,
      progress,
      elapsedMinutes,
      blockMinutes,
      cruiseAltitudeFt: trip.maxAltitudeFt || 36000
    })
    if (!state) return
    currentState = state
    updateDetailAircraft(state.lat, state.lon, state.bearing, false)
    updateDetailProgress(progress, { lat: state.lat, lon: state.lon })
  }

  const startDetailMap = () => {
    if (mode !== 'detail') return
    if (!detailInitialized) {
      setStatus('Loading map tiles…')
      const detailMap = initializeDetailMap('detail-map-canvas', {
        onReady: () => {
          detailReady = true
          setStatus('')
          resizeDetailMap()
          syncTrip()
        },
        onError: error => {
          console.warn('Detail map error', error)
          detailReady = false
          detailInitialized = false
          destroyDetailMap()
          const reason = navigator.onLine
            ? (error?.message || 'Map tile request failed')
            : 'No internet connection'
          setStatus(`${reason} · tap Detail map to retry`)
        }
      })
      detailInitialized = Boolean(detailMap)
      if (!detailMap) setStatus('Detail map could not start · tap to retry')
    }
    syncTrip()
    resizeDetailMap()
    window.setTimeout(resizeDetailMap, 120)
  }

  const ensureDetail = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(startDetailMap)
    })
  }

  const setMode = nextMode => {
    mode = nextMode
    const detail = mode === 'detail'
    offlineButton.classList.toggle('active', !detail)
    detailButton.classList.toggle('active', detail)
    panel.classList.toggle('detail-map-active', detail)
    canvas.style.display = detail ? 'none' : 'block'
    detailContainer.style.display = detail ? 'block' : 'none'
    if (detail) ensureDetail()
  }

  offlineButton.addEventListener('click', () => setMode('offline'))
  detailButton.addEventListener('click', () => setMode('detail'))

  const interceptFollow = event => {
    if (mode !== 'detail') return
    const target = event.target?.closest?.('.follow-btn')
    if (!target || !currentState) return
    event.preventDefault()
    event.stopImmediatePropagation()
    recenterDetailAircraft(currentState.lat, currentState.lon)
  }
  panel.addEventListener('click', interceptFollow, true)

  const handleResize = () => { if (mode === 'detail') resizeDetailMap() }
  window.addEventListener('resize', handleResize)

  syncTimer = window.setInterval(() => {
    if (mode === 'detail' && detailReady) syncTrip()
  }, 1000)

  return () => {
    clearInterval(syncTimer)
    panel.removeEventListener('click', interceptFollow, true)
    window.removeEventListener('resize', handleResize)
    panel.classList.remove('detail-map-active')
    try { switcher.remove() } catch (_) { /* no-op */ }
    try { detailContainer.remove() } catch (_) { /* no-op */ }
    if (detailInitialized || detailReady) destroyDetailMap()
  }
}
