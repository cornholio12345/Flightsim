/**
 * Generate waypoints along a great circle route between two points
 */
export const generateRouteWaypoints = (startCoords, endCoords, numWaypoints = 50) => {
  const waypoints = []
  
  for (let i = 0; i <= numWaypoints; i++) {
    const f = i / numWaypoints
    const A = Math.sin((1 - f) * getAngularDistance(startCoords, endCoords)) / Math.sin(getAngularDistance(startCoords, endCoords))
    const B = Math.sin(f * getAngularDistance(startCoords, endCoords)) / Math.sin(getAngularDistance(startCoords, endCoords))
    
    const x = A * Math.cos(startCoords.lat * Math.PI / 180) * Math.cos(startCoords.lon * Math.PI / 180) + B * Math.cos(endCoords.lat * Math.PI / 180) * Math.cos(endCoords.lon * Math.PI / 180)
    const y = A * Math.cos(startCoords.lat * Math.PI / 180) * Math.sin(startCoords.lon * Math.PI / 180) + B * Math.cos(endCoords.lat * Math.PI / 180) * Math.sin(endCoords.lon * Math.PI / 180)
    const z = A * Math.sin(startCoords.lat * Math.PI / 180) + B * Math.sin(endCoords.lat * Math.PI / 180)
    
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI
    const lon = Math.atan2(y, x) * 180 / Math.PI
    
    waypoints.push({ lat, lon })
  }
  
  return waypoints
}

const getAngularDistance = (coord1, coord2) => {
  const lat1 = coord1.lat * Math.PI / 180
  const lat2 = coord2.lat * Math.PI / 180
  const dLon = (coord2.lon - coord1.lon) * Math.PI / 180
  
  return Math.acos(
    Math.sin(lat1) * Math.sin(lat2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon)
  )
}

export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371 // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c)
}

export const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const dLon = lon2 - lon1
  const y = Math.sin(dLon * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon * Math.PI / 180)
  return Math.atan2(y, x) * 180 / Math.PI
}
