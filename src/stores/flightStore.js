import { defineStore } from 'pinia'
import { ref } from 'vue'
import { generateRouteWaypoints, calculateDistance, calculateBearing } from '../utils/routeUtils'

export const useFlightStore = defineStore('flight', () => {
  const activeFlight = ref(null)
  const routeData = ref(null)
  
  const setActiveFlight = (flight) => {
    activeFlight.value = flight
  }
  
  const generateRoute = async (flight) => {
    // Generate waypoints for the route
    const waypoints = generateRouteWaypoints(
      flight.departure_coords,
      flight.arrival_coords,
      50 // number of waypoints
    )
    
    routeData.value = {
      flightNumber: flight.number,
      departure: flight.from,
      arrival: flight.to,
      distance: calculateDistance(
        flight.departure_coords.lat,
        flight.departure_coords.lon,
        flight.arrival_coords.lat,
        flight.arrival_coords.lon
      ),
      waypoints: waypoints.map((point, index) => ({
        ...point,
        altitude: Math.min(35000, (index / waypoints.length) * 35000),
        speed: 450 + Math.random() * 50
      }))
    }
    
    // Store in IndexedDB for offline access
    try {
      const db = new Dexie('FlightTrackerDB')
      db.version(1).stores({ routes: 'flightNumber' })
      await db.routes.put(routeData.value)
    } catch (error) {
      console.log('Could not store in IndexedDB:', error)
    }
    
    return routeData.value
  }
  
  const retrieveStoredRoute = async (flightNumber) => {
    try {
      const db = new Dexie('FlightTrackerDB')
      db.version(1).stores({ routes: 'flightNumber' })
      const stored = await db.routes.get(flightNumber)
      if (stored) {
        routeData.value = stored
        return stored
      }
    } catch (error) {
      console.log('Could not retrieve from IndexedDB:', error)
    }
    return null
  }
  
  return {
    activeFlight,
    routeData,
    setActiveFlight,
    generateRoute,
    retrieveStoredRoute
  }
})
