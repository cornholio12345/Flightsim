import axios from 'axios'

// City/Airport codes mapping
const AIRPORT_CODES = {
  'LON': 'EGLL', 'LHR': 'EGLL', 'LONDON': 'EGLL',
  'NYC': 'KJFK', 'JFK': 'KJFK', 'NEW YORK': 'KJFK',
  'PAR': 'LFPG', 'CDG': 'LFPG', 'PARIS': 'LFPG',
  'LAX': 'KLAX', 'LOS ANGELES': 'KLAX',
  'DXB': 'OMDB', 'DUBAI': 'OMDB',
  'SFO': 'KSFO', 'SAN FRANCISCO': 'KSFO',
  'HND': 'RJTT', 'TOKYO': 'RJTT',
  'SYD': 'YSSY', 'SYDNEY': 'YSSY'
}

// Airport coordinates
const AIRPORT_COORDS = {
  'EGLL': { lat: 51.4700, lon: -0.4543, code: 'LHR' },
  'KJFK': { lat: 40.6413, lon: -73.7781, code: 'JFK' },
  'LFPG': { lat: 49.0097, lon: 2.5479, code: 'CDG' },
  'KLAX': { lat: 33.9425, lon: -118.4081, code: 'LAX' },
  'OMDB': { lat: 25.2528, lon: 55.3644, code: 'DXB' },
  'KSFO': { lat: 37.6213, lon: -122.3790, code: 'SFO' },
  'RJTT': { lat: 35.5494, lon: 139.7798, code: 'HND' },
  'YSSY': { lat: -33.9461, lon: 151.1772, code: 'SYD' }
}

// Mock flight database
const MOCK_FLIGHTS = {
  'LON_NYC': [
    { id: 1, number: 'BA112', airline: 'British Airways', departure: '10:30', arrival: '13:45', from: 'London', to: 'New York' },
    { id: 2, number: 'VS003', airline: 'Virgin Atlantic', departure: '14:00', arrival: '17:15', from: 'London', to: 'New York' },
    { id: 3, number: 'AA109', airline: 'American Airlines', departure: '16:30', arrival: '19:45', from: 'London', to: 'New York' }
  ],
  'NYC_LON': [
    { id: 4, number: 'BA111', airline: 'British Airways', departure: '11:00', arrival: '23:00', from: 'New York', to: 'London' },
    { id: 5, number: 'VS002', airline: 'Virgin Atlantic', departure: '14:30', arrival: '02:30', from: 'New York', to: 'London' }
  ],
  'PAR_DXB': [
    { id: 6, number: 'EK71', airline: 'Emirates', departure: '09:00', arrival: '15:30', from: 'Paris', to: 'Dubai' },
    { id: 7, number: 'AF241', airline: 'Air France', departure: '11:30', arrival: '18:00', from: 'Paris', to: 'Dubai' }
  ],
  'LAX_SFO': [
    { id: 8, number: 'UA256', airline: 'United', departure: '08:00', arrival: '09:30', from: 'Los Angeles', to: 'San Francisco' },
    { id: 9, number: 'AA381', airline: 'American Airlines', departure: '12:00', arrival: '13:30', from: 'Los Angeles', to: 'San Francisco' }
  ]
}

export const searchFlightsAPI = async (departure, arrival) => {
  return new Promise((resolve) => {
    // Simulate API delay
    setTimeout(() => {
      const depCode = AIRPORT_CODES[departure.toUpperCase()] || 'EGLL'
      const arrCode = AIRPORT_CODES[arrival.toUpperCase()] || 'KJFK'
      const key = `${depCode.split('').slice(1).join('')}_${arrCode.split('').slice(1).join('')}`
      
      const depCoords = AIRPORT_COORDS[depCode]
      const arrCoords = AIRPORT_COORDS[arrCode]
      
      // Get mock flights or generate random ones
      let flights = MOCK_FLIGHTS[key] || []
      
      if (flights.length === 0) {
        flights = [
          { 
            id: Math.random(), 
            number: `XX${Math.floor(Math.random() * 9000 + 100)}`, 
            airline: 'Sample Airline',
            departure: '10:00',
            arrival: '14:30',
            from: departure,
            to: arrival
          }
        ]
      }
      
      // Add coordinates to flights
      const enrichedFlights = flights.map(flight => ({
        ...flight,
        from: departure,
        to: arrival,
        departure_coords: depCoords,
        arrival_coords: arrCoords,
        distance: calculateGreatCircleDistance(
          depCoords.lat, depCoords.lon,
          arrCoords.lat, arrCoords.lon
        )
      }))
      
      resolve(enrichedFlights)
    }, 1000)
  })
}

// Scrape flight data (placeholder for actual scraping)
export const scrapeFlightRadar24 = async (departure, arrival) => {
  // This would integrate with FlightRadar24 API
  console.log('Scraping FlightRadar24:', departure, arrival)
  // Requires server-side proxy due to CORS
  return []
}

// Scrape Skyscanner data (placeholder for actual scraping)
export const scrapeSkyscanner = async (departure, arrival) => {
  // This would integrate with Skyscanner API
  console.log('Scraping Skyscanner:', departure, arrival)
  // Requires server-side proxy due to CORS
  return []
}

const calculateGreatCircleDistance = (lat1, lon1, lat2, lon2) => {
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
