import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SocketContext = createContext(null);

const trimTrailingSlash = (value = "") => value.replace(/\/+$/, "");

const SOCKET_URL = (() => {
  const explicitSocketUrl = trimTrailingSlash(String(import.meta.env.VITE_SOCKET_URL || "").trim());
  if (explicitSocketUrl) return explicitSocketUrl;

  const serverUrl = trimTrailingSlash(String(import.meta.env.VITE_SERVER_URL || "").trim());
  if (serverUrl) return serverUrl;

  return import.meta.env.DEV ? "http://localhost:4000" : window.location.origin;
})();

export function SocketProvider({ children }) {
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      console.log("[Socket] Connected:", socket.id);
      setIsConnected(true);
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket] Disconnected:", reason);
      setIsConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.error("[Socket] Connection error:", err.message);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be inside SocketProvider");
  return ctx;
}
