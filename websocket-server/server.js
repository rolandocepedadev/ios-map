import WebSocket, { WebSocketServer } from "ws";
import http from "http";

// Create HTTP server with CORS support
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "healthy",
        clients: clients.size,
        features: militaryFeatures.length,
        uptime: process.uptime(),
      }),
    );
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocketServer({
  server,
  path: "/military-features",
  perMessageDeflate: false,
});

// Military feature data store
let militaryFeatures = [];
let clients = new Set();

// San Antonio bounding box
const SAN_ANTONIO_BOUNDS = {
  north: 29.7,
  south: 29.1,
  east: -98.2,
  west: -98.8,
};

// Generate realistic military callsigns
const generateCallSign = (type, index) => {
  const prefixes = {
    tank: ["STEEL", "IRON", "TITAN", "WOLF", "SABER", "KNIGHT", "STORM"],
    aircraft: ["EAGLE", "HAWK", "VIPER", "FALCON", "GHOST", "RAVEN", "THUNDER"],
  };

  const prefix = prefixes[type][index % prefixes[type].length];
  const number = Math.floor(index / prefixes[type].length) + 1;
  return `${prefix}-${number.toString().padStart(2, "0")}`;
};

// Generate random position within San Antonio bounds
const generateRandomPosition = () => {
  const lng =
    SAN_ANTONIO_BOUNDS.west +
    Math.random() * (SAN_ANTONIO_BOUNDS.east - SAN_ANTONIO_BOUNDS.west);
  const lat =
    SAN_ANTONIO_BOUNDS.south +
    Math.random() * (SAN_ANTONIO_BOUNDS.north - SAN_ANTONIO_BOUNDS.south);
  return [lng, lat];
};

// Initialize military features
const initializeMilitaryFeatures = (count = 1000) => {
  militaryFeatures = [];

  const tankCount = Math.floor(count * 0.6);
  const aircraftCount = count - tankCount;

  // Generate tanks
  for (let i = 0; i < tankCount; i++) {
    militaryFeatures.push({
      id: `tank-${i + 1}`,
      type: "tank",
      position: generateRandomPosition(),
      heading: Math.random() * 360,
      speed: 20 + Math.random() * 40,
      status: ["friendly", "hostile", "neutral", "unknown"][
        Math.floor(Math.random() * 4)
      ],
      callSign: generateCallSign("tank", i),
      lastUpdate: Date.now(),
    });
  }

  // Generate aircraft
  for (let i = 0; i < aircraftCount; i++) {
    militaryFeatures.push({
      id: `aircraft-${i + 1}`,
      type: "aircraft",
      position: generateRandomPosition(),
      heading: Math.random() * 360,
      speed: 200 + Math.random() * 400,
      status: ["friendly", "hostile", "neutral", "unknown"][
        Math.floor(Math.random() * 4)
      ],
      callSign: generateCallSign("aircraft", i),
      lastUpdate: Date.now(),
    });
  }

  console.log(`🎖️ Initialized ${militaryFeatures.length} military features`);
};

// Calculate new position based on heading and speed
const calculateNewPosition = (
  currentPos,
  heading,
  speed,
  timeIntervalSeconds,
) => {
  const speedDegPerSec = (speed / 3600) * (1 / 111);
  const distance = speedDegPerSec * timeIntervalSeconds;

  const headingRad = (heading - 90) * (Math.PI / 180);
  const deltaLng = distance * Math.cos(headingRad);
  const deltaLat = distance * Math.sin(headingRad);

  let newLng = currentPos[0] + deltaLng;
  let newLat = currentPos[1] + deltaLat;

  // Bounce off boundaries
  if (newLng < SAN_ANTONIO_BOUNDS.west || newLng > SAN_ANTONIO_BOUNDS.east) {
    newLng = Math.max(
      SAN_ANTONIO_BOUNDS.west,
      Math.min(SAN_ANTONIO_BOUNDS.east, newLng),
    );
  }
  if (newLat < SAN_ANTONIO_BOUNDS.south || newLat > SAN_ANTONIO_BOUNDS.north) {
    newLat = Math.max(
      SAN_ANTONIO_BOUNDS.south,
      Math.min(SAN_ANTONIO_BOUNDS.north, newLat),
    );
  }

  return [newLng, newLat];
};

// Update military feature positions
const updateFeaturePositions = () => {
  const now = Date.now();

  militaryFeatures = militaryFeatures.map((feature) => {
    const timeDiff = (now - feature.lastUpdate) / 1000;

    const newPosition = calculateNewPosition(
      feature.position,
      feature.heading,
      feature.speed,
      timeDiff,
    );

    let newHeading = feature.heading;
    if (Math.random() < 0.1) {
      newHeading = (feature.heading + (Math.random() - 0.5) * 60) % 360;
      if (newHeading < 0) newHeading += 360;
    }

    let newSpeed = feature.speed;
    if (Math.random() < 0.05) {
      const speedVariation = feature.type === "tank" ? 10 : 50;
      const minSpeed = feature.type === "tank" ? 10 : 150;
      const maxSpeed = feature.type === "tank" ? 70 : 650;

      newSpeed = Math.max(
        minSpeed,
        Math.min(
          maxSpeed,
          feature.speed + (Math.random() - 0.5) * speedVariation,
        ),
      );
    }

    return {
      ...feature,
      position: newPosition,
      heading: newHeading,
      speed: newSpeed,
      lastUpdate: now,
    };
  });
};

// Broadcast message to all connected clients
const broadcast = (message) => {
  const messageStr = JSON.stringify(message);
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  });
};

// Handle WebSocket connections with enhanced error handling
wss.on("connection", (ws, req) => {
  const clientIP = req.socket.remoteAddress || "unknown";
  const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  console.log(`🔌 New WebSocket connection: ${clientId} from ${clientIP}`);
  clients.add(ws);
  ws.clientId = clientId;

  // Send welcome message and initial features
  try {
    ws.send(
      JSON.stringify({
        type: "initial_features",
        data: militaryFeatures,
        timestamp: Date.now(),
        clientId: clientId,
      }),
    );
    console.log(
      `📦 Sent ${militaryFeatures.length} initial features to ${clientId}`,
    );
  } catch (error) {
    console.error(`❌ Failed to send initial features to ${clientId}:`, error);
    clients.delete(ws);
    return;
  }

  // Keep-alive ping mechanism
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  ws.on("pong", () => {
    // Client responded to ping - connection is alive
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "initial_features":
          // Client requesting fresh initial data
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "initial_features",
                data: militaryFeatures,
                timestamp: Date.now(),
              }),
            );
          }
          break;

        case "unit_update":
          // Client sending individual unit update (for collaborative editing)
          const updatedFeature = message.data;
          if (updatedFeature && updatedFeature.id) {
            const index = militaryFeatures.findIndex(
              (f) => f.id === updatedFeature.id,
            );
            if (index !== -1) {
              militaryFeatures[index] = {
                ...updatedFeature,
                lastUpdate: Date.now(),
              };

              // Broadcast update to all other clients (except sender)
              clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                  try {
                    client.send(
                      JSON.stringify({
                        type: "unit_update",
                        data: militaryFeatures[index],
                        timestamp: Date.now(),
                      }),
                    );
                  } catch (broadcastError) {
                    console.error("❌ Broadcast error:", broadcastError);
                    clients.delete(client);
                  }
                }
              });
            }
          }
          break;

        case "heartbeat":
          // Client heartbeat - respond with server status
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "heartbeat_response",
                timestamp: Date.now(),
                serverUptime: process.uptime(),
                activeUnits: militaryFeatures.length,
              }),
            );
          }
          break;

        default:
          console.log(
            `⚠️ Unknown message type from ${clientId}:`,
            message.type,
          );
      }
    } catch (error) {
      console.error(`❌ Error parsing message from ${clientId}:`, error);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(
      `🔌 WebSocket connection closed: ${clientId} (${code}: ${reason || "No reason"})`,
    );
    clients.delete(ws);
    clearInterval(pingInterval);
  });

  ws.on("error", (error) => {
    console.error(`❌ WebSocket error from ${clientId}:`, error);
    clients.delete(ws);
    clearInterval(pingInterval);
  });
});

// Start periodic updates with performance monitoring
const startPeriodicUpdates = () => {
  const updateInterval = setInterval(() => {
    const startTime = process.hrtime.bigint();

    // Update all unit positions
    updateFeaturePositions();

    // Only broadcast if we have connected clients
    if (clients.size > 0) {
      broadcast({
        type: "features_update",
        data: militaryFeatures,
        timestamp: Date.now(),
      });

      const endTime = process.hrtime.bigint();
      const processingTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds

      const stats = {
        total: militaryFeatures.length,
        tanks: militaryFeatures.filter((f) => f.type === "tank").length,
        aircraft: militaryFeatures.filter((f) => f.type === "aircraft").length,
        clients: clients.size,
        processingTime: Math.round(processingTime * 100) / 100,
      };

      if (stats.clients > 0) {
        console.log(
          `📡 Updated ${stats.total} units (${stats.tanks} tanks, ${stats.aircraft} aircraft) → ${stats.clients} clients (${stats.processingTime}ms)`,
        );
      }
    }
  }, 2000); // Update every 2 seconds for more responsive feel

  return updateInterval;
};

// Initialize and start server
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";

console.log("🎖️ Starting IOS-MAP WebSocket Server...");
initializeMilitaryFeatures(1000);
const updateInterval = startPeriodicUpdates();

server.listen(PORT, HOST, () => {
  console.log(
    `🚀 Military Features WebSocket Server running on ${HOST}:${PORT}`,
  );
  console.log(
    `🗺️ Simulating ${militaryFeatures.length} military units in San Antonio`,
  );
  console.log(
    `📡 WebSocket endpoint: ws://localhost:${PORT}/military-features`,
  );
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log("");
  console.log("🎯 Production Features:");
  console.log("  ✅ Real-time position updates every 2 seconds");
  console.log("  ✅ 1000+ dynamic military units (tanks & aircraft)");
  console.log("  ✅ MIL-STD-2525 compatible data format");
  console.log("  ✅ Multi-client support with broadcasting");
  console.log("  ✅ Connection keep-alive with ping/pong");
  console.log("  ✅ Robust error handling and recovery");
  console.log("  ✅ Performance monitoring and logging");
  console.log("  ✅ CORS support for web clients");
  console.log("");
  console.log("🎮 Usage:");
  console.log("  - Connect from IOS-MAP frontend WebSocket mode");
  console.log("  - Multiple clients sync automatically");
  console.log("  - Monitor server performance via health endpoint");
  console.log("  - Real-time tactical picture updates");
});

// Server error handling
server.on("error", (error) => {
  console.error("❌ Server error:", error);
  if (error.code === "EADDRINUSE") {
    console.error(
      `❌ Port ${PORT} is already in use. Please try a different port.`,
    );
    process.exit(1);
  }
});

// Graceful shutdown with cleanup
const gracefulShutdown = (signal) => {
  console.log(
    `\n🛑 Received ${signal}. Shutting down WebSocket server gracefully...`,
  );

  // Stop position updates
  if (updateInterval) {
    clearInterval(updateInterval);
    console.log("⏹️ Stopped position updates");
  }

  // Close all client connections
  console.log(`📤 Closing ${clients.size} client connections...`);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "server_shutdown",
          message: "Server is shutting down",
          timestamp: Date.now(),
        }),
      );
      client.close(1001, "Server shutdown");
    }
  });

  // Close WebSocket server
  wss.close(() => {
    console.log("✅ WebSocket server closed");

    // Close HTTP server
    server.close(() => {
      console.log("✅ HTTP server closed");
      console.log("🏁 Graceful shutdown complete");
      process.exit(0);
    });
  });

  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log("⚠️ Forcing shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("UNHANDLED_REJECTION");
});
