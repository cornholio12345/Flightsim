import { feature } from 'topojson-client'
import countries50m from 'world-atlas/countries-50m.json'

const COUNTRIES = feature(countries50m, countries50m.objects.countries).features

const WATER_AREAS = [
  { name: 'Mediterranean Sea', lat: [29, 47], lon: [-7, 38] },
  { name: 'Red Sea', lat: [12, 31], lon: [31, 44] },
  { name: 'Black Sea', lat: [40, 48], lon: [27, 43] },
  { name: 'Baltic Sea', lat: [53, 66], lon: [9, 31] },
  { name: 'North Sea', lat: [50, 62], lon: [-5, 10] },
  { name: 'Adriatic Sea', lat: [39, 46], lon: [12, 20] },
  { name: 'Aegean Sea', lat: [34, 42], lon: [22, 30] },
  { name: 'Persian Gulf', lat: [23, 31], lon: [47, 57] },
  { name: 'Gulf of Mexico', lat: [18, 31], lon: [-98, -80] },
  { name: 'Caribbean Sea', lat: [8, 24], lon: [-89, -58] },
  { name: 'Arabian Sea', lat: [5, 27], lon: [48, 79] },
  { name: 'South China Sea', lat: [-2, 25], lon: [99, 122] },
  { name: 'Sea of Japan', lat: [33, 52], lon: [127, 143] },
  { name: 'Indian Ocean', lat: [-60, 25], lon: [20, 120] },
  { name: 'North Atlantic Ocean', lat: [0, 72], lon: [-82, 12] },
  { name: 'South Atlantic Ocean', lat: [-60, 0], lon: [-70, 20] },
  { name: 'North Pacific Ocean', lat: [0, 70], lon: [120, -100], wraps: true },
  { name: 'South Pacific Ocean', lat: [-60, 0], lon: [145, -70], wraps: true },
  { name: 'Southern Ocean', lat: [-90, -55], lon: [-180, 180] },
  { name: 'Arctic Ocean', lat: [66, 90], lon: [-180, 180] }
]

const normalizeLonNear = (lon, reference) => {
  let value = Number(lon)
  while (value - reference > 180) value -= 360
  while (value - reference < -180) value += 360
  return value
}

const pointInRing = (lat, lon, ring) => {
  if (!ring?.length) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = normalizeLonNear(ring[i][0], lon)
    const yi = ring[i][1]
    const xj = normalizeLonNear(ring[j][0], lon)
    const yj = ring[j][1]
    const intersects = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

const pointInPolygon = (lat, lon, polygon) => {
  if (!polygon?.length || !pointInRing(lat, lon, polygon[0])) return false
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(lat, lon, polygon[i])) return false
  }
  return true
}

const pointInGeometry = (lat, lon, geometry) => {
  if (!geometry) return false
  if (geometry.type === 'Polygon') return pointInPolygon(lat, lon, geometry.coordinates)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(polygon => pointInPolygon(lat, lon, polygon))
  return false
}

const waterAreaAt = (lat, lon) => WATER_AREAS.find(area => {
  if (lat < area.lat[0] || lat > area.lat[1]) return false
  if (area.wraps) return lon >= area.lon[0] || lon <= area.lon[1]
  return lon >= area.lon[0] && lon <= area.lon[1]
})

export const describeGeoContext = (latValue, lonValue) => {
  const lat = Number(latValue)
  const lon = Number(lonValue)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'Unknown position'

  const country = COUNTRIES.find(item => pointInGeometry(lat, lon, item.geometry))
  if (country?.properties?.name) return country.properties.name

  return waterAreaAt(lat, lon)?.name || 'Open water'
}
