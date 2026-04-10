const API_BASE = import.meta.env.VITE_SERVER_URL
  ? `${import.meta.env.VITE_SERVER_URL}/api`
  : "/api";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Request failed");
  return data.data;
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
