import * as THREE from 'three'

const RADIUS = 2
const MIN_CAMERA_Z = 3.35
const MAX_CAMERA_Z = 8.5
let scene
let camera
let renderer
let earthGroup
let globe
let aircraft
let routeLine
let animationFrame
let resizeObserver
let interactionCleanup

const disposeObject = object => {
  if (!object) return
  object.traverse?.(child => {
    child.geometry?.dispose?.()
    if (Array.isArray(child.material)) child.material.forEach(material => material.dispose?.())
    else child.material?.dispose?.()
  })
  if (!object.traverse) {
    object.geometry?.dispose?.()
    if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.())
    else object.material?.dispose?.()
  }
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
  const dot = THREE.MathUtils.clamp(va.dot(vb), -1, 1)
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

const createAircraftMarker = () => {
  const group = new THREE.Group()
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f8fb, emissive: 0x22313d, roughness: 0.45, metalness: 0.08 })
  const accent = new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0x6f4d00, roughness: 0.4 })

  // Three.js r128 does not have CapsuleGeometry. A slim cylinder plus a cone
  // gives us a recognisable aircraft fuselage without requiring a newer Three build.
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.19, 10), white)
  fuselage.rotation.z = Math.PI / 2
  group.add(fuselage)

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.031, 0.075, 10), accent)
  nose.rotation.z = -Math.PI / 2
  nose.position.x = 0.13
  group.add(nose)

  const wingShape = new THREE.Shape()
  wingShape.moveTo(-0.055, 0)
  wingShape.lineTo(0.025, 0.135)
  wingShape.lineTo(0.055, 0.135)
  wingShape.lineTo(0.025, 0)
  wingShape.lineTo(0.055, -0.135)
  wingShape.lineTo(0.025, -0.135)
  wingShape.closePath()
  const wings = new THREE.Mesh(new THREE.ShapeGeometry(wingShape), white)
  wings.rotation.x = -Math.PI / 2
  wings.position.x = 0.005
  group.add(wings)

  const tailShape = new THREE.Shape()
  tailShape.moveTo(-0.09, 0)
  tailShape.lineTo(-0.045, 0.07)
  tailShape.lineTo(-0.025, 0.07)
  tailShape.lineTo(-0.045, 0)
  tailShape.lineTo(-0.025, -0.07)
  tailShape.lineTo(-0.045, -0.07)
  tailShape.closePath()
  const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), accent)
  tail.rotation.x = -Math.PI / 2
  group.add(tail)

  group.scale.setScalar(1.18)
  group.visible = false
  return group
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
      if (distance && previousPinchDistance && camera) {
        const ratio = previousPinchDistance / distance
        setZoom(camera.position.z * ratio)
      }
      previousPinchDistance = distance
      return
    }

    if (!dragging || !earthGroup) return
    const dx = event.clientX - previousX
    const dy = event.clientY - previousY
    previousX = event.clientX
    previousY = event.clientY
    earthGroup.rotation.y += dx * 0.006
    earthGroup.rotation.x = THREE.MathUtils.clamp(earthGroup.rotation.x + dy * 0.004, -1.15, 1.15)
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
    if (!camera) return
    setZoom(camera.position.z + event.deltaY * 0.0045)
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

  aircraft = createAircraftMarker()
  earthGroup.add(aircraft)

  scene.add(new THREE.AmbientLight(0x8ab7d8, 0.72))
  const light = new THREE.DirectionalLight(0xffffff, 1.15)
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
  interactionCleanup = enableInteractions(canvas)

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

export const updateAircraftPosition = (lat, lon, altitudeFt = 0, bearing = 0) => {
  if (!aircraft) return
  const visualAltitude = Math.min(0.14, Math.max(0.035, Number(altitudeFt || 0) / 300000))
  const position = latLonVector(lat, lon, RADIUS + visualAltitude)
  const up = position.clone().normalize()
  aircraft.position.copy(position)
  aircraft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up)
  aircraft.rotateOnWorldAxis(up, THREE.MathUtils.degToRad(-Number(bearing || 0)))
  aircraft.visible = true
}

export const destroyGlobe = () => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect?.()
  interactionCleanup?.()
  disposeObject(aircraft)
  renderer?.dispose?.()
  scene = camera = renderer = earthGroup = globe = aircraft = routeLine = null
  interactionCleanup = null
}
