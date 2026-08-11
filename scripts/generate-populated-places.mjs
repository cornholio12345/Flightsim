import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_populated_places_simple.geojson'
const TARGET = fileURLToPath(new URL('../src/data/populatedPlaces.generated.js', import.meta.url))

// Natural Earth 110m guarantees a compact worldwide base. These extras fill a few
// passenger-relevant regional gaps without turning the offline globe into a huge gazetteer.
const REGIONAL_EXTRAS = [
  ['Hurghada',27.2579,33.8116,4], ['Split',43.5081,16.4402,4], ['Dubrovnik',42.6507,18.0944,4],
  ['Novi Sad',45.2671,19.8335,4], ['Thessaloniki',40.6401,22.9444,3], ['Varna',43.2141,27.9147,4],
  ['Cluj-Napoca',46.7712,23.6236,4], ['Timisoara',45.7489,21.2087,4], ['Hamburg',53.5511,9.9937,3],
  ['Munich',48.1351,11.582,3], ['Frankfurt',50.1109,8.6821,3], ['Alexandria',31.2001,29.9187,3],
  ['Jeddah',21.4858,39.1925,3], ['Dubai',25.2048,55.2708,2], ['Tel Aviv',32.0853,34.7818,3],
  ['Boston',42.3601,-71.0589,3], ['Miami',25.7617,-80.1918,3], ['San Francisco',37.7749,-122.4194,3],
  ['Vancouver',49.2827,-123.1207,3], ['Montreal',45.5019,-73.5674,3], ['Rio de Janeiro',-22.9068,-43.1729,2],
  ['São Paulo',-23.5505,-46.6333,2], ['Sydney',-33.8688,151.2093,2], ['Melbourne',-37.8136,144.9631,3]
]

const number = value => Number.isFinite(Number(value)) ? Number(value) : null

const normalizeFeature = feature => {
  const properties = feature?.properties || {}
  const coordinates = feature?.geometry?.coordinates || []
  const lon = number(coordinates[0] ?? properties.longitude)
  const lat = number(coordinates[1] ?? properties.latitude)
  const name = String(properties.nameascii || properties.name || '').trim()
  if (!name || lat == null || lon == null) return null
  return {
    name,
    lat,
    lon,
    scalerank: number(properties.scalerank) ?? 10,
    capital: Number(properties.adm0cap || 0) === 1,
    worldCity: Number(properties.worldcity || 0) === 1,
    megaCity: Number(properties.megacity || 0) === 1,
    population: number(properties.pop_max) ?? 0
  }
}

const importance = city => {
  if (city.capital) return 0
  if (city.worldCity || city.megaCity) return 1
  if (city.population >= 5_000_000) return 2
  if (city.population >= 1_000_000) return 3
  return Math.max(4, city.scalerank)
}

const mergeRows = rows => {
  const byName = new Map()
  rows.forEach(row => {
    const [name, lat, lon, rank = 5] = row
    const key = String(name).trim().toLowerCase()
    if (!key || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return
    const normalized = [String(name).trim(), Number(Number(lat).toFixed(5)), Number(Number(lon).toFixed(5)), Number(rank)]
    const existing = byName.get(key)
    if (!existing || normalized[3] < existing[3]) byName.set(key, normalized)
  })
  return [...byName.values()].sort((a, b) => a[3] - b[3] || a[0].localeCompare(b[0]))
}

try {
  const response = await fetch(SOURCE, { headers: { 'user-agent': 'FlightSim-build' } })
  if (!response.ok) throw new Error(`Natural Earth request failed: ${response.status}`)
  const collection = await response.json()
  const naturalEarthRows = []
  for (const feature of collection.features || []) {
    const city = normalizeFeature(feature)
    if (!city) continue
    naturalEarthRows.push([city.name, city.lat, city.lon, importance(city)])
  }
  const cities = mergeRows([...naturalEarthRows, ...REGIONAL_EXTRAS])
  if (cities.length < 180) throw new Error(`Natural Earth returned only ${cities.length} usable places`)
  const output = `// AUTO-GENERATED from Natural Earth ne_110m_populated_places_simple.geojson.\n// Do not edit by hand; npm prebuild/predev refreshes it when the source is reachable.\nexport default ${JSON.stringify(cities)}\n`
  await writeFile(TARGET, output, 'utf8')
  console.log(`Generated ${cities.length} offline populated places from Natural Earth + regional extras`)
} catch (error) {
  // Keep the checked-in seed so builds remain reproducible when the source is down.
  await readFile(TARGET, 'utf8')
  console.warn(`Using checked-in populated-place seed: ${error.message}`)
}
