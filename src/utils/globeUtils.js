import * as THREE from 'three'
import { feature } from 'topojson-client'
import countries110m from 'world-atlas/countries-110m.json'

const RADIUS = 2
const MIN_CAMERA_Z = 3.9
const MAX_CAMERA_Z = 8.5
const DEFAULT_CAMERA_Z = 5.8

let scene
let camera
let renderer
let earthGroup
let globe
let earthTexture
let aircraft
let aircraftState = null
let routeLine
let routeMarkers = []
let animationFrame
let resizeObserver
let interactionCleanup

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
  return {
    lat: THREE.MathUtils.radToDeg(phi2),
    lon: THREE.MathUtils.radToDeg(lambda2)
  }
}

const countryColor = name => {
  const palette = ['#49695f', '#527367', '#5b796b', '#42655e', '#627c6a', '#55705f']
  let hash = 0
  for (let index = 0; index < name.length; index += 1) hash = ((hash * 31) + name.charCodeAt(index)) >>> 0
  return palette[hash % palette.length]
}

const buildEarthTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024
  const context = canvas.getContext('2d')
  const width = canvas.width
  const height = canvas.height
  const toXY = ([lon, lat]) => [((lon + 180) / 360) * width, ((90 - lat) / 180) * height]

  const ocean = context.createLinearGradient(0, 0, 0, height)
  ocean.addColorStop(0, '#0d3a53')
  ocean.addColorStop(0.5, '#0a2d43')
  ocean.addColorStop(1, '#071f30')
  context.fillStyle = ocean
  context.fillRect(0, 0, width, height)

  context.strokeStyle = 'rgba(151, 194, 207, 0.12)'
  context.lineWidth = 1
  for (let lon = -180; lon <= 180; lon += 20) {
    const x = ((lon + 180) / 360) * width
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, height)
    context.stroke()
  }
  for (let lat = -80; lat <= 80; lat += 20) {
    const y = ((90 - lat) / 180) * height
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
  }

  const collection = feature(countries110m, countries110m.objects.countries)
  collection.features.forEach(country => {
    const name = country.properties?.name || String(country.id || '')
    const geometry = country.geometry
    const polygons = geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : []

    context.fillStyle = countryColor(name)
    context.strokeStyle = 'rgba(216, 229, 222, 0.42)'
    context.lineWidth = 1.15

    polygons.forEach(polygon => {
      context.beginPath()
      polygon.forEach(ring => {
        ring.forEach((coordinate, index) => {
          const [x, y] = toXY(coordinate)
          if (index === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
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
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1)
  texture.needsUpdate = true
  return texture
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

  context.fillStyle = 'rgba(4, 15, 22, 0.88)'
  context.strokeStyle = accent
  context.lineWidth = 3
  context.beginPath()
  context.roundRect(18, 16, 220, 64, 20)
  context.fill()
  context.stroke()

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
  const material = new THREE.SpriteMaterial({
    map: buildPlaneTexture(),
    transparent: true,
    depthTest: false,
    depthWrite: false
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(0.31, 0.31, 1)
  sprite.center.set(0.5, 0.5)
  sprite.visible = false
  sprite.renderOrder = 20
  return sprite
}

const createRouteMarker = (node, label, accentHex, accentCss) => {
  const group = new THREE.Group()
  const normal = latLonVector(node.lat, node.lon, 1).normalize()

  const pin = new THREE.Mesh(
    new THREE.SphereGeometry(0.034, 14, 14),
    new THREE.MeshBasicMaterial({ color: accentHex })
  )
  pin.position.copy(normal.clone().multiplyScalar(RADIUS + 0.035))
  group.add(pin)

  const tag = new THREE.Sprite(new THREE.SpriteMaterial({
    map: buildTagTexture(label, accentCss),
    transparent: true,
    depthTest: false,
    depthWrite: false
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
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  aircraft.material.rotation = angle - Math.PI / 2
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

  earthGroup.rotation.set(
    THREE.MathUtils.degToRad(midLat),
    THREE.MathUtils.degToRad(-(midLon + 90)),
    0
  )
  camera.position.z = THREE.MathUtils.clamp(5.05 + angularDistance * 1.05, 5.25, 7.4)
}

const enableInteractions = canvas => {
  const activePointers = new Map()
  let dragging = false
  let previousX = 0
  let previousY = 0
  let previousPinchDistance = null

  const setZoom = value => {
    if (!camera) return
    camera.position.z = THREE.MathUtils.clamp(value, MIN_CAMERA_Z, MAX_CAMERA_Z)
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
    } else if (!activePointers.size) {
      dragging = false
    }
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
  camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100)
  camera.position.set(0, 0.08, DEFAULT_CAMERA_Z)

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputEncoding = THREE.sRGBEncoding

  earthGroup = new THREE.Group()
  earthGroup.rotation.set(THREE.MathUtils.degToRad(22), THREE.MathUtils.degToRad(-105), 0)
  scene.add(earthGroup)

  earthTexture = buildEarthTexture()
  globe = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 72, 72),
    new THREE.MeshPhongMaterial({
      map: earthTexture,
      color: 0xffffff,
      emissive: 0x061018,
      emissiveIntensity: 0.2,
      shininess: 7
    })
  )
  earthGroup.add(globe)

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS + 0.035, 56, 56),
    new THREE.MeshBasicMaterial({
      color: 0x5cb5df,
      transparent: true,
      opacity: 0.055,
      side: THREE.BackSide
    })
  )
  earthGroup.add(atmosphere)

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

  if (!nodes || nodes.length < 2) return

  const points = []
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const start = nodes[index]
    const end = nodes[index + 1]
    const steps = 10
    for (let step = 0; step < steps; step += 1) points.push(greatCirclePoint(start, end, step / steps))
  }
  points.push(latLonVector(nodes[nodes.length - 1].lat, nodes[nodes.length - 1].lon, RADIUS + 0.026))

  routeLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x77ebbb, transparent: true, opacity: 0.88 })
  )
  routeLine.renderOrder = 3
  earthGroup.add(routeLine)

  const startLabel = labels.fromLabel || nodes[0].ident || 'DEP'
  const endLabel = labels.toLabel || nodes[nodes.length - 1].ident || 'ARR'
  const startMarker = createRouteMarker(nodes[0], startLabel, 0xffd65d, '#ffd65d')
  const endMarker = createRouteMarker(nodes[nodes.length - 1], endLabel, 0x83efc0, '#83efc0')
  routeMarkers.push(startMarker, endMarker)
  earthGroup.add(startMarker, endMarker)

  focusRoute(nodes)
}

export const updateAircraftPosition = (lat, lon, altitudeFt = 0, bearing = 0) => {
  if (!aircraft) return
  const visualAltitude = Math.min(0.11, Math.max(0.045, Number(altitudeFt || 0) / 360000))
  aircraft.position.copy(latLonVector(lat, lon, RADIUS + visualAltitude))
  aircraftState = {
    lat: Number(lat),
    lon: Number(lon),
    bearing: Number(bearing || 0),
    visualAltitude
  }
  aircraft.visible = true
}

export const destroyGlobe = () => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect?.()
  interactionCleanup?.()
  routeMarkers.forEach(disposeObject)
  disposeObject(routeLine)
  disposeObject(aircraft)
  earthTexture?.dispose?.()
  renderer?.dispose?.()
  scene = camera = renderer = earthGroup = globe = aircraft = routeLine = null
  routeMarkers = []
  aircraftState = null
  earthTexture = null
  interactionCleanup = null
}
