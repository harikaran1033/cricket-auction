import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { UserProvider } from "./context/UserContext";
import { SocketProvider } from "./context/SocketContext";
import { AudioProvider } from "./context/AudioContext";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <UserProvider>
        <SocketProvider>
          <AudioProvider>
            <App />
          </AudioProvider>
        </SocketProvider>
      </UserProvider>
    </BrowserRouter>
  </React.StrictMode>
);
