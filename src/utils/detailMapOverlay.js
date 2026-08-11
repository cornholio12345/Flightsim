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
  panel.insertBefore(detailContainer, panel.firstChild)

  const switcher = document.createElement('div')
  switcher.className = 'map-mode-switch'
  const offlineButton = buildButton('Offline globe', true)
  const detailButton = buildButton('Detail map')
  switcher.append(offlineButton, detailButton)
  panel.appendChild(switcher)

  let mode = 'offline'
  let detailInitialized = false
  let currentTripId = null
  let currentState = null
  let syncTimer = null

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

  const ensureDetail = () => {
    if (!detailInitialized) {
      initializeDetailMap('detail-map')
      detailInitialized = true
    }
    syncTrip()
    window.setTimeout(resizeDetailMap, 60)
  }

  const setMode = nextMode => {
    if (nextMode === 'detail' && !navigator.onLine && !detailInitialized) {
      detailButton.classList.add('needs-online')
      detailButton.textContent = 'Detail map · online'
      window.setTimeout(() => {
        detailButton.classList.remove('needs-online')
        detailButton.textContent = 'Detail map'
      }, 1800)
      return
    }
    mode = nextMode
    const detail = mode === 'detail'
    offlineButton.classList.toggle('active', !detail)
    detailButton.classList.toggle('active', detail)
    canvas.style.visibility = detail ? 'hidden' : 'visible'
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
    if (mode === 'detail') syncTrip()
  }, 1000)

  return () => {
    clearInterval(syncTimer)
    panel.removeEventListener('click', interceptFollow, true)
    window.removeEventListener('resize', handleResize)
    try { switcher.remove() } catch (_) { /* no-op */ }
    try { detailContainer.remove() } catch (_) { /* no-op */ }
    if (detailInitialized) destroyDetailMap()
  }
}
