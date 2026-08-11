import Dexie from 'dexie'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { prepareRoute } from '../utils/routeUtils'

const db = new Dexie('FlightTrackerDB')
db.version(2).stores({
  trips: 'id,flightNumber,savedAt,status'
})

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`

export const useFlightStore = defineStore('flight', () => {
  const savedTrips = ref([])
  const activeTrip = ref(null)

  const refreshTrips = async () => {
    savedTrips.value = await db.trips.orderBy('savedAt').reverse().toArray()
    activeTrip.value = savedTrips.value.find(trip => trip.status === 'active') || null
    return savedTrips.value
  }

  const savePlanForOffline = async ({ plan, requestedFlightNumber, blockMinutes }) => {
    const preparedRoute = prepareRoute(plan.nodes)
    const trip = {
      id: newId(),
      planId: plan.id,
      flightNumber: requestedFlightNumber || plan.flightNumber || '',
      fromICAO: plan.fromICAO,
      toICAO: plan.toICAO,
      fromIATA: plan.fromIATA || '',
      toIATA: plan.toIATA || '',
      fromName: plan.fromName,
      toName: plan.toName,
      fromRegionName: plan.fromRegionName || '',
      toRegionName: plan.toRegionName || '',
      fromTimeZone: plan.fromTimeZone || '',
      toTimeZone: plan.toTimeZone || '',
      distanceNm: Math.round(plan.distanceNm || preparedRoute.totalNm),
      maxAltitudeFt: plan.maxAltitudeFt || 36000,
      blockMinutes: Math.max(20, Number(blockMinutes || 0)),
      route: preparedRoute,
      weatherLabel: plan.weatherLabel || '',
      upperWindKmh: Number.isFinite(Number(plan.upperWindKmh)) ? Number(plan.upperWindKmh) : null,
      viaSummary: plan.viaSummary || '',
      source: plan.source,
      savedAt: Date.now(),
      status: 'saved',
      startedAt: null,
      progressOffset: 0,
      gpsCorrection: null
    }
    await db.trips.put(trip)
    await refreshTrips()
    return trip
  }

  const startTrip = async id => {
    const trip = await db.trips.get(id)
    if (!trip) throw new Error('Saved flight not found.')

    const active = { ...trip, status: 'active', startedAt: Date.now(), progressOffset: 0, gpsCorrection: null }
    await db.transaction('rw', db.trips, async () => {
      const others = await db.trips.where('status').equals('active').toArray()
      await Promise.all(others.filter(item => item.id !== id).map(item => db.trips.update(item.id, { status: 'saved', startedAt: null })))
      await db.trips.put(active)
    })
    await refreshTrips()
    return active
  }

  const stopTrip = async id => {
    await db.trips.update(id, { status: 'saved', startedAt: null, progressOffset: 0, gpsCorrection: null })
    await refreshTrips()
  }

  const applyGpsCorrection = async (id, { progressOffset, position, accuracyMeters, routeDistanceNm }) => {
    const gpsCorrection = {
      at: Date.now(),
      lat: position.lat,
      lon: position.lon,
      accuracyMeters,
      routeDistanceNm
    }
    await db.trips.update(id, { progressOffset, gpsCorrection })
    await refreshTrips()
    return activeTrip.value
  }

  const deleteTrip = async id => {
    await db.trips.delete(id)
    await refreshTrips()
  }

  return {
    savedTrips,
    activeTrip,
    refreshTrips,
    savePlanForOffline,
    startTrip,
    stopTrip,
    applyGpsCorrection,
    deleteTrip
  }
})
