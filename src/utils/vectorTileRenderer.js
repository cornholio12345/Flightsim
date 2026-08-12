import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'

const TILE_SIZE = 256

const palette = {
  land: '#314b43',
  ocean: '#0a2d43',
  water: '#0d3850',
  boundary: 'rgba(226, 235, 231, .46)',
  roadMajor: '#b7baa5',
  roadPrimary: '#9fae9e',
  roadMinor: '#71877f',
  rail: '#7f8e91',
  label: '#edf4f1',
  labelHalo: 'rgba(4, 14, 20, .94)'
}

const traceGeometry = (ctx, geometry, extent, close = false) => {
  const scale = TILE_SIZE / Math.max(1, extent || 4096)
  geometry.forEach(line => {
    if (!line?.length) return
    ctx.moveTo(line[0].x * scale, line[0].y * scale)
    for (let index = 1; index < line.length; index += 1) {
      ctx.lineTo(line[index].x * scale, line[index].y * scale)
    }
    if (close) ctx.closePath()
  })
}

const paintPolygonLayer = (tile, name, ctx, fillStyle) => {
  const layer = tile.layers?.[name]
  if (!layer) return
  ctx.save()
  ctx.fillStyle = fillStyle
  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index)
    if (feature.type !== 3) continue
    ctx.beginPath()
    traceGeometry(ctx, feature.loadGeometry(), feature.extent, true)
    try { ctx.fill('evenodd') } catch (_) { ctx.fill() }
  }
  ctx.restore()
}

const streetStyle = kind => {
  if (['motorway', 'trunk'].includes(kind)) return { color: palette.roadMajor, width: 2.0 }
  if (['primary', 'secondary'].includes(kind)) return { color: palette.roadPrimary, width: 1.25 }
  if (['rail', 'narrow_gauge', 'light_rail'].includes(kind)) return { color: palette.rail, width: 0.8, dash: [3, 3] }
  return { color: palette.roadMinor, width: 0.65 }
}

const paintStreets = (tile, ctx, zoom) => {
  const layer = tile.layers?.streets
  if (!layer) return
  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index)
    if (feature.type !== 2) continue
    const kind = String(feature.properties?.kind || '')
    if (zoom < 7 && !['motorway', 'trunk'].includes(kind)) continue
    if (zoom < 9 && !['motorway', 'trunk', 'primary', 'rail'].includes(kind)) continue
    const style = streetStyle(kind)
    ctx.save()
    ctx.strokeStyle = style.color
    ctx.lineWidth = style.width
    ctx.globalAlpha = kind === 'rail' ? 0.58 : 0.78
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash(style.dash || [])
    ctx.beginPath()
    traceGeometry(ctx, feature.loadGeometry(), feature.extent, false)
    ctx.stroke()
    ctx.restore()
  }
}

const paintBoundaries = (tile, ctx) => {
  const layer = tile.layers?.boundaries
  if (!layer) return
  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index)
    if (feature.type !== 2) continue
    const adminLevel = Number(feature.properties?.admin_level || 9)
    ctx.save()
    ctx.strokeStyle = palette.boundary
    ctx.lineWidth = adminLevel <= 2 ? 1.0 : 0.55
    ctx.globalAlpha = adminLevel <= 2 ? 0.78 : 0.42
    if (feature.properties?.disputed) ctx.setLineDash([4, 3])
    ctx.beginPath()
    traceGeometry(ctx, feature.loadGeometry(), feature.extent, false)
    ctx.stroke()
    ctx.restore()
  }
}

const shouldDrawPlace = (properties, zoom) => {
  const population = Number(properties?.population || 0)
  const kind = String(properties?.kind || '')
  if (kind === 'capital') return true
  if (zoom <= 4) return population >= 2_000_000
  if (zoom === 5) return population >= 750_000
  if (zoom === 6) return population >= 250_000
  if (zoom === 7) return population >= 80_000
  return population >= 20_000 || ['city', 'town'].includes(kind)
}

const paintPlaceLabels = (tile, ctx, zoom) => {
  const layer = tile.layers?.place_labels
  if (!layer) return
  let drawn = 0
  const maxLabels = zoom <= 5 ? 7 : zoom <= 7 ? 13 : 22
  for (let index = 0; index < layer.length && drawn < maxLabels; index += 1) {
    const feature = layer.feature(index)
    if (feature.type !== 1 || !shouldDrawPlace(feature.properties, zoom)) continue
    const name = String(feature.properties?.name_en || feature.properties?.name || '').trim()
    if (!name) continue
    const geometry = feature.loadGeometry()
    const point = geometry?.[0]?.[0]
    if (!point) continue
    const scale = TILE_SIZE / Math.max(1, feature.extent || 4096)
    const x = point.x * scale
    const y = point.y * scale
    const population = Number(feature.properties?.population || 0)
    const fontSize = population >= 2_000_000 ? 12 : population >= 500_000 ? 11 : 10

    ctx.save()
    ctx.font = `650 ${fontSize}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = palette.labelHalo
    ctx.lineWidth = 3
    ctx.strokeText(name, x, y)
    ctx.fillStyle = palette.label
    ctx.fillText(name, x, y)
    ctx.restore()
    drawn += 1
  }
}

const paintWaterLabels = (tile, ctx, zoom) => {
  if (zoom < 6) return
  const layer = tile.layers?.water_polygons_labels
  if (!layer) return
  let drawn = 0
  for (let index = 0; index < layer.length && drawn < 5; index += 1) {
    const feature = layer.feature(index)
    if (feature.type !== 1) continue
    const name = String(feature.properties?.name_en || feature.properties?.name || '').trim()
    if (!name) continue
    const point = feature.loadGeometry()?.[0]?.[0]
    if (!point) continue
    const scale = TILE_SIZE / Math.max(1, feature.extent || 4096)
    ctx.save()
    ctx.font = 'italic 9px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = palette.labelHalo
    ctx.lineWidth = 2.5
    ctx.strokeText(name, point.x * scale, point.y * scale)
    ctx.fillStyle = 'rgba(145, 196, 219, .88)'
    ctx.fillText(name, point.x * scale, point.y * scale)
    ctx.restore()
    drawn += 1
  }
}

export const renderVersaTile = (canvas, buffer, { zoom = 6 } = {}) => {
  if (!canvas || !buffer) return false
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (!bytes.byteLength) return false
  const tile = new VectorTile(new Pbf(bytes))
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return false

  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  ctx.fillStyle = palette.land
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE)

  paintPolygonLayer(tile, 'ocean', ctx, palette.ocean)
  paintPolygonLayer(tile, 'water_polygons', ctx, palette.water)
  paintBoundaries(tile, ctx)
  paintStreets(tile, ctx, zoom)
  paintWaterLabels(tile, ctx, zoom)
  paintPlaceLabels(tile, ctx, zoom)
  return true
}
