import WebSocket from "ws";

// Test WebSocket connection to the military features server
const TEST_URL = "ws://localhost:8080/military-features";

console.log("🧪 Testing WebSocket connection to IOS-MAP server...");
console.log(`📡 Connecting to: ${TEST_URL}\n`);

const ws = new WebSocket(TEST_URL);

let initialFeaturesReceived = false;
let updatesReceived = 0;
let testStartTime = Date.now();

// Connection opened
ws.on("open", () => {
  console.log("✅ WebSocket connection established");

  // Request initial features
  ws.send(JSON.stringify({
    type: "initial_features",
    data: [],
    timestamp: Date.now(),
  }));

  console.log("📤 Requested initial military features");
});

// Message received
ws.on("message", (data) => {
  try {
    const message = JSON.parse(data.toString());

    switch (message.type) {
      case "initial_features":
        if (Array.isArray(message.data)) {
          initialFeaturesReceived = true;
          console.log(`📦 Received ${message.data.length} initial military features`);

          // Log sample feature for verification
          if (message.data.length > 0) {
            const sample = message.data[0];
            console.log(`📍 Sample unit: ${sample.callSign} (${sample.type}) at [${sample.position[0].toFixed(4)}, ${sample.position[1].toFixed(4)}]`);
          }
        }
        break;

      case "features_update":
        if (Array.isArray(message.data)) {
          updatesReceived++;
          const elapsed = ((Date.now() - testStartTime) / 1000).toFixed(1);
          console.log(`🔄 Update #${updatesReceived} received (${elapsed}s) - ${message.data.length} units`);

          // Show position change for first unit
          if (message.data.length > 0 && updatesReceived <= 3) {
            const unit = message.data[0];
            console.log(`   └─ ${unit.callSign}: [${unit.position[0].toFixed(4)}, ${unit.position[1].toFixed(4)}] heading: ${unit.heading.toFixed(1)}°`);
          }
        }
        break;

      case "unit_update":
        console.log(`🎯 Individual unit update: ${message.data.callSign}`);
        break;

      default:
        console.log(`📨 Unknown message type: ${message.type}`);
    }

    // End test after receiving initial features and a few updates
    if (initialFeaturesReceived && updatesReceived >= 3) {
      console.log("\n🎉 Test completed successfully!");
      console.log("📊 Test Results:");
      console.log(`   ✅ Initial features received: ${initialFeaturesReceived}`);
      console.log(`   ✅ Position updates received: ${updatesReceived}`);
      console.log(`   ✅ Total test time: ${((Date.now() - testStartTime) / 1000).toFixed(1)}s`);

      ws.close(1000, "Test completed");
    }

  } catch (error) {
    console.error("❌ Error parsing message:", error);
  }
});

// Connection closed
ws.on("close", (code, reason) => {
  console.log(`\n🔌 WebSocket connection closed: ${code} - ${reason || "No reason provided"}`);

  if (initialFeaturesReceived && updatesReceived > 0) {
    console.log("✅ Test PASSED - WebSocket server is functioning correctly");
    process.exit(0);
  } else {
    console.log("❌ Test FAILED - Did not receive expected data");
    process.exit(1);
  }
});

// Connection error
ws.on("error", (error) => {
  console.error("❌ WebSocket connection error:", error.message);
  console.log("\n💡 Make sure the WebSocket server is running:");
  console.log("   cd websocket-server && npm start");
  process.exit(1);
});

// Test timeout
setTimeout(() => {
  if (ws.readyState === WebSocket.OPEN) {
    console.log("\n⏰ Test timeout - closing connection");
    ws.close(1000, "Test timeout");
  }
}, 15000); // 15 second timeout

// Handle process termination
process.on("SIGINT", () => {
  console.log("\n🛑 Test interrupted");
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(1000, "Test interrupted");
  }
  process.exit(0);
});
