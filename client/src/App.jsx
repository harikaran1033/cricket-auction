import { Routes, Route } from "react-router-dom";
import Root from "./components/Root";
import Home from "./pages/Home";
import CreateRoom from "./pages/CreateRoom";
import JoinRoom from "./pages/JoinRoom";
import LiveRooms from "./pages/LiveRooms";
import Retention from "./pages/Retention";
import Lobby from "./pages/Lobby";
import Auction from "./pages/Auction";
import Results from "./pages/Results";
import MatchSimulation from "./pages/MatchSimulation";

export default function App() {
  return (
    <Routes>
      {/* Routes with Navbar */}
      <Route element={<Root />}>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateRoom />} />
        <Route path="/join" element={<JoinRoom />} />
        <Route path="/join/:code" element={<JoinRoom />} />
        <Route path="/rooms" element={<LiveRooms />} />
      </Route>

      {/* Full-screen routes (no Navbar for immersive experience) */}
      <Route path="/room/:code/retention" element={<Retention />} />
      <Route path="/room/:code/lobby" element={<Lobby />} />
      <Route path="/room/:code/auction" element={<Auction />} />
      <Route path="/room/:code/results" element={<Results />} />
      <Route path="/room/:code/match" element={<MatchSimulation />} />
    </Routes>
  );
}
