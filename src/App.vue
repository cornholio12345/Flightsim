<template>
  <div class="app-shell">
    <header class="topbar">
      <div><p class="eyebrow">OFFLINE FLIGHT PROGRESS</p><h1>FlightSim</h1></div>
      <span class="network-pill" :class="{ offline: !isOnline }">{{ isOnline ? 'Online' : 'Offline' }}</span>
    </header>

    <main class="layout">
      <section class="panel controls">
        <div v-if="activeTrip" class="active-card">
          <div class="active-heading">
            <div>
              <span class="kicker">ACTIVE FLIGHT</span>
              <h2>{{ activeTrip.flightNumber || routeLabel(activeTrip) }}</h2>
              <p v-if="activeTrip.flightNumber">{{ routeLabel(activeTrip) }}</p>
            </div>
            <strong>{{ Math.round(currentProgress * 100) }}%</strong>
          </div>

          <div class="time-strip">
            <div><span>Started · {{ activeTrip.fromIATA || activeTrip.fromICAO }}</span><strong>{{ activeStartTime }}</strong></div>
            <div><span>ETA · {{ activeTrip.toIATA || activeTrip.toICAO }}</span><strong>{{ activeEtaTime }}</strong></div>
          </div>

          <div class="progress-track"><div class="progress-fill" :style="{ width: `${currentProgress * 100}%` }"></div></div>
          <div v-if="flightState" class="metric-grid">
            <div><span>Phase</span><strong>{{ flightState.phase }}</strong></div>
            <div><span>Remaining</span><strong>{{ nmToKm(flightState.remainingNm) }} km</strong></div>
            <div><span>Altitude</span><strong>{{ ftToM(flightState.altitudeFt).toLocaleString() }} m</strong></div>
            <div><span>Speed</span><strong>{{ Math.round(flightState.speedKt * 1.852) }} km/h</strong></div>
          </div>

          <div class="passenger-status">
            <strong>Currently over {{ geoContext }}</strong>
            <span>{{ remainingTime }} remaining<span v-if="nextWaypointText"> · {{ nextWaypointText }}</span></span>
          </div>

          <p class="gps-note">
            GPS: {{ gpsStatus }}<span v-if="activeTrip.gpsCorrection"> · last correction {{ nmToKm(activeTrip.gpsCorrection.routeDistanceNm) }} km from route · ±{{ Math.round(activeTrip.gpsCorrection.accuracyMeters) }} m</span>
          </p>
          <label class="auto-gps-row">
            <input v-model="autoGps" type="checkbox" />
            <span>Auto-correct with GPS every 3 minutes while the app is open</span>
          </label>
          <div class="button-row">
            <button class="btn secondary" :disabled="gpsBusy" @click="correctWithGps">{{ gpsBusy ? 'Reading GPS…' : 'Correct with GPS' }}</button>
            <button class="btn danger" @click="stopActiveFlight">Stop</button>
          </div>
        </div>

        <div v-if="savedTrips.length" class="saved-section">
          <div class="section-head compact"><div><span class="kicker">ON DEVICE</span><h2>Saved flights</h2></div></div>
          <article v-for="trip in savedTrips" :key="trip.id" class="saved-card">
            <div>
              <strong>{{ trip.flightNumber || routeLabel(trip) }}</strong>
              <span>{{ routeLabel(trip) }} · {{ nmToKm(trip.distanceNm) }} km · {{ formatDuration(trip.blockMinutes) }}</span>
              <span v-if="trip.weatherLabel" class="saved-weather">{{ trip.weatherLabel }}</span>
              <span class="offline-ready">✓ Route cached · ✓ Map bundled · {{ gpsPermission === 'granted' ? '✓ GPS ready' : 'GPS optional' }} · {{ formatDuration(trip.blockMinutes) }} simulation</span>
            </div>
            <div class="saved-actions">
              <button v-if="trip.status !== 'active'" class="btn small primary" @click="startSavedFlight(trip)">Takeoff now</button>
              <button class="icon-btn" aria-label="Delete saved flight" @click="removeTrip(trip)">×</button>
            </div>
          </article>
        </div>

        <div class="section-head"><div><span class="kicker">BEFORE TAKEOFF</span><h2>Find a route</h2></div></div>
        <div class="form-grid">
          <label><span>Flight number</span><input v-model="flightNumber" autocomplete="off" placeholder="e.g. LH400" @keyup.enter="search" /></label>
          <div class="route-inputs">
            <label><span>From</span><input v-model="from" autocomplete="off" placeholder="FRA" /></label>
            <label><span>To</span><input v-model="to" autocomplete="off" placeholder="JFK" /></label>
          </div>
          <button class="btn primary" :disabled="searching || !isOnline" @click="search">{{ searching ? 'Comparing routes…' : 'Search flight plans' }}</button>
        </div>
        <p v-if="message" class="message" :class="{ error: messageIsError }">{{ message }}</p>

        <div v-if="results.length" class="results">
          <button v-for="plan in results" :key="plan.id" class="result-card" :class="{ selected: selectedPlan?.id === plan.id, recommended: plan.recommendationRank === 1 }" @click="choosePlan(plan)">
            <div class="result-main">
              <div class="result-title-row">
                <strong>{{ plan.flightNumber || routeLabel(plan) }}</strong>
                <span v-if="plan.recommendationRank === 1" class="recommended-badge">Recommended</span>
                <span v-else class="rank-badge">#{{ plan.recommendationRank }}</span>
              </div>
              <span class="iata-route">{{ routeLabel(plan) }}</span>
              <span v-if="plan.fromIATA || plan.toIATA" class="icao-route">{{ plan.fromICAO }} → {{ plan.toICAO }}</span>
              <span v-if="plan.viaSummary" class="via">via {{ plan.viaSummary }}</span>
              <span v-if="plan.differenceLabel" class="difference">{{ plan.differenceLabel }}</span>
              <span class="weather" :class="{ tailwind: Number(plan.upperWindKmh) >= 10, headwind: Number(plan.upperWindKmh) <= -10 }">{{ plan.weatherLabel }}</span>
            </div>
            <div class="result-meta">
              <strong>{{ nmToKm(plan.distanceNm) }} km</strong>
              <span>{{ plan.waypoints }} pts</span>
              <span v-if="plan.tags?.length">{{ plan.tags.slice(0, 2).join(' · ') }}</span>
            </div>
          </button>
          <p class="ranking-note">Recommended combines route quality, recency, efficiency and current upper-level winds. Weather is advisory only.</p>
        </div>

        <div v-if="selectedPlan" class="selected-plan">
          <div>
            <span class="kicker">SELECTED ROUTE</span>
            <h3>{{ selectedPlan.fromName }} → {{ selectedPlan.toName }}</h3>
            <p><strong>{{ routeLabel(selectedPlan) }}</strong> · {{ nmToKm(selectedPlan.distanceNm) }} km<span v-if="selectedPlan.viaSummary"> · via {{ selectedPlan.viaSummary }}</span></p>
            <p class="weather-line">{{ selectedPlan.weatherLabel }}</p>
          </div>
          <label><span>Expected block time (minutes)</span><input v-model.number="blockMinutes" type="number" min="20" max="1500" inputmode="numeric" /></label>
          <button class="btn success" :disabled="saving || !isOnline" @click="saveSelectedPlan">{{ saving ? 'Downloading route…' : 'Save route for offline use' }}</button>
        </div>

        <p class="attribution">Route data from <a href="https://flightplandatabase.com" target="_blank" rel="noopener">Flight Plan Database</a>. Upper-wind context from Open‑Meteo. GPS is optional and used only to correct the simulation. Simulation use only — not suitable for real-world aviation or navigation.</p>
      </section>

      <section class="globe-panel">
        <canvas id="globe-canvas"></canvas>
        <button v-if="activeTrip" class="follow-btn" @click="followAircraft">◎ Follow aircraft</button>
        <div v-if="flightState" class="hud">
          <strong>{{ flightState.lat.toFixed(2) }}°, {{ flightState.lon.toFixed(2) }}° · {{ geoContext }}</strong>
          <span>{{ Math.round(flightState.speedKt * 1.852) }} km/h · hdg {{ Math.round(flightState.bearing || 0) }}°</span>
          <span v-if="nextWaypointText">{{ nextWaypointText }}</span>
        </div>
        <div v-else class="globe-empty"><strong>Route globe</strong><span>Drag to rotate · pinch to zoom</span></div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { useFlightStore } from './stores/flightStore'
import { estimateBlockMinutes, fetchFlightPlan, normalizeFlightNumber, searchFlightPlans } from './services/flightAPI'
import { formatDuration, getFlightState, nearestProgressOnRoute } from './utils/routeUtils'
import { describeGeoContext } from './utils/geoContext'
import { destroyGlobe, initializeGlobe, recenterOnAircraft, setFollowAircraft, setRouteOnGlobe, updateAircraftPosition, updateRouteProgress } from './utils/globeUtils'

const flightStore = useFlightStore()
const flightNumber = ref('LH400')
const from = ref('FRA')
const to = ref('JFK')
const results = ref([])
const selectedPlan = ref(null)
const blockMinutes = ref(0)
const searching = ref(false)
const saving = ref(false)
const gpsBusy = ref(false)
const gpsStatus = ref('checking…')
const gpsPermission = ref('unknown')
const autoGps = ref(false)
const message = ref('')
const messageIsError = ref(false)
const now = ref(Date.now())
const isOnline = ref(navigator.onLine)
let timer
let autoGpsTimer
let globe

const nmToKm = value => Math.round(Number(value || 0) * 1.852)
const ftToM = value => Math.round(Number(value || 0) * 0.3048)
const routeLabel = item => `${item?.fromIATA || item?.fromICAO || '?'} → ${item?.toIATA || item?.toICAO || '?'}`
const globeLabels = item => ({ fromLabel: item?.fromIATA || item?.fromICAO || 'DEP', toLabel: item?.toIATA || item?.toICAO || 'ARR' })
const savedTrips = computed(() => flightStore.savedTrips)
const activeTrip = computed(() => flightStore.activeTrip)
const elapsedMinutes = computed(() => activeTrip.value?.startedAt ? Math.max(0, (now.value - activeTrip.value.startedAt) / 60_000) : 0)
const timeProgress = computed(() => {
  const trip = activeTrip.value
  if (!trip?.startedAt || !trip.blockMinutes) return 0
  return Math.min(1, Math.max(0, elapsedMinutes.value / trip.blockMinutes))
})
const currentProgress = computed(() => Math.min(1, Math.max(0, timeProgress.value + Number(activeTrip.value?.progressOffset || 0))))
const flightState = computed(() => {
  const trip = activeTrip.value
  if (!trip?.route) return null
  return getFlightState({
    route: trip.route,
    progress: currentProgress.value,
    elapsedMinutes: elapsedMinutes.value,
    blockMinutes: trip.blockMinutes,
    cruiseAltitudeFt: trip.maxAltitudeFt || 36000
  })
})
const remainingTime = computed(() => activeTrip.value ? formatDuration(Math.max(0, activeTrip.value.blockMinutes - elapsedMinutes.value)) : '—')
const geoContext = computed(() => flightState.value ? describeGeoContext(flightState.value.lat, flightState.value.lon) : '—')
const nextWaypointText = computed(() => {
  const state = flightState.value
  if (!state?.nextIdent) return ''
  const distanceKm = nmToKm(state.distanceToNextNm)
  const minutes = Number.isFinite(state.minutesToNext) ? Math.max(1, Math.round(state.minutesToNext)) : null
  return `next ${state.nextIdent} · ${distanceKm} km${minutes ? ` · ~${minutes} min` : ''}`
})

const formatClock = (timestamp, timeZone) => {
  if (!timestamp) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: timeZone || undefined, timeZoneName: 'short'
    }).format(new Date(timestamp))
  } catch (_) {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
  }
}
const activeStartTime = computed(() => formatClock(activeTrip.value?.startedAt, activeTrip.value?.fromTimeZone))
const activeEtaTime = computed(() => {
  const trip = activeTrip.value
  if (!trip?.startedAt) return '—'
  return formatClock(trip.startedAt + trip.blockMinutes * 60_000, trip.toTimeZone)
})

const setMessage = (text, error = false) => { message.value = text; messageIsError.value = error }

const search = async () => {
  if (!isOnline.value) return setMessage('You are offline. Use one of the saved flights above.', true)
  searching.value = true
  results.value = []
  selectedPlan.value = null
  setMessage('')
  try {
    results.value = await searchFlightPlans({ flightNumber: flightNumber.value, from: from.value, to: to.value })
    if (!results.value.length) setMessage('No matching plans found. Try adding departure and destination.', true)
  } catch (error) {
    setMessage(error.message || 'Flight-plan search failed.', true)
  } finally { searching.value = false }
}

const choosePlan = plan => { selectedPlan.value = plan; blockMinutes.value = estimateBlockMinutes(plan.distanceNm) }

const saveSelectedPlan = async () => {
  if (!selectedPlan.value) return
  saving.value = true
  setMessage('')
  try {
    const fetched = await fetchFlightPlan(selectedPlan.value.id)
    const fullPlan = {
      ...fetched,
      fromIATA: selectedPlan.value.fromIATA || fetched.fromIATA || '',
      toIATA: selectedPlan.value.toIATA || fetched.toIATA || '',
      weatherLabel: selectedPlan.value.weatherLabel || '',
      upperWindKmh: selectedPlan.value.upperWindKmh ?? null,
      viaSummary: selectedPlan.value.viaSummary || ''
    }
    const trip = await flightStore.savePlanForOffline({
      plan: fullPlan,
      requestedFlightNumber: normalizeFlightNumber(flightNumber.value),
      blockMinutes: blockMinutes.value || estimateBlockMinutes(fullPlan.distanceNm)
    })
    setRouteOnGlobe(trip.route.nodes, globeLabels(trip))
    setMessage('Route, map context and airport time zones are stored. This flight is ready offline.')
  } catch (error) {
    setMessage(error.message || 'Could not save this route.', true)
  } finally { saving.value = false }
}

const startSavedFlight = async trip => {
  try {
    const active = await flightStore.startTrip(trip.id)
    setRouteOnGlobe(active.route.nodes, globeLabels(active))
    setFollowAircraft(true)
    now.value = Date.now()
    setMessage('Flight started. Progress is estimated from elapsed time and can be corrected with GPS.')
  } catch (error) { setMessage(error.message || 'Could not start this flight.', true) }
}
const stopActiveFlight = async () => {
  autoGps.value = false
  if (activeTrip.value) await flightStore.stopTrip(activeTrip.value.id)
}
const removeTrip = async trip => { if (trip.status === 'active') await flightStore.stopTrip(trip.id); await flightStore.deleteTrip(trip.id) }

const checkGpsPermission = async () => {
  try {
    const status = await Geolocation.checkPermissions()
    gpsPermission.value = status.location
    gpsStatus.value = status.location === 'granted' ? 'ready' : status.location === 'denied' ? 'permission denied' : 'permission not granted yet'
    return status.location
  } catch (error) {
    gpsStatus.value = 'location services unavailable'
    return 'unavailable'
  }
}

const ensureGpsPermission = async () => {
  let state = await checkGpsPermission()
  if (state === 'granted') return true
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await Geolocation.requestPermissions({ permissions: ['location'] })
      gpsPermission.value = status.location
      state = status.location
    } catch (error) {
      gpsStatus.value = 'permission unavailable'
      return false
    }
  }
  return state === 'granted' || !Capacitor.isNativePlatform()
}

const readGpsPosition = async () => {
  const allowed = await ensureGpsPermission()
  if (!allowed) throw new Error('Precise location permission was not granted.')
  if (Capacitor.isNativePlatform()) {
    return Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 45_000,
      maximumAge: 30_000,
      enableLocationFallback: true
    })
  }
  if (!navigator.geolocation) throw new Error('GPS is not available in this browser.')
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true, timeout: 45_000, maximumAge: 30_000
  }))
}

const applyGpsPosition = async (position, quiet = false) => {
  const trip = activeTrip.value
  if (!trip) return false
  const accuracy = Number(position.coords.accuracy || Infinity)
  if (!Number.isFinite(accuracy) || accuracy > 10_000) throw new Error(`GPS fix is too imprecise (±${Math.round(accuracy)} m).`)
  const lat = Number(position.coords.latitude)
  const lon = Number(position.coords.longitude)
  const nearest = nearestProgressOnRoute(trip.route, lat, lon)
  if (nearest.distanceNm > 80) throw new Error(`GPS fix is about ${nmToKm(nearest.distanceNm)} km from the route, so it was not applied.`)
  await flightStore.applyGpsCorrection(trip.id, {
    progressOffset: nearest.progress - timeProgress.value,
    position: { lat, lon },
    accuracyMeters: accuracy,
    routeDistanceNm: nearest.distanceNm
  })
  gpsPermission.value = 'granted'
  gpsStatus.value = `fix ±${Math.round(accuracy)} m`
  if (!quiet) setMessage(`GPS correction applied at ${Math.round(nearest.progress * 100)}% route progress.`)
  return true
}

const correctWithGps = async () => {
  if (!activeTrip.value) return
  gpsBusy.value = true
  setMessage('')
  try {
    const position = await readGpsPosition()
    await applyGpsPosition(position)
  } catch (error) {
    gpsStatus.value = 'no usable fix'
    setMessage(error.message || 'GPS correction failed.', true)
  } finally { gpsBusy.value = false }
}

const runAutoGps = async () => {
  if (!autoGps.value || !activeTrip.value || document.hidden || gpsBusy.value) return
  gpsBusy.value = true
  try {
    const position = await readGpsPosition()
    await applyGpsPosition(position, true)
  } catch (_) {
    gpsStatus.value = 'waiting for a usable fix'
  } finally { gpsBusy.value = false }
}
const configureAutoGps = () => {
  clearInterval(autoGpsTimer)
  autoGpsTimer = null
  if (!autoGps.value || !activeTrip.value) return
  runAutoGps()
  autoGpsTimer = window.setInterval(runAutoGps, 180_000)
}

const followAircraft = () => recenterOnAircraft()
const handleOnline = () => { isOnline.value = navigator.onLine }
const handleVisibility = () => configureAutoGps()

onMounted(async () => {
  globe = initializeGlobe('globe-canvas')
  await flightStore.refreshTrips()
  await checkGpsPermission()
  if (activeTrip.value?.route?.nodes) {
    setRouteOnGlobe(activeTrip.value.route.nodes, globeLabels(activeTrip.value))
    setFollowAircraft(true)
  }
  timer = window.setInterval(() => { now.value = Date.now() }, 1000)
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOnline)
  document.addEventListener('visibilitychange', handleVisibility)
})

watch(flightState, state => {
  if (state && globe) {
    updateAircraftPosition(state.lat, state.lon, state.altitudeFt, state.bearing)
    updateRouteProgress(currentProgress.value)
  }
}, { immediate: true })
watch(activeTrip, trip => {
  if (trip?.route?.nodes) setRouteOnGlobe(trip.route.nodes, globeLabels(trip))
  configureAutoGps()
})
watch(autoGps, configureAutoGps)

onBeforeUnmount(() => {
  clearInterval(timer)
  clearInterval(autoGpsTimer)
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOnline)
  document.removeEventListener('visibilitychange', handleVisibility)
  destroyGlobe()
})
</script>

<style scoped>
:global(body) { color:#eaf2f8; }
* { box-sizing:border-box; }
.app-shell { min-height:100%; background:radial-gradient(circle at 80% 0%,#173b58 0,#091622 34%,#050b12 80%); }
.topbar { height:76px; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,.08); background:rgba(4,10,16,.72); backdrop-filter:blur(14px); }
.topbar h1 { margin:0; font-size:24px; }
.eyebrow,.kicker { color:#71d4ac; font-size:10px; font-weight:800; letter-spacing:.16em; }
.eyebrow { margin:0 0 3px; }
.network-pill { font-size:12px; padding:6px 10px; border-radius:999px; color:#74e2b2; background:rgba(56,183,128,.13); border:1px solid rgba(74,224,165,.25); }
.network-pill.offline { color:#ffcb70; background:rgba(255,171,64,.12); }
.layout { height:calc(100vh - 76px); padding:14px; display:grid; grid-template-columns:minmax(320px,390px) minmax(0,1fr); gap:14px; }
.panel,.globe-panel { border:1px solid rgba(255,255,255,.08); background:rgba(10,22,32,.82); border-radius:18px; box-shadow:0 18px 50px rgba(0,0,0,.25); }
.controls { overflow-y:auto; padding:18px; }
.globe-panel { position:relative; overflow:hidden; min-height:360px; }
#globe-canvas { width:100%; height:100%; display:block; }
.section-head { display:flex; justify-content:space-between; align-items:center; margin:18px 0 12px; }
.section-head.compact { margin-top:18px; }
.section-head h2,.active-card h2 { margin:2px 0 0; font-size:20px; }
.form-grid { display:grid; gap:10px; }
.route-inputs { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
label { display:grid; gap:6px; }
label span { color:#91a6b5; font-size:11px; font-weight:700; }
input { width:100%; border:1px solid rgba(255,255,255,.12); background:#0a1722; color:#f3f8fb; padding:11px 12px; border-radius:10px; font-size:14px; }
.btn { border:0; border-radius:10px; padding:11px 13px; color:#f8fbfd; font-weight:800; cursor:pointer; }
.btn:disabled { opacity:.48; }.btn.primary{background:#2475a8}.btn.success{background:#24936b}.btn.secondary{background:#263d4e}.btn.danger{background:#8b3b4d}.btn.small{padding:8px 10px;font-size:12px}
.button-row { display:flex; gap:8px; margin-top:13px; }.button-row .btn{flex:1}
.message { margin:10px 0 0; padding:9px 10px; border-radius:9px; background:rgba(63,167,123,.12); color:#a9efcb; font-size:12px; }.message.error{background:rgba(196,71,89,.12);color:#ffabb7}
.results { display:grid; gap:8px; margin-top:13px; }
.result-card { width:100%; display:flex; justify-content:space-between; gap:10px; text-align:left; color:inherit; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:12px; background:#0b1823; }
.result-card.selected { border-color:#52c99a; background:rgba(42,145,106,.14); }.result-card.recommended{border-color:rgba(99,219,167,.45)}
.result-main { display:grid; gap:3px; min-width:0; }.result-title-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.result-title-row strong{font-size:14px}
.recommended-badge,.rank-badge { border-radius:999px; padding:2px 6px; font-size:9px; font-weight:800; }.recommended-badge{color:#9bf0ca;background:rgba(45,166,117,.18)}.rank-badge{color:#9db0bd;background:#172733}
.iata-route { color:#dce9ef!important; font-size:13px!important; font-weight:800; }.icao-route,.via{color:#708896!important;font-size:10px!important}.difference{color:#9fc3d5!important;font-size:10px!important}.weather{color:#a7c9dc!important;font-size:10px!important}.weather.tailwind{color:#78ddb2!important}.weather.headwind{color:#ffbd83!important}
.result-meta { text-align:right; display:grid; align-content:start; white-space:nowrap; gap:2px; }.result-meta strong{font-size:12px}.result-meta span{color:#8ea4b3;font-size:10px}
.ranking-note { margin:2px 3px 0; color:#697f8d; font-size:9px; line-height:1.4; }
.selected-plan { margin-top:13px; border-radius:13px; padding:14px; background:rgba(43,117,161,.13); border:1px solid rgba(70,149,196,.2); display:grid; gap:12px; }.selected-plan h3{margin:3px 0;font-size:15px}.selected-plan p{margin:0;color:#9eb0bc;font-size:12px}.weather-line{color:#83cbb0!important;margin-top:4px!important}
.active-card { padding:14px; border-radius:14px; background:linear-gradient(145deg,rgba(30,117,89,.25),rgba(28,77,112,.18)); border:1px solid rgba(73,210,158,.25); }.active-heading{display:flex;justify-content:space-between;gap:10px}.active-heading p{margin:3px 0 0;color:#a9bbc6;font-size:12px}.active-heading>strong{font-size:26px;color:#71d4ac}
.time-strip{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:13px}.time-strip div{padding:9px;border-radius:9px;background:rgba(0,0,0,.14)}.time-strip span{display:block;color:#819aa7;font-size:9px}.time-strip strong{font-size:12px}
.progress-track{height:5px;border-radius:999px;background:rgba(255,255,255,.09);overflow:hidden;margin:14px 0}.progress-fill{height:100%;background:#63dba7;transition:width 1s linear}.metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.metric-grid div{padding:9px;border-radius:9px;background:rgba(0,0,0,.17)}.metric-grid span{display:block;color:#8ea4b3;font-size:10px}.metric-grid strong{font-size:13px}
.passenger-status{display:grid;gap:2px;margin-top:10px}.passenger-status strong{font-size:12px;color:#dce8ec}.passenger-status span{font-size:10px;color:#89a1ae}.gps-note{font-size:10px;color:#9fc4d8;margin:10px 0 0}.auto-gps-row{display:flex;grid-template-columns:none;align-items:flex-start;gap:8px;margin-top:9px;color:#8fa8b5}.auto-gps-row input{width:auto;margin-top:1px;padding:0}.auto-gps-row span{font-size:10px;font-weight:500;line-height:1.35}
.saved-card{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}.saved-card strong{display:block;font-size:14px}.saved-card span{display:block;color:#8ea4b3;font-size:11px}.saved-weather{font-size:9px!important;color:#78bfa4!important;margin-top:2px}.offline-ready{font-size:9px!important;color:#83c7ac!important;margin-top:4px}.saved-actions{display:flex;align-items:center;gap:5px}.icon-btn{width:31px;height:31px;border-radius:8px;border:0;color:#a9bbc7;background:#172733;font-size:19px}
.attribution{margin:24px 0 3px;color:#657b89;font-size:10px;line-height:1.45}.attribution a{color:#7da9c2}
.hud{position:absolute;left:16px;bottom:16px;display:grid;gap:3px;padding:11px 13px;border-radius:10px;background:rgba(4,12,19,.78);border:1px solid rgba(93,220,168,.22)}.hud strong{color:#78e3b5;font-size:13px}.hud span{color:#9cb1bf;font-size:11px}.globe-empty{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:grid;text-align:center;color:#95aab7}.globe-empty strong{color:#d5e2e9;font-size:13px}.globe-empty span{font-size:11px;margin-top:3px}.follow-btn{position:absolute;right:14px;top:14px;border:1px solid rgba(118,231,184,.3);background:rgba(5,22,29,.76);color:#8ae9c0;border-radius:999px;padding:8px 11px;font-size:11px;font-weight:800}
@media(max-width:820px){.layout{height:auto;min-height:calc(100vh - 76px);grid-template-columns:1fr;padding:10px}.controls{order:2;overflow:visible}.globe-panel{order:1;height:42vh;min-height:300px}.topbar{height:68px}}
@media(max-width:420px){.route-inputs{grid-template-columns:1fr}.controls{padding:14px}.result-card{align-items:flex-start}.result-meta{min-width:74px}.time-strip{grid-template-columns:1fr 1fr}}
</style>
