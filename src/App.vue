<template>
  <div class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">OFFLINE FLIGHT PROGRESS</p>
        <h1>FlightSim</h1>
      </div>
      <span class="network-pill" :class="{ offline: !isOnline }">{{ isOnline ? 'Online' : 'Offline' }}</span>
    </header>

    <main class="layout">
      <section class="panel controls">
        <div v-if="activeTrip" class="active-card">
          <div class="active-heading">
            <div>
              <span class="kicker">ACTIVE FLIGHT</span>
              <h2>{{ activeTrip.flightNumber || `${activeTrip.fromICAO} → ${activeTrip.toICAO}` }}</h2>
              <p>{{ activeTrip.fromICAO }} → {{ activeTrip.toICAO }}</p>
            </div>
            <strong>{{ Math.round(currentProgress * 100) }}%</strong>
          </div>

          <div class="progress-track"><div class="progress-fill" :style="{ width: `${currentProgress * 100}%` }"></div></div>

          <div v-if="flightState" class="metric-grid">
            <div><span>Phase</span><strong>{{ flightState.phase }}</strong></div>
            <div><span>Remaining</span><strong>{{ flightState.remainingNm }} nm</strong></div>
            <div><span>Altitude</span><strong>{{ flightState.altitudeFt.toLocaleString() }} ft</strong></div>
            <div><span>Time left</span><strong>{{ remainingTime }}</strong></div>
          </div>

          <p v-if="activeTrip.gpsCorrection" class="gps-note">
            GPS corrected · {{ Math.round(activeTrip.gpsCorrection.routeDistanceNm) }} nm from route · accuracy {{ Math.round(activeTrip.gpsCorrection.accuracyMeters) }} m
          </p>

          <div class="button-row">
            <button class="btn secondary" :disabled="gpsBusy" @click="correctWithGps">{{ gpsBusy ? 'Reading GPS…' : 'Correct with GPS' }}</button>
            <button class="btn danger" @click="stopActiveFlight">Stop</button>
          </div>
        </div>

        <div class="section-head">
          <div>
            <span class="kicker">BEFORE TAKEOFF</span>
            <h2>Find a route</h2>
          </div>
        </div>

        <div class="form-grid">
          <label>
            <span>Flight number</span>
            <input v-model="flightNumber" autocomplete="off" placeholder="e.g. LH717" @keyup.enter="search" />
          </label>
          <div class="route-inputs">
            <label><span>From</span><input v-model="from" autocomplete="off" placeholder="FRA / Frankfurt" /></label>
            <label><span>To</span><input v-model="to" autocomplete="off" placeholder="HND / Tokyo" /></label>
          </div>
          <button class="btn primary" :disabled="searching || !isOnline" @click="search">
            {{ searching ? 'Searching…' : 'Search flight plans' }}
          </button>
        </div>

        <p v-if="message" class="message" :class="{ error: messageIsError }">{{ message }}</p>

        <div v-if="results.length" class="results">
          <button v-for="plan in results" :key="plan.id" class="result-card" :class="{ selected: selectedPlan?.id === plan.id }" @click="choosePlan(plan)">
            <div>
              <strong>{{ plan.flightNumber || `${plan.fromICAO} → ${plan.toICAO}` }}</strong>
              <span>{{ plan.fromICAO }} → {{ plan.toICAO }}</span>
            </div>
            <div class="result-meta">
              <span>{{ plan.distanceNm }} nm</span>
              <span>{{ plan.waypoints }} pts</span>
            </div>
          </button>
        </div>

        <div v-if="selectedPlan" class="selected-plan">
          <div>
            <span class="kicker">SELECTED ROUTE</span>
            <h3>{{ selectedPlan.fromName }} → {{ selectedPlan.toName }}</h3>
            <p>{{ selectedPlan.fromICAO }} → {{ selectedPlan.toICAO }} · {{ selectedPlan.distanceNm }} nm</p>
          </div>
          <label>
            <span>Expected block time (minutes)</span>
            <input v-model.number="blockMinutes" type="number" min="20" max="1500" inputmode="numeric" />
          </label>
          <button class="btn success" :disabled="saving || !isOnline" @click="saveSelectedPlan">
            {{ saving ? 'Downloading route…' : 'Save route for offline use' }}
          </button>
        </div>

        <div v-if="savedTrips.length" class="saved-section">
          <div class="section-head compact"><div><span class="kicker">ON DEVICE</span><h2>Saved flights</h2></div></div>
          <article v-for="trip in savedTrips" :key="trip.id" class="saved-card">
            <div>
              <strong>{{ trip.flightNumber || `${trip.fromICAO} → ${trip.toICAO}` }}</strong>
              <span>{{ trip.fromICAO }} → {{ trip.toICAO }} · {{ trip.distanceNm }} nm · {{ formatDuration(trip.blockMinutes) }}</span>
            </div>
            <div class="saved-actions">
              <button v-if="trip.status !== 'active'" class="btn small primary" @click="startSavedFlight(trip)">Takeoff now</button>
              <button class="icon-btn" aria-label="Delete saved flight" @click="removeTrip(trip)">×</button>
            </div>
          </article>
        </div>

        <p class="attribution">
          Route data from <a href="https://flightplandatabase.com" target="_blank" rel="noopener">Flight Plan Database</a>. Simulation use only — not suitable for real-world aviation or navigation.
        </p>
      </section>

      <section class="globe-panel">
        <canvas id="globe-canvas"></canvas>
        <div v-if="flightState" class="hud">
          <strong>{{ flightState.lat.toFixed(2) }}°, {{ flightState.lon.toFixed(2) }}°</strong>
          <span>{{ flightState.speedKt }} kt · hdg {{ Math.round(flightState.bearing || 0) }}°</span>
          <span v-if="flightState.nextIdent">next {{ flightState.nextIdent }}</span>
        </div>
        <div v-else class="globe-empty">
          <strong>Route globe</strong>
          <span>Save a route online, then start it at takeoff.</span>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useFlightStore } from './stores/flightStore'
import { estimateBlockMinutes, fetchFlightPlan, normalizeFlightNumber, searchFlightPlans } from './services/flightAPI'
import { formatDuration, getFlightState, nearestProgressOnRoute } from './utils/routeUtils'
import { destroyGlobe, initializeGlobe, setRouteOnGlobe, updateAircraftPosition } from './utils/globeUtils'

const flightStore = useFlightStore()
const flightNumber = ref('')
const from = ref('')
const to = ref('')
const results = ref([])
const selectedPlan = ref(null)
const blockMinutes = ref(0)
const searching = ref(false)
const saving = ref(false)
const gpsBusy = ref(false)
const message = ref('')
const messageIsError = ref(false)
const now = ref(Date.now())
const isOnline = ref(navigator.onLine)
let timer
let globe

const savedTrips = computed(() => flightStore.savedTrips)
const activeTrip = computed(() => flightStore.activeTrip)

const timeProgress = computed(() => {
  const trip = activeTrip.value
  if (!trip?.startedAt || !trip.blockMinutes) return 0
  return Math.min(1, Math.max(0, (now.value - trip.startedAt) / (trip.blockMinutes * 60_000)))
})

const currentProgress = computed(() => Math.min(1, Math.max(0, timeProgress.value + Number(activeTrip.value?.progressOffset || 0))))

const flightState = computed(() => {
  const trip = activeTrip.value
  if (!trip?.route) return null
  return getFlightState({
    route: trip.route,
    progress: currentProgress.value,
    cruiseAltitudeFt: trip.maxAltitudeFt || 36000
  })
})

const remainingTime = computed(() => {
  if (!activeTrip.value) return '—'
  return formatDuration(activeTrip.value.blockMinutes * (1 - currentProgress.value))
})

const setMessage = (text, error = false) => {
  message.value = text
  messageIsError.value = error
}

const search = async () => {
  if (!isOnline.value) return setMessage('You are offline. Use one of the saved flights below.', true)
  searching.value = true
  results.value = []
  selectedPlan.value = null
  setMessage('')
  try {
    results.value = await searchFlightPlans({ flightNumber: flightNumber.value, from: from.value, to: to.value })
    if (!results.value.length) setMessage('No matching plans found. Try adding departure and destination.', true)
  } catch (error) {
    setMessage(error.message || 'Flight-plan search failed.', true)
  } finally {
    searching.value = false
  }
}

const choosePlan = plan => {
  selectedPlan.value = plan
  blockMinutes.value = estimateBlockMinutes(plan.distanceNm)
}

const saveSelectedPlan = async () => {
  if (!selectedPlan.value) return
  saving.value = true
  setMessage('')
  try {
    const fullPlan = await fetchFlightPlan(selectedPlan.value.id)
    const trip = await flightStore.savePlanForOffline({
      plan: fullPlan,
      requestedFlightNumber: normalizeFlightNumber(flightNumber.value),
      blockMinutes: blockMinutes.value || estimateBlockMinutes(fullPlan.distanceNm)
    })
    setRouteOnGlobe(trip.route.nodes)
    setMessage('Route downloaded and stored on this device. You can now go offline.')
  } catch (error) {
    setMessage(error.message || 'Could not save this route.', true)
  } finally {
    saving.value = false
  }
}

const startSavedFlight = async trip => {
  try {
    const active = await flightStore.startTrip(trip.id)
    setRouteOnGlobe(active.route.nodes)
    now.value = Date.now()
    setMessage('Flight started. Progress is now estimated from elapsed time and the cached route.')
  } catch (error) {
    setMessage(error.message || 'Could not start this flight.', true)
  }
}

const stopActiveFlight = async () => {
  if (!activeTrip.value) return
  await flightStore.stopTrip(activeTrip.value.id)
}

const removeTrip = async trip => {
  if (trip.status === 'active') await flightStore.stopTrip(trip.id)
  await flightStore.deleteTrip(trip.id)
}

const correctWithGps = async () => {
  const trip = activeTrip.value
  if (!trip || !navigator.geolocation) return setMessage('GPS is not available on this device.', true)
  gpsBusy.value = true
  setMessage('')

  navigator.geolocation.getCurrentPosition(async position => {
    try {
      const nearest = nearestProgressOnRoute(trip.route, position.coords.latitude, position.coords.longitude)
      // Ignore wildly implausible fixes (for example a terminal GPS position before takeoff).
      if (nearest.distanceNm > 120) {
        throw new Error(`GPS fix is about ${Math.round(nearest.distanceNm)} nm from the route, so it was not applied.`)
      }
      const progressOffset = nearest.progress - timeProgress.value
      await flightStore.applyGpsCorrection(trip.id, {
        progressOffset,
        position: { lat: position.coords.latitude, lon: position.coords.longitude },
        accuracyMeters: position.coords.accuracy,
        routeDistanceNm: nearest.distanceNm
      })
      setMessage(`GPS correction applied at ${Math.round(nearest.progress * 100)}% route progress.`)
    } catch (error) {
      setMessage(error.message || 'GPS correction failed.', true)
    } finally {
      gpsBusy.value = false
    }
  }, error => {
    gpsBusy.value = false
    setMessage(`GPS unavailable: ${error.message}`, true)
  }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 })
}

const handleOnline = () => { isOnline.value = navigator.onLine }

onMounted(async () => {
  globe = initializeGlobe('globe-canvas')
  await flightStore.refreshTrips()
  if (activeTrip.value?.route?.nodes) setRouteOnGlobe(activeTrip.value.route.nodes)
  timer = window.setInterval(() => { now.value = Date.now() }, 1000)
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOnline)
})

watch(flightState, state => {
  if (state && globe) updateAircraftPosition(state.lat, state.lon, state.altitudeFt)
}, { immediate: true })

watch(activeTrip, trip => {
  if (trip?.route?.nodes) setRouteOnGlobe(trip.route.nodes)
})

onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOnline)
  destroyGlobe()
})
</script>

<style scoped>
:global(body) { color: #eaf2f8; }
* { box-sizing: border-box; }
.app-shell { min-height: 100%; background: radial-gradient(circle at 80% 0%, #173b58 0, #091622 34%, #050b12 80%); }
.topbar { height: 76px; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,.08); background: rgba(4,10,16,.72); backdrop-filter: blur(14px); }
.topbar h1 { margin: 0; font-size: 24px; letter-spacing: -.03em; }
.eyebrow, .kicker { color: #71d4ac; font-size: 10px; font-weight: 800; letter-spacing: .16em; }
.eyebrow { margin: 0 0 3px; }
.network-pill { font-size: 12px; padding: 6px 10px; border-radius: 999px; color: #74e2b2; background: rgba(56,183,128,.13); border: 1px solid rgba(74,224,165,.25); }
.network-pill.offline { color: #ffcb70; background: rgba(255,171,64,.12); border-color: rgba(255,185,78,.25); }
.layout { height: calc(100vh - 76px); padding: 14px; display: grid; grid-template-columns: minmax(320px, 390px) minmax(0, 1fr); gap: 14px; }
.panel, .globe-panel { border: 1px solid rgba(255,255,255,.08); background: rgba(10,22,32,.82); border-radius: 18px; box-shadow: 0 18px 50px rgba(0,0,0,.25); }
.controls { overflow-y: auto; padding: 18px; }
.globe-panel { position: relative; overflow: hidden; min-height: 360px; }
#globe-canvas { width: 100%; height: 100%; display: block; }
.section-head { display: flex; justify-content: space-between; align-items: center; margin: 18px 0 12px; }
.section-head.compact { margin-top: 28px; }
.section-head h2, .active-card h2 { margin: 2px 0 0; font-size: 20px; }
.form-grid { display: grid; gap: 10px; }
.route-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
label { display: grid; gap: 6px; }
label span { color: #91a6b5; font-size: 11px; font-weight: 700; }
input { width: 100%; border: 1px solid rgba(255,255,255,.12); background: #0a1722; color: #f3f8fb; padding: 11px 12px; border-radius: 10px; font-size: 14px; }
input:focus { border-color: #4bc494; box-shadow: 0 0 0 3px rgba(75,196,148,.12); }
.btn { border: 0; border-radius: 10px; padding: 11px 13px; color: #f8fbfd; font-weight: 800; cursor: pointer; }
.btn:disabled { opacity: .48; cursor: default; }
.btn.primary { background: #2475a8; }
.btn.success { background: #24936b; }
.btn.secondary { background: #263d4e; }
.btn.danger { background: #8b3b4d; }
.btn.small { padding: 8px 10px; font-size: 12px; }
.button-row { display: flex; gap: 8px; margin-top: 13px; }
.button-row .btn { flex: 1; }
.message { margin: 10px 0 0; padding: 9px 10px; border-radius: 9px; background: rgba(63,167,123,.12); color: #a9efcb; font-size: 12px; line-height: 1.4; }
.message.error { background: rgba(196,71,89,.12); color: #ffabb7; }
.results { display: grid; gap: 7px; margin-top: 13px; }
.result-card { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; text-align: left; color: inherit; border: 1px solid rgba(255,255,255,.08); border-radius: 11px; padding: 11px; background: #0b1823; cursor: pointer; }
.result-card.selected { border-color: #52c99a; background: rgba(42,145,106,.14); }
.result-card strong, .saved-card strong { display: block; font-size: 14px; }
.result-card span, .saved-card span { color: #8ea4b3; font-size: 11px; }
.result-meta { text-align: right; display: grid; white-space: nowrap; }
.selected-plan { margin-top: 13px; border-radius: 13px; padding: 14px; background: rgba(43,117,161,.13); border: 1px solid rgba(70,149,196,.2); display: grid; gap: 12px; }
.selected-plan h3 { margin: 3px 0; font-size: 15px; }
.selected-plan p { margin: 0; color: #9eb0bc; font-size: 12px; }
.active-card { padding: 14px; border-radius: 14px; background: linear-gradient(145deg, rgba(30,117,89,.25), rgba(28,77,112,.18)); border: 1px solid rgba(73,210,158,.25); }
.active-heading { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
.active-heading p { margin: 3px 0 0; color: #a9bbc6; font-size: 12px; }
.active-heading > strong { font-size: 26px; color: #71d4ac; }
.progress-track { height: 5px; border-radius: 999px; background: rgba(255,255,255,.09); overflow: hidden; margin: 14px 0; }
.progress-fill { height: 100%; background: #63dba7; transition: width 1s linear; }
.metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.metric-grid div { padding: 9px; border-radius: 9px; background: rgba(0,0,0,.17); }
.metric-grid span { display: block; color: #8ea4b3; font-size: 10px; }
.metric-grid strong { font-size: 13px; }
.gps-note { font-size: 10px; color: #9fc4d8; margin: 10px 0 0; }
.saved-section { margin-top: 4px; }
.saved-card { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
.saved-actions { display: flex; align-items: center; gap: 5px; }
.icon-btn { width: 31px; height: 31px; border-radius: 8px; border: 0; color: #a9bbc7; background: #172733; font-size: 19px; }
.attribution { margin: 24px 0 3px; color: #657b89; font-size: 10px; line-height: 1.45; }
.attribution a { color: #7da9c2; }
.hud { position: absolute; left: 16px; bottom: 16px; display: grid; gap: 3px; padding: 11px 13px; border-radius: 10px; background: rgba(4,12,19,.78); border: 1px solid rgba(93,220,168,.22); backdrop-filter: blur(8px); }
.hud strong { color: #78e3b5; font-size: 14px; }
.hud span { color: #9cb1bf; font-size: 11px; }
.globe-empty { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); display: grid; text-align: center; width: min(280px, 80%); color: #95aab7; }
.globe-empty strong { color: #d5e2e9; font-size: 13px; }
.globe-empty span { font-size: 11px; margin-top: 3px; }
@media (max-width: 820px) {
  .layout { height: auto; min-height: calc(100vh - 76px); grid-template-columns: 1fr; padding: 10px; }
  .controls { order: 2; overflow: visible; }
  .globe-panel { order: 1; height: 42vh; min-height: 300px; }
  .topbar { height: 68px; }
}
@media (max-width: 420px) {
  .route-inputs { grid-template-columns: 1fr; }
  .metric-grid { grid-template-columns: 1fr 1fr; }
  .controls { padding: 14px; }
}
</style>
