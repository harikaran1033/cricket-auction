const trimTrailingSlash = (value = "") => value.replace(/\/+$/, "");

function resolveApiBase() {
  const apiBaseOverride = trimTrailingSlash(String(import.meta.env.VITE_API_BASE_URL || "").trim());
  if (apiBaseOverride) return apiBaseOverride;

  const serverUrl = trimTrailingSlash(String(import.meta.env.VITE_SERVER_URL || "").trim());
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
    throw new Error(
      `Unexpected response from ${url} (HTTP ${res.status}). ` +
      `${snippet ? `Body starts with: ${snippet}` : "No response body."}`
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
