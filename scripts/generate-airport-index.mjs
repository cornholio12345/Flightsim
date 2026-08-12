import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv'
const INDEX_TARGET = fileURLToPath(new URL('../src/data/airports.generated.js', import.meta.url))
const DETAILS_TARGET = fileURLToPath(new URL('../src/data/airportDetails.generated.js', import.meta.url))

const parseCsvRow = line => {
  const cells = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(value)
      value = ''
    } else value += char
  }
  cells.push(value)
  return cells
}

const typeRank = value => ({ large_airport: 0, medium_airport: 1, small_airport: 2, seaplane_base: 3, heliport: 4 }[value] ?? 9)

try {
  const response = await fetch(SOURCE, { headers: { 'user-agent': 'FlightSim-build' } })
  if (!response.ok) throw new Error(`OurAirports request failed: ${response.status}`)
  const text = await response.text()
  const lines = text.split(/\r?\n/).filter(Boolean)
  const headers = parseCsvRow(lines.shift() || '')
  const column = name => headers.indexOf(name)
  const identIndex = column('ident')
  const gpsIndex = column('gps_code')
  const iataIndex = column('iata_code')
  const typeIndex = column('type')
  const scheduledIndex = column('scheduled_service')
  const latIndex = column('latitude_deg')
  const lonIndex = column('longitude_deg')
  const nameIndex = column('name')
  if ([identIndex, gpsIndex, iataIndex, typeIndex, latIndex, lonIndex, nameIndex].some(index => index < 0)) throw new Error('OurAirports columns changed')

  const best = new Map()
  for (const line of lines) {
    const cells = parseCsvRow(line)
    const iata = String(cells[iataIndex] || '').trim().toUpperCase()
    const gpsCode = String(cells[gpsIndex] || '').trim().toUpperCase()
    const ident = String(cells[identIndex] || '').trim().toUpperCase()
    const icao = /^[A-Z0-9]{4}$/.test(gpsCode) ? gpsCode : ident
    const lat = Number(cells[latIndex])
    const lon = Number(cells[lonIndex])
    if (!/^[A-Z]{3}$/.test(iata) || !/^[A-Z0-9]{4}$/.test(icao) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const rank = typeRank(cells[typeIndex]) - (cells[scheduledIndex] === 'yes' ? 0.5 : 0)
    const existing = best.get(iata)
    if (!existing || rank < existing.rank) {
      best.set(iata, {
        icao,
        lat,
        lon,
        name: String(cells[nameIndex] || iata).trim() || iata,
        rank
      })
    }
  }

  const airports = [...best.entries()]
    .map(([iata, airport]) => [iata, airport.icao])
    .sort((a, b) => a[0].localeCompare(b[0]))
  const details = [...best.entries()]
    .map(([iata, airport]) => [iata, airport.icao, Number(airport.lat.toFixed(6)), Number(airport.lon.toFixed(6)), airport.name])
    .sort((a, b) => a[0].localeCompare(b[0]))
  if (airports.length < 3000) throw new Error(`OurAirports returned only ${airports.length} usable IATA airports`)

  const indexOutput = `// AUTO-GENERATED from OurAirports airports.csv.\n// Do not edit by hand; npm prebuild/predev refreshes it when the source is reachable.\nexport default ${JSON.stringify(airports)}\n`
  const detailsOutput = `// AUTO-GENERATED from OurAirports airports.csv.\n// Compact rows: [IATA, ICAO, lat, lon, name].\nexport default ${JSON.stringify(details)}\n`
  await Promise.all([
    writeFile(INDEX_TARGET, indexOutput, 'utf8'),
    writeFile(DETAILS_TARGET, detailsOutput, 'utf8')
  ])
  console.log(`Generated ${airports.length} local airport mappings and coordinates from OurAirports`)
} catch (error) {
  await Promise.all([
    readFile(INDEX_TARGET, 'utf8'),
    readFile(DETAILS_TARGET, 'utf8')
  ])
  console.warn(`Using checked-in airport lookup seed: ${error.message}`)
}
