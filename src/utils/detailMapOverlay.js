import '../detailMapOfflineReady.css'
import { getFlightState } from './routeUtils'
import {
  destroyDetailMap,
  initializeDetailMap,
  recenterDetailAircraft,
  refreshDetailMapTiles,
  resizeDetailMap,
  setDetailMapOfflineMode,
  setDetailMapTheme,
  setDetailMapTrip,
  setDetailRoute,
  updateDetailAircraft,
  updateDetailProgress
} from './detailMap'
import { setGlobeCameraMode } from './globeUtils'
import {
  deleteOfflineMapPack,
  downloadOfflineMapPack,
  estimateOfflineMapPack,
  formatOfflineBytes,
  getOfflineMapPackStatus
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

  const detailTools = element('div', 'detail-map-tools')
  const nightButton = element('button', 'detail-map-tool', 'Night')
  nightButton.type = 'button'
  const offlineTestButton = element('button', 'detail-map-tool', 'Offline test')
  offlineTestButton.type = 'button'
  detailTools.append(nightButton, offlineTestButton)
  detailContainer.appendChild(detailTools)

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

  const offlineActions = element('div', 'detail-offline-actions')
  const downloadButton = element('button', 'detail-offline-download', 'Download offline map')
  downloadButton.type = 'button'
  const secondaryButton = element('button', 'detail-offline-secondary')
  secondaryButton.type = 'button'
  secondaryButton.style.display = 'none'
  offlineActions.append(downloadButton, secondaryButton)
  offlineCard.append(offlineTop, progressWrap, offlineActions)
  offlineCard.style.display = 'none'
  detailContainer.appendChild(offlineCard)

  const offlineReadyButton = element('button', 'detail-offline-ready-delete', '×')
  offlineReadyButton.type = 'button'
  offlineReadyButton.setAttribute('aria-label', 'Delete offline map')
  offlineReadyButton.setAttribute('title', 'Delete offline map')
  offlineReadyButton.style.display = 'none'
  detailContainer.appendChild(offlineReadyButton)

  const deleteModal = element('div', 'detail-offline-delete-modal')
  deleteModal.style.display = 'none'
  const deleteDialog = element('div', 'detail-offline-delete-dialog')
  deleteDialog.setAttribute('role', 'dialog')
  deleteDialog.setAttribute('aria-modal', 'true')
  deleteDialog.setAttribute('aria-labelledby', 'offline-map-delete-title')
  const deleteTitle = element('strong', 'detail-offline-delete-title', 'Delete offline map?')
  deleteTitle.id = 'offline-map-delete-title'
  const deleteActions = element('div', 'detail-offline-delete-actions')
  const deleteCancelButton = element('button', 'detail-offline-delete-cancel', 'Cancel')
  deleteCancelButton.type = 'button'
  const deleteConfirmButton = element('button', 'detail-offline-delete-confirm', 'Delete')
  deleteConfirmButton.type = 'button'
  deleteActions.append(deleteCancelButton, deleteConfirmButton)
  deleteDialog.append(deleteTitle, deleteActions)
  deleteModal.appendChild(deleteDialog)
  detailContainer.appendChild(deleteModal)

  panel.insertBefore(detailContainer, panel.firstChild)

  const switcher = element('div', 'map-mode-switch')
  const globeButton = buildButton('Globe', true)
  const aheadButton = buildButton('Ahead')
  const detailButton = buildButton('Detail map')
  switcher.append(globeButton, aheadButton, detailButton)
  panel.appendChild(switcher)

  let mode = 'globe'
  let detailInitialized = false
  let detailReady = false
  let currentTripId = null
  let currentState = null
  let syncTimer = null
  let offlineState = null
  let offlineEstimate = null
  let downloadController = null
  let downloadProgress = null
  let downloadError = ''
  let nightMode = true
  let offlineTest = false
  try { nightMode = localStorage.getItem('flightsim-detail-night') !== '0' } catch (_) { /* default night */ }
  setDetailMapTheme(nightMode ? 'night' : 'day')

  const setStatus = (text = '') => {
    detailStatus.textContent = text
    detailStatus.style.display = text ? 'block' : 'none'
  }

  const closeDeleteModal = () => {
    deleteModal.style.display = 'none'
  }

  const renderModeUi = () => {
    const hasActiveFlight = Boolean(store.activeTrip?.route?.nodes?.length)
    globeButton.classList.toggle('active', mode === 'globe')
    aheadButton.classList.toggle('active', mode === 'ahead')
    detailButton.classList.toggle('active', mode === 'detail')
    aheadButton.disabled = !hasActiveFlight
    panel.classList.toggle('detail-map-active', mode === 'detail')
    panel.classList.toggle('ahead-mode-active', mode === 'ahead')
    nightButton.classList.toggle('active', nightMode)
    offlineTestButton.classList.toggle('active', offlineTest)
  }

  const renderOfflineUi = () => {
    const trip = store.activeTrip
    const available = Boolean(mode === 'detail' && trip?.route?.nodes?.length)
    const complete = Boolean(available && offlineState?.complete)
    offlineCard.style.display = available && !complete ? 'block' : 'none'
    offlineReadyButton.style.display = complete ? 'grid' : 'none'
    if (!available || complete) return

    offlineEstimate = offlineEstimate || estimateOfflineMapPack(trip.route.nodes)
    const downloading = Boolean(downloadController)
    const completed = Number(offlineState?.completed || 0)
    const total = Math.max(1, Number(offlineState?.tileCount || offlineEstimate.tileCount || 1))
    const partialPercent = Math.round((completed / total) * 100)
    downloadButton.disabled = downloading || !navigator.onLine || offlineTest
    secondaryButton.disabled = false

    if (downloading && downloadProgress) {
      const done = Number(downloadProgress.completed || 0)
      const progressTotal = Math.max(1, Number(downloadProgress.total || 1))
      const percent = Math.round((done / progressTotal) * 100)
      offlineTitle.textContent = `Downloading offline map · ${percent}%`
      offlineMeta.textContent = `Zoom ${downloadProgress.minZoom}–${downloadProgress.maxZoom} · route ±${downloadProgress.corridorKm} km`
      offlineBadge.textContent = 'DOWNLOADING'
      progressWrap.style.display = 'grid'
      progressBar.style.width = `${percent}%`
      progressLabel.textContent = `${done} / ${progressTotal} tiles · ${formatOfflineBytes(downloadProgress.byteCount)}`
      downloadButton.style.display = 'inline-flex'
      downloadButton.textContent = 'Downloading…'
      secondaryButton.style.display = 'inline-flex'
      secondaryButton.textContent = 'Cancel'
      return
    }

    progressWrap.style.display = completed > 0 && !offlineState?.complete ? 'grid' : 'none'
    progressBar.style.width = `${partialPercent}%`
    progressLabel.textContent = completed > 0 ? `${completed} / ${total} tiles · ${formatOfflineBytes(offlineState?.byteCount)}` : ''

    if (completed > 0) {
      offlineTitle.textContent = `Offline map · ${partialPercent}% saved`
      offlineMeta.textContent = downloadError || `Zoom ${offlineState.minZoom}–${offlineState.maxZoom} · route ±${offlineState.corridorKm} km`
      offlineBadge.textContent = offlineTest ? 'TEST OFFLINE' : 'PARTIAL'
      downloadButton.style.display = 'inline-flex'
      downloadButton.textContent = 'Resume download'
      secondaryButton.style.display = 'inline-flex'
      secondaryButton.textContent = 'Delete'
      return
    }

    progressWrap.style.display = 'none'
    downloadButton.style.display = 'inline-flex'
    secondaryButton.style.display = 'none'
    offlineTitle.textContent = 'Offline detail map'
    offlineMeta.textContent = downloadError || `${offlineEstimate.tileCount} tiles · zoom ${offlineEstimate.minZoom}–${offlineEstimate.maxZoom} · route ±${offlineEstimate.corridorKm} km`
    offlineBadge.textContent = offlineTest ? 'TEST OFFLINE' : (navigator.onLine ? 'ON DEMAND' : 'OFFLINE')
    downloadButton.textContent = 'Download offline map'
  }

  const refreshOfflineState = async tripId => {
    if (!tripId) {
      offlineState = null
      offlineEstimate = null
      closeDeleteModal()
      renderOfflineUi()
      return
    }
    const requestedId = String(tripId)
    const trip = store.activeTrip
    if (!trip?.route?.nodes?.length) return
    const state = await getOfflineMapPackStatus(requestedId, trip.route.nodes)
    if (String(store.activeTrip?.id || '') !== requestedId) return
    offlineState = state
    offlineEstimate = estimateOfflineMapPack(trip.route.nodes)
    renderOfflineUi()
  }

  const syncTrip = () => {
    const trip = store.activeTrip
    if (!trip?.route?.nodes?.length) {
      if (currentTripId) {
        if (downloadController) downloadController.abort()
        currentTripId = null
        setDetailMapTrip(null)
        offlineState = null
        offlineEstimate = null
        closeDeleteModal()
        renderOfflineUi()
      }
      if (mode === 'ahead') setMode('globe')
      renderModeUi()
      return
    }
    if (trip.id !== currentTripId) {
      if (downloadController) downloadController.abort()
      currentTripId = trip.id
      currentState = null
      downloadError = ''
      offlineState = null
      offlineEstimate = estimateOfflineMapPack(trip.route.nodes)
      closeDeleteModal()
      setDetailMapTrip(trip.id)
      setDetailRoute(trip.route.nodes, labelsForTrip(trip))
      refreshOfflineState(trip.id)
    }
    const startedAt = Number(trip.startedAt || 0)
    const blockMinutes = Number(trip.blockMinutes || 0)
    if (!startedAt || !blockMinutes) {
      renderModeUi()
      return
    }
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
    renderModeUi()
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
          setStatus(error?.message || (navigator.onLine ? 'Map tile request failed' : 'No offline map available'))
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

  function setMode(nextMode) {
    let next = nextMode
    if (next === 'ahead' && !store.activeTrip?.route?.nodes?.length) next = 'globe'
    mode = next
    const detail = mode === 'detail'
    if (!detail) closeDeleteModal()
    canvas.style.display = detail ? 'none' : 'block'
    detailContainer.style.display = detail ? 'block' : 'none'
    if (mode === 'ahead') setGlobeCameraMode('ahead')
    else if (mode === 'globe') setGlobeCameraMode('free')
    renderModeUi()
    renderOfflineUi()
    if (detail) ensureDetail()
  }

  const startOfflineDownload = async () => {
    const trip = store.activeTrip
    if (!trip?.id || !trip?.route?.nodes?.length || downloadController || offlineTest) return
    if (!navigator.onLine) {
      downloadError = 'Connect to the internet to continue.'
      renderOfflineUi()
      return
    }

    const downloadTripId = String(trip.id)
    downloadError = ''
    offlineState = await getOfflineMapPackStatus(trip.id, trip.route.nodes)
    downloadProgress = {
      completed: offlineState?.completed || 0,
      total: offlineState?.tileCount || offlineEstimate?.tileCount || 1,
      byteCount: offlineState?.byteCount || 0,
      minZoom: offlineState?.minZoom || offlineEstimate?.minZoom,
      maxZoom: offlineState?.maxZoom || offlineEstimate?.maxZoom,
      corridorKm: offlineState?.corridorKm || offlineEstimate?.corridorKm
    }
    downloadController = new AbortController()
    renderOfflineUi()

    try {
      await downloadOfflineMapPack({
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
        offlineState = await getOfflineMapPackStatus(trip.id, trip.route.nodes)
        setDetailMapTrip(trip.id)
        refreshDetailMapTiles()
        setStatus('')
      }
    } catch (error) {
      if (String(store.activeTrip?.id || '') === downloadTripId) {
        offlineState = await getOfflineMapPackStatus(trip.id, trip.route.nodes)
        if (error?.name !== 'AbortError') downloadError = error?.message || 'Download paused.'
      }
    } finally {
      downloadController = null
      downloadProgress = null
      renderOfflineUi()
    }
  }

  const deleteCurrentOfflineMap = async () => {
    const trip = store.activeTrip
    if (!trip?.id || !offlineState?.completed || downloadController) return
    deleteConfirmButton.disabled = true
    deleteCancelButton.disabled = true
    try {
      await deleteOfflineMapPack(trip.id)
      offlineState = null
      downloadError = ''
      closeDeleteModal()
      refreshDetailMapTiles({ resetHealth: offlineTest })
    } finally {
      deleteConfirmButton.disabled = false
      deleteCancelButton.disabled = false
      renderOfflineUi()
    }
  }

  const secondaryAction = async () => {
    const trip = store.activeTrip
    if (downloadController) {
      downloadController.abort()
      return
    }
    if (!trip?.id || !offlineState?.completed) return
    secondaryButton.disabled = true
    try {
      await deleteOfflineMapPack(trip.id)
      offlineState = null
      downloadError = ''
      refreshDetailMapTiles({ resetHealth: offlineTest })
    } finally {
      secondaryButton.disabled = false
      renderOfflineUi()
    }
  }

  const openDeleteModal = () => {
    if (!offlineState?.complete) return
    deleteModal.style.display = 'grid'
    window.requestAnimationFrame(() => deleteCancelButton.focus())
  }

  const onDeleteModalClick = event => {
    if (event.target === deleteModal) closeDeleteModal()
  }

  const onDeleteModalKeydown = event => {
    if (event.key === 'Escape' && deleteModal.style.display !== 'none') closeDeleteModal()
  }

  const toggleNight = () => {
    nightMode = !nightMode
    try { localStorage.setItem('flightsim-detail-night', nightMode ? '1' : '0') } catch (_) { /* no-op */ }
    setDetailMapTheme(nightMode ? 'night' : 'day')
    renderModeUi()
  }

  const toggleOfflineTest = () => {
    offlineTest = !offlineTest
    setStatus('')
    setDetailMapOfflineMode(offlineTest)
    renderModeUi()
    renderOfflineUi()
  }

  const onGlobeMode = () => setMode('globe')
  const onAheadMode = () => setMode('ahead')
  const onDetailMode = () => setMode('detail')
  globeButton.addEventListener('click', onGlobeMode)
  aheadButton.addEventListener('click', onAheadMode)
  detailButton.addEventListener('click', onDetailMode)
  nightButton.addEventListener('click', toggleNight)
  offlineTestButton.addEventListener('click', toggleOfflineTest)
  downloadButton.addEventListener('click', startOfflineDownload)
  secondaryButton.addEventListener('click', secondaryAction)
  offlineReadyButton.addEventListener('click', openDeleteModal)
  deleteCancelButton.addEventListener('click', closeDeleteModal)
  deleteConfirmButton.addEventListener('click', deleteCurrentOfflineMap)
  deleteModal.addEventListener('click', onDeleteModalClick)
  window.addEventListener('keydown', onDeleteModalKeydown)

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
    renderModeUi()
    renderOfflineUi()
    if (mode === 'detail') refreshDetailMapTiles({ resetHealth: true })
  }
  window.addEventListener('resize', handleResize)
  window.addEventListener('online', handleConnectivity)
  window.addEventListener('offline', handleConnectivity)

  syncTimer = window.setInterval(() => {
    syncTrip()
  }, 1000)

  renderModeUi()
  syncTrip()

  return () => {
    clearInterval(syncTimer)
    if (downloadController) downloadController.abort()
    panel.removeEventListener('click', interceptFollow, true)
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('online', handleConnectivity)
    window.removeEventListener('offline', handleConnectivity)
    window.removeEventListener('keydown', onDeleteModalKeydown)
    globeButton.removeEventListener('click', onGlobeMode)
    aheadButton.removeEventListener('click', onAheadMode)
    detailButton.removeEventListener('click', onDetailMode)
    nightButton.removeEventListener('click', toggleNight)
    offlineTestButton.removeEventListener('click', toggleOfflineTest)
    downloadButton.removeEventListener('click', startOfflineDownload)
    secondaryButton.removeEventListener('click', secondaryAction)
    offlineReadyButton.removeEventListener('click', openDeleteModal)
    deleteCancelButton.removeEventListener('click', closeDeleteModal)
    deleteConfirmButton.removeEventListener('click', deleteCurrentOfflineMap)
    deleteModal.removeEventListener('click', onDeleteModalClick)
    panel.classList.remove('detail-map-active', 'ahead-mode-active')
    setGlobeCameraMode('free')
    setDetailMapOfflineMode(false)
    try { switcher.remove() } catch (_) { /* no-op */ }
    try { detailContainer.remove() } catch (_) { /* no-op */ }
    if (detailInitialized || detailReady) destroyDetailMap()
  }
}
