import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Capacitor } from '@capacitor/core'
import App from './App.vue'
import './style.css'
import { useFlightStore } from './stores/flightStore'
import { mountDetailMapOverlay } from './utils/detailMapOverlay'
import { downloadOfflineMapPack, estimateOfflineMapPack, getOfflineMapPackStatus } from './utils/offlineMapStore'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.mount('#app')

// The detailed online map deliberately uses ordinary DOM <img> tiles and an SVG
// overlay. It has no second WebGL context and does not depend on a map framework.
const flightStore = useFlightStore(pinia)
const unmountDetailMapOverlay = mountDetailMapOverlay(flightStore)

// Offline detail maps are a pre-flight asset. Expose the downloader directly on
// every saved-flight card instead of waiting for that trip to become active.
// The active flight keeps using the richer downloader inside Detail map.
const preflightDownloadControllers = new Map()
const preflightMapStates = new Map()
let preflightSyncQueued = false

const tripById = tripId => (flightStore.savedTrips || []).find(trip => String(trip.id) === String(tripId)) || null

const renderPreflightMapButton = (button, trip) => {
  if (!button || !trip) return
  const state = preflightMapStates.get(String(trip.id))
  const downloading = preflightDownloadControllers.has(String(trip.id))
  const completed = Number(state?.completed || 0)
  const total = Math.max(1, Number(state?.tileCount || estimateOfflineMapPack(trip.route?.nodes || []).tileCount || 1))
  const percent = Math.round((completed / total) * 100)

  button.disabled = downloading || !navigator.onLine || Boolean(state?.complete)
  button.className = `btn small secondary preflight-map-download${state?.complete ? ' map-ready' : ''}`
  let label = 'Download map'
  if (downloading) label = `Downloading map… ${percent}%`
  else if (state?.complete) label = '✓ Map ready'
  else if (completed > 0) label = `Resume map · ${percent}%`
  if (button.textContent !== label) button.textContent = label
}

const refreshPreflightMapState = async trip => {
  if (!trip?.id || !trip?.route?.nodes?.length) return
  const tripId = String(trip.id)
  try {
    const state = await getOfflineMapPackStatus(trip.id, trip.route.nodes)
    if (!tripById(tripId)) return
    preflightMapStates.set(tripId, state)
    const button = document.querySelector(`.preflight-map-download[data-trip-id="${CSS.escape(tripId)}"]`)
    renderPreflightMapButton(button, trip)
  } catch (_) {
    // A missing/corrupt status must not block takeoff; the normal download path
    // will surface a concrete error if the user taps the button.
  }
}

const startPreflightMapDownload = async event => {
  const button = event.currentTarget
  const tripId = String(button?.dataset?.tripId || '')
  const trip = tripById(tripId)
  if (!trip?.id || !trip?.route?.nodes?.length || preflightDownloadControllers.has(tripId)) return
  if (!navigator.onLine) return

  const current = await getOfflineMapPackStatus(trip.id, trip.route.nodes)
  preflightMapStates.set(tripId, current)
  if (current?.complete) {
    renderPreflightMapButton(button, trip)
    return
  }

  const controller = new AbortController()
  preflightDownloadControllers.set(tripId, controller)
  renderPreflightMapButton(button, trip)

  try {
    await downloadOfflineMapPack({
      tripId: trip.id,
      nodes: trip.route.nodes,
      signal: controller.signal,
      onProgress: progress => {
        if (!tripById(tripId)) return
        preflightMapStates.set(tripId, {
          ...(preflightMapStates.get(tripId) || {}),
          ...progress,
          complete: false,
          tileCount: Number(progress.total || progress.tileCount || 0),
          completed: Number(progress.completed || 0)
        })
        renderPreflightMapButton(button, trip)
      }
    })
    const state = await getOfflineMapPackStatus(trip.id, trip.route.nodes)
    if (tripById(tripId)) preflightMapStates.set(tripId, state)
  } catch (error) {
    if (error?.name !== 'AbortError') console.warn('Preflight offline-map download failed', error)
    try {
      const state = await getOfflineMapPackStatus(trip.id, trip.route.nodes)
      if (tripById(tripId)) preflightMapStates.set(tripId, state)
    } catch (_) { /* keep prior progress */ }
  } finally {
    preflightDownloadControllers.delete(tripId)
    renderPreflightMapButton(button, trip)
  }
}

const syncPreflightMapButtons = () => {
  preflightSyncQueued = false
  const cards = [...document.querySelectorAll('.saved-section .saved-card')]
  const trips = flightStore.savedTrips || []

  cards.forEach((card, index) => {
    const trip = trips[index]
    const actions = card.querySelector('.saved-actions')
    const existing = actions?.querySelector('.preflight-map-download')
    if (!actions || !trip?.id || !trip?.route?.nodes?.length || trip.status === 'active') {
      existing?.remove()
      return
    }

    let button = existing
    const tripId = String(trip.id)
    if (!button || button.dataset.tripId !== tripId) {
      button?.remove()
      button = document.createElement('button')
      button.type = 'button'
      button.dataset.tripId = tripId
      button.addEventListener('click', startPreflightMapDownload)
      actions.insertBefore(button, actions.firstChild)
      refreshPreflightMapState(trip)
    }
    renderPreflightMapButton(button, trip)
  })
}

const queuePreflightMapSync = () => {
  if (preflightSyncQueued) return
  preflightSyncQueued = true
  window.requestAnimationFrame(syncPreflightMapButtons)
}

const preflightObserver = new MutationObserver(queuePreflightMapSync)
preflightObserver.observe(document.getElementById('app'), { childList: true, subtree: true })
const refreshPreflightConnectivity = () => {
  queuePreflightMapSync()
  ;(flightStore.savedTrips || []).forEach(trip => {
    if (trip.status !== 'active') refreshPreflightMapState(trip)
  })
}
window.addEventListener('online', refreshPreflightConnectivity)
window.addEventListener('offline', refreshPreflightConnectivity)
queuePreflightMapSync()

window.addEventListener('pagehide', () => {
  unmountDetailMapOverlay()
  preflightObserver.disconnect()
  window.removeEventListener('online', refreshPreflightConnectivity)
  window.removeEventListener('offline', refreshPreflightConnectivity)
  preflightDownloadControllers.forEach(controller => controller.abort())
  preflightDownloadControllers.clear()
}, { once: true })

// A service worker is useful for the web/PWA build, but the native Capacitor app
// already ships its assets locally. Keeping an old SW/cache alive inside the APK
// can make an updated install render stale frontend files, so remove it on native.
if ('serviceWorker' in navigator) {
  if (Capacitor.isNativePlatform()) {
    navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
      .catch(() => {})
    if ('caches' in window) {
      caches.keys()
        .then(names => Promise.all(names.filter(name => name.startsWith('flightsim-')).map(name => caches.delete(name))))
        .catch(() => {})
    }
  } else {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('Service Worker registered', reg.scope))
      .catch(err => console.log('Service Worker registration failed:', err))
  }
}
