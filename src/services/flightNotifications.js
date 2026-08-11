import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

const hashId = value => {
  let hash = 17
  for (const char of String(value || 'flight')) hash = ((hash * 31) + char.charCodeAt(0)) | 0
  return Math.abs(hash || 1) % 1_900_000_000
}

const idsForTrip = trip => {
  const base = hashId(trip?.id)
  return [0, 1, 2, 3, 4, 5, 6].map(offset => (base + offset) % 2_000_000_000)
}

const ensurePermission = async () => {
  if (!Capacitor.isNativePlatform()) return false
  try {
    let status = await LocalNotifications.checkPermissions()
    if (status.display !== 'granted') status = await LocalNotifications.requestPermissions()
    return status.display === 'granted'
  } catch (_) {
    return false
  }
}

const durationText = minutes => {
  const total = Math.max(0, Math.round(Number(minutes || 0)))
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h}h ${m}m` : `${m} min`
}

export const scheduleFlightNotifications = async (trip, milestones = []) => {
  if (!trip?.startedAt || !trip?.blockMinutes || !(await ensurePermission())) return false
  const ids = idsForTrip(trip)
  await cancelFlightNotifications(trip)

  const route = `${trip.fromIATA || trip.fromICAO} → ${trip.toIATA || trip.toICAO}`
  const title = `${trip.flightNumber || route} · Flight active`
  const notifications = [
    {
      id: ids[0],
      title,
      body: `${route} · ${durationText(trip.blockMinutes)} planned · tap FlightSim for live progress`,
      ongoing: true,
      autoCancel: false,
      group: `flightsim-${trip.id}`,
      extra: { tripId: trip.id, type: 'active' }
    }
  ]

  milestones.slice(0, 5).forEach((milestone, index) => {
    const at = trip.startedAt + milestone.minute * 60_000
    if (at <= Date.now() + 30_000) return
    const remaining = Math.max(0, trip.blockMinutes - milestone.minute)
    notifications.push({
      id: ids[index + 1],
      title: `${trip.flightNumber || route} · ${milestone.label}`,
      body: `${Math.round(milestone.progress * 100)}% · ${durationText(remaining)} remaining · over ${milestone.context}`,
      schedule: { at: new Date(at) },
      group: `flightsim-${trip.id}`,
      extra: { tripId: trip.id, type: milestone.key }
    })
  })

  const arrivalAt = trip.startedAt + trip.blockMinutes * 60_000
  if (arrivalAt > Date.now() + 30_000) {
    notifications.push({
      id: ids[6],
      title: `${trip.flightNumber || route} · Estimated arrival`,
      body: `${route} · planned block time complete`,
      schedule: { at: new Date(arrivalAt) },
      group: `flightsim-${trip.id}`,
      extra: { tripId: trip.id, type: 'arrival' }
    })
  }

  await LocalNotifications.schedule({ notifications })
  return true
}

export const cancelFlightNotifications = async trip => {
  if (!Capacitor.isNativePlatform() || !trip?.id) return
  const notifications = idsForTrip(trip).map(id => ({ id }))
  try { await LocalNotifications.cancel({ notifications }) } catch (_) { /* optional */ }
  try {
    const delivered = await LocalNotifications.getDeliveredNotifications()
    const own = (delivered.notifications || []).filter(item => notifications.some(target => target.id === item.id))
    if (own.length) await LocalNotifications.removeDeliveredNotifications({ notifications: own })
  } catch (_) { /* optional */ }
}
