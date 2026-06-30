import { EventBus } from '../src/core/events/EventBus.js';
import { B2Match } from '../src/phaser/B2Match.js';
import { Player } from '../src/models/Player.js';
import { ControllerType, Difficulty } from '../src/models/enums.js';
import { colorForSlot } from '../src/rendering/Palette.js';
import { C } from '../src/constants/GameConstants.js';
import { MSG, serializeMaze, buildSnapshot } from '../src/net/protocol.js';
import { NetController } from './NetController.js';
import { AIController } from '../src/ai/AIController.js';
import { log } from '../src/core/log/Logger.js';

const rlog = log.scope('room');

const MAX_SLOTS = 4; // classic 2–4 arena; humans fill low slots, bots fill the rest
const SNAP_HZ = 20; // authoritative snapshot rate
const SNAP_INTERVAL = 1 / SNAP_HZ;
const POINTS_TO_WIN = 5;
const MAX_PENDING_EVENTS = 120; // safety cap on the per-snapshot event batch

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
];

/**
 * One online match room. Holds the connected members, the single authoritative
 * {@link B2Match}, and the fixed-timestep server loop that steps the sim and
 * broadcasts snapshots (with a piggy-backed gameplay-event batch). The host can
 * toggle whether empty seats are filled with AI bots, in the lobby AND mid-match
 * (it takes effect at the next round). A human who leaves mid-match is handed to
 * the AI so their tank keeps fighting instead of freezing.
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
    this.fillBots = true; // host-controlled; default keeps the arena full
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

    this.bus.on('round:created', () => this._broadcastRoundStart());
    this._wireEvents();
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
  get isFull() {
    return this.members.size >= MAX_SLOTS;
  }

  /** Lowest free slot index, or -1 if full. */
  _freeSlot() {
    const taken = new Set([...this.members.values()].map((m) => m.slot));
    for (let i = 0; i < MAX_SLOTS; i++) if (!taken.has(i)) return i;
    return -1;
  }

  /** @returns {number} assigned slot, or -1 if the room is full / already started */
  addMember(id, ws, name) {
    if (this.started || this.isFull) return -1;
    const slot = this._freeSlot();
    if (slot < 0) return -1;
    this.members.set(id, { ws, id, name: name || `Player ${slot + 1}`, slot });
    if (!this.hostId) this.hostId = id;
    this._broadcastRoomState();
    return slot;
  }

  removeMember(id) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    this.controllers.delete(m.slot);
    if (this.started && this.match && this.match.round) {
      // Hand the abandoned tank to the AI so it keeps fighting this round; the
      // next round's roster (rebuilt below) decides the seat per fillBots.
      const player = this.match.players.find((p) => p.slot === m.slot);
      if (player) {
        this.match.round.setController(m.slot, new AIController(player));
        rlog.info('leaver → bot', { code: this.code, slot: m.slot, name: m.name });
      }
      this._applyRosterToMatch();
    }
    if (this.hostId === id) this.hostId = this.members.keys().next().value || null;
    if (this.members.size === 0) {
      this.stop();
      this._onEmpty?.();
    } else {
      this._broadcastRoomState();
    }
  }

  roster() {
    return [...this.members.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((m) => ({ id: m.id, name: m.name, slot: m.slot, isHost: m.id === this.hostId }));
  }

  /** Build the player list + human controller map from members + fillBots. */
  _buildRoster() {
    const players = [];
    const humanControllers = new Map();
    for (let slot = 0; slot < MAX_SLOTS; slot++) {
      const human = [...this.members.values()].find((mm) => mm.slot === slot);
      if (human) {
        let ctrl = this.controllers.get(slot);
        if (!ctrl) {
          ctrl = new NetController();
          this.controllers.set(slot, ctrl);
        }
        humanControllers.set(slot, ctrl);
        players.push(new Player({ slot, name: human.name, controller: ControllerType.HUMAN, color: colorForSlot(slot) }));
      } else if (this.fillBots) {
        players.push(new Player({ slot, name: `Bot ${slot + 1}`, controller: ControllerType.AI, color: colorForSlot(slot), difficulty: Difficulty.HARD }));
      }
    }
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
  setFillBots(on, byId) {
    if (byId !== this.hostId) return;
    this.fillBots = !!on;
    rlog.info('fillBots toggled', { code: this.code, on: this.fillBots, started: this.started });
    if (this.started) this._applyRosterToMatch(); // applies next round
    this._broadcastRoomState();
  }

  start(byId) {
    if (this.started || byId !== this.hostId) return false;
    return this._beginMatch();
  }

  /** Host rematch after a match ends — same room, same members. */
  restart(byId) {
    if (byId !== this.hostId || !this._matchOverSent) return false;
    return this._beginMatch();
  }

  _beginMatch() {
    this.started = true;
    const { players, humanControllers } = this._buildRoster();

    this.match = new B2Match(this.bus);
    this.match.configure(players, { pointsToWin: POINTS_TO_WIN, humanControllers });
    this.match.start(); // emits round:created → _broadcastRoundStart

    this._matchOverSent = false;
    this._acc = 0;
    this._snapAcc = 0;
    this._snapCount = 0;
    this._pendingEvents.length = 0;
    this._last = Date.now();
    if (this._loop) clearInterval(this._loop);
    this._loop = setInterval(() => this._tick(), Math.round(1000 * C.STEP));
    rlog.info('match started', { code: this.code, fillBots: this.fillBots, players: players.map((p) => `${p.name}/${p.isHuman ? 'H' : 'AI'}`) });
    return true;
  }

  setInput(id, input) {
    const m = this.members.get(id);
    if (!m || !this.started) return;
    this.controllers.get(m.slot)?.setInput(input);
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
    this.broadcast({ t: MSG.ROOM_STATE, code: this.code, started: this.started, maxSlots: MAX_SLOTS, fillBots: this.fillBots, members: this.roster() });
  }

  _broadcastRoundStart() {
    if (!this.match || !this.match.sim) return;
    const tiles = this.match.sim.maze.tiles;
    rlog.info('round start', { code: this.code, round: this.match.roundNumber, maze: `${tiles.length}x${tiles[0].length}` });
    this.broadcast({
      t: MSG.ROUND_START,
      round: this.match.roundNumber,
      maze: serializeMaze(this.match.sim.maze),
      players: this.match.players.map((p) => ({ slot: p.slot, name: p.name, isHuman: p.isHuman, color: p.color })),
    });
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
