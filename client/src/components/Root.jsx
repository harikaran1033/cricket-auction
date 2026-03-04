import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";
import { COLORS } from "../data/constants";

export default function Root() {
  return (
    <div className="flex flex-col min-h-screen" style={{ background: COLORS.bgMain, fontFamily: "'Inter', sans-serif" }}>
      <Navbar />
      <main className="flex-1 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
