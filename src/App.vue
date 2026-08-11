<template>
  <div class="app-container">
    <header class="app-header">
      <h1>🌍 3D Flight Tracker</h1>
      <p class="subtitle">Route Simulation with Offline Tracking</p>
    </header>
    
    <main class="app-main">
      <div class="controls-panel">
        <div class="search-section">
          <div class="search-inputs">
            <input 
              v-model="departureCity" 
              type="text" 
              placeholder="From (e.g., LON, NYC)"
              class="input-field"
            >
            <input 
              v-model="arrivalCity" 
              type="text" 
              placeholder="To (e.g., JFK, CDG)"
              class="input-field"
            >
            <button @click="searchFlights" class="btn btn-primary" :disabled="isSearching">
              {{ isSearching ? 'Searching...' : '🔍 Search Flights' }}
            </button>
          </div>
          <p v-if="searchStatus" class="status-text">{{ searchStatus }}</p>
        </div>

        <div class="flights-list" v-if="searchResults.length > 0">
          <h3>Available Flights</h3>
          <div class="flight-item" v-for="flight in searchResults" :key="flight.id" @click="selectFlight(flight)">
            <div class="flight-header">
              <span class="flight-number">{{ flight.number }}</span>
              <span class="airline">{{ flight.airline }}</span>
            </div>
            <div class="flight-times">
              <span>{{ flight.departure }} → {{ flight.arrival }}</span>
            </div>
            <div class="flight-route">
              {{ flight.from }} → {{ flight.to }}
            </div>
          </div>
        </div>

        <div class="active-flight" v-if="activeFlight">
          <h3>Selected Flight</h3>
          <div class="active-flight-info">
            <p><strong>{{ activeFlight.number }}</strong> - {{ activeFlight.airline }}</p>
            <p>{{ activeFlight.from }} → {{ activeFlight.to }}</p>
            <p>Distance: {{ activeFlight.distance || 'Calculating...' }} km</p>
            <button @click="loadRouteData" class="btn btn-success" :disabled="isLoadingRoute">
              {{ isLoadingRoute ? 'Loading Route...' : '📥 Load Route Data' }}
            </button>
            <button @click="startSimulation" class="btn btn-info" :disabled="!routeDataLoaded || isSimulating">
              {{ isSimulating ? 'Simulation Active' : '▶️ Start Simulation' }}
            </button>
          </div>
        </div>
      </div>

      <div class="globe-container">
        <canvas id="globe-canvas"></canvas>
        <div class="flight-status" v-if="isSimulating">
          <div class="status-item">
            <span class="label">Position:</span>
            <span class="value">{{ currentPosition.lat.toFixed(2) }}°, {{ currentPosition.lon.toFixed(2) }}°</span>
          </div>
          <div class="status-item">
            <span class="label">Altitude:</span>
            <span class="value">{{ currentPosition.altitude }} ft</span>
          </div>
          <div class="status-item">
            <span class="label">Progress:</span>
            <span class="value">{{ (progressPercent * 100).toFixed(1) }}%</span>
          </div>
          <div class="status-item">
            <span class="label">Speed:</span>
            <span class="value">{{ currentPosition.speed }} knots</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useFlightStore } from './stores/flightStore'
import { useGlobeStore } from './stores/globeStore'
import { searchFlightsAPI } from './services/flightAPI'
import { initializeGlobe, updateAircraftPosition } from './utils/globeUtils'

const flightStore = useFlightStore()
const globeStore = useGlobeStore()

const departureCity = ref('')
const arrivalCity = ref('')
const searchResults = ref([])
const activeFlight = ref(null)
const isSearching = ref(false)
const isLoadingRoute = ref(false)
const isSimulating = ref(false)
const searchStatus = ref('')
const routeDataLoaded = ref(false)
const currentPosition = ref({ lat: 0, lon: 0, altitude: 0, speed: 0 })
const progressPercent = ref(0)

let globeRenderer = null
let simulationInterval = null
let routeData = null

onMounted(() => {
  globeRenderer = initializeGlobe('globe-canvas')
})

const searchFlights = async () => {
  if (!departureCity.value || !arrivalCity.value) {
    searchStatus.value = 'Please enter both departure and arrival cities'
    return
  }

  isSearching.value = true
  searchStatus.value = 'Searching for flights...'
  
  try {
    const results = await searchFlightsAPI(departureCity.value, arrivalCity.value)
    searchResults.value = results
    searchStatus.value = `Found ${results.length} flights`
  } catch (error) {
    searchStatus.value = `Error: ${error.message}`
    console.error('Search error:', error)
  } finally {
    isSearching.value = false
  }
}

const selectFlight = (flight) => {
  activeFlight.value = flight
  routeDataLoaded.value = false
  flightStore.setActiveFlight(flight)
}

const loadRouteData = async () => {
  if (!activeFlight.value) return
  
  isLoadingRoute.value = true
  
  try {
    routeData = await flightStore.generateRoute(activeFlight.value)
    routeDataLoaded.value = true
    searchStatus.value = 'Route data loaded. Ready to start simulation.'
  } catch (error) {
    searchStatus.value = `Error loading route: ${error.message}`
    console.error('Route loading error:', error)
  } finally {
    isLoadingRoute.value = false
  }
}

const startSimulation = () => {
  if (!routeData || isSimulating.value) return
  
  isSimulating.value = true
  let progress = 0
  const totalSteps = routeData.waypoints.length
  
  simulationInterval = setInterval(() => {
    if (progress < totalSteps - 1) {
      const currentWaypoint = routeData.waypoints[progress]
      const nextWaypoint = routeData.waypoints[progress + 1]
      
      currentPosition.value = {
        lat: currentWaypoint.lat,
        lon: currentWaypoint.lon,
        altitude: currentWaypoint.altitude,
        speed: currentWaypoint.speed || 450
      }
      
      if (globeRenderer) {
        updateAircraftPosition(globeRenderer, currentWaypoint.lat, currentWaypoint.lon, currentWaypoint.altitude)
      }
      
      progressPercent.value = progress / totalSteps
      progress++
    } else {
      clearInterval(simulationInterval)
      isSimulating.value = false
      searchStatus.value = 'Flight simulation completed!'
    }
  }, 500)
}
</script>

<style scoped>
.app-container {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.app-header {
  padding: 20px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  text-align: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}

.app-header h1 {
  margin: 0;
  font-size: 2em;
}

.subtitle {
  margin: 5px 0 0 0;
  opacity: 0.9;
  font-size: 0.95em;
}

.app-main {
  flex: 1;
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 20px;
  padding: 20px;
  overflow: hidden;
}

.controls-panel {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.search-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-inputs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input-field {
  padding: 12px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.3s;
}

.input-field:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.status-text {
  font-size: 12px;
  color: #666;
  margin: 0;
}

.btn {
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 500;
}

.btn-primary {
  background: #667eea;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #5568d3;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-success {
  background: #4CAF50;
  color: white;
}

.btn-success:hover:not(:disabled) {
  background: #45a049;
}

.btn-info {
  background: #2196F3;
  color: white;
}

.btn-info:hover:not(:disabled) {
  background: #0b7dda;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.flights-list {
  border-top: 2px solid #f0f0f0;
  padding-top: 15px;
}

.flights-list h3 {
  margin: 0 0 12px 0;
  color: #333;
  font-size: 14px;
  text-transform: uppercase;
}

.flight-item {
  padding: 12px;
  background: #f9f9f9;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 8px;
  transition: all 0.3s;
  border-left: 3px solid #667eea;
}

.flight-item:hover {
  background: #f0f0f0;
  transform: translateX(4px);
}

.flight-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.flight-number {
  font-weight: bold;
  color: #333;
  font-size: 14px;
}

.airline {
  font-size: 12px;
  color: #666;
}

.flight-times {
  font-size: 12px;
  color: #999;
  margin-bottom: 4px;
}

.flight-route {
  font-size: 12px;
  color: #667eea;
  font-weight: 500;
}

.active-flight {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 16px;
  border-radius: 8px;
}

.active-flight h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  text-transform: uppercase;
  opacity: 0.9;
}

.active-flight-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.active-flight-info p {
  margin: 0;
  font-size: 14px;
}

.globe-container {
  position: relative;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

#globe-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.flight-status {
  position: absolute;
  bottom: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.8);
  color: #4CAF50;
  padding: 15px 20px;
  border-radius: 8px;
  font-size: 13px;
  font-family: 'Courier New', monospace;
  border: 1px solid #4CAF50;
}

.status-item {
  display: flex;
  gap: 10px;
  margin-bottom: 8px;
}

.status-item:last-child {
  margin-bottom: 0;
}

.label {
  color: #999;
}

.value {
  color: #4CAF50;
  font-weight: bold;
}

@media (max-width: 1024px) {
  .app-main {
    grid-template-columns: 1fr;
  }
  
  .controls-panel {
    max-height: 300px;
  }
}
</style>
