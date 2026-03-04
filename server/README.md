# Cricket Auction Server

Production-grade real-time multiplayer cricket auction engine built with **Node.js**, **Express**, **Socket.IO**, and **MongoDB**.

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18+ | Runtime |
| Express | 4.21 | HTTP framework |
| Socket.IO | 4.7.5 | Real-time WebSocket layer |
| Mongoose | 8.6 | MongoDB ODM |
| Helmet | 7.1 | Security headers |
| Morgan | 1.10 | HTTP request logging |
| Joi | 17.13 | Validation (available) |
| dotenv | 16.4 | Environment variables |

---

## Getting Started

```bash
# Install dependencies
npm install

# Seed the database (creates IPL league, 40 players, league-player links)
npm run seed

# Start in development mode (auto-restart with nodemon)
npm run dev

# Start in production mode
npm start
```

The server runs on **port 4000** by default and expects MongoDB at `mongodb://localhost:27017/cricket-auction`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `MONGO_URI` | `mongodb://localhost:27017/cricket-auction` | MongoDB connection string |
| `NODE_ENV` | `development` | Environment mode |
| `CLIENT_URL` | `http://localhost:5173` | Allowed CORS origin |

---

## Architecture

```
src/
├── index.js                  # Entry point — Express + Socket.IO bootstrap
├── config/
│   ├── index.js              # Env-driven config (port, db, auction defaults)
│   └── db.js                 # MongoDB connection
├── models/                   # Mongoose schemas (7 models)
├── services/                 # Business logic layer (5 services)
├── controllers/              # HTTP request handlers
├── routes/                   # REST API route definitions
├── socket/
│   ├── events.js             # All 37 socket event name constants
│   └── handler.js            # Socket event → service/engine dispatch
├── auctionEngine/
│   └── index.js              # Server-authoritative auction state machine
├── middleware/
│   └── errorHandler.js       # Global Express error handler
├── seed/
│   └── index.js              # Database seeder (IPL league + 40 players)
├── utils/
│   └── index.js              # Helpers (formatPrice, shortId)
└── validators/               # (Reserved for Joi schemas)
```

---

## Data Models

### Player

Global player master data (league-agnostic).

| Field | Type | Details |
|-------|------|---------|
| `name` | String | Required, trimmed |
| `nationality` | String | Required, trimmed |
| `isOverseas` | Boolean | Default `false` |
| `role` | String | Enum: `Batsman`, `Bowler`, `All-Rounder`, `Wicket-Keeper` |
| `battingStyle` | String | Enum: `Right-Hand`, `Left-Hand` |
| `bowlingStyle` | String | Free text (e.g. "Right-Arm Fast") |
| `age` | Number | |
| `image` | String | URL or empty |
| `skills` | [String] | Descriptive tags (e.g. `["Finisher", "Captain"]`) |

### LeaguePlayer

League-specific projection linking a Player to a League with pricing and stats.

| Field | Type | Details |
|-------|------|---------|
| `player` | ObjectId → Player | Required |
| `league` | ObjectId → League | Required |
| `basePrice` | Number | In lakhs, required |
| `franchisePrice` | Number | Retention price in lakhs, default 0 |
| `previousTeam` | String | For RTM eligibility |
| `stats` | Object | `{ matches, runs, wickets, average, strikeRate, economy }` |
| `set` | String | Auction set grouping, default `"A"` |

### League

Auction format definition (e.g. IPL). Source of truth for purse, team config, retention rules, and bid brackets.

| Field | Type | Details |
|-------|------|---------|
| `name` | String | Required, unique |
| `code` | String | Required, unique, uppercase |
| `totalTeams` | Number | Required |
| `purse` | Number | In lakhs, required |
| `maxSquadSize` | Number | Default 25 |
| `minSquadSize` | Number | Default 18 |
| `maxOverseas` | Number | Default 8 |
| `teams` | [Object] | `{ name, shortName, logo }` |
| `retention` | Object | `{ maxRetentions, slots: [{ slot, cost, type }] }` |
| `basePrices` | [Number] | Available base price tiers |
| `bidIncrements` | [Object] | `[{ upTo, increment }]` — tiered bid brackets |

### Room

Central entity for an auction session.

| Field | Type | Details |
|-------|------|---------|
| `roomCode` | String | Unique, 6-char auto-generated |
| `roomName` | String | Required |
| `league` | ObjectId → League | Required |
| `host` | Object | `{ userId, userName }` |
| `visibility` | String | `public` / `private` |
| `retentionEnabled` | Boolean | |
| `status` | String | `waiting` → `retention` → `lobby` → `auction` → `completed` |
| `maxTeams` | Number | |
| `auctionConfig` | Object | `{ timerSeconds, bidIncrement }` |
| `joinedTeams` | [Object] | See below |

**Team sub-document:**

| Field | Type |
|-------|------|
| `userId` | String (UUID) |
| `userName` | String |
| `teamName` / `teamShortName` | String |
| `totalPurse` / `remainingPurse` | Number |
| `squad` | [SquadPlayer] |
| `retentions` | [SquadPlayer] |
| `rtmCardsUsed` / `maxRtmCards` | Number |
| `isReady` / `isConnected` | Boolean |

**SquadPlayer:** `{ player, leaguePlayer, acquiredFrom (retention/auction/rtm), price, isOverseas }`

### AuctionState

Server-authoritative state for a live auction (one per room).

| Field | Type | Details |
|-------|------|---------|
| `room` | ObjectId → Room | Unique |
| `status` | String | `WAITING`, `NOMINATING`, `BIDDING`, `SOLD`, `UNSOLD`, `RTM_PENDING`, `PAUSED`, `COMPLETED` |
| `currentPlayer` / `currentLeaguePlayer` | ObjectId | Currently nominated player |
| `currentBid` / `currentBidTeam` / `currentBidUserId` | Mixed | Active bid state |
| `currentBidHistory` | [Object] | `{ teamName, userId, amount, timestamp, isRtm }` |
| `rtmEligibleTeam` / `rtmActive` | Mixed | RTM state |
| `timerEndsAt` / `timerDurationMs` | Mixed | Server-side timer |
| `playerPool` | [ObjectId] | Remaining players to auction |
| `soldPlayers` | [Object] | `{ player, leaguePlayer, soldTo, soldPrice, acquiredVia, bidHistory }` |
| `unsoldPlayers` | [ObjectId] | Players that went unsold |
| `nominationIndex` / `round` / `isAccelerated` | Mixed | Auction progress |

### ChatMessage

Room-scoped chat messages: `{ room, userId, userName, teamName, message (max 500) }`

### ActivityLog

Immutable event log: `{ room, type, payload, userId, userName }`

**Event types:** `ROOM_CREATED`, `TEAM_JOINED`, `TEAM_LEFT`, `RETENTION_MADE`, `AUCTION_STARTED`, `PLAYER_NOMINATED`, `BID_PLACED`, `PLAYER_SOLD`, `PLAYER_UNSOLD`, `RTM_USED`, `RTM_PASSED`, `AUCTION_PAUSED`, `AUCTION_RESUMED`, `AUCTION_COMPLETED`, `CHAT_MESSAGE`

---

## REST API

All endpoints are prefixed with `/api`.

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Returns `{ status: "ok", timestamp }` |

### Rooms

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/rooms` | Create a new auction room |
| GET | `/api/rooms/live` | List public rooms (up to 50, newest first) |
| GET | `/api/rooms/:code` | Get room details by code |
| POST | `/api/rooms/:code/lobby` | Transition room to lobby (host only) |

### Leagues

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/leagues` | List all leagues |
| GET | `/api/leagues/:id` | Get league by ID |
| GET | `/api/leagues/:id/players` | Get all players for a league |

---

## Socket Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `room:join` | `{ roomCode, userId, userName, teamName }` | Join a room (reconnect supported) |
| `room:spectate` | `{ roomCode }` | Join as spectator (read-only) |
| `room:leave` | `{ roomCode, userId }` | Leave room |
| `room:ready` | `{ roomCode, userId, isReady }` | Toggle ready status in lobby |
| `retention:getPlayers` | `{ roomCode }` + callback | Get retention-eligible players |
| `retention:retain` | `{ roomCode, userId, leaguePlayerId, slotNumber }` | Retain a player |
| `retention:remove` | `{ roomCode, userId, playerId }` | Remove a retention |
| `retention:confirm` | `{ roomCode, userId }` | Confirm retention selections |
| `auction:start` | `{ roomCode, userId }` | Start auction (host only) |
| `auction:bid` | `{ roomCode, userId, teamName, amount }` | Place a bid |
| `auction:nominate` | `{ roomCode, userId, leaguePlayerId }` | Nominate specific player (host) |
| `auction:pause` | `{ roomCode, userId }` | Pause auction (host) |
| `auction:resume` | `{ roomCode, userId }` | Resume auction (host) |
| `auction:rtmUse` | `{ roomCode, userId, teamName }` | Exercise RTM card |
| `auction:rtmPass` | `{ roomCode, userId, teamName }` | Pass on RTM |
| `auction:getState` | `{ roomCode }` + callback | Get full auction state (reconnect) |
| `chat:send` | `{ roomCode, userId, userName, teamName, message }` | Send chat message |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `room:updated` | `{ room }` | Room data changed (teams, ready state) |
| `room:userJoined` | `{ userId, userName, teamName }` | New user joined |
| `room:userLeft` | `{ userId, userName, teamName }` | User disconnected |
| `room:error` | `{ message }` | Room-level error |
| `retention:updated` | `{ room }` | Retention state changed |
| `retention:players` | `{ config, players }` | Available players for retention |
| `retention:allConfirmed` | — | All teams confirmed retentions |
| `retention:error` | `{ message }` | Retention error |
| `auction:initialized` | `{ roomCode, state }` | Auction engine ready |
| `auction:playerNominated` | `{ playerData, basePrice, ... }` | New player up for bidding |
| `auction:bidPlaced` | `{ teamName, amount, minNextBid, ... }` | Bid recorded |
| `auction:playerSold` | `{ playerName, teamName, price, acquiredVia, teams }` | Player sold |
| `auction:playerUnsold` | `{ playerName }` | Player went unsold |
| `auction:rtmPending` | `{ rtmTeam, currentBid, currentBidTeam }` | RTM decision needed |
| `auction:timerTick` | `{ remaining }` | Timer sync (every second) |
| `auction:paused` | — | Auction paused |
| `auction:resumed` | — | Auction resumed |
| `auction:completed` | `{ stats }` | Auction finished |
| `auction:state` | `{ state }` | Full state snapshot (reconnect) |
| `auction:error` | `{ message }` | Auction error |
| `chat:message` | `{ userId, userName, teamName, message, createdAt }` | New chat message |
| `chat:history` | `[messages]` | Chat history on join |
| `activity:new` | `{ type, payload, ... }` | New activity event |
| `activity:history` | `[logs]` | Activity history on join |

---

## Auction Engine

The `AuctionEngine` is an EventEmitter-based **server-authoritative state machine** — the heart of the system. It manages timers, validates bids, handles RTM logic, and persists auction state to MongoDB.

### State Machine

```
WAITING → NOMINATING → BIDDING ──────→ SOLD ──→ NOMINATING → ... → COMPLETED
                          │                         ↑
                          └──→ RTM_PENDING ─────────┘
                          │
                          └──→ UNSOLD ──────→ NOMINATING
```

### Key Methods

| Method | Description |
|--------|-------------|
| `initializeAuction(roomCode)` | Loads room + league, excludes retained players from pool, calculates RTM cards per team (`maxRetentions - retentions.length`), creates AuctionState |
| `nominatePlayer(roomCode, leaguePlayerId?)` | Nominates next player (auto or host-specified), starts bidding timer |
| `placeBid({ roomCode, userId, teamName, amount })` | Validates purse reserve (₹20L/remaining slot), overseas limit, min bid (bracket-based), resets timer |
| `useRtm({ roomCode, userId, teamName })` | Matches winning bid, re-opens for counter-bids, increments RTM cards used |
| `passRtm({ roomCode, userId, teamName })` | Passes RTM, sells to original bidder |
| `pauseAuction(roomCode, userId)` | Host-only, clears timer |
| `resumeAuction(roomCode, userId)` | Host-only, auto-nominates next player |
| `getAuctionState(roomCode)` | Full populated state with timer remaining (for reconnects) |

### RTM (Right to Match) Logic

- Enabled when `retentionEnabled` is true on the room
- RTM cards per team = `maxRetentions - retentions.length` (retained 4 → 0 RTM, retained 0 → 4 RTM)
- Triggered when a player's `previousTeam` matches a team in the room that has RTM cards left
- RTM team gets 15 seconds to match or pass
- Using RTM matches the current bid and re-opens bidding for counter-bids
- If RTM team wins the final bid, player is acquired via "rtm"

### Bid Validation

- Minimum bid calculated from league's tiered `bidIncrements` brackets
- Purse reserve: each team must keep ₹20L per remaining empty squad slot
- Overseas player limit enforced (max 8)
- Squad size limit enforced (max 25)
- Cannot bid on yourself (self-bid prevention)

---

## Services

| Service | Responsibility |
|---------|---------------|
| `roomService` | Room CRUD, join/leave, ready status, reconnection handling |
| `retentionService` | Retention config, player eligibility, retain/remove, cost tracking (uses `franchisePrice`) |
| `playerService` | Player queries (by league, by ID, search) |
| `leagueService` | League read operations |
| `chatService` | Chat message persistence, activity log queries |

---

## Seed Data

The seeder (`npm run seed`) creates:

- **1 IPL League** — 10 teams (CSK, MI, RCB, KKR, SRH, RR, DC, PBKS, LSG, GT), ₹120 Cr purse, 4 retention slots, tiered bid increments
- **40 IPL Players** — Real cricketers with roles, skill tags, overseas flags
- **40 League-Player Links** — Base prices (₹20L–₹200L), franchise prices (₹600L–₹1800L), previous team mappings, stats

⚠️ Running `npm run seed` **clears** existing League, Player, and LeaguePlayer collections.

---

## Error Handling

- HTTP errors return `{ success: false, error: "message" }` with appropriate status codes
- Socket errors emit `room:error`, `retention:error`, or `auction:error` to the originating client
- Stack traces included in development mode only
