const { AuctionState, Room, LeaguePlayer, ActivityLog } = require("../models");
const EventEmitter = require("events");
const { resolvePlayerImage } = require("../utils/playerImages");
const { buildPlayerContext } = require("../utils/playerContext");

/**
 * AuctionEngine — the heart of the auction system.
 *
 * DESIGN PRINCIPLES:
 * 1. Server is the SINGLE SOURCE OF TRUTH for timer & state.
 * 2. All mutations are atomic — state changes happen in sequence.
 * 3. Timer runs on server using setTimeout; clients receive timerEndsAt timestamp.
 * 4. Every state transition emits an event for the socket layer to broadcast.
 * 5. Bid validation happens here — never trust the client.
 *
 * AUCTION FLOW (IPL-style sets):
 *   Sets progress in order: M1 → M2 → BA1 → AL1 → WK1 → FA1 → SP1
 *   → UBA1 → UAL1 → UWK1 → UFA1 → USP1
 *   → (Depth) BA2 → AL2 → WK2 → FA2 → SP2 → UBA2 → ... → USP2
 *   → (Accelerated) ACC — all remaining unsold players
 *
 * STATE MACHINE:
 *   WAITING → NOMINATING → BIDDING → SOLD/UNSOLD → NOMINATING → ... → COMPLETED
 *                                ↘ RTM_PENDING → SOLD ↗
 */
class AuctionEngine extends EventEmitter {
  constructor() {
    super();
    // Map<roomId, { timer, state }> — active auction timers
    this.activeTimers = new Map();
  }

  _normalizeTeamName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  _buildTeamAliasLookup(teams = []) {
    const lookup = new Map();
    for (const t of teams) {
      const full = String(t?.name || "").trim();
      const short = String(t?.shortName || "").trim();
      if (!full) continue;
      lookup.set(this._normalizeTeamName(full), full);
      if (short) lookup.set(this._normalizeTeamName(short), full);
    }
    return lookup;
  }

  _resolveCanonicalTeamName(name, teamLookup) {
    if (!name) return "";
    const normalized = this._normalizeTeamName(name);
    const LEGACY_TEAM_ALIASES = {
      "royal challengers bangalore": "Royal Challengers Bengaluru",
      "kings xi punjab": "Punjab Kings",
      "delhi daredevils": "Delhi Capitals",
    };
    return teamLookup.get(normalized) || LEGACY_TEAM_ALIASES[normalized] || String(name).trim();
  }

  _withPlayerImage(player) {
    if (!player) return player;
    return {
      ...player,
      image: player.image || resolvePlayerImage(player.name),
    };
  }

  _normalizeSquadEntry(entry) {
    const playerObj =
      entry?.player && typeof entry.player === "object" ? entry.player : null;
    const leaguePlayerObj =
      entry?.leaguePlayer && typeof entry.leaguePlayer === "object"
        ? entry.leaguePlayer
        : null;
    const leaguePlayerRef =
      leaguePlayerObj?.player && typeof leaguePlayerObj.player === "object"
        ? leaguePlayerObj.player
        : null;

    const name =
      playerObj?.name || leaguePlayerRef?.name || entry?.playerName || "Unknown Player";
    const playerId =
      playerObj?._id?.toString?.() ||
      leaguePlayerRef?._id?.toString?.() ||
      entry?.player?._id?.toString?.() ||
      (typeof entry?.player === "string" ? entry.player : null) ||
      null;
    const role = playerObj?.role || leaguePlayerRef?.role || "";
    const nationality = playerObj?.nationality || leaguePlayerRef?.nationality || "";
    const isOverseas =
      playerObj?.isOverseas ?? leaguePlayerRef?.isOverseas ?? entry?.isOverseas ?? false;
    const image =
      playerObj?.image || leaguePlayerRef?.image || resolvePlayerImage(name);
    const price = Number.isFinite(entry?.price) ? entry.price : 0;
    const fairPoint = Number.isFinite(leaguePlayerObj?.fairPoint) ? leaguePlayerObj.fairPoint : 0;
    const basePrice = Number.isFinite(leaguePlayerObj?.basePrice) ? leaguePlayerObj.basePrice : 0;

    return {
      context: buildPlayerContext(
        playerObj || leaguePlayerRef || { name, role },
        {
          ...(leaguePlayerObj || {}),
          fairPoint,
          basePrice,
        }
      ),
      player: this._withPlayerImage({
        ...(playerObj || leaguePlayerRef || {}),
        name,
        role,
        nationality,
        isOverseas,
        image,
      }),
      playerId,
      leaguePlayer: leaguePlayerObj?._id || entry?.leaguePlayer || null,
      price,
      isOverseas,
      acquiredFrom: entry?.acquiredFrom,
      name,
      role,
      fairPoint,
      basePrice,
      stats: leaguePlayerObj?.stats || null,
      stats2026: leaguePlayerObj?.stats2026 || null,
      stats2024: leaguePlayerObj?.stats2024 || null,
      stats2025: leaguePlayerObj?.stats2025 || null,
    };
  }

  _buildAuctionContextView(fullContext = {}, phase = "scout") {
    const normalizedPhase = ["scout", "bid", "revealed"].includes(phase) ? phase : "scout";
    const isScout = normalizedPhase === "scout";
    const isBid = normalizedPhase === "bid";
    const isRevealed = normalizedPhase === "revealed";

    return {
      playerName: fullContext.playerName,
      role: fullContext.role,
      baseStats: fullContext.baseStats,
      visibleTags: fullContext.visibleTags || [],
      clueTags: isScout ? [] : (fullContext.clueTags || []),
      hiddenTagCount: isRevealed ? 0 : Number(fullContext.hiddenTagCount || 0),
      phaseRatings: isRevealed ? fullContext.phaseRatings : null,
      exactTags: isRevealed ? (fullContext.exactTags || []) : [],
      matchupStrengths: isScout ? [] : (fullContext.matchupStrengths || []),
      matchupWeaknesses: isScout ? [] : (fullContext.matchupWeaknesses || []),
      venueBonus: isRevealed ? fullContext.venueBonus : null,
      dismissalInsight: isRevealed ? fullContext.dismissalInsight : null,
      spinProfile: isRevealed ? fullContext.spinProfile : null,
      handednessProfile: isRevealed ? fullContext.handednessProfile : null,
      battingStyle: fullContext.battingStyle || null,
      bowlingStyle: fullContext.bowlingStyle || null,
      contextModifier: isRevealed ? fullContext.contextModifier : null,
      contextModifierHint: isBid
        ? (Number(fullContext.contextModifier || 0) >= 0 ? "bonus" : "risk")
        : null,
      revealedFairPoint: isRevealed ? fullContext.revealedFairPoint : null,
    };
  }

  _buildAuctionPlayerPayload(leaguePlayer, phase = "scout") {
    if (!leaguePlayer?.player) return null;

    const lp = typeof leaguePlayer.toObject === "function" ? leaguePlayer.toObject() : leaguePlayer;
    const fullContext = buildPlayerContext(leaguePlayer.player, {
      ...lp,
      fairPoint: leaguePlayer.fairPoint || 0,
      basePrice: leaguePlayer.basePrice || 0,
    });

    return {
      playerId: leaguePlayer.player._id,
      leaguePlayerId: leaguePlayer._id,
      name: leaguePlayer.player.name,
      nationality: leaguePlayer.player.nationality,
      isOverseas: leaguePlayer.player.isOverseas,
      isCapped: leaguePlayer.player.isCapped,
      role: leaguePlayer.player.role,
      battingStyle: leaguePlayer.player.battingStyle,
      bowlingStyle: leaguePlayer.player.bowlingStyle,
      jerseyNumber: leaguePlayer.player.jerseyNumber,
      image: leaguePlayer.player.image || resolvePlayerImage(leaguePlayer.player.name),
      skills: leaguePlayer.player.skills,
      basePrice: leaguePlayer.basePrice,
      stats: leaguePlayer.stats,
      stats2026: leaguePlayer.stats2026,
      stats2024: leaguePlayer.stats2024,
      stats2025: leaguePlayer.stats2025,
      fairPoint: leaguePlayer.fairPoint || 0,
      previousTeam: leaguePlayer.previousTeam,
      previousPrice: leaguePlayer.player.previousPrice || null,
      set: leaguePlayer.set,
      auctionPhase: phase,
      context: this._buildAuctionContextView(fullContext, phase),
    };
  }

  // ─────────────────────────── INITIALIZATION ───────────────────────────

  /**
   * Initialize auction state for a room. Called when host starts auction.
   * Dynamically assigns players to auction sets based on base price, role, and capped status.
   *
   * SET ASSIGNMENT LOGIC:
   * 1. Marquee sets: Top players by base price (top ~10% or 12, whichever is larger). Split into sets of ≤6.
   * 2. Capped sets: Remaining capped players grouped by role. Sets of ≤10.
   * 3. Uncapped sets: Uncapped players grouped by role. Sets of ≤10.
   * 4. This supports any pool size (60, 250, 600+ players).
   */
  async initializeAuction(roomCode) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");

    // Get all league players, excluding retained ones
    const retainedPlayerIds = room.joinedTeams.flatMap((t) =>
      t.retentions.map((r) => r.leaguePlayer?.toString()).filter(Boolean)
    );

    const leaguePlayers = await LeaguePlayer.find({
      league: room.league._id,
      _id: { $nin: retainedPlayerIds },
    })
      .populate("player")
      .sort({ basePrice: -1 });

    // Guard: if no players exist in this league, fail loudly instead of silently completing.
    if (leaguePlayers.length === 0) {
      throw new Error(
        "No players found for this league. Run 'npm run seed' and 'npm run seed:stats' first, " +
        "then restart the auction."
      );
    }

    const playerPool = leaguePlayers.map((lp) => lp._id);

    // ──────── DYNAMIC SET ASSIGNMENT ────────
    const { setOrder, setsConfig, playerSetMap } = this._buildDynamicSets(leaguePlayers, room.league);

    // Save set codes to LeaguePlayers in DB (bulk)
    const bulkOps = [];
    for (const [lpId, setCode] of Object.entries(playerSetMap)) {
      bulkOps.push({
        updateOne: { filter: { _id: lpId }, update: { $set: { set: setCode } } },
      });
    }
    if (bulkOps.length > 0) await LeaguePlayer.bulkWrite(bulkOps);

    // Save dynamic setsConfig to league for reference
    room.league.auctionSets = setsConfig;
    await room.league.save();

    // Calculate RTM cards per team
    if (room.retentionEnabled) {
      for (const team of room.joinedTeams) {
        team.maxRtmCards = Math.max(
          0,
          (room.league.retention?.maxRetentions || 0) - team.retentions.length
        );
      }
      await room.save();
    }

    // Build the set pool for the first set
    const firstSetCode = setOrder[0] || "M1";
    const firstSetPlayers = leaguePlayers
      .filter((lp) => playerSetMap[lp._id.toString()] === firstSetCode)
      .map((lp) => lp._id);

    // Create or reset auction state
    let auctionState = await AuctionState.findOne({ room: room._id });
    if (auctionState) {
      // Reset
      auctionState.status = "WAITING";
      auctionState.currentPlayer = null;
      auctionState.currentLeaguePlayer = null;
      auctionState.currentBasePrice = 0;
      auctionState.currentBid = 0;
      auctionState.currentBidTeam = null;
      auctionState.currentBidUserId = null;
      auctionState.currentBidHistory = [];
      auctionState.currentPlayerPhase = null;
      auctionState.rtmEligibleTeam = null;
      auctionState.rtmActive = false;
      auctionState.timerEndsAt = null;
      auctionState.playerPool = playerPool;
      auctionState.nominationIndex = 0;
      auctionState.currentSet = firstSetCode;
      auctionState.setOrder = setOrder;
      auctionState.currentSetIndex = 0;
      auctionState.setPool = firstSetPlayers;
      auctionState.completedSets = [];
      auctionState.soldPlayers = [];
      auctionState.unsoldPlayers = [];
      auctionState.totalPlayersSold = 0;
      auctionState.totalPlayersUnsold = 0;
      auctionState.totalPurseSpent = 0;
      auctionState.round = 1;
      auctionState.isAccelerated = false;
    } else {
      auctionState = new AuctionState({
        room: room._id,
        status: "WAITING",
        playerPool,
        timerDurationMs: (room.auctionConfig?.timerSeconds || 15) * 1000,
        currentSet: firstSetCode,
        setOrder: setOrder,
        currentSetIndex: 0,
        setPool: firstSetPlayers,
        completedSets: [],
      });
    }

    await auctionState.save();

    // Update room status
    room.status = "auction";
    await room.save();

    await ActivityLog.create({
      room: room._id,
      type: "AUCTION_STARTED",
      payload: {
        totalPlayers: playerPool.length,
        totalSets: setOrder.length,
        firstSet: firstSetCode,
      },
      userId: room.host.userId,
      userName: room.host.userName,
    });

    // Build set info for clients
    const setInfo = this._buildSetInfo(setsConfig, setOrder, firstSetCode, []);

    this.emit("auction:initialized", {
      roomCode,
      roomId: room._id.toString(),
      totalPlayers: playerPool.length,
      setInfo,
    });

    return auctionState;
  }

  // ─────────────────────────── SET MANAGEMENT ───────────────────────────

  // ─────────────────────────── DYNAMIC SET BUILDER ───────────────────────────

  /**
   * Dynamically assigns players to auction sets based on:
   *  1. Base price → Marquee (top players by value, split into sets of ≤6)
   *  2. Role + Capped → Primary/Uncapped sets (split into sets of ≤10)
   *
   * Handles any pool size: 60, 250, 600+ players.
   *
   * @param {Array} leaguePlayers - populated LeaguePlayer docs sorted by basePrice desc
   * @param {Object} league - the league document
   * @returns {{ setOrder: string[], setsConfig: Object[], playerSetMap: Object }}
   */
  _buildDynamicSets(leaguePlayers, league) {
    const MAX_MARQUEE_SET_SIZE = 6;
    const MAX_SET_SIZE = 10;

    // How many marquee players? top ~10% with min 6, max 24
    const totalPlayers = leaguePlayers.length;
    let marqueeCount = Math.max(6, Math.min(24, Math.ceil(totalPlayers * 0.1)));

    // Marquee = highest base-price capped players (mix of all roles for star power)
    // Only capped players qualify for marquee
    const cappedByPrice = leaguePlayers.filter((lp) => lp.player.isCapped !== false);
    marqueeCount = Math.min(marqueeCount, cappedByPrice.length);

    // Find the base-price threshold for marquee
    // All players with base price >= the Nth highest qualify
    const marqueePlayers = cappedByPrice.slice(0, marqueeCount);
    const marqueeIds = new Set(marqueePlayers.map((lp) => lp._id.toString()));

    // Remaining players (not in marquee)
    const remaining = leaguePlayers.filter((lp) => !marqueeIds.has(lp._id.toString()));

    // Group remaining by capped/uncapped and role
    const roleGroups = {
      capped: { Batsman: [], "All-Rounder": [], "Wicket-Keeper": [], Bowler: [] },
      uncapped: { Batsman: [], "All-Rounder": [], "Wicket-Keeper": [], Bowler: [] },
    };

    for (const lp of remaining) {
      const type = lp.player.isCapped === false ? "uncapped" : "capped";
      const role = lp.player.role || "Batsman";
      if (roleGroups[type][role]) {
        roleGroups[type][role].push(lp);
      } else {
        // Unknown role → All-Rounder bucket
        roleGroups[type]["All-Rounder"].push(lp);
      }
    }

    // ── Build sets ──
    const setsConfig = [];
    const playerSetMap = {}; // lpId → setCode
    let orderNum = 1;

    // Helper: split an array into chunks, create set for each
    const createSetsFromGroup = (players, codePrefix, namePrefix, phase, maxSize) => {
      if (players.length === 0) return;
      const numSets = Math.ceil(players.length / maxSize);
      for (let i = 0; i < numSets; i++) {
        const setNum = numSets > 1 ? i + 1 : 1;
        const code = numSets > 1 ? `${codePrefix}${setNum}` : `${codePrefix}1`;
        const name = numSets > 1 ? `${namePrefix} Set ${setNum}` : `${namePrefix}`;
        const chunk = players.slice(i * maxSize, (i + 1) * maxSize);
        setsConfig.push({ code, name, phase, roleFilter: "", cappedOnly: null, order: orderNum++ });
        for (const lp of chunk) {
          playerSetMap[lp._id.toString()] = code;
        }
      }
    };

    // 1. Marquee sets
    createSetsFromGroup(marqueePlayers, "M", "Marquee", "marquee", MAX_MARQUEE_SET_SIZE);

    // 2. Capped primary sets by role
    const roleCodeMap = {
      Batsman: { code: "BA", name: "Capped Batters" },
      "All-Rounder": { code: "AL", name: "Capped All-Rounders" },
      "Wicket-Keeper": { code: "WK", name: "Capped Wicket-Keepers" },
      Bowler: { code: "FA", name: "Capped Bowlers" },
    };

    for (const [role, info] of Object.entries(roleCodeMap)) {
      const players = roleGroups.capped[role];
      createSetsFromGroup(players, info.code, info.name, "primary", MAX_SET_SIZE);
    }

    // 3. Uncapped sets by role
    const uncappedRoleCodeMap = {
      Batsman: { code: "UBA", name: "Uncapped Batters" },
      "All-Rounder": { code: "UAL", name: "Uncapped All-Rounders" },
      "Wicket-Keeper": { code: "UWK", name: "Uncapped Wicket-Keepers" },
      Bowler: { code: "UFA", name: "Uncapped Bowlers" },
    };

    for (const [role, info] of Object.entries(uncappedRoleCodeMap)) {
      const players = roleGroups.uncapped[role];
      createSetsFromGroup(players, info.code, info.name, "uncapped", MAX_SET_SIZE);
    }

    // 4. ACC set (config only, players added at runtime when needed)
    setsConfig.push({ code: "ACC", name: "Accelerated Round", phase: "accelerated", roleFilter: "", cappedOnly: null, order: 99 });

    // Build ordered set codes (exclude ACC — added dynamically)
    const setOrder = setsConfig
      .filter((s) => s.phase !== "accelerated")
      .sort((a, b) => a.order - b.order)
      .map((s) => s.code);

    console.log(`[AuctionEngine] Dynamic sets built: ${setOrder.length} sets for ${totalPlayers} players`);
    console.log(`  Marquee: ${marqueePlayers.length} players → ${Math.ceil(marqueePlayers.length / MAX_MARQUEE_SET_SIZE) || 0} set(s)`);
    console.log(`  Sets: ${setOrder.join(" → ") || "(none — player pool may be empty)"}`);

    if (setOrder.length === 0) {
      console.warn(
        "[AuctionEngine] WARNING: setOrder is empty! This means no players were assigned to sets. " +
        "Check that LeaguePlayers are seeded and 'npm run seed:stats' has been run."
      );
    }

    return { setOrder, setsConfig, playerSetMap };
  }

  /**
   * Build set info object for the client.
   */
  _buildSetInfo(leagueAuctionSets, setOrder, currentSetCode, completedSets) {
    const setsConfig = leagueAuctionSets || [];
    // Always include ACC at the end if not already in setOrder
    const fullOrder = [...setOrder];
    if (!fullOrder.includes("ACC")) fullOrder.push("ACC");
    return {
      currentSet: currentSetCode,
      completedSets,
      sets: fullOrder.map((code) => {
        const cfg = setsConfig.find((s) => s.code === code) || {};
        return {
          code,
          name: cfg.name || (code === "ACC" ? "Accelerated Round" : code),
          phase: cfg.phase || (code === "ACC" ? "accelerated" : "primary"),
          isCompleted: completedSets.includes(code),
          isCurrent: code === currentSetCode,
        };
      }),
    };
  }

  /**
   * Get populated player list for the current set pool.
   * Returns lightweight player objects for UI display.
   * nominationIndex = index of NEXT player to nominate (already incremented after current pick).
   * So current player = nominationIndex - 1.
   */
  async _getSetPoolPlayers(setPool, nominationIndex) {
    if (!setPool || setPool.length === 0) return [];
    const LeaguePlayer = require("../models/LeaguePlayer");
    const lps = await LeaguePlayer.find({ _id: { $in: setPool } }).select("player basePrice fairPoint").populate("player", "name nationality isOverseas isCapped role image").lean();
    // Build a map for ordering
    const idMap = {};
    lps.forEach((lp) => { idMap[lp._id.toString()] = lp; });
    const currentIdx = nominationIndex > 0 ? nominationIndex - 1 : -1;
    return setPool.map((id, idx) => {
      const lp = idMap[id.toString()];
      if (!lp || !lp.player) return null;
      let status;
      if (idx < currentIdx) status = "done";
      else if (idx === currentIdx) status = "current";
      else status = "upcoming";
      return {
        leaguePlayerId: lp._id,
        playerId: lp.player._id,
        name: lp.player.name,
        nationality: lp.player.nationality,
        isOverseas: lp.player.isOverseas,
        isCapped: lp.player.isCapped,
        role: lp.player.role,
        image: lp.player.image || resolvePlayerImage(lp.player.name),
        basePrice: lp.basePrice,
        fairPoint: lp.fairPoint || 0,
        status,
      };
    }).filter(Boolean);
  }

  /**
   * Advance to the next set. Returns false if auction is complete.
   */
  async _advanceToNextSet(room, auctionState) {
    const nextIdx = auctionState.currentSetIndex + 1;

    if (nextIdx >= auctionState.setOrder.length) {
      // All sets done — check if there are unsold players for accelerated round
      if (auctionState.unsoldPlayers.length > 0 && !auctionState.isAccelerated) {
        return this._startAcceleratedRound(room, auctionState);
      }

      // Safety guard: don't complete if no players were ever auctioned.
      // This happens when setOrder is empty (pool empty / seed missing).
      if (
        auctionState.totalPlayersSold === 0 &&
        auctionState.totalPlayersUnsold === 0 &&
        auctionState.setOrder.length === 0
      ) {
        throw new Error(
          "Auction aborted: player pool is empty. " +
          "Ensure league players are seeded before starting the auction."
        );
      }

      return false; // auction complete
    }

    const nextSetCode = auctionState.setOrder[nextIdx];

    // Load players for the next set (exclude already sold/retained)
    const soldIds = auctionState.soldPlayers.map((sp) => sp.leaguePlayer?.toString()).filter(Boolean);
    const setPlayers = await LeaguePlayer.find({
      _id: { $in: auctionState.playerPool },
      set: nextSetCode,
    }).populate("player").sort({ basePrice: -1 });

    const setPool = setPlayers
      .filter((lp) => !soldIds.includes(lp._id.toString()))
      .map((lp) => lp._id);

    // Mark current set as completed
    if (!auctionState.completedSets.includes(auctionState.currentSet)) {
      auctionState.completedSets.push(auctionState.currentSet);
    }

    auctionState.currentSetIndex = nextIdx;
    auctionState.currentSet = nextSetCode;
    auctionState.setPool = setPool;
    auctionState.nominationIndex = 0;

    await auctionState.save();

    // If this set has no players (all retained/sold), skip to next
    if (setPool.length === 0) {
      return this._advanceToNextSet(room, auctionState);
    }

    // Emit set change event
    const setInfo = this._buildSetInfo(
      room.league.auctionSets,
      auctionState.setOrder,
      nextSetCode,
      auctionState.completedSets
    );

    await ActivityLog.create({
      room: room._id,
      type: "SET_CHANGED",
      payload: { setCode: nextSetCode, setName: setInfo.sets.find((s) => s.code === nextSetCode)?.name || nextSetCode },
    });

    const setPoolPlayers = await this._getSetPoolPlayers(setPool, 0);

    this.emit("auction:setChanged", {
      roomCode: room.roomCode,
      roomId: room._id.toString(),
      setInfo,
      playersInSet: setPool.length,
      setPoolPlayers,
    });

    return true;
  }

  /**
   * Start the accelerated round with all unsold players.
   */
  async _startAcceleratedRound(room, auctionState) {
    // Mark current set as completed
    if (!auctionState.completedSets.includes(auctionState.currentSet)) {
      auctionState.completedSets.push(auctionState.currentSet);
    }

    auctionState.currentSet = "ACC";
    auctionState.setPool = [...auctionState.unsoldPlayers];
    auctionState.unsoldPlayers = [];
    auctionState.nominationIndex = 0;
    auctionState.round += 1;
    auctionState.isAccelerated = true;

    await auctionState.save();

    await ActivityLog.create({
      room: room._id,
      type: "SET_CHANGED",
      payload: { setCode: "ACC", setName: "Accelerated Round" },
    });

    const setInfo = this._buildSetInfo(
      room.league.auctionSets,
      [...auctionState.setOrder, "ACC"],
      "ACC",
      auctionState.completedSets
    );

    const accPoolPlayers = await this._getSetPoolPlayers(auctionState.setPool, 0);

    this.emit("auction:setChanged", {
      roomCode: room.roomCode,
      roomId: room._id.toString(),
      setInfo,
      playersInSet: auctionState.setPool.length,
      isAccelerated: true,
      setPoolPlayers: accPoolPlayers,
    });

    return true;
  }

  // ─────────────────────────── NOMINATION ───────────────────────────

  /**
   * Nominate the next player for auction.
   * Uses set-based progression: walks through setPool, then advances set.
   */
  async nominatePlayer(roomCode, leaguePlayerId = null) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");

    const auctionState = await AuctionState.findOne({ room: room._id });
    if (!auctionState) throw new Error("Auction not initialized");

    if (auctionState.status !== "WAITING" && auctionState.status !== "NOMINATING") {
      throw new Error(`Cannot nominate in ${auctionState.status} state`);
    }

    let leaguePlayer;

    if (leaguePlayerId) {
      // Host nominated a specific player
      leaguePlayer = await LeaguePlayer.findById(leaguePlayerId).populate("player");
      if (!leaguePlayer) throw new Error("Player not found in pool");
    } else {
      // Auto-nominate next from current set pool
      if (auctionState.nominationIndex >= auctionState.setPool.length) {
        // Current set is exhausted — advance to next set
        const hasMore = await this._advanceToNextSet(room, auctionState);
        if (!hasMore) {
          // Auction complete
          return this._completeAuction(room, auctionState);
        }

        // Small delay before first player of new set
        await new Promise((r) => setTimeout(r, 1500));

        // Re-read state (may have been updated by _advanceToNextSet)
        const freshState = await AuctionState.findOne({ room: room._id });
        if (freshState) {
          auctionState.currentSet = freshState.currentSet;
          auctionState.setPool = freshState.setPool;
          auctionState.nominationIndex = freshState.nominationIndex;
          auctionState.currentSetIndex = freshState.currentSetIndex;
          auctionState.completedSets = freshState.completedSets;
          auctionState.isAccelerated = freshState.isAccelerated;
          auctionState.round = freshState.round;
        }
      }

      if (auctionState.nominationIndex >= auctionState.setPool.length) {
        // Still no players — complete
        return this._completeAuction(room, auctionState);
      }

      // Skip players that were already sold/unsold (e.g. host nominated them out of order)
      const soldIds = new Set(auctionState.soldPlayers.map((sp) => sp.leaguePlayer?.toString()).filter(Boolean));
      const unsoldIds = new Set(auctionState.unsoldPlayers.map((id) => id.toString()));
      while (auctionState.nominationIndex < auctionState.setPool.length) {
        const candidateId = auctionState.setPool[auctionState.nominationIndex].toString();
        if (!soldIds.has(candidateId) && !unsoldIds.has(candidateId)) break;
        auctionState.nominationIndex += 1;
      }

      if (auctionState.nominationIndex >= auctionState.setPool.length) {
        // All players in set done — advance to next set
        const hasMore2 = await this._advanceToNextSet(room, auctionState);
        if (!hasMore2) return this._completeAuction(room, auctionState);
        const freshState2 = await AuctionState.findOne({ room: room._id });
        if (freshState2) {
          auctionState.currentSet = freshState2.currentSet;
          auctionState.setPool = freshState2.setPool;
          auctionState.nominationIndex = freshState2.nominationIndex;
          auctionState.currentSetIndex = freshState2.currentSetIndex;
          auctionState.completedSets = freshState2.completedSets;
          auctionState.isAccelerated = freshState2.isAccelerated;
          auctionState.round = freshState2.round;
        }
      }

      if (auctionState.nominationIndex >= auctionState.setPool.length) {
        return this._completeAuction(room, auctionState);
      }

      const lpId = auctionState.setPool[auctionState.nominationIndex];
      leaguePlayer = await LeaguePlayer.findById(lpId).populate("player");
      auctionState.nominationIndex += 1;
    }

    if (!leaguePlayer) throw new Error("Player not found");

    // Set current player
    auctionState.currentPlayer = leaguePlayer.player._id;
    auctionState.currentLeaguePlayer = leaguePlayer._id;
    auctionState.currentBasePrice = leaguePlayer.basePrice;
    auctionState.currentBid = leaguePlayer.basePrice;
      auctionState.currentBidTeam = null;
      auctionState.currentBidUserId = null;
      auctionState.currentBidHistory = [];
      auctionState.currentPlayerPhase = "scout";
      auctionState.rtmEligibleTeam = null;
      auctionState.rtmActive = false;
      auctionState.status = "BIDDING";

    // Start timer
    const timerMs = auctionState.timerDurationMs || 15000;
    auctionState.timerEndsAt = new Date(Date.now() + timerMs);

    await auctionState.save();

    // Start server-side timer
    this._startTimer(roomCode, room._id.toString(), timerMs);

    // Build set info for context
    const setInfo = this._buildSetInfo(
      room.league.auctionSets,
      auctionState.isAccelerated ? [...auctionState.setOrder, "ACC"] : auctionState.setOrder,
      auctionState.currentSet,
      auctionState.completedSets
    );

    const playerData = this._buildAuctionPlayerPayload(leaguePlayer, auctionState.currentPlayerPhase);

    await ActivityLog.create({
      room: room._id,
      type: "PLAYER_NOMINATED",
      payload: { playerName: leaguePlayer.player.name, basePrice: leaguePlayer.basePrice, set: auctionState.currentSet },
    });

    const setPoolPlayers = await this._getSetPoolPlayers(auctionState.setPool, auctionState.nominationIndex);

    this.emit("auction:playerNominated", {
      roomCode,
      roomId: room._id.toString(),
      player: playerData,
      playerPhase: auctionState.currentPlayerPhase,
      currentBid: auctionState.currentBid,
      timerEndsAt: auctionState.timerEndsAt,
      round: auctionState.round,
      setInfo,
      playerIndexInSet: auctionState.nominationIndex,
      totalPlayersInSet: auctionState.setPool.length,
      setPoolPlayers,
    });

    return { auctionState, player: playerData };
  }

  // ─────────────────────────── BIDDING ───────────────────────────

  /**
   * Place a bid. Server validates everything.
   */
  async placeBid({ roomCode, userId, teamName, amount }) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");

    const auctionState = await AuctionState.findOne({ room: room._id });
    if (!auctionState) throw new Error("Auction not initialized");

    if (auctionState.status !== "BIDDING") {
      throw new Error("Bidding is not active");
    }

    // Validate timer hasn't expired (server authoritative)
    if (new Date() > auctionState.timerEndsAt) {
      throw new Error("Timer has expired");
    }

    // Validate team exists in room
    const team = room.joinedTeams.find(
      (t) => t.userId === userId && t.teamName === teamName
    );
    if (!team) throw new Error("Team not found");

    // Validate bid amount.
    // If no bids yet, first bid must be exactly the base price.
    const bidAmount = Number(amount);
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
      throw new Error("Invalid bid amount");
    }

    // If no bids yet, first bid can be at base price (currentBid holds base at nomination)
    const minBid = auctionState.currentBidTeam
      ? this._calculateMinBid(auctionState.currentBid, room.league)
      : auctionState.currentBid;
    if (!auctionState.currentBidTeam && bidAmount !== minBid) {
      throw new Error(`First bid must be base price (${minBid} lakhs)`);
    }
    if (auctionState.currentBidTeam && bidAmount !== minBid) {
      throw new Error(`Next bid must be exactly ${minBid} lakhs`);
    }

    // Validate purse
    const squadTarget = room.playersPerTeam || room.league.maxSquadSize || 25;
    const slotsRemaining = squadTarget - team.squad.length;
    const minReserve = slotsRemaining > 1 ? (slotsRemaining - 1) * 20 : 0; // ₹20L per remaining slot minimum
    if (team.remainingPurse - bidAmount < minReserve) {
      throw new Error("Insufficient purse (must reserve for remaining slots)");
    }

    // Validate overseas limit — uses room.overseasLimit (derived from playersPerTeam) first
    const currentPlayer = await LeaguePlayer.findById(auctionState.currentLeaguePlayer).populate("player");
    if (currentPlayer?.player?.isOverseas) {
      const overseasCount = team.squad.filter((s) => s.isOverseas).length;
      const effectiveLimit = room.overseasLimit || room.league.maxOverseas || 8;
      if (overseasCount >= effectiveLimit) {
        throw new Error(`Overseas player limit reached (${effectiveLimit} max for ${room.playersPerTeam || 25}-player squad)`);
      }
    }

    // Validate squad size
    if (team.squad.length >= (room.playersPerTeam || room.league.maxSquadSize || 25)) {
      throw new Error("Squad is full");
    }

    // Can't bid on yourself
    if (auctionState.currentBidUserId === userId) {
      throw new Error("You already have the highest bid");
    }

    // Record bid
    const bidEntry = {
      teamName,
      userId,
      amount: bidAmount,
      timestamp: new Date(),
      isRtm: false,
    };

    auctionState.currentBid = bidAmount;
    auctionState.currentBidTeam = teamName;
    auctionState.currentBidUserId = userId;
    auctionState.currentBidHistory.push(bidEntry);
    auctionState.currentPlayerPhase = "bid";

    // Reset timer on each bid
    const timerMs = auctionState.timerDurationMs || 15000;
    auctionState.timerEndsAt = new Date(Date.now() + timerMs);

    await auctionState.save();

    // Restart timer
    this._startTimer(roomCode, room._id.toString(), timerMs);

    await ActivityLog.create({
      room: room._id,
      type: "BID_PLACED",
      payload: {
        playerName: currentPlayer?.player?.name,
        teamName,
        amount: bidAmount,
      },
      userId,
      userName: team.userName,
    });

    this.emit("auction:bidPlaced", {
      roomCode,
      roomId: room._id.toString(),
      bid: bidEntry,
      currentBid: bidAmount,
      currentBidTeam: teamName,
      playerPhase: auctionState.currentPlayerPhase,
      currentPlayer: this._buildAuctionPlayerPayload(currentPlayer, auctionState.currentPlayerPhase),
      timerEndsAt: auctionState.timerEndsAt,
      minNextBid: this._calculateMinBid(bidAmount, room.league),
    });

    return auctionState;
  }

  // ─────────────────────────── RTM ───────────────────────────

  /**
   * Check if RTM applies after bidding ends.
   */
  async _checkRtm(room, auctionState) {
    if (!room.retentionEnabled) {
      console.log(`[RTM] Skipped — retention not enabled for room ${room.roomCode}`);
      return false;
    }

    const currentLP = await LeaguePlayer.findById(auctionState.currentLeaguePlayer).populate("player");
    if (!currentLP?.previousTeam) {
      console.log(`[RTM] Skipped — player "${currentLP?.player?.name || '?'}" has no previousTeam`);
      return false;
    }

    const teamLookup = this._buildTeamAliasLookup(room?.league?.teams || []);
    const canonicalPreviousTeam = this._resolveCanonicalTeamName(currentLP.previousTeam, teamLookup);
    console.log(`[RTM] Checking RTM for "${currentLP.player.name}" (previousTeam: "${currentLP.previousTeam}" -> "${canonicalPreviousTeam}")`);

    // Find the team that previously had this player
    const previousTeam = room.joinedTeams.find((t) => (
      this._normalizeTeamName(t?.teamName) === this._normalizeTeamName(canonicalPreviousTeam) ||
      this._normalizeTeamName(t?.teamShortName) === this._normalizeTeamName(canonicalPreviousTeam)
    ));
    if (!previousTeam) {
      console.log(`[RTM] Skipped — previousTeam "${canonicalPreviousTeam}" not found in room. Joined teams: [${room.joinedTeams.map(t => t.teamName).join(', ')}]`);
      return false;
    }

    // Check if they have RTM cards left
    if (previousTeam.rtmCardsUsed >= previousTeam.maxRtmCards) {
      console.log(`[RTM] Skipped — ${previousTeam.teamName} has no RTM cards left (${previousTeam.rtmCardsUsed}/${previousTeam.maxRtmCards})`);
      return false;
    }

    // Can't RTM if they already won the bid
    if (auctionState.currentBidTeam === previousTeam.teamName) {
      console.log(`[RTM] Skipped — ${previousTeam.teamName} already won the bid`);
      return false;
    }

    // Check if they can afford it
    if (previousTeam.remainingPurse < auctionState.currentBid) {
      console.log(`[RTM] Skipped — ${previousTeam.teamName} can't afford (purse: ${previousTeam.remainingPurse}, bid: ${auctionState.currentBid})`);
      return false;
    }

    // Block RTM if this player was already retained by the previous team
    // (retained players must not re-enter the RTM pathway — they were kept or released intentionally)
    const currentLpId = auctionState.currentLeaguePlayer?.toString();
    if (currentLpId) {
      const alreadyRetained = previousTeam.retentions?.some(
        (r) => r.leaguePlayer?.toString() === currentLpId
      );
      if (alreadyRetained) {
        console.log(`[RTM] Skipped — player was already retained by ${previousTeam.teamName}`);
        return false;
      }
    }

    console.log(`[RTM] ✓ RTM eligible: ${previousTeam.teamName} for "${currentLP.player.name}"`);
    return previousTeam.teamName;
  }

  /**
   * Use RTM card — match the winning bid.
   * Immediately sells the player to the RTM team at the current bid price.
   */
  async useRtm({ roomCode, userId, teamName }) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");

    const auctionState = await AuctionState.findOne({ room: room._id });
    if (!auctionState) throw new Error("Auction not initialized");

    if (auctionState.status !== "RTM_PENDING") {
      throw new Error("RTM is not pending");
    }

    if (auctionState.rtmEligibleTeam !== teamName) {
      throw new Error("You are not eligible for RTM");
    }

    const team = room.joinedTeams.find(
      (t) => t.userId === userId && t.teamName === teamName
    );
    if (!team) throw new Error("Team not found");

    const rtmPrice = auctionState.currentBid;

    // Clear current timer
    this._clearTimer(room._id.toString());

    // Record RTM in bid history
    auctionState.currentBidHistory.push({
      teamName,
      userId,
      amount: rtmPrice,
      timestamp: new Date(),
      isRtm: true,
    });

    // Update bid to RTM team
    auctionState.currentBidTeam = teamName;
    auctionState.currentBidUserId = userId;
    await auctionState.save();

    // Use up one RTM card
    team.rtmCardsUsed += 1;
    await room.save();

    await ActivityLog.create({
      room: room._id,
      type: "RTM_USED",
      payload: { teamName, amount: rtmPrice },
      userId,
      userName: team.userName,
    });

    console.log(`[RTM] ${teamName} used RTM for ${rtmPrice} — selling immediately`);

    // Sell immediately to RTM team
    await this._sellPlayer(
      room,
      auctionState,
      teamName,
      userId,
      rtmPrice,
      "rtm"
    );

    return auctionState;
  }

  /**
   * Pass on RTM.
   */
  async passRtm({ roomCode, userId, teamName }) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");

    const auctionState = await AuctionState.findOne({ room: room._id });
    if (!auctionState || auctionState.status !== "RTM_PENDING") {
      throw new Error("RTM is not pending");
    }

    if (auctionState.rtmEligibleTeam !== teamName) {
      throw new Error("You are not eligible for RTM");
    }

    this._clearTimer(room._id.toString());

    // Mark RTM as finished for this player
    auctionState.rtmActive = false;
    auctionState.rtmEligibleTeam = null;
    await auctionState.save();

    await ActivityLog.create({
      room: room._id,
      type: "RTM_PASSED",
      payload: { teamName },
      userId,
    });

    // Sell to winning bidder
    await this._sellPlayer(
      room,
      auctionState,
      auctionState.currentBidTeam,
      auctionState.currentBidUserId,
      auctionState.currentBid,
      "auction"
    );

    return auctionState;
  }

  // ─────────────────────────── RE-AUCTION UNSOLD ─────────────────────────────

  /**
   * Re-queue all unsold players for re-auction (host only).
   * Moves unsoldPlayers back into setPool and restarts nominations from there.
   * Called by the host from the UI "Re-auction X Unsold" button.
   */
  async nominateUnsold(roomCode, userId) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");
    if (room.host.userId !== userId) throw new Error("Only host can re-auction unsold players");

    const auctionState = await AuctionState.findOne({ room: room._id });
    if (!auctionState) throw new Error("Auction not initialized");

    if (!auctionState.unsoldPlayers || auctionState.unsoldPlayers.length === 0) {
      throw new Error("No unsold players to re-auction");
    }

    const valid = ["SOLD","UNSOLD","NOMINATING","WAITING","PAUSED"];
    if (!valid.includes(auctionState.status)) {
      throw new Error(`Cannot re-auction during ${auctionState.status}`);
    }

    // Push unsold back to the END of the current set pool
    auctionState.setPool = [
      ...auctionState.setPool.slice(auctionState.nominationIndex),
      ...auctionState.unsoldPlayers,
    ];
    auctionState.unsoldPlayers = [];
    auctionState.nominationIndex = 0;
    auctionState.status = "NOMINATING";

    await auctionState.save();

    await ActivityLog.create({
      room: room._id,
      type: "RE_AUCTION_STARTED",
      payload: { totalPlayers: auctionState.setPool.length },
      userId,
    });

    // Kick off next nomination
    await this.nominatePlayer(roomCode);
    return auctionState;
  }

  // ─────────────────────────── TIMER ───────────────────────────

  /**
   * Server-side countdown timer.
   * When it expires → auto-resolve (sell or unsold).
   */
  _startTimer(roomCode, roomId, durationMs) {
    // Clear any existing timer for this room
    this._clearTimer(roomId);

    const timer = setTimeout(async () => {
      try {
        await this._onTimerExpired(roomCode, roomId);
      } catch (err) {
        console.error(`[AuctionEngine] Timer error for room ${roomCode}:`, err);
      }
    }, durationMs);

    this.activeTimers.set(roomId, timer);

    // Emit timer tick events every second for client sync
    this._emitTimerSync(roomCode, roomId, durationMs);
  }

  _clearTimer(roomId) {
    const existing = this.activeTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      this.activeTimers.delete(roomId);
    }
    // Also clear auto-nominate timer
    const anomKey = `${roomId}_autonom`;
    const anomTimer = this.activeTimers.get(anomKey);
    if (anomTimer) {
      clearTimeout(anomTimer);
      this.activeTimers.delete(anomKey);
    }
    // Also clear sync interval
    const syncKey = `${roomId}_sync`;
    const syncInterval = this.activeTimers.get(syncKey);
    if (syncInterval) {
      clearInterval(syncInterval);
      this.activeTimers.delete(syncKey);
    }
  }

  _emitTimerSync(roomCode, roomId, durationMs) {
    const syncKey = `${roomId}_sync`;
    // Clear any existing sync
    const existing = this.activeTimers.get(syncKey);
    if (existing) clearInterval(existing);

    let remaining = Math.ceil(durationMs / 1000);

    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(interval);
        this.activeTimers.delete(syncKey);
        return;
      }
      this.emit("auction:timerTick", {
        roomCode,
        roomId,
        remaining,
      });
    }, 1000);

    this.activeTimers.set(syncKey, interval);
  }

  /**
   * Called when the bid timer expires.
   */
  async _onTimerExpired(roomCode, roomId) {
    const auctionState = await AuctionState.findOne({ room: roomId });
    if (!auctionState || auctionState.status !== "BIDDING") return;

    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) return;

    if (auctionState.currentBidTeam) {
      // Check if RTM applies (first-time check after bidding ends)
      const rtmTeam = await this._checkRtm(room, auctionState);
      if (rtmTeam) {
        auctionState.status = "RTM_PENDING";
        auctionState.rtmEligibleTeam = rtmTeam;
        auctionState.rtmActive = true;

        const rtmTimerMs = 15000;
        auctionState.timerEndsAt = new Date(Date.now() + rtmTimerMs);
        await auctionState.save();

        this._startRtmTimer(roomCode, roomId, rtmTimerMs);

        this.emit("auction:rtmPending", {
          roomCode,
          roomId,
          rtmTeam,
          currentBid: auctionState.currentBid,
          currentBidTeam: auctionState.currentBidTeam,
          playerPhase: auctionState.currentPlayerPhase || "bid",
          currentPlayer: this._buildAuctionPlayerPayload(currentLP, auctionState.currentPlayerPhase || "bid"),
          timerEndsAt: auctionState.timerEndsAt,
        });
        return;
      }

      // No RTM — sell to highest bidder
      await this._sellPlayer(
        room,
        auctionState,
        auctionState.currentBidTeam,
        auctionState.currentBidUserId,
        auctionState.currentBid,
        "auction"
      );
    } else {
      // No bids — player unsold
      await this._unsoldPlayer(room, auctionState);
    }
  }

  /**
   * RTM timer — if RTM team doesn't respond, sell to original bidder.
   */
  _startRtmTimer(roomCode, roomId, durationMs) {
    this._clearTimer(roomId);

    const timer = setTimeout(async () => {
      try {
        const auctionState = await AuctionState.findOne({ room: roomId });
        if (!auctionState || auctionState.status !== "RTM_PENDING") return;

        const room = await Room.findOne({ roomCode }).populate("league");

        // RTM timed out — pass automatically
        const rtmTeamName = auctionState.rtmEligibleTeam;
        auctionState.rtmActive = false;
        auctionState.rtmEligibleTeam = null;
        await auctionState.save();

        await ActivityLog.create({
          room: roomId,
          type: "RTM_PASSED",
          payload: { teamName: rtmTeamName, reason: "timeout" },
        });

        await this._sellPlayer(
          room,
          auctionState,
          auctionState.currentBidTeam,
          auctionState.currentBidUserId,
          auctionState.currentBid,
          "auction"
        );
      } catch (err) {
        console.error(`[AuctionEngine] RTM timer error:`, err);
      }
    }, durationMs);

    this.activeTimers.set(roomId, timer);
    this._emitTimerSync(roomCode, roomId, durationMs);
  }

  // ─────────────────────────── RESOLUTION ───────────────────────────

  /**
   * Sell player to a team.
   */
  async _sellPlayer(room, auctionState, teamName, userId, price, acquiredVia) {
    this._clearTimer(room._id.toString());

    const currentLP = await LeaguePlayer.findById(auctionState.currentLeaguePlayer).populate("player");
    const revealedPlayer = this._buildAuctionPlayerPayload(currentLP, "revealed");

    // Update team in room
    const team = room.joinedTeams.find((t) => t.teamName === teamName);
    if (team) {
      const squadEntry = {
        player: auctionState.currentPlayer,
        leaguePlayer: auctionState.currentLeaguePlayer,
        acquiredFrom: acquiredVia,
        price,
        isOverseas: currentLP?.player?.isOverseas || false,
      };
      team.squad.push(squadEntry);
      team.remainingPurse -= price;
      await room.save();
    }

    // Update auction state
    auctionState.soldPlayers.push({
      player: auctionState.currentPlayer,
      leaguePlayer: auctionState.currentLeaguePlayer,
      soldTo: teamName,
      soldPrice: price,
      acquiredVia,
      bidHistory: [...auctionState.currentBidHistory],
    });

    auctionState.totalPlayersSold += 1;
    auctionState.totalPurseSpent += price;
    auctionState.status = "SOLD";
    auctionState.currentPlayerPhase = "revealed";
    auctionState.currentBidHistory = [];
    auctionState.rtmActive = false;
    auctionState.rtmEligibleTeam = null;

    await auctionState.save();

    await ActivityLog.create({
      room: room._id,
      type: "PLAYER_SOLD",
      payload: {
        playerName: currentLP?.player?.name,
        teamName,
        amount: price,
        acquiredVia,
      },
      userId,
    });

    this.emit("auction:playerSold", {
      roomCode: room.roomCode,
      roomId: room._id.toString(),
      player: {
        playerId: currentLP?.player?._id,
        name: currentLP?.player?.name,
        role: currentLP?.player?.role,
        isOverseas: currentLP?.player?.isOverseas,
        image: currentLP?.player?.image || resolvePlayerImage(currentLP?.player?.name),
      },
      soldTo: teamName,
      soldPrice: price,
      acquiredVia,
      revealedPlayer,
      currentSet: auctionState.currentSet,
      // Send updated team data with populated squad
      teams: await this._getTeamsWithSquad(room),
    });

    // ── recalculateAfterSale hook ────────────────────────────────────────
    // Emit a lightweight purse-summary update so all clients can stay in sync
    // without waiting for a full auction-state refresh.
    try {
      const purseSummary = room.joinedTeams.map((t) => ({
        teamName: t.teamName,
        remainingPurse: t.remainingPurse,
        squadSize: t.squad.length,
        slotsRemaining: (room.playersPerTeam || 25) - t.squad.length,
      }));
      this.emit("auction:pursesRecalculated", {
        roomCode: room.roomCode,
        roomId: room._id.toString(),
        purseSummary,
        totalPurseSpent: auctionState.totalPurseSpent,
        totalPlayersSold: auctionState.totalPlayersSold,
      });
    } catch (e) {
      console.warn("[AuctionEngine] recalculateAfterSale warning:", e.message);
    }

    // Auto-nominate next after 3-second delay (stored so it can be cancelled)
    // But first check if all teams have full squads — if so, complete immediately
    if (this._allTeamsFull(room)) {
      console.log(`[AuctionEngine] All teams have full squads — completing auction.`);
      setTimeout(async () => {
        try {
          await this._completeAuction(room, auctionState);
        } catch (err) {
          console.error("[AuctionEngine] Auto-complete error:", err);
        }
      }, 3000);
      return;
    }

    const roomId = room._id.toString();
    const autoNomTimer = setTimeout(async () => {
      try {
        this.activeTimers.delete(`${roomId}_autonom`);
        auctionState.status = "NOMINATING";
        auctionState.currentPlayerPhase = null;
        await auctionState.save();
        await this.nominatePlayer(room.roomCode);
      } catch (err) {
        console.error("[AuctionEngine] Auto-nominate error:", err);
      }
    }, 3000);
    this.activeTimers.set(`${roomId}_autonom`, autoNomTimer);
  }

  /**
   * Mark player as unsold.
   */
  async _unsoldPlayer(room, auctionState) {
    this._clearTimer(room._id.toString());

    const currentLP = await LeaguePlayer.findById(auctionState.currentLeaguePlayer).populate("player");

    auctionState.unsoldPlayers.push(auctionState.currentLeaguePlayer);
    auctionState.totalPlayersUnsold += 1;
    auctionState.status = "UNSOLD";
    auctionState.currentPlayerPhase = null;
    auctionState.currentBidHistory = [];

    await auctionState.save();

    await ActivityLog.create({
      room: room._id,
      type: "PLAYER_UNSOLD",
      payload: { playerName: currentLP?.player?.name },
    });

    this.emit("auction:playerUnsold", {
      roomCode: room.roomCode,
      roomId: room._id.toString(),
      player: {
        playerId: currentLP?.player?._id,
        name: currentLP?.player?.name,
        role: currentLP?.player?.role,
        image: currentLP?.player?.image || resolvePlayerImage(currentLP?.player?.name),
      },
    });

    // Auto-nominate next (stored so it can be cancelled)
    const roomId = room._id.toString();
    const autoNomTimer = setTimeout(async () => {
      try {
        this.activeTimers.delete(`${roomId}_autonom`);
        auctionState.status = "NOMINATING";
        await auctionState.save();
        await this.nominatePlayer(room.roomCode);
      } catch (err) {
        console.error("[AuctionEngine] Auto-nominate error:", err);
      }
    }, 3000);
    this.activeTimers.set(`${roomId}_autonom`, autoNomTimer);
  }

  /**
   * Check if all teams have reached their squad size limit.
   * Uses room.playersPerTeam (set at room creation) as the canonical limit.
   */
  _allTeamsFull(room) {
    const maxSquad = room.playersPerTeam || room.league?.maxSquadSize || 25;
    if (!room.joinedTeams || room.joinedTeams.length === 0) return false;
    return room.joinedTeams.every((t) => {
      // Retentions are already pushed into squad during retention flow.
      // Count unique player ids across both arrays to avoid double-counting.
      const ids = new Set();
      for (const entry of t.squad || []) {
        const id = entry?.player?.toString?.() || entry?.player?.toString() || null;
        if (id) ids.add(id);
      }
      for (const entry of t.retentions || []) {
        const id = entry?.player?.toString?.() || entry?.player?.toString() || null;
        if (id) ids.add(id);
      }
      return ids.size >= maxSquad;
    });
  }

  /**
   * Complete the auction.
   */
  async _completeAuction(room, auctionState) {
    this._clearTimer(room._id.toString());

    auctionState.status = "COMPLETED";
    await auctionState.save();

    room.status = "completed";
    await room.save();

    await ActivityLog.create({
      room: room._id,
      type: "AUCTION_COMPLETED",
      payload: {
        totalSold: auctionState.totalPlayersSold,
        totalUnsold: auctionState.totalPlayersUnsold,
        totalSpent: auctionState.totalPurseSpent,
      },
    });

    this.emit("auction:completed", {
      roomCode: room.roomCode,
      roomId: room._id.toString(),
      stats: {
        totalSold: auctionState.totalPlayersSold,
        totalUnsold: auctionState.totalPlayersUnsold,
        totalSpent: auctionState.totalPurseSpent,
      },
    });

    return auctionState;
  }

  // ─────────────────────────── CONTROLS ───────────────────────────

  /**
   * Pause auction (host only).
   */
  async pauseAuction(roomCode, userId) {
    const room = await Room.findOne({ roomCode });
    if (!room) throw new Error("Room not found");
    if (room.host.userId !== userId) throw new Error("Only host can pause");

    const auctionState = await AuctionState.findOne({ room: room._id });
    if (!auctionState) throw new Error("Auction not initialized");

    this._clearTimer(room._id.toString());

    auctionState.status = "PAUSED";
    auctionState.timerEndsAt = null;
    await auctionState.save();

    room.status = "paused";
    await room.save();

    this.emit("auction:paused", {
      roomCode,
      roomId: room._id.toString(),
    });

    return auctionState;
  }

  /**
   * Resume auction (host only).
   */
  async resumeAuction(roomCode, userId) {
    const room = await Room.findOne({ roomCode });
    if (!room) throw new Error("Room not found");
    if (room.host.userId !== userId) throw new Error("Only host can resume");

    const auctionState = await AuctionState.findOne({ room: room._id });
    if (!auctionState || auctionState.status !== "PAUSED") {
      throw new Error("Auction is not paused");
    }

    room.status = "auction";
    await room.save();

    // Resume nominating
    auctionState.status = "NOMINATING";
    await auctionState.save();

    this.emit("auction:resumed", {
      roomCode,
      roomId: room._id.toString(),
    });

    // Nominate next player
    await this.nominatePlayer(roomCode);

    return auctionState;
  }

  /**
   * Get current auction state for a room (for reconnects / new joins).
   */
  async getAuctionState(roomCode) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");

    const auctionState = await AuctionState.findOne({ room: room._id })
      .populate({
        path: "currentPlayer",
      })
      .populate({
        path: "currentLeaguePlayer",
        populate: { path: "player" },
      })
      .populate({
        path: "soldPlayers.player",
        select: "name nationality isOverseas role image",
      })
      .populate({
        path: "soldPlayers.leaguePlayer",
        select: "basePrice stats previousTeam",
      })
      .lean();

    if (!auctionState) return null;

    const state = {
      ...auctionState,
      currentPlayer: this._withPlayerImage(auctionState.currentPlayer),
      currentLeaguePlayer: auctionState.currentLeaguePlayer
        ? this._buildAuctionPlayerPayload(
            {
              ...auctionState.currentLeaguePlayer,
              player: this._withPlayerImage(auctionState.currentLeaguePlayer.player),
            },
            auctionState.currentPlayerPhase || (auctionState.currentBidTeam ? "bid" : "scout")
          )
        : auctionState.currentLeaguePlayer,
      soldPlayers: (auctionState.soldPlayers || []).map((sp) => ({
        ...sp,
        player: this._withPlayerImage(sp.player),
      })),
    };

    // Calculate remaining timer
    let timerRemaining = 0;
    if (auctionState.timerEndsAt) {
      timerRemaining = Math.max(
        0,
        Math.ceil((new Date(auctionState.timerEndsAt) - Date.now()) / 1000)
      );
    }

    // Populate squad player refs for team display
    const populatedRoom = await Room.findOne({ roomCode })
      .populate({
        path: "joinedTeams.squad.player",
        select: "name nationality isOverseas role image",
      })
      .populate({
        path: "joinedTeams.squad.leaguePlayer",
        select: "fairPoint basePrice player stats stats2026 stats2024 stats2025 previousTeam",
        populate: {
          path: "player",
          select: "name nationality isOverseas role image",
        },
      });

    // Build set info
    const setInfo = this._buildSetInfo(
      room.league?.auctionSets || [],
      auctionState.setOrder || [],
      auctionState.currentSet || "M1",
      auctionState.completedSets || []
    );

    const setPoolPlayers = await this._getSetPoolPlayers(
      auctionState.setPool || [],
      auctionState.nominationIndex || 0
    );

    return {
      ...state,
      currentPlayerPhase: auctionState.currentPlayerPhase || (auctionState.currentBidTeam ? "bid" : "scout"),
      timerRemaining,
      setInfo,
      setPoolPlayers,
      host: room.host,
      playerIndexInSet: auctionState.nominationIndex || 0,
      totalPlayersInSet: auctionState.setPool?.length || 0,
      teams: (populatedRoom || room).joinedTeams.map((t) => ({
        teamName: t.teamName,
        teamShortName: t.teamShortName,
        userName: t.userName,
        userId: t.userId,
        remainingPurse: t.remainingPurse,
        totalPurse: t.totalPurse,
        squadSize: t.squad.length,
        squad: t.squad.map((s) => this._normalizeSquadEntry(s)),
        isConnected: t.isConnected,
        teamColor: t.teamColor || "",
        teamLogo:  t.teamLogo  || "",
      })),
    };
  }

  // ─────────────────────────── HELPERS ───────────────────────────

  /**
   * Re-populate the room's squad player refs and return serialized teams array.
   * Used for sending populated squad data in real-time events.
   */
  async _getTeamsWithSquad(room) {
    const populated = await Room.findById(room._id)
      .populate({
        path: "joinedTeams.squad.player",
        select: "name nationality isOverseas role image",
      })
      .populate({
        path: "joinedTeams.squad.leaguePlayer",
        select: "fairPoint basePrice player stats stats2026 stats2024 stats2025 previousTeam",
        populate: {
          path: "player",
          select: "name nationality isOverseas role image",
        },
      });
    return (populated || room).joinedTeams.map((t) => ({
      teamName: t.teamName,
      teamShortName: t.teamShortName,
      remainingPurse: t.remainingPurse,
      squadSize: t.squad.length,
      squad: t.squad.map((s) => this._normalizeSquadEntry(s)),
      teamColor: t.teamColor || "",
      teamLogo:  t.teamLogo  || "",
    }));
  }

  /**
   * Calculate minimum next bid based on IPL-style bracket rules.
   * < 1 Cr (100L): increment by 10L
   * 1-5 Cr (100-500L): increment by 25L
   * > 5 Cr (500L+): increment by 1 Cr (100L)
   */
  _calculateMinBid(currentBid, league) {
    if (!currentBid) return 20; // absolute minimum

    let increment;
    if (currentBid < 100) {
      increment = 10; // +10L when below 1 Cr
    } else if (currentBid < 500) {
      increment = 25; // +25L when 1-5 Cr
    } else {
      increment = 100; // +1 Cr when above 5 Cr
    }

    return currentBid + increment;
  }

  /**
   * Clean up timers for a room (on room delete / error).
   */
  cleanup(roomId) {
    this._clearTimer(roomId);
  }

  // ───────────────────── TIMER CONFIGURATION ─────────────────────

  /**
   * Update auction timer duration (host only).
   * Can be 5, 10, 15, or 20 seconds.
   */
  async updateTimerDuration(roomCode, userId, seconds) {
    const room = await Room.findOne({ roomCode });
    if (!room) throw new Error("Room not found");
    if (room.host.userId !== userId) throw new Error("Only host can change timer");

    const validTimers = [5, 10, 15, 20];
    if (!validTimers.includes(seconds)) throw new Error("Invalid timer value. Use 5, 10, 15, or 20.");

    room.auctionConfig.timerSeconds = seconds;
    await room.save();

    const auctionState = await AuctionState.findOne({ room: room._id });
    if (auctionState) {
      auctionState.timerDurationMs = seconds * 1000;
      await auctionState.save();
    }

    return { seconds };
  }

  // ───────────────────── KICK PLAYER RETURN ─────────────────────

  /**
   * Return a kicked team's players back to the auction pool.
   * Called when a host kicks a user during an active auction.
   */
  async returnPlayersToPool(roomCode, squadEntries) {
    const room = await Room.findOne({ roomCode });
    if (!room) return;

    const auctionState = await AuctionState.findOne({ room: room._id });
    if (!auctionState || auctionState.status === "COMPLETED") return;

    const leaguePlayerIds = new Set(
      squadEntries
        .map((s) => s.leaguePlayer?.toString())
        .filter(Boolean)
    );

    // Remove from soldPlayers and track purse returned
    const beforeCount = auctionState.soldPlayers.length;
    let purseReturned = 0;
    auctionState.soldPlayers = auctionState.soldPlayers.filter((sp) => {
      const id = sp.leaguePlayer?.toString();
      if (leaguePlayerIds.has(id)) {
        purseReturned += sp.soldPrice || 0;
        return false;
      }
      return true;
    });
    const removed = beforeCount - auctionState.soldPlayers.length;

    // Add back to unsoldPlayers and playerPool for re-auction
    for (const lpId of leaguePlayerIds) {
      if (!auctionState.unsoldPlayers.some((id) => id.toString() === lpId)) {
        auctionState.unsoldPlayers.push(lpId);
      }
      if (!auctionState.playerPool.some((id) => id.toString() === lpId)) {
        auctionState.playerPool.push(lpId);
      }
    }

    // Update stats
    auctionState.totalPlayersSold -= removed;
    auctionState.totalPurseSpent -= purseReturned;

    await auctionState.save();

    await ActivityLog.create({
      room: room._id,
      type: "PLAYERS_RETURNED_TO_POOL",
      payload: { count: leaguePlayerIds.size, reason: "team_kicked" },
    });
  }
}

// Singleton
module.exports = new AuctionEngine();
