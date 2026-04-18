const trimTrailingSlash = (value = "") => value.replace(/\/+$/, "");

function normalizeApiBase(raw = "", { isOverride = false } = {}) {
  const value = trimTrailingSlash(String(raw || "").trim());
  if (!value) return "";

  // If a full origin is provided (e.g. https://api.example.com) as VITE_API_BASE_URL,
  // treat it as server root and append /api automatically.
  if (isOverride) {
    try {
      const parsed = new URL(value);
      if (!parsed.pathname || parsed.pathname === "/") {
        return `${value}/api`;
      }
    } catch {
      // Ignore parse errors and fall through to raw value.
    }
  }

  return value;
}

function resolveApiBase() {
  const apiBaseOverride = normalizeApiBase(import.meta.env.VITE_API_BASE_URL, { isOverride: true });
  if (apiBaseOverride) return apiBaseOverride;

  const serverUrl = normalizeApiBase(import.meta.env.VITE_SERVER_URL);
  if (serverUrl) return `${serverUrl}/api`;

  return "/api";
}

const API_BASE = resolveApiBase();

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`; 
  let res;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
  } catch (err) {
    throw new Error(`Network error while calling ${url}. Check mobile internet/API URL.`);
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  let payload = null;

  if (contentType.includes("application/json")) {
    try {
      payload = await res.json();
    } catch {
      throw new Error(`Invalid JSON response from ${url} (HTTP ${res.status})`);
    }
  } else {
    const text = await res.text();
    const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
    const missingApiBaseHint =
      API_BASE === "/api" && text.includes("<!DOCTYPE html>")
        ? " This usually means SPA fallback rewrote /api to index.html. Set VITE_API_BASE_URL to your backend API URL and redeploy."
        : "";
    const wrongPathHint =
      text.includes("Cannot GET /leagues")
        ? " Backend was reached at /leagues, but this API is under /api/leagues. Set VITE_API_BASE_URL to https://<backend-domain>/api (or set VITE_SERVER_URL to https://<backend-domain>)."
        : "";
    throw new Error(
      `Unexpected response from ${url} (HTTP ${res.status}). ` +
      `${snippet ? `Body starts with: ${snippet}` : "No response body."}` +
      missingApiBaseHint +
      wrongPathHint
    );
  }

  if (!res.ok) {
    throw new Error(payload?.error || `HTTP ${res.status} ${res.statusText}`);
  }
  if (!payload?.success) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload.data;
}

export const api = {
  // Leagues
  getLeagues: () => request("/leagues"),
  getLeague: (id) => request(`/leagues/${id}`),
  getLeaguePlayers: (id) => request(`/leagues/${id}/players`),

  // Rooms
  createRoom: (body) =>
    request("/rooms", { method: "POST", body: JSON.stringify(body) }),
  getPublicRooms: () => request("/rooms/live"),
  getRoom: (code) => request(`/rooms/${code}`),
  getRoomReplay: (code, limit = 500) => request(`/rooms/${code}/replay?limit=${limit}`),
  moveToLobby: (code, userId) =>
    request(`/rooms/${code}/lobby`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),

  // Match simulation
  getMatchStrengths: (code) => request(`/match/${code}/strengths`),
  getTeamStrength: (code, teamName) =>
    request(`/match/${code}/team/${encodeURIComponent(teamName)}/strength`),
  getSeasonSimulation: (code) => request(`/match/${code}/season`),
  submitPlayingXI: (code, body) =>
    request(`/match/${code}/xi`, { method: "POST", body: JSON.stringify(body) }),
  simulateMatch: (code, body) =>
    request(`/match/${code}/simulate`, { method: "POST", body: JSON.stringify(body) }),
};
