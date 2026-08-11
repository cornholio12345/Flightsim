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

// The detailed online vector map is an optional overlay. The existing Three.js
// globe remains the self-contained offline renderer used in flight.
const flightStore = useFlightStore(pinia)
const unmountDetailMapOverlay = mountDetailMapOverlay(flightStore)
window.addEventListener('pagehide', () => unmountDetailMapOverlay(), { once: true })

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .then(reg => console.log('Service Worker registered'))
    .catch(err => console.log('Service Worker registration failed:', err))
}