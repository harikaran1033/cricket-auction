import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Zap, Menu, X, Trophy } from "lucide-react";
import { COLORS } from "../data/constants";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path) => location.pathname === path;

  const navLinks = [
    { label: "Home", path: "/" },
    { label: "Live Rooms", path: "/rooms" },
    { label: "Create Room", path: "/create" },
  ];

  return (
    <nav
      style={{
        background: `linear-gradient(90deg, #0F172A 0%, #1E293B 100%)`,
        borderBottom: `1px solid ${COLORS.border}`,
        fontFamily: "'Inter', sans-serif",
      }}
      className="sticky top-0 z-50 w-full"
    >
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 group"
          >
            <div
              style={{
                background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`,
                boxShadow: `0 0 20px ${COLORS.primary}55`,
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
            >
              <Zap size={18} fill="white" color="white" />
            </div>
            <span
              style={{
                color: COLORS.textPrimary,
                fontFamily: "'Inter', sans-serif",
              }}
              className="text-lg hidden sm:block"
            >
              <span style={{ color: COLORS.primary }} className="font-black">BID</span>
              <span className="font-bold">ARENA</span>
            </span>
          </button>

          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <button
                key={link.path}
                onClick={() => navigate(link.path)}
                style={{
                  color: isActive(link.path) ? COLORS.primary : COLORS.textSecondary,
                  background: isActive(link.path) ? `${COLORS.primary}18` : "transparent",
                  borderBottom: isActive(link.path) ? `2px solid ${COLORS.primary}` : "2px solid transparent",
                  fontFamily: "'Inter', sans-serif",
                }}
                className="px-4 py-2 rounded-t-md text-sm font-medium transition-all duration-200 hover:text-white"
              >
                {link.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/create")}
              style={{
                background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`,
                color: "#0F172A",
                fontFamily: "'Inter', sans-serif",
                boxShadow: `0 0 16px ${COLORS.primary}44`,
              }}
              className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 hover:scale-105"
            >
              <Trophy size={15} />
              Create Room
            </button>

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{ color: COLORS.textSecondary }}
              className="md:hidden p-2"
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div
            style={{ borderTop: `1px solid ${COLORS.border}` }}
            className="md:hidden pb-4"
          >
            {navLinks.map((link) => (
              <button
                key={link.path}
                onClick={() => { navigate(link.path); setMenuOpen(false); }}
                style={{
                  color: isActive(link.path) ? COLORS.primary : COLORS.textSecondary,
                  background: isActive(link.path) ? `${COLORS.primary}15` : "transparent",
                  fontFamily: "'Inter', sans-serif",
                }}
                className="w-full text-left px-4 py-3 text-sm font-medium"
              >
                {link.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
