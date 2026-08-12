import * as THREE from 'three'

const ROUTE_RADIUS = 2.036
const AHEAD_CAMERA_Z = 3.55
const AHEAD_AIRCRAFT_NDC_Y = -1.02
const AHEAD_TARGET_NORMAL = new THREE.Vector3(0, -0.24, 1).normalize()
const TEST_WIDTH = 1080
const TEST_HEIGHT = 1920
const EPSILON = 1e-6

const latLonVector = (lat, lon, radius = 1) => {
  const phi = (90 - Number(lat)) * Math.PI / 180
  const theta = (Number(lon) + 180) * Math.PI / 180
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  )
}

const destinationPoint = (lat, lon, bearing, angularDistanceValue) => {
  const phi1 = THREE.MathUtils.degToRad(Number(lat))
  const lambda1 = THREE.MathUtils.degToRad(Number(lon))
  const theta = THREE.MathUtils.degToRad(Number(bearing))
  const phi2 = Math.asin(THREE.MathUtils.clamp(
    Math.sin(phi1) * Math.cos(angularDistanceValue) + Math.cos(phi1) * Math.sin(angularDistanceValue) * Math.cos(theta),
    -1,
    1
  ))
  const y = Math.sin(theta) * Math.sin(angularDistanceValue) * Math.cos(phi1)
  const x = Math.cos(angularDistanceValue) - Math.sin(phi1) * Math.sin(phi2)
  const lambda2 = lambda1 + Math.atan2(y, x)
  return { lat: THREE.MathUtils.radToDeg(phi2), lon: THREE.MathUtils.radToDeg(lambda2) }
}

const buildAheadQuaternion = ({ lat, lon, bearing }) => {
  const normal = latLonVector(lat, lon, 1).normalize()
  const ahead = destinationPoint(lat, lon, bearing, 0.05)
  const aheadNormal = latLonVector(ahead.lat, ahead.lon, 1).normalize()
  const forward = aheadNormal.clone().addScaledVector(normal, -aheadNormal.dot(normal)).normalize()
  const right = forward.clone().cross(normal).normalize()

  const targetNormal = AHEAD_TARGET_NORMAL.clone()
  const screenUp = new THREE.Vector3(0, 1, 0)
  const targetForward = screenUp.addScaledVector(targetNormal, -screenUp.dot(targetNormal)).normalize()
  const targetRight = targetForward.clone().cross(targetNormal).normalize()

  const localBasis = new THREE.Matrix4().makeBasis(right, forward, normal)
  const targetBasis = new THREE.Matrix4().makeBasis(targetRight, targetForward, targetNormal)
  const localQuaternion = new THREE.Quaternion().setFromRotationMatrix(localBasis)
  const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(targetBasis)
  return targetQuaternion.multiply(localQuaternion.invert())
}

const makeCamera = fov => {
  const camera = new THREE.PerspectiveCamera(fov, TEST_WIDTH / TEST_HEIGHT, 0.05, 100)
  camera.position.set(0, 0, AHEAD_CAMERA_Z)
  camera.up.set(0, 1, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return camera
}

const anchorAircraft = (camera, aircraftWorld) => {
  camera.clearViewOffset()
  camera.updateProjectionMatrix()
  const centeredY = aircraftWorld.clone().project(camera).y
  const offsetY = (AHEAD_AIRCRAFT_NDC_Y - centeredY) * TEST_HEIGHT / 2
  camera.setViewOffset(TEST_WIDTH, TEST_HEIGHT, 0, offsetY, TEST_WIDTH, TEST_HEIGHT)
  camera.updateProjectionMatrix()
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

// Late HRG -> PAD regression geometry from the mobile failure report.
// The 290° local route direction is intentional: it exercises the reported
// route tangent rather than assuming a straight airport-to-airport bearing.
const state = { lat: 49.5, lon: 11.8, bearing: 290 }
const earthQuaternion = buildAheadQuaternion(state)
const pointAt = angularDistance => {
  const coord = destinationPoint(state.lat, state.lon, state.bearing, angularDistance)
  return latLonVector(coord.lat, coord.lon, ROUTE_RADIUS).applyQuaternion(earthQuaternion)
}

const aircraftWorld = pointAt(0)
const expectedAircraftWorld = AHEAD_TARGET_NORMAL.clone().multiplyScalar(ROUTE_RADIUS)
assert(aircraftWorld.distanceTo(expectedAircraftWorld) < EPSILON, 'Aircraft world point is not the fixed Ahead anchor')

const fovs = [40, 24, 12, 6]
const rows = []
for (const fov of fovs) {
  const camera = makeCamera(fov)
  anchorAircraft(camera, aircraftWorld)

  const aircraftY = aircraftWorld.clone().project(camera).y
  const nearY = pointAt(0.005).project(camera).y
  const midY = pointAt(0.015).project(camera).y
  const farY = pointAt(0.03).project(camera).y

  assert(Math.abs(aircraftY - AHEAD_AIRCRAFT_NDC_Y) < EPSILON, `Aircraft NDC anchor moved at FOV ${fov}`)
  assert(nearY > aircraftY, `Near route point is not ahead/up at FOV ${fov}`)
  assert(midY > nearY, `Mid route point is not above the near point at FOV ${fov}`)
  assert(farY > midY, `Far route point is not above the mid point at FOV ${fov}`)

  rows.push({ fov, aircraftY, nearY, midY, farY })
}

console.table(rows.map(row => ({
  FOV: `${row.fov}°`,
  aircraft: row.aircraftY.toFixed(4),
  near: row.nearY.toFixed(4),
  mid: row.midY.toFixed(4),
  far: row.farY.toFixed(4)
})))
console.log('Ahead geometry checks passed.')
