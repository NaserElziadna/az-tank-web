import { EventBus } from '../src/core/events/EventBus.js';
import { B2Match } from '../src/phaser/B2Match.js';
import { Player } from '../src/models/Player.js';
import { ControllerType, Difficulty } from '../src/models/enums.js';
import { colorForSlot } from '../src/rendering/Palette.js';
import { C } from '../src/constants/GameConstants.js';
import { MSG, serializeMaze, buildSnapshot, genToken } from '../src/net/protocol.js';
import { NetController } from './NetController.js';
import { AIController } from '../src/ai/AIController.js';
import { log } from '../src/core/log/Logger.js';

const rlog = log.scope('room');

const MAX_HUMANS = 4; // dedicated human seats (slots 0–3)
const MAX_BOTS = 4; // optional AI tanks stacked above the humans (slots 4–7)
const MIN_HUMANS_TO_START = 2; // online is player-vs-player; a lone player waits
const SNAP_HZ = 20; // authoritative snapshot rate
const SNAP_INTERVAL = 1 / SNAP_HZ;
const POINTS_TO_WIN = 5;
const MAX_PENDING_EVENTS = 120; // safety cap on the per-snapshot event batch
const RECONNECT_GRACE_MS = 120000; // keep a dropped player's slot reserved this long (refresh / drop / battery)

// Gameplay events forwarded to clients so audio + particle effects + screen
// shake fire online (the sim runs server-side, so the client can't emit these
// itself). Payloads are spread through verbatim (they carry x/y where relevant).
const FORWARDED_EVENTS = [
  'weapon:fire',
  'weapon:flash',
  'ability:activate',
  'projectile:bounce',
  'tank:bump',
  'tank:damaged',
  'tank:destroyed',
  'mine:detonated',
  'mine:tripped',
  'collectible:picked',
  'round:countdown:tick',
  'round:start',
  'tank:revived',
];

/**
 * One online match room. Holds the connected members, the single authoritative
 * {@link B2Match}, and the fixed-timestep server loop that steps the sim and
 * broadcasts snapshots (with a piggy-backed gameplay-event batch).
 *
 * Seats are two separate pools: up to {@link MAX_HUMANS} real players (slots
 * 0–3) plus a host-configured set of AI bots (slots 4–7), each with its own
 * skill. A match needs {@link MIN_HUMANS_TO_START} humans to begin — a lone
 * player waits in the lobby — and players can join any time there's an open
 * human seat (spawning at the next round). With revive-bots on, killed bots
 * respawn while a human is alive, so a round ends on human elimination, never on
 * a bots-only duel. A human who leaves mid-match is handed to the AI so their
 * tank keeps fighting instead of freezing.
 */
export class Room {
  /** @param {string} code @param {() => void} onEmpty called when the last member leaves */
  constructor(code, onEmpty) {
    this.code = code;
    this._onEmpty = onEmpty;
    /** @type {Map<string, {ws:any, id:string, name:string, slot:number}>} */
    this.members = new Map();
    this.hostId = null;
    this.started = false;
    // Bot roster: one entry per AI tank, each with its own skill. Host-controlled
    // (lobby + mid-match). Defaults to a small, lively arena out of the box.
    this.bots = [{ difficulty: Difficulty.HARD }, { difficulty: Difficulty.HARD }];
    this.reviveBots = true; // killed bots respawn while a human is alive
    this.pointsToWin = POINTS_TO_WIN; // host-controlled (lobby only)
    this.bus = new EventBus();
    this.match = null;
    /** @type {Map<number, NetController>} */
    this.controllers = new Map();
    this._loop = null;
    this._acc = 0;
    this._snapAcc = 0;
    this._last = 0;
    this._snapCount = 0;
    this._matchOverSent = false;
    this._pendingEvents = [];

    this.bus.on('round:created', () => {
      this._aiControlDisconnected(); // reserved-but-absent players play as bots this round
      this._broadcastRoundStart();
    });
    this._wireEvents();
  }

  /** Drive any reserved-but-disconnected members' tanks with the AI for this round. */
  _aiControlDisconnected() {
    if (!this.match || !this.match.round) return;
    for (const m of this.members.values()) {
      if (m.connected === false) {
        const player = this.match.players.find((p) => p.slot === m.slot);
        if (player) this.match.round.setController(m.slot, new AIController(player));
      }
    }
  }

  /**
   * Subscribe to the sim's event bus once: forward gameplay events to clients
   * (for audio/effects) and mirror the meaningful ones into the log (rare events
   * in full, hot ones sampled, so the log is rich without flooding).
   */
  _wireEvents() {
    const code = this.code;
    for (const name of FORWARDED_EVENTS) {
      this.bus.on(name, (payload) => {
        if (this._pendingEvents.length < MAX_PENDING_EVENTS) this._pendingEvents.push({ e: name, ...payload });
      });
    }
    this.bus.on('tank:destroyed', (e) => rlog.info('kill', { code, slot: e.slot, by: e.killerSlot ?? null }));
    this.bus.on('round:decided', (e) => rlog.info('round decided', { code, winnerSlot: e.winnerSlot }));
    this.bus.on('collectible:picked', (e) => rlog.info('pickup', { code, slot: e.slot, type: e.type }));
    this.bus.on('ability:activate', (e) => rlog.info('ability', { code, slot: e.slot, kind: e.kind }));
    this.bus.on('weapon:fire', (e) => rlog.sampled(`fire-${code}`, 15, 'debug', 'weapon fire', { code, weapon: e.weapon }));
    this.bus.on('tank:damaged', (e) => rlog.sampled(`dmg-${code}`, 6, 'debug', 'tank damaged', { code, slot: e.slot ?? e.targetSlot }));
  }

  // ── lobby ──────────────────────────────────────────────────────────────
  /** Full = every human seat taken (bots don't occupy human seats). */
  get isFull() {
    return this.members.size >= MAX_HUMANS;
  }

  /** Lowest free human seat (0…MAX_HUMANS-1), or -1 if all taken. */
  _freeSlot() {
    const taken = new Set([...this.members.values()].map((m) => m.slot));
    for (let i = 0; i < MAX_HUMANS; i++) if (!taken.has(i)) return i;
    return -1;
  }

  /**
   * Seat a player. Allowed any time there's an open human seat — including
   * mid-match, in which case they're folded into the live roster and spawn at
   * the next round.
   * @returns {{slot:number, token:string}|null} assignment, or null if full
   */
  addMember(id, ws, name) {
    if (this.isFull) return null;
    const slot = this._freeSlot();
    if (slot < 0) return null;
    const token = genToken();
    this.members.set(id, { ws, id, name: name || `Player ${slot + 1}`, slot, token, connected: true, graceTimer: null });
    if (!this.hostId) this.hostId = id;
    if (this.started) this._applyRosterToMatch(); // join in progress → spawn next round
    this._broadcastRoomState();
    return { slot, token };
  }

  /** Socket dropped: reserve the slot for a grace period, hand the tank to AI. */
  handleDisconnect(id) {
    const m = this.members.get(id);
    if (!m) return;
    m.connected = false;
    m.ws = null;
    this.controllers.get(m.slot)?.neutral();
    if (this.started && this.match && this.match.round) {
      const player = this.match.players.find((p) => p.slot === m.slot);
      if (player) this.match.round.setController(m.slot, new AIController(player));
    }
    // Host duties pass to a connected member while they're away.
    if (this.hostId === id) this.hostId = this._firstConnectedId();
    rlog.info('disconnect (slot reserved)', { code: this.code, slot: m.slot, name: m.name, graceMs: RECONNECT_GRACE_MS });
    m.graceTimer = setTimeout(() => this.removeMember(id), RECONNECT_GRACE_MS);
    if (!this._firstConnectedId()) {
      // Nobody connected; if the grace lapses for all, the room empties itself.
      this._broadcastRoomState();
    } else {
      this._broadcastRoomState();
    }
  }

  /** Reconnect a dropped member by token onto their reserved slot. */
  rejoin(newId, ws, token) {
    const m = [...this.members.values()].find((x) => x.token === token && !x.connected);
    if (!m) return null;
    if (m.graceTimer) clearTimeout(m.graceTimer);
    this.members.delete(m.id);
    m.id = newId;
    m.ws = ws;
    m.connected = true;
    m.graceTimer = null;
    this.members.set(newId, m);
    if (!this._firstConnectedId() || this.hostId == null) this.hostId = newId;
    // Restore human control of their slot (swap the AI stand-in back out).
    if (this.started && this.match && this.match.round) {
      const ctrl = this.controllers.get(m.slot);
      if (ctrl) this.match.round.setController(m.slot, ctrl);
    }
    rlog.info('reconnect', { code: this.code, slot: m.slot, name: m.name, started: this.started });
    this._broadcastRoomState();
    // Mid-match: hand the rejoiner the live round so they can render the arena
    // immediately instead of staring at the lobby until the next round.
    if (this.started && this.match && this.match.sim) this.send(newId, this._roundStartMsg());
    return { slot: m.slot, token: m.token, isHost: this.hostId === newId };
  }

  removeMember(id) {
    const m = this.members.get(id);
    if (!m) return;
    if (m.graceTimer) clearTimeout(m.graceTimer);
    this.members.delete(id);
    this.controllers.delete(m.slot);
    if (this.started && this.match && this.match.round) {
      // Hand the abandoned tank to the AI so it keeps fighting this round; the
      // next round's roster (rebuilt below) drops the empty human seat.
      const player = this.match.players.find((p) => p.slot === m.slot);
      if (player) {
        this.match.round.setController(m.slot, new AIController(player));
        rlog.info('leaver → bot', { code: this.code, slot: m.slot, name: m.name });
      }
      this._applyRosterToMatch();
    }
    if (this.hostId === id) this.hostId = this._firstConnectedId();
    if (this.members.size === 0) {
      this.stop();
      this._onEmpty?.();
      return;
    }
    // Online is player-vs-player: if a leaver drops us below the minimum, end
    // the match so the survivor returns to waiting rather than soloing bots.
    if (this.started && !this._matchOverSent && this.members.size < MIN_HUMANS_TO_START) {
      this._endMatchNotEnoughPlayers();
    }
    this._broadcastRoomState();
  }

  /** End a running match early because too few humans remain to keep playing. */
  _endMatchNotEnoughPlayers() {
    this._matchOverSent = true;
    rlog.info('match ended — not enough players', { code: this.code, members: this.members.size });
    this.broadcast({ t: MSG.MATCH_OVER, winnerSlot: null, winnerName: null, reason: 'notEnoughPlayers' });
    this.stop();
  }

  _firstConnectedId() {
    for (const m of this.members.values()) if (m.connected) return m.id;
    return null;
  }

  roster() {
    return [...this.members.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((m) => ({ id: m.id, name: m.name, slot: m.slot, isHost: m.id === this.hostId, connected: m.connected !== false }));
  }

  /** Build the player list + human controller map: humans (0–3) then bots (4–7). */
  _buildRoster() {
    const players = [];
    const humanControllers = new Map();
    // Human seats — one per joined member, at their assigned slot.
    for (const m of [...this.members.values()].sort((a, b) => a.slot - b.slot)) {
      let ctrl = this.controllers.get(m.slot);
      if (!ctrl) {
        ctrl = new NetController();
        this.controllers.set(m.slot, ctrl);
      }
      humanControllers.set(m.slot, ctrl);
      players.push(new Player({ slot: m.slot, name: m.name, controller: ControllerType.HUMAN, color: colorForSlot(m.slot) }));
    }
    // Bots stacked above the human seats, each with its own skill.
    this.bots.slice(0, MAX_BOTS).forEach((b, i) => {
      const slot = MAX_HUMANS + i;
      const difficulty = Object.values(Difficulty).includes(b.difficulty) ? b.difficulty : Difficulty.HARD;
      const lethal = difficulty === Difficulty.LETHAL;
      players.push(new Player({ slot, name: `Bot ${i + 1}`, controller: ControllerType.AI, color: colorForSlot(slot), difficulty, lethal }));
    });
    return { players, humanControllers };
  }

  /** Re-roster a live match (preserving scores); takes effect next round. */
  _applyRosterToMatch() {
    if (!this.match) return;
    const { players, humanControllers } = this._buildRoster();
    for (const p of players) p.score = this.match.score ? this.match.score.get(p.slot) : 0;
    this.match.players = players;
    this.match._humanControllers = humanControllers;
    if (this.match.score) for (const p of players) this.match.score.register(p.slot);
  }

  // ── match lifecycle ──────────────────────────────────────────────────────
  /** Host sets the bot roster (count + per-bot skill). Any time → next round. */
  setBots(bots, byId) {
    if (byId !== this.hostId) return;
    const list = Array.isArray(bots) ? bots.slice(0, MAX_BOTS) : [];
    this.bots = list.map((b) => ({ difficulty: Object.values(Difficulty).includes(b && b.difficulty) ? b.difficulty : Difficulty.HARD }));
    rlog.info('bots set', { code: this.code, bots: this.bots.map((b) => b.difficulty), started: this.started });
    if (this.started) this._applyRosterToMatch(); // applies next round
    this._broadcastRoomState();
  }

  /** Host sets revive-bots (any time → effective immediately) and points-to-win (lobby only). */
  setSettings({ pointsToWin, reviveBots }, byId) {
    if (byId !== this.hostId) return;
    if (typeof reviveBots === 'boolean') {
      this.reviveBots = reviveBots;
      if (this.match) this.match.reviveBots = reviveBots;
      if (this.match && this.match.round) this.match.round.reviveBots = reviveBots;
    }
    if (pointsToWin && !this.started) {
      this.pointsToWin = Math.max(1, Math.min(20, Math.round(pointsToWin)));
    }
    rlog.info('settings', { code: this.code, reviveBots: this.reviveBots, pointsToWin: this.pointsToWin, started: this.started });
    this._broadcastRoomState();
  }

  /** Enough real players present to begin/continue a match. */
  get canStart() {
    return this.members.size >= MIN_HUMANS_TO_START;
  }

  start(byId) {
    if (this.started || byId !== this.hostId || !this.canStart) return false;
    return this._beginMatch();
  }

  /** Host rematch after a match ends — same room, same members. */
  restart(byId) {
    if (byId !== this.hostId || !this._matchOverSent || !this.canStart) return false;
    return this._beginMatch();
  }

  _beginMatch() {
    this.started = true;
    const { players, humanControllers } = this._buildRoster();

    this.match = new B2Match(this.bus);
    this.match.configure(players, { pointsToWin: this.pointsToWin, humanControllers, reviveBots: this.reviveBots });
    this.match.start(); // emits round:created → _broadcastRoundStart

    this._matchOverSent = false;
    this._acc = 0;
    this._snapAcc = 0;
    this._snapCount = 0;
    this._pendingEvents.length = 0;
    this._last = Date.now();
    if (this._loop) clearInterval(this._loop);
    this._loop = setInterval(() => this._tick(), Math.round(1000 * C.STEP));
    rlog.info('match started', { code: this.code, reviveBots: this.reviveBots, players: players.map((p) => `${p.name}/${p.isHuman ? 'H' : 'AI'}`) });
    return true;
  }

  setInput(id, input) {
    const m = this.members.get(id);
    if (!m || !this.started) return;
    this.controllers.get(m.slot)?.setInput(input);
  }

  /** Relay a WebRTC voice-signaling message to the member in the target slot. */
  relayRtc(fromId, msg) {
    const from = this.members.get(fromId);
    if (!from) return;
    const target = [...this.members.values()].find((m) => m.slot === msg.toSlot && m.connected !== false);
    if (target) this.send(target.id, { t: MSG.RTC, fromSlot: from.slot, kind: msg.kind, payload: msg.payload });
  }

  _flushEvents() {
    if (this._pendingEvents.length === 0) return undefined;
    const ev = this._pendingEvents;
    this._pendingEvents = [];
    return ev;
  }

  _tick() {
    if (!this.match) return;
    try {
      const now = Date.now();
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (dt > 0.25) dt = 0.25;

      this._acc += dt;
      let steps = 0;
      while (this._acc >= C.STEP && steps < 5) {
        this.match.update(C.STEP);
        this._acc -= C.STEP;
        steps++;
      }
      if (steps === 5) this._acc = 0;

      this._snapAcc += dt;
      if (this._snapAcc >= SNAP_INTERVAL) {
        this._snapAcc = 0;
        const snap = buildSnapshot(this.match);
        snap.ev = this._flushEvents(); // piggy-back the gameplay-event batch
        this.broadcast(snap);
        if (this._snapCount === 0) rlog.info('first snapshot', { code: this.code, phase: this.match.phase });
        else if (this._snapCount % (SNAP_HZ * 5) === 0) rlog.debug('snapshot heartbeat', { code: this.code, n: this._snapCount, phase: this.match.phase });
        this._snapCount++;
      }

      if (this.match.matchOver && !this._matchOverSent) {
        this._matchOverSent = true;
        const winner = this.match.matchWinner;
        rlog.info('match over', { code: this.code, winnerSlot: winner ? winner.slot : null, winner: winner ? winner.name : null });
        this.broadcast({ t: MSG.MATCH_OVER, winnerSlot: winner ? winner.slot : null, winnerName: winner ? winner.name : null });
        this.stop();
      }
    } catch (err) {
      rlog.error('tick crashed — stopping room loop', { code: this.code, snapCount: this._snapCount, err: { message: err.message, stack: err.stack } });
      this.stop();
    }
  }

  stop() {
    if (this._loop) clearInterval(this._loop);
    this._loop = null;
  }

  // ── broadcast helpers ──────────────────────────────────────────────────────
  _broadcastRoomState() {
    this.broadcast({
      t: MSG.ROOM_STATE,
      code: this.code,
      started: this.started,
      maxHumans: MAX_HUMANS,
      maxBots: MAX_BOTS,
      minToStart: MIN_HUMANS_TO_START,
      bots: this.bots,
      reviveBots: this.reviveBots,
      pointsToWin: this.pointsToWin,
      members: this.roster(),
    });
  }

  /** The ROUND_START payload for the current round (maze + player meta). */
  _roundStartMsg() {
    return {
      t: MSG.ROUND_START,
      round: this.match.roundNumber,
      maze: serializeMaze(this.match.sim.maze),
      players: this.match.players.map((p) => ({ slot: p.slot, name: p.name, isHuman: p.isHuman, color: p.color })),
    };
  }

  _broadcastRoundStart() {
    if (!this.match || !this.match.sim) return;
    const tiles = this.match.sim.maze.tiles;
    rlog.info('round start', { code: this.code, round: this.match.roundNumber, maze: `${tiles.length}x${tiles[0].length}` });
    this.broadcast(this._roundStartMsg());
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) {
      try {
        if (m.ws.readyState === 1 /* OPEN */) m.ws.send(data);
      } catch {
        /* drop on a dead socket; removeMember handles cleanup on close */
      }
    }
  }

  send(id, msg) {
    const m = this.members.get(id);
    if (m && m.ws.readyState === 1) m.ws.send(JSON.stringify(msg));
  }
}
