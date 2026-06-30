import Phaser from './phaserLib.js';
import { EventBus } from '../core/events/EventBus.js';
import { schemeForSlot } from '../core/input/ControlSchemes.js';
import { PhaserRenderer } from './PhaserRenderer.js';
import { PhaserControls } from './PhaserControls.js';
import { TouchControls, isTouchDevice } from './TouchControls.js';
import { AssetStore } from './AssetStore.js';
import { TankIconCompositor } from './TankIconCompositor.js';
import { RemoteMatch } from '../net/RemoteMatch.js';
import { log } from '../core/log/Logger.js';

const glog = log.scope('game');
const ilog = log.scope('input');
const INPUT_HZ = 30;
const INPUT_INTERVAL = 1 / INPUT_HZ;

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
  constructor(parentEl, { net, version = 'v2.0', initialRound = null }) {
    this.net = net;
    this.version = version;
    this.parentEl = parentEl;
    this.remote = new RemoteMatch();
    this.bus = new EventBus(); // local effects bus (shake etc.); server is the source of truth
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
      net.on('snapshot', (m) => this.remote.pushSnapshot(m)),
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
