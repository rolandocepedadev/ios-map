export interface MilitaryFeature {
  id: string;
  type: "tank" | "aircraft";
  position: [number, number]; // [longitude, latitude]
  heading: number; // degrees 0-360
  speed: number; // km/h
  status: "friendly" | "hostile" | "neutral" | "unknown";
  callSign: string;
  lastUpdate: number;
  destination?: [number, number];
}

export interface MilitaryFeatureResponse {
  features: MilitaryFeature[];
  timestamp: number;
  total: number;
}

// San Antonio bounding box for realistic positioning
const SAN_ANTONIO_BOUNDS = {
  north: 29.7,
  south: 29.1,
  east: -98.2,
  west: -98.8,
};

// Generate realistic military callsigns
const generateCallSign = (type: "tank" | "aircraft", index: number): string => {
  const prefixes = {
    tank: ["STEEL", "IRON", "TITAN", "WOLF", "SABER", "KNIGHT", "STORM"],
    aircraft: ["EAGLE", "HAWK", "VIPER", "FALCON", "GHOST", "RAVEN", "THUNDER"],
  };

  const prefix = prefixes[type][index % prefixes[type].length];
  const number = Math.floor(index / prefixes[type].length) + 1;
  return `${prefix}-${number.toString().padStart(2, "0")}`;
};

// Generate random position within San Antonio bounds
const generateRandomPosition = (): [number, number] => {
  const lng =
    SAN_ANTONIO_BOUNDS.west +
    Math.random() * (SAN_ANTONIO_BOUNDS.east - SAN_ANTONIO_BOUNDS.west);
  const lat =
    SAN_ANTONIO_BOUNDS.south +
    Math.random() * (SAN_ANTONIO_BOUNDS.north - SAN_ANTONIO_BOUNDS.south);
  return [lng, lat];
};

// Generate initial military features
export const generateInitialFeatures = (
  count: number = 1000,
): MilitaryFeature[] => {
  const features: MilitaryFeature[] = [];

  // 60% tanks, 40% aircraft for land-based operations
  const tankCount = Math.floor(count * 0.6);
  const aircraftCount = count - tankCount;

  // Generate tanks
  for (let i = 0; i < tankCount; i++) {
    const position = generateRandomPosition();
    features.push({
      id: `tank-${i + 1}`,
      type: "tank",
      position,
      heading: Math.random() * 360,
      speed: 20 + Math.random() * 40, // 20-60 km/h
      status: ["friendly", "hostile", "neutral", "unknown"][
        Math.floor(Math.random() * 4)
      ] as MilitaryFeature["status"],
      callSign: generateCallSign("tank", i),
      lastUpdate: Date.now(),
      destination: generateRandomPosition(),
    });
  }

  // Generate aircraft
  for (let i = 0; i < aircraftCount; i++) {
    const position = generateRandomPosition();
    features.push({
      id: `aircraft-${i + 1}`,
      type: "aircraft",
      position,
      heading: Math.random() * 360,
      speed: 200 + Math.random() * 400, // 200-600 km/h
      status: ["friendly", "hostile", "neutral", "unknown"][
        Math.floor(Math.random() * 4)
      ] as MilitaryFeature["status"],
      callSign: generateCallSign("aircraft", i),
      lastUpdate: Date.now(),
      destination: generateRandomPosition(),
    });
  }

  return features;
};

// Calculate new position based on heading and speed
const calculateNewPosition = (
  currentPos: [number, number],
  heading: number,
  speed: number,
  timeIntervalSeconds: number,
): [number, number] => {
  // Convert speed from km/h to degrees per second (rough approximation)
  const speedDegPerSec = (speed / 3600) * (1 / 111); // 111 km per degree roughly
  const distance = speedDegPerSec * timeIntervalSeconds;

  // Convert heading to radians (0 degrees = North)
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

// Update feature positions with realistic movement
export const updateFeaturePositions = (
  features: MilitaryFeature[],
): MilitaryFeature[] => {
  const now = Date.now();

  return features.map((feature) => {
    const timeDiff = (now - feature.lastUpdate) / 1000; // seconds

    // Calculate new position
    const newPosition = calculateNewPosition(
      feature.position,
      feature.heading,
      feature.speed,
      timeDiff,
    );

    // Occasionally change heading for more realistic movement
    let newHeading = feature.heading;
    if (Math.random() < 0.1) {
      // 10% chance to change direction
      newHeading = (feature.heading + (Math.random() - 0.5) * 60) % 360;
      if (newHeading < 0) newHeading += 360;
    }

    // Occasionally change speed slightly
    let newSpeed = feature.speed;
    if (Math.random() < 0.05) {
      // 5% chance to change speed
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

// WebSocket connection types
interface WebSocketMessage {
  type: "features_update" | "initial_features" | "unit_update";
  data: MilitaryFeature[] | MilitaryFeature;
  timestamp: number;
}

// WebSocket-first API service for real-time military features
export class MilitaryFeatureService {
  private features: MilitaryFeature[] = [];
  private updateInterval?: NodeJS.Timeout;
  private websocket: WebSocket | null = null;
  private wsUrl: string = "ws://localhost:8080/military-features";
  private callback?: (features: MilitaryFeature[]) => void;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private useWebSocket: boolean = true; // Default to WebSocket for real-time updates

  constructor(useWebSocket: boolean = true) {
    // Only generate features locally if not using WebSocket (fallback mode)
    if (!useWebSocket) {
      this.features = generateInitialFeatures(1000);
    }
    this.useWebSocket = useWebSocket;
  }

  // Fetch features (used for fallback polling mode only)
  async fetchFeatures(): Promise<MilitaryFeatureResponse> {
    if (this.useWebSocket) {
      // In WebSocket mode, return current cached features
      return {
        features: [...this.features],
        timestamp: Date.now(),
        total: this.features.length,
      };
    }

    // Fallback: simulate network delay for polling mode
    await new Promise((resolve) =>
      setTimeout(resolve, 100 + Math.random() * 200),
    );

    return {
      features: [...this.features],
      timestamp: Date.now(),
      total: this.features.length,
    };
  }

  // Start real-time updates (WebSocket primary, polling fallback)
  startUpdates(
    intervalMs: number = 3000,
    callback?: (features: MilitaryFeature[]) => void,
  ) {
    this.callback = callback;

    if (this.useWebSocket) {
      console.log("🔌 Starting WebSocket connection for real-time updates...");
      this.startWebSocketConnection();
    } else {
      console.log("⏰ Starting polling mode as fallback...");
      this.startPollingUpdates(intervalMs);
    }
  }

  // Fallback polling mode (only used when WebSocket unavailable)
  private startPollingUpdates(intervalMs: number) {
    // Initialize features for polling mode if not already done
    if (this.features.length === 0) {
      this.features = generateInitialFeatures(1000);
      console.log("📦 Generated 1000 features for polling mode");
    }

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.features = updateFeaturePositions(this.features);
      if (this.callback) {
        this.callback([...this.features]);
      }
    }, intervalMs);
  }

  // Primary WebSocket connection for server-driven real-time updates
  private startWebSocketConnection() {
    try {
      console.log(`🔌 Connecting to WebSocket server: ${this.wsUrl}`);
      this.websocket = new WebSocket(this.wsUrl);

      this.websocket.onopen = () => {
        console.log(
          "✅ WebSocket connected - requesting initial military features",
        );
        this.reconnectAttempts = 0;

        // Request initial feature set from server
        this.sendWebSocketMessage({
          type: "initial_features",
          data: [],
          timestamp: Date.now(),
        });
      };

      this.websocket.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error("❌ Error parsing WebSocket message:", error);
        }
      };

      this.websocket.onclose = (event) => {
        console.log(
          `🔌 WebSocket connection closed: ${event.code} - ${event.reason}`,
        );
        this.handleWebSocketReconnect();
      };

      this.websocket.onerror = (error) => {
        console.error("❌ WebSocket connection error:", error);
      };
    } catch (error) {
      console.error("❌ Failed to establish WebSocket connection:", error);
      this.fallbackToPolling();
    }
  }

  // Handle server-sent position updates via WebSocket
  private handleWebSocketMessage(message: WebSocketMessage) {
    switch (message.type) {
      case "initial_features":
        if (Array.isArray(message.data)) {
          this.features = message.data;
          console.log(
            `📦 Server sent ${this.features.length} initial military units`,
          );
          if (this.callback) {
            this.callback([...this.features]);
          }
        }
        break;

      case "features_update":
        // Server sends updated positions for all units
        if (Array.isArray(message.data)) {
          this.features = message.data;
          console.log(
            `🔄 Server updated positions for ${this.features.length} units`,
          );
          if (this.callback) {
            this.callback([...this.features]);
          }
        }
        break;

      case "unit_update":
        // Server sends single unit position update
        if (!Array.isArray(message.data)) {
          const updatedFeature = message.data;
          const index = this.features.findIndex(
            (f) => f.id === updatedFeature.id,
          );
          if (index !== -1) {
            this.features[index] = updatedFeature;
            console.log(`📍 Server updated unit: ${updatedFeature.callSign}`);
            if (this.callback) {
              this.callback([...this.features]);
            }
          }
        }
        break;

      default:
        console.warn("⚠️ Unknown message type from server:", message.type);
    }
  }

  // Send message through WebSocket
  private sendWebSocketMessage(message: WebSocketMessage) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify(message));
    }
  }

  // Auto-reconnect with exponential backoff, fallback to polling if needed
  private handleWebSocketReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

      console.log(
        `🔄 WebSocket reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`,
      );

      setTimeout(() => {
        this.startWebSocketConnection();
      }, delay);
    } else {
      console.log(
        "❌ WebSocket reconnection failed. Switching to polling fallback mode.",
      );
      this.fallbackToPolling();
    }
  }

  // Switch to polling mode when WebSocket is unavailable
  private fallbackToPolling() {
    this.useWebSocket = false;
    this.websocket = null;
    console.log("📡 Activating polling fallback mode...");
    this.startPollingUpdates(3000);
  }

  // Stop automatic updates
  stopUpdates() {
    // Stop polling
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }

    // Close WebSocket connection
    if (this.websocket) {
      this.websocket.close(1000, "Client stopping updates");
      this.websocket = null;
    }

    this.callback = undefined;
  }

  // Get current features
  getCurrentFeatures(): MilitaryFeature[] {
    return [...this.features];
  }

  // Manually update positions (for external control)
  updatePositions(): MilitaryFeature[] {
    this.features = updateFeaturePositions(this.features);
    return [...this.features];
  }

  // Switch between WebSocket and polling modes
  setConnectionMode(useWebSocket: boolean) {
    if (this.useWebSocket !== useWebSocket) {
      this.stopUpdates();
      this.useWebSocket = useWebSocket;

      if (this.callback) {
        this.startUpdates(3000, this.callback);
      }
    }
  }

  // Get current connection status
  getConnectionStatus(): {
    mode: "websocket" | "polling";
    connected: boolean;
    reconnectAttempts: number;
  } {
    return {
      mode: this.useWebSocket ? "websocket" : "polling",
      connected: this.useWebSocket
        ? this.websocket?.readyState === WebSocket.OPEN
        : this.updateInterval !== undefined,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  // Send manual feature update via WebSocket
  sendFeatureUpdate(feature: MilitaryFeature) {
    if (this.useWebSocket && this.websocket) {
      this.sendWebSocketMessage({
        type: "unit_update",
        data: feature,
        timestamp: Date.now(),
      });
    }
  }
}

// Export singleton instance (defaults to WebSocket mode for real-time updates)
export const militaryFeatureService = new MilitaryFeatureService(true);
