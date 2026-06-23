import { C } from '../constants/GameConstants.js';
import { rng } from '../core/math/Random.js';
import { MazeGenerator } from '../maze/MazeGenerator.js';
import { RoundSimulation } from './round/RoundSimulation.js';
import { CrateSpawner } from './round/CrateSpawner.js';
import { AIController } from '../ai/AIController.js';
import { Score } from '../models/Score.js';
import { RoundPhase } from '../models/enums.js';

/**
 * The match orchestrator (top of the game layer).
 *
 * A small state machine — between-rounds → countdown → playing → finishing —
 * mirroring the original's lifecycle. It generates a fresh maze each round,
 * spawns one tank per player, wires up controllers (human keyboard or AI),
 * runs the {@link RoundSimulation}, awards the surviving tank a point, and ends
 * the match when a player reaches the points target.
 */
export class GameController {
  /**
   * @param {import('../core/events/EventBus.js').EventBus} bus
   */
  constructor(bus) {
    this.bus = bus;
    this.mazeGen = new MazeGenerator(rng);

    /** @type {import('../models/Player.js').Player[]} */
    this.players = [];
    this.score = new Score(0);
    this.pointsToWin = 0;
    this.enabledCrates = null;

    /** @type {RoundSimulation|null} */
    this.sim = null;
    this.spawner = null;

    this.phase = RoundPhase.COUNTDOWN;
    this._timer = 0;
    this.countdownValue = C.FLOW.COUNTDOWN_START_VALUE;
    this.showGo = false;

    /** @type {{winnerSlot:number|null}|null} round result for the overlay */
    this.roundResult = null;
    /** @type {import('../models/Player.js').Player|null} */
    this.matchWinner = null;
    this.matchOver = false;
    this.roundNumber = 0;

    // Persistent human controllers (AI controllers are recreated per round).
    /** @type {Map<number, {think:Function}>} */
    this._humanControllers = new Map();
  }

  /**
   * @param {import('../models/Player.js').Player[]} players
   * @param {object} opts
   * @param {number} [opts.pointsToWin] 0 = endless
   * @param {string[]} [opts.enabledCrates]
   * @param {Map<number,{think:Function}>} [opts.humanControllers] slot -> control reader
   */
  configure(players, { pointsToWin = 0, enabledCrates = null, humanControllers = new Map() } = {}) {
    this.players = players;
    this.pointsToWin = pointsToWin;
    this.score = new Score(pointsToWin);
    this.enabledCrates = enabledCrates;
    this._humanControllers = humanControllers;
    for (const p of players) {
      p.score = 0;
      this.score.register(p.slot);
    }
  }

  start() {
    this.matchOver = false;
    this.matchWinner = null;
    this.roundNumber = 0;
    this.score.reset();
    for (const p of this.players) p.score = 0;
    this._beginRound();
  }

  // ── round setup ──────────────────────────────────────────────────────────
  _beginRound() {
    this.roundNumber++;
    const maze = this.mazeGen.generate(this.players.length);
    this.sim = new RoundSimulation(maze, this.bus);
    this.spawner = new CrateSpawner(this.enabledCrates);

    const spawns = maze.tankSpawns;
    this.players.forEach((player, i) => {
      const spawn = spawns[i % spawns.length];
      this.sim.addTank(player, spawn);
      const controller = player.isAI
        ? new AIController(player)
        : this._humanControllers.get(player.slot) || { think: () => null };
      this.sim.setController(player.slot, controller);
    });

    this.phase = RoundPhase.COUNTDOWN;
    this.countdownValue = C.FLOW.COUNTDOWN_START_VALUE;
    this.showGo = false;
    this._timer = 0;
    this.roundResult = null;
    this.bus.emit('round:created', { round: this.roundNumber });
  }

  // ── per-frame ──────────────────────────────────────────────────────────
  /** @param {number} dt */
  update(dt) {
    if (!this.sim || this.matchOver) return;
    this._timer += dt;

    switch (this.phase) {
      case RoundPhase.COUNTDOWN:
        this._updateCountdown(dt);
        this.sim.update(dt, false); // tanks frozen, but spawn shields tick & world renders
        break;
      case RoundPhase.PLAYING:
        this.spawner.update(dt, this.sim);
        this.sim.update(dt, true);
        if (this.sim.finished) this._endRound();
        break;
      case RoundPhase.ENDING:
        this.sim.update(dt, false); // let explosions / shrapnel settle
        if (this._timer >= C.FLOW.ROUND_FINISHING_DURATION) this._afterRound();
        break;
      default:
        break;
    }
  }

  _updateCountdown(dt) {
    if (this.countdownValue > 0) {
      if (this._timer >= C.FLOW.COUNTDOWN_DURATION) {
        this._timer = 0;
        this.bus.emit('round:countdown:tick', { value: this.countdownValue });
        this.countdownValue--;
        if (this.countdownValue === 0) {
          this.showGo = true;
          this.bus.emit('round:start');
        }
      }
    } else if (this._timer >= C.FLOW.GO_DURATION) {
      this.showGo = false;
      this.phase = RoundPhase.PLAYING;
      this._timer = 0;
    }
  }

  _endRound() {
    const winnerSlot = this.sim.winnerSlot;
    this.roundResult = { winnerSlot };
    if (winnerSlot != null) {
      this.score.award(winnerSlot);
      const winner = this.players.find((p) => p.slot === winnerSlot);
      if (winner) winner.score = this.score.get(winnerSlot);
      this.bus.emit('score:changed', { slot: winnerSlot, score: this.score.get(winnerSlot) });
    }
    this.phase = RoundPhase.ENDING;
    this._timer = 0;
  }

  _afterRound() {
    const winnerSlot = this.score.winnerSlot;
    if (winnerSlot != null) {
      this.matchOver = true;
      this.matchWinner = this.players.find((p) => p.slot === winnerSlot) || null;
      this.bus.emit('match:over', { winner: this.matchWinner });
      return;
    }
    this._beginRound();
  }

  /** True while a round is actively being played (for input gating, HUD, etc.). */
  get isPlaying() {
    return this.phase === RoundPhase.PLAYING;
  }
}
