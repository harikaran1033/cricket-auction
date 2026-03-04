const API_BASE = "/api";

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
  moveToLobby: (code, userId) =>
    request(`/rooms/${code}/lobby`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
};
