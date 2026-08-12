import * as THREE from 'three'

const RADIUS = 2
const ROUTE_RADIUS = 2.036
const AHEAD_CAMERA_Z = 3.55
const AHEAD_BASE_FOV = 30
const AHEAD_MIN_FOV = 6
const AHEAD_MAX_FOV = 30
const AHEAD_WIDE_AIRCRAFT_NDC_Y = -1.02
const AHEAD_TARGET_NORMAL = new THREE.Vector3(0, 0.19218855364791623, 1).normalize()
const TEST_WIDTH = 1080
const TEST_HEIGHT = 1920
const EPSILON = 1e-5

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
  const targetForward = new THREE.Vector3(0, targetNormal.z, -targetNormal.y).normalize()
  const targetRight = targetForward.clone().cross(targetNormal).normalize()

  const localBasis = new THREE.Matrix4().makeBasis(right, forward, normal)
  const targetBasis = new THREE.Matrix4().makeBasis(targetRight, targetForward, targetNormal)
  const localQuaternion = new THREE.Quaternion().setFromRotationMatrix(localBasis)
  const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(targetBasis)
  return {
    quaternion: targetQuaternion.multiply(localQuaternion.invert()),
    targetForward
  }
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

const applyAheadProjection = (camera, aircraftWorld, focusWorld, fov) => {
  camera.clearViewOffset()
  camera.fov = fov
  camera.updateProjectionMatrix()
  const aircraftCentered = aircraftWorld.clone().project(camera)
  const focusCentered = focusWorld.clone().project(camera)

  const wideOffsetX = 0
  const wideOffsetY = (AHEAD_WIDE_AIRCRAFT_NDC_Y - aircraftCentered.y) * TEST_HEIGHT / 2
  const focusOffsetX = focusCentered.x * TEST_WIDTH / 2
  const focusOffsetY = -focusCentered.y * TEST_HEIGHT / 2
  const zoomProgress = THREE.MathUtils.clamp(
    (AHEAD_MAX_FOV - fov) / (AHEAD_MAX_FOV - AHEAD_MIN_FOV),
    0,
    1
  )
  const focusBlend = zoomProgress * zoomProgress * (3 - 2 * zoomProgress)
  camera.setViewOffset(
    TEST_WIDTH,
    TEST_HEIGHT,
    THREE.MathUtils.lerp(wideOffsetX, focusOffsetX, focusBlend),
    THREE.MathUtils.lerp(wideOffsetY, focusOffsetY, focusBlend),
    TEST_WIDTH,
    TEST_HEIGHT
  )
  camera.updateProjectionMatrix()
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

// Late HRG -> PAD regression geometry from the mobile report.
const state = { lat: 49.5, lon: 11.8, bearing: 290 }
const { quaternion: earthQuaternion, targetForward } = buildAheadQuaternion(state)
const pointAt = (angularDistance, radius = ROUTE_RADIUS) => {
  const coord = destinationPoint(state.lat, state.lon, state.bearing, angularDistance)
  return latLonVector(coord.lat, coord.lon, radius).applyQuaternion(earthQuaternion)
}

const aircraftWorld = pointAt(0)
const focusWorld = pointAt(THREE.MathUtils.degToRad(5))
assert(targetForward.z < -0.15, 'Ahead route-forward does not recede away from the camera')
assert(aircraftWorld.distanceTo(AHEAD_TARGET_NORMAL.clone().multiplyScalar(ROUTE_RADIUS)) < EPSILON, 'Aircraft is not at the deterministic Ahead origin')

// Earth horizon in the forward vertical plane.
const targetAlpha = Math.atan2(AHEAD_TARGET_NORMAL.y, AHEAD_TARGET_NORMAL.z)
const earthHorizonAlpha = Math.acos(RADIUS / AHEAD_CAMERA_Z)
const horizonDelta = earthHorizonAlpha - targetAlpha
const horizonWorld = AHEAD_TARGET_NORMAL.clone().multiplyScalar(Math.cos(horizonDelta) * RADIUS)
  .add(targetForward.clone().multiplyScalar(Math.sin(horizonDelta) * RADIUS))

const wideCamera = makeCamera(AHEAD_MAX_FOV)
applyAheadProjection(wideCamera, aircraftWorld, focusWorld, AHEAD_MAX_FOV)
const wideAircraft = aircraftWorld.clone().project(wideCamera)
const wideHorizon = horizonWorld.clone().project(wideCamera)
const horizonFromTop = (1 - wideHorizon.y) / 2
const nearWorld = pointAt(THREE.MathUtils.degToRad(3))
const farWorld = pointAt(THREE.MathUtils.degToRad(15))
const wideNear = nearWorld.clone().project(wideCamera)
const wideFar = farWorld.clone().project(wideCamera)

assert(Math.abs(wideAircraft.y - AHEAD_WIDE_AIRCRAFT_NDC_Y) < EPSILON, 'Wide Ahead origin moved away from the lower edge')
assert(Math.abs(horizonFromTop - 0.20) < 0.015, `Wide horizon is not near 20% from top (${horizonFromTop.toFixed(3)})`)
assert(wideNear.y > wideAircraft.y && wideFar.y > wideNear.y, 'Route ahead does not run forward/up through the wide view')
assert(wideCamera.position.distanceTo(farWorld) > wideCamera.position.distanceTo(nearWorld), 'Far route point is not deeper than near route point')

const zoomCamera = makeCamera(AHEAD_MIN_FOV)
applyAheadProjection(zoomCamera, aircraftWorld, focusWorld, AHEAD_MIN_FOV)
const zoomFocus = focusWorld.clone().project(zoomCamera)
const zoomAircraft = aircraftWorld.clone().project(zoomCamera)
const zoomHorizon = horizonWorld.clone().project(zoomCamera)
assert(Math.abs(zoomFocus.x) < EPSILON && Math.abs(zoomFocus.y) < EPSILON, 'Full zoom is not centered on the Ahead target')
assert(zoomAircraft.y < -1, 'Aircraft origin should be allowed to leave below frame while zooming')
assert(zoomHorizon.y > 1, 'Horizon should be allowed to leave above frame while zooming')

console.table([
  {
    view: 'wide',
    fov: `${AHEAD_MAX_FOV}°`,
    aircraftY: wideAircraft.y.toFixed(4),
    horizonTop: `${(horizonFromTop * 100).toFixed(1)}%`,
    focusY: focusWorld.clone().project(wideCamera).y.toFixed(4)
  },
  {
    view: 'zoom',
    fov: `${AHEAD_MIN_FOV}°`,
    aircraftY: zoomAircraft.y.toFixed(4),
    horizonY: zoomHorizon.y.toFixed(4),
    focusY: zoomFocus.y.toFixed(4)
  }
])
console.log('Ahead nose-camera geometry checks passed.')
