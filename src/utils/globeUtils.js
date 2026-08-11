import * as THREE from 'three'
import { feature } from 'topojson-client'
import countries50m from 'world-atlas/countries-50m.json'

const RADIUS = 2
const MIN_CAMERA_Z = 2.55
const MAX_CAMERA_Z = 8.5
const DEFAULT_CAMERA_Z = 5.8
const COUNTRY_COLLECTION = feature(countries50m, countries50m.objects.countries)

const FEATURED_COUNTRIES = new Set([
  'Egypt', 'Sudan', 'Saudi Arabia', 'Jordan', 'Israel', 'Turkey', 'Greece', 'Cyprus',
  'Bulgaria', 'Romania', 'Hungary', 'Austria', 'Czechia', 'Czech Republic', 'Poland',
  'Germany', 'Italy', 'France', 'Spain', 'United Kingdom', 'Ukraine', 'Russia',
  'United States of America', 'Canada', 'Ireland', 'Iceland', 'Portugal'
])

const CITY_LABELS = [
  ['London', 51.5074, -0.1278], ['Paris', 48.8566, 2.3522], ['Madrid', 40.4168, -3.7038],
  ['Rome', 41.9028, 12.4964], ['Berlin', 52.52, 13.405], ['Hamburg', 53.5511, 9.9937],
  ['Munich', 48.1351, 11.582], ['Frankfurt', 50.1109, 8.6821], ['Vienna', 48.2082, 16.3738],
  ['Prague', 50.0755, 14.4378], ['Warsaw', 52.2297, 21.0122], ['Budapest', 47.4979, 19.0402],
  ['Bucharest', 44.4268, 26.1025], ['Sofia', 42.6977, 23.3219], ['Athens', 37.9838, 23.7275],
  ['Istanbul', 41.0082, 28.9784], ['Kyiv', 50.4501, 30.5234], ['Moscow', 55.7558, 37.6173],
  ['Cairo', 30.0444, 31.2357], ['Alexandria', 31.2001, 29.9187], ['Hurghada', 27.2579, 33.8116],
  ['Riyadh', 24.7136, 46.6753], ['Jeddah', 21.4858, 39.1925], ['Dubai', 25.2048, 55.2708],
  ['Tel Aviv', 32.0853, 34.7818], ['New York', 40.7128, -74.006], ['Boston', 42.3601, -71.0589],
  ['Washington', 38.9072, -77.0369], ['Chicago', 41.8781, -87.6298], ['Los Angeles', 34.0522, -118.2437],
  ['Toronto', 43.6532, -79.3832], ['Mexico City', 19.4326, -99.1332], ['São Paulo', -23.5505, -46.6333],
  ['Buenos Aires', -34.6037, -58.3816], ['Tokyo', 35.6762, 139.6503], ['Seoul', 37.5665, 126.978],
  ['Beijing', 39.9042, 116.4074], ['Shanghai', 31.2304, 121.4737], ['Hong Kong', 22.3193, 114.1694],
  ['Singapore', 1.3521, 103.8198], ['Bangkok', 13.7563, 100.5018], ['Delhi', 28.6139, 77.209],
  ['Mumbai', 19.076, 72.8777], ['Sydney', -33.8688, 151.2093], ['Melbourne', -37.8136, 144.9631],
  ['Cape Town', -33.9249, 18.4241], ['Johannesburg', -26.2041, 28.0473], ['Nairobi', -1.2921, 36.8219]
]

const SEA_LABELS = [
  ['North Atlantic Ocean', 39, -38], ['Mediterranean Sea', 35, 18], ['Red Sea', 20.5, 38.5],
  ['Black Sea', 43.3, 34], ['Baltic Sea', 58, 20], ['North Sea', 56, 3],
  ['Adriatic Sea', 43, 15], ['Aegean Sea', 39, 25], ['Arabian Sea', 14, 65],
  ['Persian Gulf', 26, 52], ['Indian Ocean', -13, 77], ['Caribbean Sea', 15, -75],
  ['Gulf of Mexico', 24, -90], ['South China Sea', 14, 114], ['Sea of Japan', 40, 136]
]

let scene
let camera
let renderer
let earthGroup
let globe
let earthTexture
let aircraft
let aircraftState = null
let routeLine
let routePoints = []
let routeMarkers = []
let mapLabels = []
let animationFrame
let resizeObserver
let interactionCleanup
let followAircraft = false

const disposeObject = object => {
  if (!object) return
  object.traverse?.(child => {
    child.geometry?.dispose?.()
    if (Array.isArray(child.material)) {
      child.material.forEach(material => {
        material.map?.dispose?.()
        material.dispose?.()
      })
    } else {
      child.material?.map?.dispose?.()
      child.material?.dispose?.()
    }
  })
  if (!object.traverse) {
    object.geometry?.dispose?.()
    object.material?.map?.dispose?.()
    object.material?.dispose?.()
  }
}

const latLonVector = (lat, lon, radius = RADIUS) => {
  const phi = (90 - Number(lat)) * Math.PI / 180
  const theta = (Number(lon) + 180) * Math.PI / 180
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  )
}

const greatCirclePoint = (a, b, t, radius = RADIUS + 0.026) => {
  const va = latLonVector(a.lat, a.lon, 1).normalize()
  const vb = latLonVector(b.lat, b.lon, 1).normalize()
  const dot = THREE.MathUtils.clamp(va.dot(vb), -1, 1)
  const omega = Math.acos(dot)
  if (omega < 1e-6) return va.multiplyScalar(radius)
  const sinOmega = Math.sin(omega)
  return va.multiplyScalar(Math.sin((1 - t) * omega) / sinOmega)
    .add(vb.multiplyScalar(Math.sin(t * omega) / sinOmega))
    .normalize()
    .multiplyScalar(radius)
}

const destinationPoint = (lat, lon, bearing, angularDistance = 0.012) => {
  const phi1 = THREE.MathUtils.degToRad(Number(lat))
  const lambda1 = THREE.MathUtils.degToRad(Number(lon))
  const theta = THREE.MathUtils.degToRad(Number(bearing || 0))
  const phi2 = Math.asin(THREE.MathUtils.clamp(
    Math.sin(phi1) * Math.cos(angularDistance)
      + Math.cos(phi1) * Math.sin(angularDistance) * Math.cos(theta),
    -1,
    1
  ))
  const y = Math.sin(theta) * Math.sin(angularDistance) * Math.cos(phi1)
  const x = Math.cos(angularDistance) - Math.sin(phi1) * Math.sin(phi2)
  const lambda2 = lambda1 + Math.atan2(y, x)
  return { lat: THREE.MathUtils.radToDeg(phi2), lon: THREE.MathUtils.radToDeg(lambda2) }
}

const countryColor = name => {
  const palette = ['#49695f', '#527367', '#5b796b', '#42655e', '#627c6a', '#55705f']
  let hash = 0
  for (let index = 0; index < name.length; index += 1) hash = ((hash * 31) + name.charCodeAt(index)) >>> 0
  return palette[hash % palette.length]
}

const buildEarthTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 4096
  canvas.height = 2048
  const context = canvas.getContext('2d')
  const width = canvas.width
  const height = canvas.height
  const toXY = ([lon, lat]) => [((lon + 180) / 360) * width, ((90 - lat) / 180) * height]

  const ocean = context.createLinearGradient(0, 0, 0, height)
  ocean.addColorStop(0, '#0c364e')
  ocean.addColorStop(0.5, '#092c41')
  ocean.addColorStop(1, '#071e2e')
  context.fillStyle = ocean
  context.fillRect(0, 0, width, height)

  context.strokeStyle = 'rgba(151, 194, 207, 0.10)'
  context.lineWidth = 1
  const north70 = ((90 - 70) / 180) * height
  const south70 = ((90 + 70) / 180) * height
  for (let lon = -180; lon <= 180; lon += 20) {
    const x = ((lon + 180) / 360) * width
    context.beginPath()
    context.moveTo(x, north70)
    context.lineTo(x, south70)
    context.stroke()
  }
  for (let lat = -60; lat <= 60; lat += 20) {
    const y = ((90 - lat) / 180) * height
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
  }

  COUNTRY_COLLECTION.features.forEach(country => {
    const name = country.properties?.name || String(country.id || '')
    const geometry = country.geometry
    const polygons = geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : []

    context.fillStyle = countryColor(name)
    context.strokeStyle = 'rgba(222, 233, 227, 0.48)'
    context.lineWidth = 1.35

    polygons.forEach(polygon => {
      context.beginPath()
      polygon.forEach(ring => {
        let previousX = null
        ring.forEach((coordinate, index) => {
          const [x, y] = toXY(coordinate)
          if (index === 0 || (previousX !== null && Math.abs(x - previousX) > width * 0.5)) context.moveTo(x, y)
          else context.lineTo(x, y)
          previousX = x
        })
        context.closePath()
      })
      context.fill('evenodd')
      context.stroke()
    })
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipMapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = Math.min(12, renderer?.capabilities?.getMaxAnisotropy?.() || 1)
  texture.needsUpdate = true
  return texture
}

const ringAreaAndCentroid = ring => {
  if (!ring?.length) return null
  let twiceArea = 0
  let cx = 0
  let cy = 0
  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const cross = x0 * y1 - x1 * y0
    twiceArea += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
    minLon = Math.min(minLon, x0)
    maxLon = Math.max(maxLon, x0)
    minLat = Math.min(minLat, y0)
    maxLat = Math.max(maxLat, y0)
  }
  if (Math.abs(twiceArea) < 1e-6) return null
  const lon = cx / (3 * twiceArea)
  const lat = cy / (3 * twiceArea)
  const spanLon = Math.min(180, Math.max(0, maxLon - minLon))
  const spanLat = Math.max(0, maxLat - minLat)
  const score = spanLon * spanLat * Math.max(0.25, Math.cos(THREE.MathUtils.degToRad(lat)))
  return { lon, lat, area: Math.abs(twiceArea / 2), score }
}

const countryLabelInfo = country => {
  const geometry = country.geometry
  const polygons = geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates
      : []
  let best = null
  polygons.forEach(polygon => {
    const info = ringAreaAndCentroid(polygon?.[0])
    if (info && (!best || info.area > best.area)) best = info
  })
  return best
}

const buildMapLabelTexture = (text, kind) => {
  const canvas = document.createElement('canvas')
  canvas.width = kind === 'city' ? 512 : 768
  canvas.height = kind === 'city' ? 96 : 128
  const context = canvas.getContext('2d')
  context.textBaseline = 'middle'
  context.shadowColor = 'rgba(2, 8, 12, 0.95)'
  context.shadowBlur = kind === 'city' ? 6 : 9
  context.shadowOffsetY = 2

  if (kind === 'country') {
    context.font = '700 45px system-ui, sans-serif'
    context.textAlign = 'center'
    context.fillStyle = 'rgba(235, 242, 237, 0.92)'
    context.fillText(String(text).toUpperCase(), canvas.width / 2, canvas.height / 2)
  } else if (kind === 'sea') {
    context.font = 'italic 600 38px system-ui, sans-serif'
    context.textAlign = 'center'
    context.fillStyle = 'rgba(133, 192, 221, 0.82)'
    context.fillText(String(text), canvas.width / 2, canvas.height / 2)
  } else {
    context.beginPath()
    context.arc(42, canvas.height / 2, 8, 0, Math.PI * 2)
    context.fillStyle = '#f4d36d'
    context.fill()
    context.font = '650 34px system-ui, sans-serif'
    context.textAlign = 'left'
    context.fillStyle = 'rgba(242, 247, 249, 0.96)'
    context.fillText(String(text), 66, canvas.height / 2)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

const addMapLabel = ({ text, lat, lon, kind, maxCameraZ, width, height }) => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: buildMapLabelTexture(text, kind), transparent: true, depthTest: true, depthWrite: false
  }))
  sprite.position.copy(latLonVector(lat, lon, RADIUS + 0.034))
  sprite.renderOrder = 8
  sprite.userData.maxCameraZ = maxCameraZ
  sprite.userData.baseWidth = width
  sprite.userData.baseHeight = height
  sprite.visible = false
  earthGroup.add(sprite)
  mapLabels.push(sprite)
}

const createMapLabels = () => {
  COUNTRY_COLLECTION.features.forEach(country => {
    const name = country.properties?.name
    if (!name || name === 'Antarctica') return
    const info = countryLabelInfo(country)
    if (!info) return
    const featured = FEATURED_COUNTRIES.has(name)
    let maxCameraZ = null
    if (featured) maxCameraZ = 4.85
    else if (info.score >= 500) maxCameraZ = 5.25
    else if (info.score >= 65) maxCameraZ = 4.35
    else if (info.score >= 22) maxCameraZ = 3.45
    if (!maxCameraZ) return
    const labelWidth = Math.min(1.05, Math.max(0.52, 0.39 + String(name).length * 0.035))
    addMapLabel({ text: name, lat: info.lat, lon: info.lon, kind: 'country', maxCameraZ, width: labelWidth, height: 0.18 })
  })
  SEA_LABELS.forEach(([text, lat, lon]) => addMapLabel({ text, lat, lon, kind: 'sea', maxCameraZ: 4.25, width: 0.92, height: 0.17 }))
  CITY_LABELS.forEach(([text, lat, lon]) => {
    const width = Math.min(0.9, Math.max(0.46, 0.34 + String(text).length * 0.028))
    addMapLabel({ text, lat, lon, kind: 'city', maxCameraZ: 3.35, width, height: 0.14 })
  })
}

const updateMapLabels = () => {
  if (!camera || !mapLabels.length) return
  const worldPosition = new THREE.Vector3()
  const toCamera = new THREE.Vector3()
  mapLabels.forEach(label => {
    if (camera.position.z > label.userData.maxCameraZ) {
      label.visible = false
      return
    }
    label.getWorldPosition(worldPosition)
    toCamera.copy(camera.position).sub(worldPosition).normalize()
    const facing = worldPosition.clone().normalize().dot(toCamera) > 0.04
    label.visible = facing
    if (!facing) return
    const distance = camera.position.distanceTo(worldPosition)
    const scaleFactor = THREE.MathUtils.clamp(distance / 3.4, 0.28, 1.05)
    label.scale.set(label.userData.baseWidth * scaleFactor, label.userData.baseHeight * scaleFactor, 1)
  })
}

const buildPlaneTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 160
  const context = canvas.getContext('2d')
  context.translate(80, 80)
  context.shadowColor = 'rgba(0, 0, 0, 0.55)'
  context.shadowBlur = 7
  context.beginPath()
  context.moveTo(0, -62)
  context.quadraticCurveTo(9, -52, 9, -34)
  context.lineTo(11, -15)
  context.lineTo(57, 8)
  context.lineTo(57, 18)
  context.lineTo(13, 11)
  context.lineTo(10, 39)
  context.lineTo(30, 52)
  context.lineTo(30, 60)
  context.lineTo(0, 50)
  context.lineTo(-30, 60)
  context.lineTo(-30, 52)
  context.lineTo(-10, 39)
  context.lineTo(-13, 11)
  context.lineTo(-57, 18)
  context.lineTo(-57, 8)
  context.lineTo(-11, -15)
  context.lineTo(-9, -34)
  context.quadraticCurveTo(-9, -52, 0, -62)
  context.closePath()
  context.fillStyle = '#f7fbfd'
  context.fill()
  context.lineWidth = 3
  context.strokeStyle = '#17313d'
  context.stroke()
  context.shadowBlur = 0
  context.beginPath()
  context.moveTo(-7, -49)
  context.lineTo(0, -65)
  context.lineTo(7, -49)
  context.closePath()
  context.fillStyle = '#ffd54a'
  context.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

const buildTagTexture = (text, accent) => {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const context = canvas.getContext('2d')
  context.fillStyle = 'rgba(4, 15, 22, 0.52)'
  context.strokeStyle = accent
  context.globalAlpha = 0.78
  context.lineWidth = 2
  context.beginPath()
  context.roundRect(18, 16, 220, 64, 20)
  context.fill()
  context.stroke()
  context.globalAlpha = 0.9
  context.font = '800 36px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#f4f9f7'
  context.fillText(String(text || '').slice(0, 7), 128, 49)
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

const createAircraftMarker = () => {
  const material = new THREE.SpriteMaterial({ map: buildPlaneTexture(), transparent: true, depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(0.31, 0.31, 1)
  sprite.visible = false
  sprite.renderOrder = 20
  return sprite
}

const createRouteMarker = (node, label, accentHex, accentCss) => {
  const group = new THREE.Group()
  const normal = latLonVector(node.lat, node.lon, 1).normalize()
  const pin = new THREE.Mesh(
    new THREE.SphereGeometry(0.034, 14, 14),
    new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 0.72 })
  )
  pin.position.copy(normal.clone().multiplyScalar(RADIUS + 0.035))
  group.add(pin)
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({
    map: buildTagTexture(label, accentCss), transparent: true, opacity: 0.8, depthTest: false, depthWrite: false
  }))
  tag.position.copy(normal.clone().multiplyScalar(RADIUS + 0.09))
  tag.scale.set(0.57, 0.21, 1)
  tag.renderOrder = 15
  group.add(tag)
  return group
}

const updateAircraftScreenRotation = () => {
  if (!aircraft?.visible || !aircraftState || !earthGroup || !camera) return
  const ahead = destinationPoint(aircraftState.lat, aircraftState.lon, aircraftState.bearing)
  const from = latLonVector(aircraftState.lat, aircraftState.lon, RADIUS + aircraftState.visualAltitude)
  const to = latLonVector(ahead.lat, ahead.lon, RADIUS + aircraftState.visualAltitude)
  earthGroup.localToWorld(from)
  earthGroup.localToWorld(to)
  from.project(camera)
  to.project(camera)
  aircraft.material.rotation = Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2
}

const centerCoordinate = (lat, lon) => {
  if (!earthGroup) return
  earthGroup.rotation.set(
    THREE.MathUtils.degToRad(Number(lat)),
    THREE.MathUtils.degToRad(-(Number(lon) + 90)),
    0
  )
}

const focusRoute = nodes => {
  if (!earthGroup || !camera || !nodes?.length) return
  const start = nodes[0]
  const end = nodes[nodes.length - 1]
  const a = latLonVector(start.lat, start.lon, 1).normalize()
  const b = latLonVector(end.lat, end.lon, 1).normalize()
  const midpoint = a.clone().add(b).normalize()
  const midLat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(midpoint.y, -1, 1)))
  const midLon = THREE.MathUtils.radToDeg(Math.atan2(-midpoint.z, midpoint.x))
  const angularDistance = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1))
  centerCoordinate(midLat, midLon)
  camera.position.z = THREE.MathUtils.clamp(5.05 + angularDistance * 1.05, 5.25, 7.4)
  followAircraft = false
}

const enableInteractions = canvas => {
  const activePointers = new Map()
  let dragging = false
  let previousX = 0
  let previousY = 0
  let previousPinchDistance = null
  const setZoom = value => {
    if (camera) camera.position.z = THREE.MathUtils.clamp(value, MIN_CAMERA_Z, MAX_CAMERA_Z)
  }
  const pointerDistance = () => {
    if (activePointers.size < 2) return null
    const [a, b] = [...activePointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const onPointerDown = event => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    canvas.setPointerCapture?.(event.pointerId)
    if (activePointers.size === 1) {
      dragging = true
      previousX = event.clientX
      previousY = event.clientY
    } else {
      dragging = false
      previousPinchDistance = pointerDistance()
    }
  }
  const onPointerMove = event => {
    if (!activePointers.has(event.pointerId)) return
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (activePointers.size >= 2) {
      const distance = pointerDistance()
      if (distance && previousPinchDistance && camera) setZoom(camera.position.z * (previousPinchDistance / distance))
      previousPinchDistance = distance
      return
    }
    if (!dragging || !earthGroup) return
    const dx = event.clientX - previousX
    const dy = event.clientY - previousY
    previousX = event.clientX
    previousY = event.clientY
    if (Math.abs(dx) + Math.abs(dy) > 1) followAircraft = false
    earthGroup.rotation.y += dx * 0.006
    earthGroup.rotation.x = THREE.MathUtils.clamp(earthGroup.rotation.x + dy * 0.004, -1.3, 1.3)
  }
  const onPointerEnd = event => {
    activePointers.delete(event.pointerId)
    previousPinchDistance = pointerDistance()
    if (activePointers.size === 1) {
      const [remaining] = activePointers.values()
      previousX = remaining.x
      previousY = remaining.y
      dragging = true
    } else if (!activePointers.size) dragging = false
  }
  const onWheel = event => {
    event.preventDefault()
    if (camera) setZoom(camera.position.z + event.deltaY * 0.0045)
  }
  canvas.style.touchAction = 'none'
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerEnd)
  canvas.addEventListener('pointercancel', onPointerEnd)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerEnd)
    canvas.removeEventListener('pointercancel', onPointerEnd)
    canvas.removeEventListener('wheel', onWheel)
  }
}

export const initializeGlobe = canvasId => {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return null
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x06111a)
  camera = new THREE.PerspectiveCamera(48, 1, 0.05, 100)
  camera.position.set(0, 0.08, DEFAULT_CAMERA_Z)
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputEncoding = THREE.sRGBEncoding
  earthGroup = new THREE.Group()
  earthGroup.rotation.set(THREE.MathUtils.degToRad(22), THREE.MathUtils.degToRad(-105), 0)
  scene.add(earthGroup)
  earthTexture = buildEarthTexture()
  globe = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 96, 96),
    new THREE.MeshPhongMaterial({ map: earthTexture, color: 0xffffff, emissive: 0x061018, emissiveIntensity: 0.18, shininess: 6 })
  )
  earthGroup.add(globe)
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS + 0.035, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x5cb5df, transparent: true, opacity: 0.05, side: THREE.BackSide })
  )
  earthGroup.add(atmosphere)
  createMapLabels()
  aircraft = createAircraftMarker()
  earthGroup.add(aircraft)
  scene.add(new THREE.HemisphereLight(0xb8d9e7, 0x071019, 0.82))
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.88)
  keyLight.position.set(4, 4, 6)
  scene.add(keyLight)
  const resize = () => {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  interactionCleanup = enableInteractions(canvas)
  const animate = () => {
    animationFrame = requestAnimationFrame(animate)
    updateAircraftScreenRotation()
    updateMapLabels()
    renderer.render(scene, camera)
  }
  animate()
  return { scene, camera, renderer, earthGroup }
}

export const setRouteOnGlobe = (nodes, labels = {}) => {
  if (!earthGroup) return
  if (routeLine) {
    earthGroup.remove(routeLine)
    disposeObject(routeLine)
    routeLine = null
  }
  routeMarkers.forEach(marker => {
    earthGroup.remove(marker)
    disposeObject(marker)
  })
  routeMarkers = []
  routePoints = []
  if (!nodes || nodes.length < 2) return

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const start = nodes[index]
    const end = nodes[index + 1]
    const steps = 12
    for (let step = 0; step < steps; step += 1) routePoints.push(greatCirclePoint(start, end, step / steps))
  }
  routePoints.push(latLonVector(nodes[nodes.length - 1].lat, nodes[nodes.length - 1].lon, RADIUS + 0.026))

  routeLine = new THREE.Group()
  const flown = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([routePoints[0], routePoints[0]]),
    new THREE.LineBasicMaterial({ color: 0x75efb9, transparent: true, opacity: 1 })
  )
  const remaining = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(routePoints),
    new THREE.LineBasicMaterial({ color: 0x75a0aa, transparent: true, opacity: 0.58 })
  )
  flown.userData.role = 'flown'
  remaining.userData.role = 'remaining'
  flown.renderOrder = 4
  remaining.renderOrder = 3
  routeLine.add(remaining, flown)
  earthGroup.add(routeLine)

  const startLabel = labels.fromLabel || nodes[0].ident || 'DEP'
  const endLabel = labels.toLabel || nodes[nodes.length - 1].ident || 'ARR'
  const startMarker = createRouteMarker(nodes[0], startLabel, 0xffd65d, '#ffd65d')
  const endMarker = createRouteMarker(nodes[nodes.length - 1], endLabel, 0x83efc0, '#83efc0')
  routeMarkers.push(startMarker, endMarker)
  earthGroup.add(startMarker, endMarker)
  focusRoute(nodes)
}

export const updateRouteProgress = progress => {
  if (!routeLine || routePoints.length < 2) return
  const p = THREE.MathUtils.clamp(Number(progress || 0), 0, 1)
  const split = Math.max(1, Math.min(routePoints.length - 1, Math.round(p * (routePoints.length - 1))))
  const flown = routeLine.children.find(child => child.userData.role === 'flown')
  const remaining = routeLine.children.find(child => child.userData.role === 'remaining')
  if (flown) {
    flown.geometry.dispose()
    flown.geometry = new THREE.BufferGeometry().setFromPoints(routePoints.slice(0, split + 1))
  }
  if (remaining) {
    remaining.geometry.dispose()
    remaining.geometry = new THREE.BufferGeometry().setFromPoints(routePoints.slice(split))
  }
}

export const updateAircraftPosition = (lat, lon, altitudeFt = 0, bearing = 0) => {
  if (!aircraft) return
  const visualAltitude = Math.min(0.11, Math.max(0.045, Number(altitudeFt || 0) / 360000))
  aircraft.position.copy(latLonVector(lat, lon, RADIUS + visualAltitude))
  aircraftState = { lat: Number(lat), lon: Number(lon), bearing: Number(bearing || 0), visualAltitude }
  aircraft.visible = true
  if (followAircraft) centerCoordinate(lat, lon)
}

export const recenterOnAircraft = () => {
  if (!aircraftState) return false
  followAircraft = true
  centerCoordinate(aircraftState.lat, aircraftState.lon)
  if (camera && camera.position.z > 4.2) camera.position.z = 4.0
  return true
}

export const setFollowAircraft = value => {
  followAircraft = Boolean(value)
  if (followAircraft && aircraftState) centerCoordinate(aircraftState.lat, aircraftState.lon)
  return followAircraft
}

export const destroyGlobe = () => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect?.()
  interactionCleanup?.()
  routeMarkers.forEach(disposeObject)
  mapLabels.forEach(label => {
    earthGroup?.remove(label)
    disposeObject(label)
  })
  disposeObject(routeLine)
  disposeObject(aircraft)
  earthTexture?.dispose?.()
  renderer?.dispose?.()
  scene = camera = renderer = earthGroup = globe = aircraft = routeLine = null
  routeMarkers = []
  routePoints = []
  mapLabels = []
  aircraftState = null
  earthTexture = null
  interactionCleanup = null
  followAircraft = false
}
