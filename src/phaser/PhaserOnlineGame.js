import Phaser from './phaserLib.js';
import { EventBus } from '../core/events/EventBus.js';
import { schemeForSlot } from '../core/input/ControlSchemes.js';
import { PhaserRenderer } from './PhaserRenderer.js';
import { PhaserControls } from './PhaserControls.js';
import { TouchControls, isTouchDevice } from './TouchControls.js';
import { AssetStore } from './AssetStore.js';
import { TankIconCompositor } from './TankIconCompositor.js';
import { RemoteMatch } from '../net/RemoteMatch.js';
import { C } from '../constants/GameConstants.js';
import { RoundPhase } from '../models/enums.js';
import { log } from '../core/log/Logger.js';

const glog = log.scope('game');
const ilog = log.scope('input');
const INPUT_HZ = 30;
const INPUT_INTERVAL = 1 / INPUT_HZ;
const SNAP_CORRECTION = 0.3; // how hard each snapshot nudges the prediction back
const SNAP_THRESHOLD = 1.5; // metres of error past which we hard-snap (death/respawn)

/**
 * Online counterpart to {@link PhaserGame}. There is no local simulation: a
 * {@link RemoteMatch} is fed authoritative snapshots from the server and
 * interpolated each frame, then painted by the shared {@link PhaserRenderer}.
 * The local player's keyboard/touch input is sampled and streamed to the
 * server, which owns every tank (including ours).
 */
export class PhaserOnlineGame {
  /**
   * @param {HTMLElement} parentEl
   * @param {{net:import('../net/NetClient.js').NetClient, version?:string}} opts
   */
  constructor(parentEl, { net, version = 'v2.0', initialRound = null, bus = null, localSlot = null }) {
    this.net = net;
    this.version = version;
    this.parentEl = parentEl;
    this.localSlot = localSlot;
    this._pred = null; // client-side prediction of our own tank {x, y, rot}
    this.remote = new RemoteMatch();
    // Use the app's audio/effects bus so forwarded server events drive sound,
    // particles and screen shake. Falls back to a local bus if none provided.
    this.bus = bus || new EventBus();
    this.controls = null;
    this.touch = null;
    this.renderer = null;
    this._inputAcc = 0;
    this._lastInput = null;
    this._fpsFrames = 0;
    this._fpsTime = 0;

    glog.info('online game created', { hasInitialRound: !!initialRound });
    // The roundStart that triggered the launch was already dispatched before we
    // subscribed, so apply it directly to avoid waiting for the next round.
    if (initialRound) this.remote.onRoundStart(initialRound);

    this._starve = 0;
    this._starveWarned = false;
    this._unsub = [
      net.on('roundStart', (m) => this.remote.onRoundStart(m)),
      net.on('snapshot', (m) => {
        this.remote.pushSnapshot(m);
        this._replayEvents(m.ev);
        this._reconcile(m);
      }),
    ];

    const w = parentEl.clientWidth || 960;
    const h = parentEl.clientHeight || 600;
    const self = this;
    this.game = new Phaser.Game(w, h, Phaser.CANVAS, parentEl, {
      create() {
        self._create();
      },
      update() {
        self._update();
      },
      render() {
        self._render();
      },
    });
  }

  _create() {
    const game = this.game;
    game.scale.scaleMode = Phaser.ScaleManager.RESIZE;
    game.stage.disableVisibilityChange = true;

    this.controls = new PhaserControls(game, schemeForSlot(0));
    if (isTouchDevice()) this.touch = new TouchControls(this.parentEl);

    this.assets = new AssetStore();
    this.assets.load(320);
    this.compositor = new TankIconCompositor(this.assets);
    this.renderer = new PhaserRenderer(game, this.bus, this.version, this.assets, this.compositor);
  }

  /** Sample local input and stream it to the server at a fixed rate. */
  _update() {
    let dt = this.game.time.elapsedMS / 1000;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.25) dt = 0.25;

    const intent = this._readLocalInput();
    const changed = this._changed(intent);
    // Smart input logging: one line only when the held state actually changes,
    // never the 30Hz stream — so taps/turns are visible without flooding.
    if (changed) ilog.debug('input', intent);
    this._inputAcc += dt;
    // Send on a fixed cadence, plus immediately when the held state changes so
    // taps (fire/ability) are never swallowed by the throttle.
    if (this._inputAcc >= INPUT_INTERVAL || changed) {
      this._inputAcc = 0;
      this._lastInput = intent;
      this.net.sendInput(intent);
    }
    this._predict(intent, dt);
    if (this.renderer) this.renderer.update(dt);

    // Periodic telemetry: one rich line every 5s (FPS, rtt, interp buffer, who's
    // alive, current phase/round) — enough to see health at a glance, throttled.
    this._fpsFrames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 5) {
      const round = this.remote.round;
      glog.info('telemetry', {
        fps: Math.round(this._fpsFrames / this._fpsTime),
        rtt: this.net.rtt != null ? Math.round(this.net.rtt) : null,
        buf: this.remote._buf.length,
        phase: this.remote.phase,
        round: this.remote.roundNumber,
        alive: round ? round.tanks.filter((t) => t.alive).length : 0,
        proj: round ? round.projectiles.length : 0,
      });
      this._fpsFrames = 0;
      this._fpsTime = 0;
    }

    // Starvation watchdog: warn only on *sustained* snapshot loss. A new round
    // momentarily empties the buffer (onRoundStart) — that's not starvation, so
    // we require the buffer to stay empty for >2.5s, and re-arm once healthy.
    if (this.remote.round && this.remote._buf.length === 0) this._starve += dt;
    else this._starve = 0;
    if (this.remote._buf.length > 0) this._starveWarned = false;
    if (this._starve > 2.5 && !this._starveWarned) {
      this._starveWarned = true;
      glog.warn('snapshot starvation >2.5s', { netOpen: this.net.ws?.readyState, rtt: this.net.rtt, round: this.remote.roundNumber });
    }
  }

  /** Replay the server's gameplay-event batch on the bus → sound + effects + shake. */
  _replayEvents(events) {
    if (!events || !events.length) return;
    for (const e of events) this.bus.emit(e.e, e);
  }

  /** Latest authoritative state of our own tank (from the newest snapshot). */
  _authLocalTank() {
    if (this.localSlot == null) return null;
    const last = this.remote._buf[this.remote._buf.length - 1];
    return last ? last.snap.tanks.find((t) => t.slot === this.localSlot) : null;
  }

  /**
   * Advance the local tank from our own input immediately (no waiting for the
   * server round-trip), using the server's exact movement constants, then clamp
   * against maze walls so we don't visibly tunnel through them before the next
   * snapshot corrects us. Server stays authoritative — this is cosmetic latency
   * hiding for our own tank only.
   */
  _predict(intent, dt) {
    const auth = this._authLocalTank();
    if (!auth || !auth.alive) {
      this._pred = null;
      return;
    }
    // Only predict during live play; otherwise sit exactly on the server state.
    if (this.remote.phase !== RoundPhase.PLAYING) {
      this._pred = { x: auth.x, y: auth.y, rot: auth.rot };
      return;
    }
    if (!this._pred) this._pred = { x: auth.x, y: auth.y, rot: auth.rot };

    this._pred.rot += intent.turn * C.TANK.ROTATION_SPEED * dt;
    if (intent.drive !== 0) {
      const speed = intent.drive > 0 ? C.TANK.FORWARD_SPEED : -C.TANK.BACK_SPEED;
      this._pred.x += Math.cos(this._pred.rot) * speed * dt;
      this._pred.y += Math.sin(this._pred.rot) * speed * dt;
      const maze = this.remote.round && this.remote.round.maze;
      if (maze) clampToWalls(this._pred, C.TANK.COLLISION_RADIUS, maze);
    }
  }

  /** Nudge the prediction back toward the authoritative snapshot (or snap on a big jump). */
  _reconcile(snap) {
    if (this.localSlot == null || !this._pred) return;
    const auth = snap.tanks.find((t) => t.slot === this.localSlot);
    if (!auth || !auth.alive) {
      this._pred = null;
      return;
    }
    const ex = auth.x - this._pred.x;
    const ey = auth.y - this._pred.y;
    if (Math.hypot(ex, ey) > SNAP_THRESHOLD) {
      this._pred = { x: auth.x, y: auth.y, rot: auth.rot }; // death/respawn/round change
      return;
    }
    this._pred.x += ex * SNAP_CORRECTION;
    this._pred.y += ey * SNAP_CORRECTION;
    this._pred.rot += shortAngle(auth.rot - this._pred.rot) * SNAP_CORRECTION;
  }

  _readLocalInput() {
    const k = this.controls.read();
    const abilityHeld = this.controls.ability ? this.controls.ability.isDown : false;
    let drive = k.drive;
    let turn = k.turn;
    let fire = k.fire;
    let ability = abilityHeld;
    if (this.touch && this.touch.active) {
      const t = this.touch.read();
      if (t.drive !== 0) drive = t.drive;
      if (t.turn !== 0) turn = t.turn;
      fire = fire || t.fire;
      ability = ability || t.abilityPressed;
    }
    return { drive, turn, fire, ability };
  }

  _changed(i) {
    const p = this._lastInput;
    return !p || p.drive !== i.drive || p.turn !== i.turn || p.fire !== i.fire || p.ability !== i.ability;
  }

  _render() {
    if (!this.renderer) return;
    this.remote.interpolate();
    // Override our own tank with the predicted pose so our input feels instant.
    if (this._pred && this.remote.round) {
      const me = this.remote.round.tanks.find((t) => t.slot === this.localSlot && t.alive);
      if (me) {
        me.position = { x: this._pred.x, y: this._pred.y };
        me.prevPosition = me.position;
        me.rotation = this._pred.rot;
        me.prevRotation = this._pred.rot;
      }
    }
    if (this.remote.sim) this.renderer.render(this.remote, 0);
  }

  destroy() {
    for (const off of this._unsub) off?.();
    if (this.touch) {
      this.touch.dispose();
      this.touch = null;
    }
    if (this.renderer) this.renderer.dispose();
    try {
      if (this.game && this.game.isBooted) this.game.destroy(true);
    } catch {
      /* ignore teardown on a half-booted game */
    }
    this.game = null;
    this.renderer = null;
  }
}

/** Push a circle out of any maze wall it overlaps, and keep it inside the arena. */
function clampToWalls(p, r, maze) {
  for (const w of maze.walls) {
    const cx = Math.max(w.minX, Math.min(p.x, w.maxX));
    const cy = Math.max(w.minY, Math.min(p.y, w.maxY));
    let dx = p.x - cx;
    let dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * r;
      p.y = cy + (dy / d) * r;
    } else {
      // Center inside the rect: eject along the shallowest axis.
      const left = p.x - w.minX;
      const right = w.maxX - p.x;
      const top = p.y - w.minY;
      const bottom = w.maxY - p.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) p.x = w.minX - r;
      else if (m === right) p.x = w.maxX + r;
      else if (m === top) p.y = w.minY - r;
      else p.y = w.maxY + r;
    }
  }
  p.x = Math.max(r, Math.min(p.x, maze.worldWidth - r));
  p.y = Math.max(r, Math.min(p.y, maze.worldHeight - r));
}

function shortAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
