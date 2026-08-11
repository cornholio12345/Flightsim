# 🌍 3D Flight Tracker - Offline Route Simulation

## Overview

A progressive web app for tracking flight routes on an interactive 3D globe. Search for flights online, fetch route data, store it locally, and simulate aircraft movement on a 3D globe during flight using offline data.

## Features

### Online Mode
- 🔍 **Flight Search**: Search for flights by departure and arrival cities
- 🌐 **Multi-Source**: Integration with FlightRadar24 and Skyscanner (backend proxy required)
- 📥 **Route Data Download**: Fetch and cache complete route data to device
- 🗺️ **Interactive 3D Globe**: Visualize routes on a rotating Earth

### Offline Mode (In-Flight)
- ✈️ **Route Simulation**: Simulate aircraft movement along cached routes
- 🎮 **Takeoff Button**: Start simulation when aircraft takes off
- 📊 **Flight Telemetry**: Display real-time position, altitude, speed
- 💾 **Local Storage**: Routes stored in IndexedDB for offline access
- 🔋 **PWA Ready**: Works as standalone app without internet

## How It Works

### Workflow
1. **At Home (Online)**:
   - Search for your flight (e.g., "London" → "New York")
   - Select your specific flight
   - Click "Load Route Data" to download waypoints and route info
   - Route is automatically saved to device storage

2. **At Airport (Online or Offline)**:
   - App loads your previously saved flights
   - No internet required

3. **In Flight (Offline)**:
   - When aircraft starts moving during takeoff
   - Press "Start Simulation" button
   - Watch 3D globe show your position in real-time
   - Monitor altitude, speed, and progress

## Technology Stack

- **Vue 3**: Modern reactive UI framework
- **Three.js**: 3D globe rendering
- **Pinia**: State management
- **IndexedDB/Dexie**: Offline data persistence
- **Service Workers**: PWA offline support
- **Vite**: Fast build and dev server

## Project Structure

```
src/
├── components/          # Vue components
├── stores/             # Pinia stores (flight, globe)
├── services/           # API services (flightAPI)
├── utils/              # Utilities
│   ├── globeUtils.js   # 3D globe rendering
│   └── routeUtils.js   # Route calculations
├── App.vue             # Main component
├── main.js             # Entry point
└── style.css           # Global styles
```

## Installation

```bash
npm install
npm run dev
```

## Build for Production

```bash
npm run build
npm run preview
```

## API Integration

### FlightRadar24 Integration
- Requires backend proxy due to CORS
- Endpoint: `/api/flightradar24/search`
- Returns real-time flight data

### Skyscanner Integration
- Requires API key and backend proxy
- Endpoint: `/api/skyscanner/search`
- Returns flight options with detailed routes

## Offline Data Format

Route data stored in IndexedDB:
```json
{
  "flightNumber": "BA112",
  "departure": "London",
  "arrival": "New York",
  "distance": 5570,
  "waypoints": [
    { "lat": 51.47, "lon": -0.45, "altitude": 0, "speed": 450 },
    { "lat": 51.50, "lon": -1.23, "altitude": 2000, "speed": 450 },
    ...
  ]
}
```

## Future Enhancements

- [ ] Real FlightRadar24 API integration
- [ ] Skyscanner route scraping
- [ ] Historical flight tracking
- [ ] Multi-flight tracking
- [ ] Weather overlay on globe
- [ ] Detailed flight information panels
- [ ] Audio alerts for milestones
- [ ] AR mode for viewing aircraft position

## Contributing

Pull requests are welcome! Please ensure offline functionality is maintained.

## License

MIT
