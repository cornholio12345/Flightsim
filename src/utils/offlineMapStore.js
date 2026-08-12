import Dexie from 'dexie'
import { calculateDistanceNm } from './routeUtils'

export const OFFLINE_MIN_ZOOM = 2
export const OFFLINE_MAX_ZOOM = 9
export const OFFLINE_CORRIDOR_KM = 120
export const VERSATILES_TILE_URL = (z, x, y) => `https://tiles.versatiles.org/tiles/osm/${z}/${x}/${y}`

const MAX_PACK_TILES = 1800
const DOWNLOAD_CONCURRENCY = 3
const SAMPLE_SPACING_KM = 65

const db = new Dexie('FlightSimOfflineMaps')
db.version(1).stores({
  packs: '&tripId,savedAt',
  tiles: '&key,tripId,[tripId+z],z'
})

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const toRad = value => Number(value) * Math.PI / 180
const toDeg = value => Number(value) * 180 / Math.PI

const greatCircle = (a, b, t) => {
  const lat1 = toRad(a.lat)
  const lon1 = toRad(a.lon)
  const lat2 = toRad(b.lat)
  const lon2 = toRad(b.lon)
  const v1 = [Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)]
  const v2 = [Math.cos(lat2) * Math.cos(lon2), Math.cos(lat2) * Math.sin(lon2), Math.sin(lat2)]
  const dot = clamp(v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2], -1, 1)
  const omega = Math.acos(dot)
  if (omega < 1e-9) return { lat: Number(a.lat), lon: Number(a.lon) }
  const sinOmega = Math.sin(omega)
  const aa = Math.sin((1 - t) * omega) / sinOmega
  const bb = Math.sin(t * omega) / sinOmega
  const x = aa * v1[0] + bb * v2[0]
  const y = aa * v1[1] + bb * v2[1]
  const z = aa * v1[2] + bb * v2[2]
  return {
    lon: toDeg(Math.atan2(y, x)),
    lat: toDeg(Math.atan2(z, Math.hypot(x, y)))
  }
}

const routeSamples = nodes => {
  const valid = (nodes || []).filter(node => Number.isFinite(Number(node?.lat)) && Number.isFinite(Number(node?.lon)))
  if (valid.length < 2) return []
  const samples = []
  for (let index = 0; index < valid.length - 1; index += 1) {
    const start = valid[index]
    const end = valid[index + 1]
    const segmentKm = calculateDistanceNm(Number(start.lat), Number(start.lon), Number(end.lat), Number(end.lon)) * 1.852
    const steps = Math.max(1, Math.ceil(segmentKm / SAMPLE_SPACING_KM))
    for (let step = 0; step < steps; step += 1) samples.push(greatCircle(start, end, step / steps))
  }
  const last = valid[valid.length - 1]
  samples.push({ lat: Number(last.lat), lon: Number(last.lon) })
  return samples
}

const coordinateToTile = (lat, lon, z) => {
  const n = 2 ** z
  const limitedLat = clamp(Number(lat), -85.05112878, 85.05112878)
  const latRad = toRad(limitedLat)
  const x = Math.floor(((Number(lon) + 180) / 360) * n)
  const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n)
  return {
    x: ((x % n) + n) % n,
    y: clamp(y, 0, n - 1)
  }
}

const corridorRadiusTiles = (lat, z) => {
  const equatorTileKm = 40075.017 / (2 ** z)
  const localTileKm = Math.max(8, equatorTileKm * Math.max(0.22, Math.cos(toRad(lat))))
  return clamp(Math.ceil(OFFLINE_CORRIDOR_KM / localTileKm), 1, 4)
}

const buildPlanAtMaxZoom = (nodes, maxZoom) => {
  const samples = routeSamples(nodes)
  if (!samples.length) return []
  const keys = new Set()
  const plan = []

  for (let z = OFFLINE_MIN_ZOOM; z <= maxZoom; z += 1) {
    const n = 2 ** z
    samples.forEach(sample => {
      const tile = coordinateToTile(sample.lat, sample.lon, z)
      const radius = corridorRadiusTiles(sample.lat, z)
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = ((tile.x + dx) % n + n) % n
        for (let dy = -radius; dy <= radius; dy += 1) {
          const y = tile.y + dy
          if (y < 0 || y >= n) continue
          const key = `${z}/${x}/${y}`
          if (keys.has(key)) continue
          keys.add(key)
          plan.push({ key, z, x, y })
        }
      }
    })
  }

  return plan.sort((a, b) => (a.z - b.z) || (a.y - b.y) || (a.x - b.x))
}

export const estimateOfflineMapPack = nodes => {
  let maxZoom = OFFLINE_MAX_ZOOM
  let tiles = buildPlanAtMaxZoom(nodes, maxZoom)
  while (tiles.length > MAX_PACK_TILES && maxZoom > 7) {
    maxZoom -= 1
    tiles = buildPlanAtMaxZoom(nodes, maxZoom)
  }
  return {
    tiles,
    tileCount: tiles.length,
    minZoom: OFFLINE_MIN_ZOOM,
    maxZoom,
    corridorKm: OFFLINE_CORRIDOR_KM
  }
}

const tileDbKey = (tripId, z, x, y) => `${tripId}|${z}/${x}/${y}`

export const getOfflineMapPack = async tripId => {
  if (!tripId) return null
  return db.packs.get(String(tripId))
}

export const getOfflineMapTile = async (tripId, z, x, y) => {
  if (!tripId) return null
  const row = await db.tiles.get(tileDbKey(String(tripId), z, x, y))
  return row?.data || null
}

export const deleteOfflineMapPack = async tripId => {
  if (!tripId) return
  const id = String(tripId)
  await db.transaction('rw', db.tiles, db.packs, async () => {
    await db.tiles.where('tripId').equals(id).delete()
    await db.packs.delete(id)
  })
}

const abortError = () => {
  try { return new DOMException('Offline map download cancelled.', 'AbortError') } catch (_) {
    const error = new Error('Offline map download cancelled.')
    error.name = 'AbortError'
    return error
  }
}

export const downloadOfflineMapPack = async ({ tripId, nodes, signal, onProgress } = {}) => {
  const id = String(tripId || '')
  if (!id) throw new Error('No flight selected for offline map download.')
  if (!navigator.onLine) throw new Error('Connect to the internet before downloading the offline map.')

  const plan = estimateOfflineMapPack(nodes)
  if (!plan.tileCount) throw new Error('This flight does not contain a usable route for an offline map.')

  await deleteOfflineMapPack(id)
  let completed = 0
  let byteCount = 0
  let cursor = 0
  let failed = null

  const report = current => onProgress?.({
    completed,
    total: plan.tileCount,
    byteCount,
    minZoom: plan.minZoom,
    maxZoom: plan.maxZoom,
    corridorKm: plan.corridorKm,
    current
  })

  report(null)

  const worker = async () => {
    while (!failed) {
      if (signal?.aborted) throw abortError()
      const index = cursor
      cursor += 1
      if (index >= plan.tiles.length) return
      const tile = plan.tiles[index]
      try {
        const response = await fetch(VERSATILES_TILE_URL(tile.z, tile.x, tile.y), {
          signal,
          cache: 'default',
          headers: { Accept: 'application/vnd.mapbox-vector-tile, application/x-protobuf, */*' }
        })
        if (!response.ok) throw new Error(`VersaTiles returned HTTP ${response.status} for z${tile.z}/${tile.x}/${tile.y}.`)
        const data = await response.arrayBuffer()
        if (signal?.aborted) throw abortError()
        await db.tiles.put({
          key: tileDbKey(id, tile.z, tile.x, tile.y),
          tripId: id,
          z: tile.z,
          x: tile.x,
          y: tile.y,
          data,
          byteCount: data.byteLength,
          savedAt: Date.now()
        })
        completed += 1
        byteCount += data.byteLength
        report(tile)
      } catch (error) {
        failed = error
        throw error
      }
    }
  }

  try {
    const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, plan.tileCount) }, () => worker())
    await Promise.all(workers)
    const pack = {
      tripId: id,
      savedAt: Date.now(),
      tileCount: plan.tileCount,
      byteCount,
      minZoom: plan.minZoom,
      maxZoom: plan.maxZoom,
      corridorKm: plan.corridorKm,
      source: 'VersaTiles / OpenStreetMap'
    }
    await db.packs.put(pack)
    try { await navigator.storage?.persist?.() } catch (_) { /* best effort only */ }
    return pack
  } catch (error) {
    await deleteOfflineMapPack(id)
    throw error
  }
}

export const formatOfflineBytes = bytes => {
  const value = Math.max(0, Number(bytes || 0))
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
