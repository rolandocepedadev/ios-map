"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import MapContainer from "./components/MapContainer";
import {
  militaryFeatureService,
  MilitaryFeature,
} from "./services/militaryFeatures";

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [militaryFeatures, setMilitaryFeatures] = useState<MilitaryFeature[]>(
    [],
  );
  const [connectionStatus, setConnectionStatus] = useState({
    mode: "polling" as "websocket" | "polling",
    connected: false,
    reconnectAttempts: 0,
  });

  const toggleSidebar = () => {
    if (!isAnimating) {
      setIsAnimating(true);
      setSidebarOpen(!sidebarOpen);
      setTimeout(() => setIsAnimating(false), 300);
    }
  };

  // Toggle connection mode (WebSocket is primary, polling is fallback)
  const toggleConnectionMode = () => {
    const newMode =
      connectionStatus.mode === "websocket" ? "polling" : "websocket";
    militaryFeatureService.setConnectionMode(newMode === "websocket");
  };

  // Update military features state when they change (WebSocket-driven)
  useEffect(() => {
    const updateFeatures = (features: MilitaryFeature[]) => {
      console.log(
        `📡 Main page received ${features.length} features from WebSocket`,
      );
      if (features.length > 0) {
        // Log sample feature for debugging
        const sample = features[0];
        console.log(
          `📍 Sample: ${sample.callSign} at [${sample.position[0].toFixed(4)}, ${sample.position[1].toFixed(4)}] heading: ${sample.heading.toFixed(1)}°`,
        );
      }
      setMilitaryFeatures(features);
    };

    // Start WebSocket connection for real-time server updates
    militaryFeatureService.startUpdates(3000, updateFeatures);

    // Status update interval
    const statusInterval = setInterval(() => {
      setConnectionStatus(militaryFeatureService.getConnectionStatus());
    }, 1000);

    return () => {
      militaryFeatureService.stopUpdates();
      clearInterval(statusInterval);
    };
  }, []);

  // Calculate statistics
  const stats = {
    total: militaryFeatures.length,
    tanks: militaryFeatures.filter((f) => f.type === "tank").length,
    aircraft: militaryFeatures.filter((f) => f.type === "aircraft").length,
    friendly: militaryFeatures.filter((f) => f.status === "friendly").length,
    hostile: militaryFeatures.filter((f) => f.status === "hostile").length,
    neutral: militaryFeatures.filter((f) => f.status === "neutral").length,
    unknown: militaryFeatures.filter((f) => f.status === "unknown").length,
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="bg-black border-b border-zinc-800 flex-shrink-0 z-20 relative">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <button
                onClick={toggleSidebar}
                className="text-zinc-400 hover:text-zinc-50 p-2 rounded-md transition-all duration-200 hover:bg-zinc-800"
                disabled={isAnimating}
              >
                <svg
                  className={`w-5 h-5 transform transition-transform duration-300 ${sidebarOpen ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={
                      sidebarOpen
                        ? "M6 18L18 6M6 6l12 12"
                        : "M4 6h16M4 12h16M4 18h16"
                    }
                  />
                </svg>
              </button>
              <div className="flex items-center">
                <Image
                  src="/aceios-logo.png"
                  alt="IOS-MAP"
                  width={160}
                  height={50}
                  className="h-10 w-auto logo-image"
                  priority
                />
                <span className="ml-4 text-xs text-zinc-400 military-status">
                  Information Operations Simulation Map
                </span>
              </div>
            </div>
            <nav className="flex space-x-6">
              {/*<a
                href="#"
                className="text-zinc-400 hover:text-zinc-50 px-3 py-2 rounded-md text-sm font-medium transition-colors tracking-wide"
              >
                Operations
              </a>
              <a
                href="#"
                className="text-zinc-400 hover:text-zinc-50 px-3 py-2 rounded-md text-sm font-medium transition-colors tracking-wide"
              >
                Analytics
              </a>
              <a
                href="#"
                className="text-zinc-400 hover:text-zinc-50 px-3 py-2 rounded-md text-sm font-medium transition-colors tracking-wide"
              >
                Settings
              </a>*/}
            </nav>
          </div>
        </div>
      </header>

      <main className="flex-1 relative">
        {/* Full-screen Map Container */}
        <MapContainer features={militaryFeatures} />

        {/* Overlay Sidebar */}
        <div
          className={`fixed top-[73px] left-0 h-[calc(100vh-73px)] w-80 bg-zinc-950/95 backdrop-blur-md border-r border-zinc-800 z-30 shadow-2xl transition-transform duration-300 ease-in-out ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="p-4 h-full overflow-y-auto">
            <div
              className={`space-y-4 ${sidebarOpen ? "stagger-children" : ""}`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-zinc-50 tracking-tight military-title">
                  Operations Panel
                </h2>
                <button
                  onClick={toggleSidebar}
                  className="text-zinc-400 hover:text-zinc-50 p-1 rounded transition-all duration-200 hover:bg-zinc-800 hover:rotate-90"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Military Units Overview */}
              <div className="space-y-3">
                <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 transform transition-all duration-200 hover:scale-102 hover:bg-zinc-800/50 hover-lift">
                  <h3 className="text-sm text-zinc-50 mb-2 military-label">
                    Total Units
                  </h3>
                  <div className="text-2xl text-blue-500 military-data">
                    {stats.total}
                  </div>
                  <p className="text-xs text-zinc-400 military-status">
                    Active military assets
                  </p>
                </div>

                <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 transform transition-all duration-200 hover:scale-102 hover:bg-zinc-800/50 hover-lift">
                  <h3 className="text-sm text-zinc-50 mb-2 military-label">
                    Ground Forces
                  </h3>
                  <div className="text-2xl text-green-500 military-data">
                    {stats.tanks}
                  </div>
                  <p className="text-xs text-zinc-400 military-status">
                    Armored vehicles
                  </p>
                </div>

                <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 transform transition-all duration-200 hover:scale-102 hover:bg-zinc-800/50 hover-lift">
                  <h3 className="text-sm text-zinc-50 mb-2 military-label">
                    Air Assets
                  </h3>
                  <div className="text-2xl text-purple-500 military-data">
                    {stats.aircraft}
                  </div>
                  <p className="text-xs text-zinc-400 military-status">
                    Aircraft units
                  </p>
                </div>
              </div>

              {/* Force Status */}
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 transform transition-all duration-200 hover:scale-102 hover:bg-zinc-800/50 hover-lift">
                <h3 className="text-sm text-zinc-50 mb-3 military-label">
                  Force Classification
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded bg-green-500"></div>
                      <span className="text-xs text-zinc-300">Friendly</span>
                    </div>
                    <span className="text-sm font-semibold text-green-500">
                      {stats.friendly}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded bg-red-500"></div>
                      <span className="text-xs text-zinc-300">Hostile</span>
                    </div>
                    <span className="text-sm font-semibold text-red-500">
                      {stats.hostile}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded bg-yellow-500"></div>
                      <span className="text-xs text-zinc-300">Neutral</span>
                    </div>
                    <span className="text-sm font-semibold text-yellow-500">
                      {stats.neutral}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded bg-cyan-500"></div>
                      <span className="text-xs text-zinc-300">Unknown</span>
                    </div>
                    <span className="text-sm font-semibold text-cyan-500">
                      {stats.unknown}
                    </span>
                  </div>
                </div>
              </div>

              {/* Active Operations */}
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 transform transition-all duration-200 hover:scale-102 hover:bg-zinc-800/50 hover-lift">
                <h3 className="text-sm font-semibold text-zinc-50 mb-2">
                  Recent Activity
                </h3>
                <div className="space-y-2 text-xs text-zinc-400">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span>System initialized</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span>Map layers loaded</span>
                  </div>
                </div>
              </div>

              {/* Connection Status & Controls */}
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 transform transition-all duration-200 hover:scale-102 hover:bg-zinc-800/50 hover-lift">
                <h3 className="text-sm text-zinc-50 mb-2 military-label">
                  Data Connection
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          connectionStatus.connected
                            ? "bg-green-500 animate-pulse"
                            : "bg-red-500"
                        }`}
                      ></div>
                      <span className="text-xs text-zinc-300">
                        {connectionStatus.mode.toUpperCase()}
                      </span>
                    </div>
                    <span className="text-xs text-zinc-400">
                      {connectionStatus.connected
                        ? "Connected"
                        : "Disconnected"}
                    </span>
                  </div>
                  <button
                    onClick={toggleConnectionMode}
                    className="w-full text-left text-xs text-zinc-400 hover:text-zinc-200 py-1 px-2 rounded hover:bg-zinc-800 transition-all duration-200 transform hover:translate-x-1 btn-animate"
                  >
                    {connectionStatus.mode === "websocket"
                      ? "Use Polling Fallback"
                      : "Resume WebSocket Mode"}
                  </button>
                  {connectionStatus.mode === "websocket" &&
                    connectionStatus.reconnectAttempts > 0 && (
                      <div className="text-xs text-yellow-500 military-status">
                        Reconnecting... ({connectionStatus.reconnectAttempts}/5)
                      </div>
                    )}
                  {connectionStatus.mode === "polling" && (
                    <div className="text-xs text-blue-400 military-status">
                      Fallback mode - positions calculated locally
                    </div>
                  )}
                </div>
              </div>

              {/* Map Controls */}
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 transform transition-all duration-200 hover:scale-102 hover:bg-zinc-800/50 hover-lift">
                <h3 className="text-sm font-semibold text-zinc-50 mb-2">
                  Map Controls
                </h3>
                <div className="space-y-2">
                  <button className="w-full text-left text-xs text-zinc-400 hover:text-zinc-200 py-1 px-2 rounded hover:bg-zinc-800 transition-all duration-200 transform hover:translate-x-1 btn-animate">
                    Reset View
                  </button>
                  <button className="w-full text-left text-xs text-zinc-400 hover:text-zinc-200 py-1 px-2 rounded hover:bg-zinc-800 transition-all duration-200 transform hover:translate-x-1 btn-animate">
                    Toggle Layers
                  </button>
                  <button className="w-full text-left text-xs text-zinc-400 hover:text-zinc-200 py-1 px-2 rounded hover:bg-zinc-800 transition-all duration-200 transform hover:translate-x-1 btn-animate">
                    Export View
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mini stats overlay when sidebar is closed */}
        {!sidebarOpen && (
          <div className="absolute top-4 right-4 z-20 space-y-2 animate-in fade-in-0 slide-in-from-right-4 duration-300">
            <div className="bg-zinc-900/95 backdrop-blur-sm rounded-lg border border-zinc-800 p-3 min-w-[180px] transform transition-all duration-200 hover:scale-105 hover:bg-zinc-800/95">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-blue-500">
                    {stats.total}
                  </div>
                  <p className="text-xs text-zinc-400 military-status">
                    Total Units
                  </p>
                </div>
                <div>
                  <div className="text-lg font-bold text-green-500">
                    {stats.tanks}
                  </div>
                  <p className="text-xs text-zinc-400 military-status">Tanks</p>
                </div>
                <div>
                  <div className="text-lg font-bold text-purple-500">
                    {stats.aircraft}
                  </div>
                  <p className="text-xs text-zinc-400 military-status">
                    Aircraft
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Map status indicator */}
        <div className="absolute bottom-4 left-4 z-20">
          <div className="bg-zinc-900/95 backdrop-blur-sm rounded-lg border border-zinc-800 p-2 flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-xs text-zinc-400 military-status">
              Map Active
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
