import { getFlightState } from './routeUtils'
import {
  destroyDetailMap,
  initializeDetailMap,
  recenterDetailAircraft,
  refreshDetailMapTiles,
  resizeDetailMap,
  setDetailMapTrip,
  setDetailRoute,
  updateDetailAircraft,
  updateDetailProgress
} from './detailMap'
import {
  deleteOfflineMapPack,
  downloadOfflineMapPack,
  estimateOfflineMapPack,
  formatOfflineBytes,
  getOfflineMapPack
} from './offlineMapStore'

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

const element = (tag, className, text = '') => {
  const node = document.createElement(tag)
  node.className = className
  if (text) node.textContent = text
  return node
}

export const mountDetailMapOverlay = store => {
  const panel = document.querySelector('.globe-panel')
  const canvas = document.getElementById('globe-canvas')
  if (!panel || !canvas) return () => {}

  const detailContainer = element('div', 'detail-map-container')
  detailContainer.id = 'detail-map'
  detailContainer.style.display = 'none'

  const detailCanvas = element('div', 'detail-map-canvas')
  detailCanvas.id = 'detail-map-canvas'
  detailContainer.appendChild(detailCanvas)

  const detailStatus = element('div', 'detail-map-status', 'Loading detail map…')
  detailStatus.style.display = 'none'
  detailContainer.appendChild(detailStatus)

  const offlineCard = element('div', 'detail-offline-card')
  const offlineTop = element('div', 'detail-offline-top')
  const offlineText = element('div', 'detail-offline-text')
  const offlineTitle = element('strong', 'detail-offline-title', 'Offline detail map')
  const offlineMeta = element('span', 'detail-offline-meta')
  offlineText.append(offlineTitle, offlineMeta)
  const offlineBadge = element('span', 'detail-offline-badge', 'ON DEMAND')
  offlineTop.append(offlineText, offlineBadge)

  const progressWrap = element('div', 'detail-offline-progress-wrap')
  const progressTrack = element('div', 'detail-offline-progress')
  const progressBar = element('div', 'detail-offline-progress-bar')
  progressTrack.appendChild(progressBar)
  const progressLabel = element('span', 'detail-offline-progress-label')
  progressWrap.append(progressTrack, progressLabel)
  progressWrap.style.display = 'none'

  const offlineHint = element('div', 'detail-offline-hint', 'Starts only when you tap. May use mobile data.')
  const offlineActions = element('div', 'detail-offline-actions')
  const downloadButton = element('button', 'detail-offline-download', 'Download offline map')
  downloadButton.type = 'button'
  const secondaryButton = element('button', 'detail-offline-secondary')
  secondaryButton.type = 'button'
  secondaryButton.style.display = 'none'
  offlineActions.append(downloadButton, secondaryButton)
  offlineCard.append(offlineTop, progressWrap, offlineHint, offlineActions)
  offlineCard.style.display = 'none'
  detailContainer.appendChild(offlineCard)

  panel.insertBefore(detailContainer, panel.firstChild)

  const switcher = element('div', 'map-mode-switch')
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
  let offlinePack = null
  let offlineEstimate = null
  let offlineMessage = ''
  let downloadController = null
  let downloadProgress = null

  const setStatus = (text = '') => {
    detailStatus.textContent = text
    detailStatus.style.display = text ? 'block' : 'none'
  }

  const renderOfflineUi = () => {
    const trip = store.activeTrip
    const available = mode === 'detail' && trip?.route?.nodes?.length
    offlineCard.style.display = available ? 'block' : 'none'
    if (!available) return

    offlineEstimate = offlineEstimate || estimateOfflineMapPack(trip.route.nodes)
    const downloading = Boolean(downloadController)
    downloadButton.disabled = downloading || !navigator.onLine
    secondaryButton.disabled = false

    if (downloading && downloadProgress) {
      const completed = Number(downloadProgress.completed || 0)
      const total = Math.max(1, Number(downloadProgress.total || 1))
      const percent = Math.round((completed / total) * 100)
      offlineTitle.textContent = `Downloading offline map · ${percent}%`
      offlineMeta.textContent = `Zoom ${downloadProgress.minZoom}–${downloadProgress.maxZoom} · route ±${downloadProgress.corridorKm} km`
      offlineBadge.textContent = 'DOWNLOADING'
      progressWrap.style.display = 'grid'
      progressBar.style.width = `${percent}%`
      progressLabel.textContent = `${completed} / ${total} tiles · ${formatOfflineBytes(downloadProgress.byteCount)}`
      offlineHint.textContent = 'Download runs only because you started it here.'
      downloadButton.style.display = 'inline-flex'
      downloadButton.textContent = 'Downloading…'
      secondaryButton.style.display = 'inline-flex'
      secondaryButton.textContent = 'Cancel'
      return
    }

    progressWrap.style.display = 'none'
    progressBar.style.width = '0%'

    if (offlinePack) {
      offlineTitle.textContent = 'Offline map ready'
      offlineMeta.textContent = `${offlinePack.tileCount} tiles · ${formatOfflineBytes(offlinePack.byteCount)} · zoom ${offlinePack.minZoom}–${offlinePack.maxZoom} · ±${offlinePack.corridorKm} km`
      offlineBadge.textContent = 'OFFLINE READY'
      offlineHint.textContent = offlineMessage || 'Stored on this device until you delete the map or Android clears app storage.'
      downloadButton.style.display = 'none'
      secondaryButton.style.display = 'inline-flex'
      secondaryButton.textContent = 'Delete offline map'
      return
    }

    downloadButton.style.display = 'inline-flex'
    secondaryButton.style.display = 'none'
    offlineTitle.textContent = 'Offline detail map'
    offlineMeta.textContent = `${offlineEstimate.tileCount} tiles · zoom ${offlineEstimate.minZoom}–${offlineEstimate.maxZoom} · route ±${offlineEstimate.corridorKm} km`
    offlineBadge.textContent = navigator.onLine ? 'ON DEMAND' : 'OFFLINE'
    offlineHint.textContent = offlineMessage || (navigator.onLine
      ? 'Starts only when you tap. May use mobile data.'
      : 'Connect to the internet, then tap Download offline map.')
    downloadButton.textContent = 'Download offline map'
  }

  const refreshOfflineState = async tripId => {
    if (!tripId) {
      offlinePack = null
      offlineEstimate = null
      renderOfflineUi()
      return
    }
    const requestedId = String(tripId)
    const pack = await getOfflineMapPack(requestedId)
    if (String(store.activeTrip?.id || '') !== requestedId) return
    offlinePack = pack || null
    offlineEstimate = store.activeTrip?.route?.nodes?.length ? estimateOfflineMapPack(store.activeTrip.route.nodes) : null
    renderOfflineUi()
  }

  const syncTrip = () => {
    const trip = store.activeTrip
    if (!trip?.route?.nodes?.length) {
      if (currentTripId) {
        if (downloadController) downloadController.abort()
        currentTripId = null
        setDetailMapTrip(null)
        offlinePack = null
        offlineEstimate = null
        renderOfflineUi()
      }
      return
    }
    if (trip.id !== currentTripId) {
      if (downloadController) downloadController.abort()
      currentTripId = trip.id
      currentState = null
      offlineMessage = ''
      offlinePack = null
      offlineEstimate = estimateOfflineMapPack(trip.route.nodes)
      setDetailMapTrip(trip.id)
      setDetailRoute(trip.route.nodes, labelsForTrip(trip))
      refreshOfflineState(trip.id)
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
          const reason = error?.message || (navigator.onLine ? 'Map tile request failed' : 'No offline map available')
          setStatus(reason)
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
    renderOfflineUi()
    if (detail) ensureDetail()
  }

  const startOfflineDownload = async () => {
    const trip = store.activeTrip
    if (!trip?.id || !trip?.route?.nodes?.length || downloadController) return
    if (!navigator.onLine) {
      offlineMessage = 'Connect to the internet before downloading.'
      renderOfflineUi()
      return
    }

    const downloadTripId = String(trip.id)
    offlineMessage = ''
    downloadProgress = {
      completed: 0,
      total: offlineEstimate?.tileCount || 1,
      byteCount: 0,
      minZoom: offlineEstimate?.minZoom,
      maxZoom: offlineEstimate?.maxZoom,
      corridorKm: offlineEstimate?.corridorKm
    }
    downloadController = new AbortController()
    renderOfflineUi()

    try {
      const pack = await downloadOfflineMapPack({
        tripId: trip.id,
        nodes: trip.route.nodes,
        signal: downloadController.signal,
        onProgress: progress => {
          if (String(store.activeTrip?.id || '') !== downloadTripId) return
          downloadProgress = progress
          renderOfflineUi()
        }
      })
      if (String(store.activeTrip?.id || '') === downloadTripId) {
        offlinePack = pack
        offlineMessage = 'Download complete. Detail map can now use this corridor without internet.'
        setDetailMapTrip(trip.id)
        refreshDetailMapTiles()
        setStatus('')
      }
    } catch (error) {
      if (String(store.activeTrip?.id || '') === downloadTripId) {
        if (error?.name === 'AbortError') offlineMessage = 'Download cancelled. Partial map data was removed.'
        else offlineMessage = error?.message || 'Offline map download failed.'
        offlinePack = await getOfflineMapPack(trip.id)
      }
    } finally {
      downloadController = null
      downloadProgress = null
      renderOfflineUi()
    }
  }

  const secondaryAction = async () => {
    const trip = store.activeTrip
    if (downloadController) {
      downloadController.abort()
      return
    }
    if (!trip?.id || !offlinePack) return
    secondaryButton.disabled = true
    try {
      await deleteOfflineMapPack(trip.id)
      offlinePack = null
      offlineMessage = 'Offline map deleted.'
      refreshDetailMapTiles()
    } finally {
      secondaryButton.disabled = false
      renderOfflineUi()
    }
  }

  const onOfflineMode = () => setMode('offline')
  const onDetailMode = () => setMode('detail')
  offlineButton.addEventListener('click', onOfflineMode)
  detailButton.addEventListener('click', onDetailMode)
  downloadButton.addEventListener('click', startOfflineDownload)
  secondaryButton.addEventListener('click', secondaryAction)

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
  const handleConnectivity = () => {
    renderOfflineUi()
    if (mode === 'detail') refreshDetailMapTiles()
  }
  window.addEventListener('resize', handleResize)
  window.addEventListener('online', handleConnectivity)
  window.addEventListener('offline', handleConnectivity)

  syncTimer = window.setInterval(() => {
    if (mode === 'detail') syncTrip()
  }, 1000)

  return () => {
    clearInterval(syncTimer)
    if (downloadController) downloadController.abort()
    panel.removeEventListener('click', interceptFollow, true)
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('online', handleConnectivity)
    window.removeEventListener('offline', handleConnectivity)
    offlineButton.removeEventListener('click', onOfflineMode)
    detailButton.removeEventListener('click', onDetailMode)
    downloadButton.removeEventListener('click', startOfflineDownload)
    secondaryButton.removeEventListener('click', secondaryAction)
    panel.classList.remove('detail-map-active')
    try { switcher.remove() } catch (_) { /* no-op */ }
    try { detailContainer.remove() } catch (_) { /* no-op */ }
    if (detailInitialized || detailReady) destroyDetailMap()
  }
}
