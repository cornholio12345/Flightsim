import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
import { useFlightStore } from './stores/flightStore'
import { mountDetailMapOverlay } from './utils/detailMapOverlay'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.mount('#app')

// The detailed online map uses Leaflet with ordinary raster tiles for broad
// Android WebView compatibility. The Three.js globe remains fully offline.
const flightStore = useFlightStore(pinia)
const unmountDetailMapOverlay = mountDetailMapOverlay(flightStore)
window.addEventListener('pagehide', () => unmountDetailMapOverlay(), { once: true })

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .then(reg => console.log('Service Worker registered'))
    .catch(err => console.log('Service Worker registration failed:', err))
}
