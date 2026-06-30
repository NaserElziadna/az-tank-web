import { EventBus } from '../src/core/events/EventBus.js';
import { B2Match } from '../src/phaser/B2Match.js';
import { Player } from '../src/models/Player.js';
import { ControllerType, Difficulty } from '../src/models/enums.js';
import { colorForSlot } from '../src/rendering/Palette.js';
import { C } from '../src/constants/GameConstants.js';
import { MSG, serializeMaze, buildSnapshot } from '../src/net/protocol.js';
import { NetController } from './NetController.js';
import { log } from '../src/core/log/Logger.js';

const rlog = log.scope('room');

const MAX_SLOTS = 4; // classic 2–4 arena; humans fill low slots, bots fill the rest
const SNAP_HZ = 20; // authoritative snapshot rate
const SNAP_INTERVAL = 1 / SNAP_HZ;
const POINTS_TO_WIN = 5;

/**
 * One online match room. Holds the connected members, the single authoritative
 * {@link B2Match}, and the fixed-timestep server loop that steps the sim and
 * broadcasts snapshots. Empty slots are filled with AI bots so the arena is
 * always full and there's always something to fight.
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
    this.bus = new EventBus();
    this.match = null;
    /** @type {Map<number, NetController>} */
    this.controllers = new Map();
    this._loop = null;
    this._acc = 0;
    this._snapAcc = 0;
    this._last = 0;
    this._matchOverSent = false;

    this.bus.on('round:created', () => this._broadcastRoundStart());
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
    // If the match is live, neutralise their tank's input (it lingers as a sitting duck).
    if (this.started) this.controllers.get(m.slot)?.neutral();
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

  // ── match lifecycle ──────────────────────────────────────────────────────
  start(byId) {
    if (this.started || byId !== this.hostId) return false;
    this.started = true;

    const players = [];
    const humanControllers = new Map();
    const humanSlots = new Set([...this.members.values()].map((m) => m.slot));
    for (let slot = 0; slot < MAX_SLOTS; slot++) {
      const human = [...this.members.values()].find((m) => m.slot === slot);
      if (human) {
        const ctrl = new NetController();
        this.controllers.set(slot, ctrl);
        humanControllers.set(slot, ctrl);
        players.push(new Player({ slot, name: human.name, controller: ControllerType.HUMAN, color: colorForSlot(slot) }));
      } else {
        players.push(new Player({ slot, name: `Bot ${slot + 1}`, controller: ControllerType.AI, color: colorForSlot(slot), difficulty: Difficulty.HARD }));
      }
    }

    this.match = new B2Match(this.bus);
    this.match.configure(players, { pointsToWin: POINTS_TO_WIN, humanControllers });
    this.match.start(); // emits round:created → _broadcastRoundStart

    this._matchOverSent = false;
    this._acc = 0;
    this._snapAcc = 0;
    this._snapCount = 0;
    this._last = Date.now();
    this._loop = setInterval(() => this._tick(), Math.round(1000 * C.STEP));
    rlog.info('match started', { code: this.code, players: players.map((p) => `${p.name}/${p.isHuman ? 'H' : 'AI'}`) });
    return true;
  }

  setInput(id, input) {
    const m = this.members.get(id);
    if (!m || !this.started) return;
    this.controllers.get(m.slot)?.setInput(input);
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
        this.broadcast(buildSnapshot(this.match));
        // First snapshot + a heartbeat every ~5s confirm the loop is alive.
        if (this._snapCount === 0) rlog.info('first snapshot', { code: this.code, phase: this.match.phase });
        else if (this._snapCount % (SNAP_HZ * 5) === 0) rlog.debug('snapshot heartbeat', { code: this.code, n: this._snapCount, phase: this.match.phase });
        this._snapCount++;
      }

      if (this.match.matchOver && !this._matchOverSent) {
        this._matchOverSent = true;
        rlog.info('match over', { code: this.code, winnerSlot: this.match.matchWinner ? this.match.matchWinner.slot : null });
        this.broadcast({ t: MSG.MATCH_OVER, winnerSlot: this.match.matchWinner ? this.match.matchWinner.slot : null });
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
    this.broadcast({ t: MSG.ROOM_STATE, code: this.code, started: this.started, maxSlots: MAX_SLOTS, members: this.roster() });
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
