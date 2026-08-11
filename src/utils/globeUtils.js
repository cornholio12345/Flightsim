import * as THREE from 'three'

let scene, camera, renderer, globe, aircraft

export const initializeGlobe = (canvasId) => {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return null

  // Scene setup
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 10000)
  camera.position.z = 3

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setSize(canvas.clientWidth, canvas.clientHeight)
  renderer.setClearColor(0x000000)

  // Create Earth globe
  const geometry = new THREE.SphereGeometry(2, 64, 64)
  const texture = createEarthTexture()
  const material = new THREE.MeshPhongMaterial({ map: texture })
  globe = new THREE.Mesh(geometry, material)
  scene.add(globe)

  // Create aircraft marker
  const aircraftGeometry = new THREE.ConeGeometry(0.05, 0.2, 8)
  const aircraftMaterial = new THREE.MeshPhongMaterial({ color: 0xFF0000 })
  aircraft = new THREE.Mesh(aircraftGeometry, aircraftMaterial)
  scene.add(aircraft)

  // Lighting
  const light = new THREE.DirectionalLight(0xFFFFFF, 1)
  light.position.set(5, 3, 5)
  scene.add(light)

  const ambientLight = new THREE.AmbientLight(0x404040)
  scene.add(ambientLight)

  // Animation loop
  const animate = () => {
    requestAnimationFrame(animate)
    globe.rotation.y += 0.0005
    renderer.render(scene, camera)
  }
  animate()

  // Handle window resize
  window.addEventListener('resize', () => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height)
  })

  return { scene, camera, renderer, globe, aircraft }
}

export const updateAircraftPosition = (globeRenderer, lat, lon, altitude = 0) => {
  if (!aircraft) return

  // Convert lat/lon to 3D coordinates on sphere
  const radius = 2
  const phi = (90 - lat) * Math.PI / 180
  const theta = (lon + 180) * Math.PI / 180

  const x = -(radius + altitude / 100000) * Math.sin(phi) * Math.cos(theta)
  const y = (radius + altitude / 100000) * Math.cos(phi)
  const z = (radius + altitude / 100000) * Math.sin(phi) * Math.sin(theta)

  aircraft.position.set(x, y, z)
  aircraft.lookAt(0, 0, 0)
}

const createEarthTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024
  const ctx = canvas.getContext('2d')

  // Ocean color
  ctx.fillStyle = '#1a3a52'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Land color
  ctx.fillStyle = '#2d5016'
  
  // Simple land masses (very simplified)
  const landRegions = [
    { x: 200, y: 300, w: 300, h: 200 }, // North America
    { x: 600, y: 350, w: 200, h: 150 }, // Europe
    { x: 1000, y: 400, w: 250, h: 180 }, // Asia
    { x: 900, y: 600, w: 180, h: 120 }, // Australia
  ]

  landRegions.forEach(region => {
    ctx.fillRect(region.x, region.y, region.w, region.h)
  })

  return new THREE.CanvasTexture(canvas)
}
