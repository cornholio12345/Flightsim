import * as THREE from 'three'

const RADIUS = 2
let scene
let camera
let renderer
let earthGroup
let globe
let aircraft
let routeLine
let animationFrame
let resizeObserver

const disposeObject = object => {
  if (!object) return
  object.geometry?.dispose?.()
  if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.())
  else object.material?.dispose?.()
}

const latLonVector = (lat, lon, radius = RADIUS) => {
  const phi = (90 - lat) * Math.PI / 180
  const theta = (lon + 180) * Math.PI / 180
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  )
}

const greatCirclePoint = (a, b, t) => {
  const va = latLonVector(a.lat, a.lon, 1).normalize()
  const vb = latLonVector(b.lat, b.lon, 1).normalize()
  let dot = THREE.MathUtils.clamp(va.dot(vb), -1, 1)
  const omega = Math.acos(dot)
  if (omega < 1e-6) return va.multiplyScalar(RADIUS + 0.025)
  const sinOmega = Math.sin(omega)
  return va.multiplyScalar(Math.sin((1 - t) * omega) / sinOmega)
    .add(vb.multiplyScalar(Math.sin(t * omega) / sinOmega))
    .normalize()
    .multiplyScalar(RADIUS + 0.025)
}

const addGraticule = () => {
  const material = new THREE.LineBasicMaterial({ color: 0x4e7fa3, transparent: true, opacity: 0.28 })
  for (let lat = -60; lat <= 60; lat += 30) {
    const points = []
    for (let lon = -180; lon <= 180; lon += 4) points.push(latLonVector(lat, lon, RADIUS + 0.006))
    earthGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material))
  }
  for (let lon = -150; lon <= 180; lon += 30) {
    const points = []
    for (let lat = -88; lat <= 88; lat += 4) points.push(latLonVector(lat, lon, RADIUS + 0.006))
    earthGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material))
  }
}

const enableDragRotation = canvas => {
  let dragging = false
  let previousX = 0
  let previousY = 0
  canvas.style.touchAction = 'none'

  canvas.addEventListener('pointerdown', event => {
    dragging = true
    previousX = event.clientX
    previousY = event.clientY
    canvas.setPointerCapture?.(event.pointerId)
  })
  canvas.addEventListener('pointermove', event => {
    if (!dragging || !earthGroup) return
    const dx = event.clientX - previousX
    const dy = event.clientY - previousY
    previousX = event.clientX
    previousY = event.clientY
    earthGroup.rotation.y += dx * 0.006
    earthGroup.rotation.x = THREE.MathUtils.clamp(earthGroup.rotation.x + dy * 0.004, -1.15, 1.15)
  })
  const stop = () => { dragging = false }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)
}

export const initializeGlobe = canvasId => {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return null

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x06111f)
  camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100)
  camera.position.set(0, 0.15, 5.4)

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  earthGroup = new THREE.Group()
  scene.add(earthGroup)

  globe = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 64, 64),
    new THREE.MeshPhongMaterial({ color: 0x123f62, emissive: 0x061420, shininess: 18 })
  )
  earthGroup.add(globe)
  addGraticule()

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS + 0.035, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x4ca7e8, transparent: true, opacity: 0.08, side: THREE.BackSide })
  )
  earthGroup.add(atmosphere)

  aircraft = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0x7a4a00 })
  )
  aircraft.visible = false
  earthGroup.add(aircraft)

  scene.add(new THREE.AmbientLight(0x8ab7d8, 0.65))
  const light = new THREE.DirectionalLight(0xffffff, 1.1)
  light.position.set(5, 3, 5)
  scene.add(light)

  const resize = () => {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  enableDragRotation(canvas)

  const animate = () => {
    animationFrame = requestAnimationFrame(animate)
    renderer.render(scene, camera)
  }
  animate()

  return { scene, camera, renderer, earthGroup }
}

export const setRouteOnGlobe = nodes => {
  if (!earthGroup) return
  if (routeLine) {
    earthGroup.remove(routeLine)
    disposeObject(routeLine)
    routeLine = null
  }
  if (!nodes || nodes.length < 2) return

  const points = []
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const start = nodes[index]
    const end = nodes[index + 1]
    const steps = 8
    for (let step = 0; step < steps; step += 1) points.push(greatCirclePoint(start, end, step / steps))
  }
  points.push(latLonVector(nodes[nodes.length - 1].lat, nodes[nodes.length - 1].lon, RADIUS + 0.025))

  routeLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x62e6a8, transparent: true, opacity: 0.95 })
  )
  earthGroup.add(routeLine)
}

export const updateAircraftPosition = (lat, lon, altitudeFt = 0) => {
  if (!aircraft) return
  const visualAltitude = Math.min(0.14, Math.max(0.035, Number(altitudeFt || 0) / 300000))
  const position = latLonVector(lat, lon, RADIUS + visualAltitude)
  aircraft.position.copy(position)
  aircraft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), position.clone().normalize())
  aircraft.visible = true
}

export const destroyGlobe = () => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect?.()
  renderer?.dispose?.()
  scene = camera = renderer = earthGroup = globe = aircraft = routeLine = null
}
