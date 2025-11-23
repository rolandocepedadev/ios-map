# ACEIOS (Information Operations Simulation Map)

A Next.js-based web application for monitoring and managing information operations across geographic regions using interactive maps powered by OpenLayers and MapTiler.

## Features

- **Real-time WebSocket Updates**: Server-driven position updates for true tactical situational awareness
- **Interactive Vector Maps**: High-performance mapping using OpenLayers with MapTiler vector tiles
- **MIL-STD-2525 Symbols**: 1000+ dynamic military units with standardized symbology
- **Live Movement Tracking**: Server-calculated positions broadcast to all connected clients
- **Multi-Client Synchronization**: All operators see identical real-time tactical picture
- **Force Classification**: Live monitoring of tanks, aircraft, and force status indicators
- **ACEIOS Branding**: Custom logo integration with Inter Tight interface typography
- **Vercel Dark Theme**: Elegant dark interface matching Vercel's design system
- **Production Ready**: WebSocket-first with polling fallback for reliability

## Tech Stack

- **Frontend**: Next.js 16 with App Router
- **Real-time Communication**: WebSocket with automatic fallback to polling
- **Mapping**: OpenLayers 10.7.0 with ol-mapbox-style for vector tiles
- **Military Symbology**: Custom MIL-STD-2525 implementation
- **Backend**: Node.js WebSocket server for position updates
- **Typography**: Inter Tight interface font with ACEIOS logo branding
- **Styling**: Tailwind CSS 4 with Vercel-inspired dark theme
- **Language**: TypeScript (Frontend & Backend)
- **Package Manager**: pnpm

## Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm (recommended) or npm

### Quick Start

1. **Start the WebSocket server** (for real-time updates):
```bash
cd websocket-server
npm install
npm start
```
Server runs on `ws://localhost:8080/military-features`

2. **Start the frontend** (in a new terminal):
```bash
cd ios-map
pnpm install
pnpm dev
```

3. **Open the application**:
Open [http://localhost:3000](http://localhost:3000) in your browser

4. **Verify connection**: Check sidebar shows "WEBSOCKET Connected" status

### Build for Production

```bash
pnpm build
pnpm start
```

## Project Structure

```
ios-map/
├── app/
│   ├── components/
│   │   ├── Map.tsx              # OpenLayers map component
│   │   └── MapContainer.tsx     # Main map container with features
│   ├── services/
│   │   └── militaryFeatures.ts  # Military unit API service
│   ├── utils/
│   │   └── milStd2525.ts        # MIL-STD-2525 symbol utilities
│   ├── globals.css              # Global styles with Inter Tight typography
│   ├── layout.tsx               # Root layout with font configuration
│   └── page.tsx                 # Home page with sidebar
├── public/
│   ├── aceios.png               # ACEIOS logo image
│   └── ...                      # Other static assets
├── package.json
└── README.md
```

## Map Configuration

The application uses MapTiler vector tiles with the following configuration:
- **Vector Style**: `https://api.maptiler.com/maps/019aa851-7005-7219-9be8-65f5e65ce6b4/style.json`
- **Implementation**: OpenLayers with ol-mapbox-style for Mapbox GL JS compatibility
- **Default Center**: USA Continental Center (-98.5795, 39.8283)
- **Default Zoom**: Level 10 (focused on San Antonio)
- **Theme**: Vercel-inspired dark theme with refined black/zinc color palette

## Military Features

The application provides a real-time tactical operations center with server-driven military unit tracking:

### **Real-time Architecture**
- **WebSocket Primary**: Server calculates and broadcasts all position updates
- **Multi-client Sync**: All connected operators see identical tactical picture
- **Server Authority**: Single source of truth for unit positions and status
- **Auto Fallback**: Switches to local polling if WebSocket unavailable
- **2-second Updates**: High-frequency position broadcasts for responsive tracking

### **Unit Types & Classification**
- **Ground Forces (60%)**: Armored vehicles and tanks
- **Air Assets (40%)**: Fixed-wing aircraft  
- **Force Status**: Friendly (green), Hostile (red), Neutral (yellow), Unknown (cyan)
- **MIL-STD-2525**: NATO compliant symbology with proper frame shapes
- **Dynamic Indicators**: Symbols rotate based on server-calculated headings

### **Production Features**
- **1000+ Concurrent Units**: Server handles large-scale simulations
- **Multi-client Broadcasting**: Supports multiple simultaneous operators
- **Connection Monitoring**: Live status indicators and reconnection handling
- **Performance Optimized**: Sub-3ms processing time for position updates
- **Graceful Degradation**: Automatic fallback ensures continuous operation
- **Professional Branding**: ACEIOS logo with Inter Tight interface typography and custom military styling classes

## Development

### **Available Scripts**

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

### **WebSocket Server (Required for Real-time)**

The WebSocket server provides server-driven real-time updates:

**Start the server:**
```bash
cd websocket-server
npm install
npm start
```

**Test the connection:**
```bash
# In a separate terminal, test WebSocket functionality
npm test
```

**Expected output:**
```
🧪 Testing WebSocket connection to IOS-MAP server...
✅ WebSocket connection established
📦 Received 1000 initial military features
🔄 Update #1 received (2.1s) - 1000 units
🎉 Test completed successfully!
```

**Server features:**
- Runs on `ws://localhost:8080/military-features`
- Health check endpoint: `http://localhost:8080/health`
- Handles 1000+ units with 2-second update intervals
- Multi-client broadcasting with connection keep-alive
- Graceful shutdown with client notification
- ES modules for modern Node.js deployment

**Troubleshooting:**
If you see `WebSocket.Server is not a constructor`, ensure you're using Node.js 14+ and the server uses ES modules with `"type": "module"` in package.json.

### Adding New Features

1. Create new components in `app/components/`
2. Add new pages in the `app/` directory following Next.js App Router conventions
3. Modify the map configuration in `app/components/MapContainer.tsx`
4. Extend military features in `app/services/militaryFeatures.ts`
5. Add new symbol types in `app/utils/milStd2525.ts`

### Military Feature Development

#### Adding New Unit Types
```typescript
// In militaryFeatures.ts
export interface MilitaryFeature {
  type: 'tank' | 'aircraft' | 'naval' | 'infantry'; // Add new types
  // ... other properties
}
```

#### Custom Symbol Creation
```typescript
// In milStd2525.ts
export const SYMBOL_PATHS = {
  tank: { /* tank paths */ },
  aircraft: { /* aircraft paths */ },
  naval: { /* add naval paths */ },
  // Add custom SVG paths for new unit types
}
```

#### Real API Integration
Replace the mock service with your military data API:
```typescript
// Update fetchFeatures() in militaryFeatures.ts
async fetchFeatures(): Promise<MilitaryFeatureResponse> {
  const response = await fetch('/api/military-units');
  return response.json();
}
```

### Connection Architecture

The application uses a WebSocket-first architecture with intelligent fallback:

#### **ES Modules & Modern JavaScript**
- **WebSocket Server**: Uses ES modules (`import/export`) for modern Node.js compatibility
- **Type Safety**: Full TypeScript integration for both frontend and backend
- **Node.js 14+**: Requires modern Node.js version for ES module support

#### **WebSocket Mode (Primary)**
- **Server Authority**: All positions calculated and broadcast by server
- **Real-time Sync**: 2-second update intervals for responsive tracking
- **Multi-client Support**: All operators see identical tactical picture
- **Connection Resilience**: Automatic reconnection with exponential backoff
- **Performance Monitoring**: Sub-millisecond processing with performance logging

#### **Polling Mode (Fallback)**
- **Local Calculation**: Client-side position updates when WebSocket unavailable
- **3-second Updates**: Reduced frequency for fallback mode
- **No Dependencies**: Operates without external server
- **Seamless Transition**: Automatic switch when WebSocket fails

#### **Production WebSocket Server**

The included server provides enterprise-grade real-time capabilities:

**Advanced Features:**
- Multi-client broadcasting with connection keep-alive (ping/pong)
- Robust error handling and graceful shutdown procedures
- Performance monitoring with processing time metrics
- CORS support for cross-origin web client connections
- Health check endpoint for monitoring and load balancing

**Message Protocol:**
- `initial_features` - Complete unit dataset on connection
- `features_update` - Bulk position updates (all 1000+ units)
- `unit_update` - Individual unit modifications
- `heartbeat` - Connection health monitoring
- `server_shutdown` - Graceful disconnection notification

**Monitoring & Operations:**
```bash
# Health check
curl http://localhost:8080/health

# Test WebSocket connection
npm test

# Server logs show real-time performance
📡 Updated 1000 units (600 tanks, 400 aircraft) → 3 clients (2.1ms)
```

**Development Commands:**
```bash
# Start server in development mode (auto-restart)
npm run dev

# Test WebSocket connectivity and data flow
npm test
```

## License

Private project - All rights reserved.