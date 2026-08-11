import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useGlobeStore = defineStore('globe', () => {
  const aircraftPosition = ref({ lat: 0, lon: 0, altitude: 0 })
  const route = ref(null)
  const isTracking = ref(false)
  
  const updatePosition = (lat, lon, altitude) => {
    aircraftPosition.value = { lat, lon, altitude }
  }
  
  const setRoute = (routeData) => {
    route.value = routeData
  }
  
  const startTracking = () => {
    isTracking.value = true
  }
  
  const stopTracking = () => {
    isTracking.value = false
  }
  
  return {
    aircraftPosition,
    route,
    isTracking,
    updatePosition,
    setRoute,
    startTracking,
    stopTracking
  }
})
