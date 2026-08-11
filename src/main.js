import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Capacitor } from '@capacitor/core'
import App from './App.vue'
import './style.css'
import { useFlightStore } from './stores/flightStore'
import { mountDetailMapOverlay } from './utils/detailMapOverlay'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.mount('#app')

// The detailed online map deliberately uses ordinary DOM <img> tiles and an SVG
// overlay. It has no second WebGL context and does not depend on a map framework.
const flightStore = useFlightStore(pinia)
const unmountDetailMapOverlay = mountDetailMapOverlay(flightStore)
window.addEventListener('pagehide', () => unmountDetailMapOverlay(), { once: true })

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
