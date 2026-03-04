# Cricket Auction Client

Real-time multiplayer cricket auction frontend built with **React 18**, **Vite 6**, **Tailwind CSS v4**, and **Socket.IO Client**.

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.3 | UI framework |
| Vite | 6.3 | Build tool & dev server |
| Tailwind CSS | 4.1 | Utility-first styling |
| Socket.IO Client | 4.7.5 | Real-time server communication |
| React Router DOM | 6.26 | Client-side routing |
| Recharts | 2.15 | Charts on Results page |
| Lucide React | 0.487 | Icon library |
| tw-animate-css | 1.3 | Animation utilities |

---

## Getting Started

```bash
# Install dependencies
npm install

# Start development server (port 5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

The dev server proxies `/api` and `/socket.io` requests to `http://localhost:4000` (the backend server).

---

## Architecture

```
src/
├── main.jsx                   # Entry point — BrowserRouter + Providers
├── App.jsx                    # Route definitions
├── context/
│   ├── SocketContext.jsx      # Socket.IO connection provider
│   └── UserContext.jsx        # User identity provider (localStorage)
├── pages/
│   ├── Home.jsx               # Landing page with hero + live rooms
│   ├── CreateRoom.jsx         # Room creation form
│   ├── JoinRoom.jsx           # Join room by code
│   ├── Lobby.jsx              # Pre-auction waiting room with chat
│   ├── Retention.jsx          # Player retention phase
│   ├── Auction.jsx            # Live auction experience (522 lines)
│   └── Results.jsx            # Post-auction results dashboard
├── components/
│   ├── Root.jsx               # Layout wrapper with Navbar
│   ├── Navbar.jsx             # Top navigation bar ("BIDARENA")
│   └── StatusBadge.jsx        # Room status pill component
├── services/
│   └── api.js                 # REST API client (fetch wrapper)
├── data/
│   └── constants.js           # Design system colors + helper functions
├── utils/
│   └── index.js               # Shared utilities (formatPrice, formatActivity)
├── styles/
│   ├── index.css              # Entry — imports fonts, tailwind, theme
│   ├── fonts.css              # Inter + JetBrains Mono from Google Fonts
│   ├── tailwind.css           # Tailwind v4 config + custom utilities
│   └── theme.css              # Global resets, scrollbar, dark theme
└── hooks/                     # (Reserved for custom hooks)
```

---

## Routing

| Path | Page | Layout |
|------|------|--------|
| `/` | Home | With Navbar |
| `/create` | CreateRoom | With Navbar |
| `/join` | JoinRoom | With Navbar |
| `/join/:code` | JoinRoom | With Navbar |
| `/rooms` | LiveRooms | With Navbar |
| `/room/:code/retention` | Retention | Full-screen |
| `/room/:code/lobby` | Lobby | Full-screen |
| `/room/:code/auction` | Auction | Full-screen |
| `/room/:code/results` | Results | Full-screen |

---

## Pages

### Home

Landing page with animated hero section, feature cards (Realtime Bidding, Retention Mode, Live Chat, Team Dashboard), stat counters, and a live rooms list fetched from the API.

- **API:** `GET /api/rooms/live`
- **Navigation:** Create Room, Join Room, Live Rooms, direct join via room cards

### CreateRoom

Multi-step form to create an auction room.

- **Fields:** Your Name, Room Name, League (dropdown), Team (grid picker), Retention toggle, Visibility (public/private)
- **API:** `GET /api/leagues` (on mount), `POST /api/rooms` (on submit)
- **Flow:** On success → saves user context → navigates to Retention (if enabled) or Lobby

### JoinRoom

Join an existing room by entering a 6-character code.

- **Features:** Auto-fetches room details when code is entered, shows available teams (filters out taken ones), room info preview with StatusBadge, Spectate option
- **API:** `GET /api/rooms/:code`, `GET /api/leagues/:id`
- **Socket:** `room:join`, `room:spectate`
- **Flow:** On join → navigates based on room status

### Lobby

Pre-auction waiting room with real-time chat and activity feed.

- **Layout:** 3-column — Team list (left), Live Chat (center), Activity Feed (right)
- **Features:** Ready Up toggle (non-host), Start Auction button (host, requires all teams ready), copyable room code, per-team purse bars, retention config display
- **Socket Events:**
  - Emits: `room:join`, `chat:send`, `room:ready`, `auction:start`
  - Listens: `chat:history`, `activity:history`, `room:updated`, `room:userJoined`, `room:userLeft`, `chat:message`, `activity:new`, `auction:initialized`

### Retention

Player retention phase where teams select players to retain before the auction.

- **Layout:** 4-column — Team/Purse info (left), Player grid (center 2 cols), Activity feed (right)
- **Features:** Player cards with role colors and skill tag badges, retain/remove buttons, retention slot visualization with per-player franchise price, RTM cards info panel, Confirm/Skip buttons, cost tracking
- **Socket Events:**
  - Emits: `room:join`, `retention:getPlayers`, `retention:retain`, `retention:remove`, `retention:confirm`
  - Listens: `retention:updated`, `retention:allConfirmed`, `room:updated`, `activity:new`
- **API:** `POST /api/rooms/:code/lobby` (on all confirmed → transition to lobby)

### Auction

The core live auction experience — the largest page (522 lines).

- **Layout:** 3-column — Teams sidebar (left), Main auction area with player card + timer + bid controls (center), Chat panel (right)
- **Player Card:** Shows name, nationality, role badge, base price, skill tag badges, overseas flag
- **Timer:** Client-side `requestAnimationFrame` countdown synced from server's `timerEndsAt`, with animated progress bar
- **Bid Controls:** Dynamic bid amounts (min + increments of ₹25L/₹50L/₹75L/₹100L), disabled when not your turn or insufficient purse
- **Overlays:** SOLD (green glow) and UNSOLD (red) full-screen overlays with player details
- **RTM Panel:** Shows when RTM is pending with Use/Pass buttons for the eligible team
- **Host Controls:** Pause/Resume auction
- **Spectator Mode:** Read-only view (no bid controls)
- **Completion:** Trophy screen with stats → auto-navigates to Results
- **Socket Events:**
  - Emits: `room:join`, `room:spectate`, `auction:getState`, `auction:bid`, `auction:rtmUse`, `auction:rtmPass`, `auction:pause`, `auction:resume`, `chat:send`
  - Listens: `chat:history`, `auction:playerNominated`, `auction:bidPlaced`, `auction:playerSold`, `auction:playerUnsold`, `auction:rtmPending`, `auction:timerTick`, `auction:paused`, `auction:resumed`, `auction:completed`, `auction:error`, `auction:state`, `room:updated`, `chat:message`

### Results

Post-auction results dashboard with charts and downloadable data.

- **Sections:** Summary stats (Total Spent, Players Sold, Most Expensive, Biggest Spender), Purse Utilization bar chart (Recharts), Top 5 Picks, Final Squad cards per team, All Sold Players table
- **Features:** JSON download of full results, RTM acquisition labels, role-colored badges
- **Socket:** `auction:getState` (to fetch final state)

### LiveRooms

Browse all public auction rooms.

- **Features:** Search bar, league filter dropdown, "Live Only" toggle, room cards grid with StatusBadge, team fill progress bars, dynamic action buttons per room status (Watch Live / Join Lobby / View Results)
- **API:** `GET /api/rooms/live`

---

## Context Providers

### SocketContext

Manages a single Socket.IO connection to the server.

- **Provides:** `{ socket, isConnected }`
- **Hook:** `useSocket()`
- **Details:** Connects to `VITE_SERVER_URL` or `http://localhost:4000`. Auto-reconnects (up to 10 attempts). Transports: WebSocket, polling fallback.

### UserContext

Manages local user identity, persisted in `localStorage` under key `"auction_user"`.

- **Provides:** `{ user, updateUser }`
- **Hook:** `useUser()`
- **User shape:** `{ userId (UUIDv4), userName, teamName, teamShortName, roomCode, isHost }`
- **Details:** Generates a UUID on first visit. `updateUser(partial)` merges fields and persists.

---

## API Service

All calls go through a `request()` wrapper that extracts `data.data` or throws on `!data.success`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `getLeagues()` | `GET /api/leagues` | List all leagues |
| `getLeague(id)` | `GET /api/leagues/:id` | Get league details |
| `getLeaguePlayers(id)` | `GET /api/leagues/:id/players` | Get players for a league |
| `createRoom(body)` | `POST /api/rooms` | Create a new room |
| `getPublicRooms()` | `GET /api/rooms/live` | List public rooms |
| `getRoom(code)` | `GET /api/rooms/:code` | Get room by code |
| `moveToLobby(code, userId)` | `POST /api/rooms/:code/lobby` | Transition to lobby |

---

## Styling

### Approach

Hybrid styling using **Tailwind CSS v4** utility classes for layout/spacing and **inline `style={}`** objects referencing a `COLORS` constant from the design system.

### Design System (`COLORS`)

| Token | Value | Usage |
|-------|-------|-------|
| `primary` | `#00E5FF` | Cyan — primary actions, highlights, glows |
| `accent` | `#FF3D00` | Red-orange — accents, alerts |
| `success` | `#00C853` | Green — sold, confirmed |
| `warning` | `#FFD600` | Yellow — warnings, RTM |
| `bgMain` | `#0F172A` | Dark navy — page background |
| `bgCard` | `#1E293B` | Slate — card backgrounds |
| `bgHover` | `#334155` | Lighter slate — hover states |
| `border` | `#334155` | Border color |
| `textPrimary` | `#F8FAFC` | White text |
| `textSecondary` | `#94A3B8` | Muted text |
| `textMuted` | `#64748B` | Faded text |

### Fonts

- **Inter** (400–900) — Primary UI font
- **JetBrains Mono** (400–700) — Monospace/code font

### Custom CSS

- `glow-cyan`, `glow-red`, `glow-green` — Box-shadow glow effects
- `text-glow-cyan`, `text-glow-red` — Text shadow glows
- `bid-pulse` — Scale + glow keyframe for bid animations
- `sold-flash` — Opacity blink keyframe for sold overlays
- `auction-grid` — CSS Grid layout for auction page

---

## Utilities

| Function | Description |
|----------|-------------|
| `formatPrice(lakhs)` | Formats to `₹X.XX Cr` (≥100 lakhs) or `₹X L` |
| `getRoleColor(role)` | Returns hex color for player roles |
| `getActivityClass(type)` | Returns CSS class for activity log entries |
| `formatActivity(log)` | Converts activity log to human-readable string |
| `getStatusConfig(status)` | Maps room status → `{ color, bg, label, pulse }` |

---

## Build

```bash
npm run build
```

Produces optimized output in `dist/`:
- ~695 KB JS (gzipped: ~197 KB)
- ~27.5 KB CSS (gzipped: ~6 KB)

---

## Development Notes

- **No global state store** — all state is local `useState` per page. User identity and socket connection are in Context.
- **Socket reconnection** — every room-scoped page (Lobby, Retention, Auction) re-emits `room:join` on mount to register with the server and receive initial state via callbacks/history events.
- **Spectator mode** — append `?spectate=1` to auction URL for read-only viewing.
- **Proxy config** — Vite proxies `/api` and `/socket.io` to `http://localhost:4000` in development. No proxy needed in production if served from same origin.
