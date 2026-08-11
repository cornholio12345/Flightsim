import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_populated_places_simple.geojson'
const TARGET = fileURLToPath(new URL('../src/data/populatedPlaces.generated.js', import.meta.url))

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

try {
  const response = await fetch(SOURCE, { headers: { 'user-agent': 'FlightSim-build' } })
  if (!response.ok) throw new Error(`Natural Earth request failed: ${response.status}`)
  const collection = await response.json()
  const byCoordinate = new Map()
  for (const feature of collection.features || []) {
    const city = normalizeFeature(feature)
    if (!city) continue
    const key = `${city.name.toLowerCase()}|${city.lat.toFixed(3)}|${city.lon.toFixed(3)}`
    const existing = byCoordinate.get(key)
    if (!existing || importance(city) < importance(existing)) byCoordinate.set(key, city)
  }
  const cities = [...byCoordinate.values()]
    .sort((a, b) => importance(a) - importance(b) || b.population - a.population || a.name.localeCompare(b.name))
    .map(city => [city.name, Number(city.lat.toFixed(5)), Number(city.lon.toFixed(5)), importance(city)])

  if (cities.length < 180) throw new Error(`Natural Earth returned only ${cities.length} usable places`)
  const output = `// AUTO-GENERATED from Natural Earth ne_110m_populated_places_simple.geojson.\n// Do not edit by hand; npm prebuild/predev refreshes it when the source is reachable.\nexport default ${JSON.stringify(cities)}\n`
  await writeFile(TARGET, output, 'utf8')
  console.log(`Generated ${cities.length} offline populated places from Natural Earth`)
} catch (error) {
  // Keep the checked-in seed so builds remain reproducible when the source is down.
  await readFile(TARGET, 'utf8')
  console.warn(`Using checked-in populated-place seed: ${error.message}`)
}
