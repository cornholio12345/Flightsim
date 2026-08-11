import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

const formatDuration = minutes => {
  const total = Math.max(0, Math.round(Number(minutes || 0)))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

const roundedRect = (ctx, x, y, w, h, r) => {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

const createSummaryPng = summary => {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const ctx = canvas.getContext('2d')

  const bg = ctx.createLinearGradient(0, 0, 1200, 630)
  bg.addColorStop(0, '#07131d')
  bg.addColorStop(0.55, '#0b2632')
  bg.addColorStop(1, '#153d4a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 1200, 630)

  ctx.fillStyle = '#72dfb1'
  ctx.font = '700 24px system-ui, sans-serif'
  ctx.fillText('FLIGHTSIM · FLIGHT COMPLETE', 68, 72)

  ctx.fillStyle = '#f3f8fa'
  ctx.font = '800 68px system-ui, sans-serif'
  ctx.fillText(summary.flightNumber || summary.routeLabel, 68, 154)
  ctx.font = '650 36px system-ui, sans-serif'
  ctx.fillStyle = '#a9bdc7'
  ctx.fillText(summary.routeLabel, 68, 205)

  const stats = [
    ['Distance', `${Math.round(summary.distanceKm || 0).toLocaleString()} km`],
    ['Flight time', formatDuration(summary.elapsedMinutes)],
    ['GPS fixes', String(summary.gpsFixCount || 0)],
    ['Arrival', summary.arrivalClock || '—']
  ]
  stats.forEach(([label, value], index) => {
    const x = 68 + (index % 2) * 300
    const y = 270 + Math.floor(index / 2) * 112
    roundedRect(ctx, x, y, 270, 88, 16)
    ctx.fillStyle = 'rgba(0,0,0,.18)'
    ctx.fill()
    ctx.fillStyle = '#7f9aa7'
    ctx.font = '600 18px system-ui, sans-serif'
    ctx.fillText(label, x + 20, y + 29)
    ctx.fillStyle = '#f3f8fa'
    ctx.font = '750 27px system-ui, sans-serif'
    ctx.fillText(value, x + 20, y + 62)
  })

  const contexts = (summary.contexts || []).slice(0, 7)
  roundedRect(ctx, 690, 245, 440, 260, 22)
  ctx.fillStyle = 'rgba(3,14,20,.45)'
  ctx.fill()
  ctx.fillStyle = '#72dfb1'
  ctx.font = '700 19px system-ui, sans-serif'
  ctx.fillText('ROUTE HIGHLIGHTS', 724, 286)
  ctx.fillStyle = '#dce9ed'
  ctx.font = '600 24px system-ui, sans-serif'
  contexts.forEach((context, index) => ctx.fillText(`• ${context}`, 724, 330 + index * 31))

  ctx.fillStyle = '#6f8996'
  ctx.font = '500 17px system-ui, sans-serif'
  ctx.fillText('Offline passenger flight progress · simulation only', 68, 580)
  return canvas.toDataURL('image/png')
}

export const shareLandingSummary = async summary => {
  const title = `${summary.flightNumber || summary.routeLabel} · Flight complete`
  const text = `${summary.routeLabel} · ${Math.round(summary.distanceKm || 0)} km · ${formatDuration(summary.elapsedMinutes)} · FlightSim`

  try {
    if (Capacitor.isNativePlatform()) {
      const dataUrl = createSummaryPng(summary)
      const base64 = dataUrl.split(',')[1]
      const filename = `flightsim-${String(summary.flightNumber || 'flight').replace(/[^a-z0-9_-]/gi, '-')}-${Date.now()}.png`
      await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache })
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache })
      await Share.share({ title, text, files: [uri], dialogTitle: 'Share flight summary' })
      return true
    }

    if (navigator.share) {
      await navigator.share({ title, text })
      return true
    }
  } catch (_) {
    // Fall back to clipboard/text below.
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(`${title}\n${text}`)
    return true
  }
  return false
}
