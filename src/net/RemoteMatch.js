import { Maze } from '../maze/Maze.js';
import { C } from '../constants/GameConstants.js';
import { RoundPhase } from '../models/enums.js';
import { log } from '../core/log/Logger.js';

const mlog = log.scope('remote');

const INTERP_DELAY_MS = 100; // render ~2 snapshots in the past to absorb jitter
const BUFFER_MAX = 16;

/**
 * Client-side, render-only stand-in for a server {@link B2Match}.
 *
 * The authoritative sim lives on the server; this reconstructs just enough of
 * the live object graph for {@link PhaserRenderer} to paint, fed by JSON
 * snapshots. Entity positions are interpolated between the two snapshots
 * bracketing `now − INTERP_DELAY`, and `prevPosition`/`position` are set equal
 * to the interpolated point so the renderer's own lerp is a no-op (we do the
 * interpolation here, against wall-clock time, instead of a local sim step).
 */
export class RemoteMatch {
  constructor() {
    this.round = null; // RemoteRound
    this.players = [];
    this.phase = RoundPhase.COUNTDOWN;
    this.countdownValue = 3;
    this.showGo = false;
    this.roundNumber = 0;
    this.matchOver = false;
    this.matchWinner = null;
    this.roundResult = null;
    /** @type {{time:number, snap:object}[]} */
    this._buf = [];
  }

  get sim() {
    return this.round;
  }

  /** New round: rebuild the real maze from its tile grid and reset buffers. */
  onRoundStart(msg) {
    // The launch path can deliver the same roundStart twice (initialRound + the
    // live event dispatch); rebuild the maze only once per round.
    if (this._appliedRound === msg.round && this.round) return;
    this._appliedRound = msg.round;
    try {
      this.round = new RemoteRound(new Maze(msg.maze.tiles));
      this._meta = msg.players || [];
      this._buf.length = 0;
      mlog.info('round start applied', { round: msg.round, maze: `${msg.maze.tiles.length}x${msg.maze.tiles[0].length}` });
    } catch (err) {
      mlog.error('onRoundStart failed', err);
    }
  }

  /** Buffer an authoritative snapshot (called on each SNAPSHOT message). */
  pushSnapshot(snap) {
    if (!this.round) return;
    this._buf.push({ time: performance.now(), snap });
    if (this._buf.length > BUFFER_MAX) this._buf.shift();
  }

  /** Rebuild interpolated render state for the current frame. */
  interpolate(now = performance.now()) {
    if (!this.round || this._buf.length === 0) return;
    const renderTime = now - INTERP_DELAY_MS;

    let a = this._buf[0];
    let b = this._buf[0];
    for (let i = 0; i < this._buf.length; i++) {
      if (this._buf[i].time <= renderTime) {
        a = this._buf[i];
        b = this._buf[i + 1] || this._buf[i];
      }
    }
    const span = b.time - a.time;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.time) / span)) : 0;

    this._applyScalars(b.snap);
    this._applyTanks(a.snap, b.snap, alpha);
    this._applyProjectiles(a.snap, b.snap, alpha);
    this._applyMines(b.snap);
    this._applyCollectibles(b.snap);
    this.round.beams = b.snap.beams || [];
    this._applyPlayers(b.snap);
  }

  _applyScalars(s) {
    this.phase = s.phase;
    this.countdownValue = s.cd;
    this.showGo = s.go;
    this.roundNumber = s.rn;
    this.matchOver = s.mo;
    this.matchWinner = s.mw != null ? { slot: s.mw, name: nameForSlot(s.players, s.mw) } : null;
    this.roundResult = s.phase === RoundPhase.ENDING ? { winnerSlot: s.rr } : null;
  }

  _applyTanks(sa, sb, alpha) {
    const prevById = indexBy(sa.tanks, 'slot');
    this.round.tanks = sb.tanks.map((tb) => {
      const ta = prevById.get(tb.slot) || tb;
      const x = lerp(ta.x, tb.x, alpha);
      const y = lerp(ta.y, tb.y, alpha);
      const rot = ta.rot + shortAngle(tb.rot - ta.rot) * alpha;
      return {
        slot: tb.slot,
        alive: tb.alive,
        position: { x, y },
        prevPosition: { x, y },
        rotation: rot,
        prevRotation: rot,
        velocity: null, // (dust effect is skipped for remote tanks)
        reconTimer: tb.recon ? 1 : 0,
        hp: tb.hp,
        maxHp: tb.maxHp,
        colorKey: tb.color,
        lethal: tb.lethal,
        phasing: tb.phasing,
        spawnAnim: 1,
        treadOffset: 0,
        aimer: null,
        shield: tb.shieldRatio != null ? { time: tb.shieldRatio * C.UPGRADES.SHIELD.lifetime } : null,
        player: { name: nameForSlot(sb.players, tb.slot) },
        activeWeapon: { type: tb.wType, hudLabel: () => tb.wLabel },
        abilityActive: tb.abilityActive,
        ability: tb.ability,
      };
    });
  }

  _applyProjectiles(sa, sb, alpha) {
    const prevById = indexBy(sa.proj, 'id');
    this.round.projectiles = sb.proj.map((pb) => {
      const pa = prevById.get(pb.id) || pb;
      const x = lerp(pa.x, pb.x, alpha);
      const y = lerp(pa.y, pb.y, alpha);
      const rot = pa.rot + shortAngle(pb.rot - pa.rot) * alpha;
      return { id: pb.id, position: { x, y }, prevPosition: { x, y }, rotation: rot, prevRotation: rot, kind: pb.kind, colorKey: pb.color };
    });
  }

  _applyMines(sb) {
    this.round.mines = sb.mines.map((m) => ({
      id: m.id,
      position: { x: m.x, y: m.y },
      state: m.state,
      armed: m.state !== 'arming',
      colorKey: m.color,
    }));
  }

  _applyCollectibles(sb) {
    this.round.collectibles = sb.cols.map((c) => ({
      id: c.id,
      position: { x: c.x, y: c.y },
      prevPosition: { x: c.x, y: c.y },
      category: c.cat,
      kind: c.kind,
      rotation: c.rot,
      spin: c.rot,
      spawnAnim: c.anim,
    }));
  }

  _applyPlayers(sb) {
    const tankBySlot = indexBy(this.round.tanks, 'slot');
    this.players = (sb.players || []).map((p) => ({
      slot: p.slot,
      name: p.name,
      isHuman: p.isHuman,
      score: p.score,
      color: p.color,
      tank: tankBySlot.get(p.slot) || null,
    }));
  }
}

/** Minimal render-side round: a real Maze plus interpolated entity arrays. */
class RemoteRound {
  constructor(maze) {
    this.maze = maze;
    this.tanks = [];
    this.projectiles = [];
    this.mines = [];
    this.collectibles = [];
    this.beams = [];
    this.physics = null; // only used for the aimer trace, which remote tanks omit
  }
}

function indexBy(arr, key) {
  const m = new Map();
  for (const item of arr) m.set(item[key], item);
  return m;
}
function nameForSlot(players, slot) {
  const p = players && players.find((x) => x.slot === slot);
  return p ? p.name : `Tank ${slot + 1}`;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function shortAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
