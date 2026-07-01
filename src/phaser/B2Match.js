import { C } from '../constants/GameConstants.js';
import { rng } from '../core/math/Random.js';
import { MazeGenerator } from '../maze/MazeGenerator.js';
import { B2Round } from './B2Round.js';
import { CrateSpawner } from '../game/round/CrateSpawner.js';
import { AIController } from '../ai/AIController.js';
import { Score } from '../models/Score.js';
import { RoundPhase, GameModeId } from '../models/enums.js';
import { createMode } from '../game/mode/GameMode.js';

/**
 * Match orchestrator for the Box2D/Phaser build — the same state machine as the
 * clean-engine GameController (between-rounds → countdown → playing → ending),
 * but driving a {@link B2Round}. Reuses the maze generator, crate spawner, AI,
 * and scoring unchanged.
 */
export class B2Match {
  constructor(bus) {
    this.bus = bus;
    this.mazeGen = new MazeGenerator(rng);
    this.players = [];
    this.score = new Score(5);
    this.pointsToWin = 5; // first-to-5 by default (0 = endless; set via configure)
    this.mode = createMode(GameModeId.CLASSIC); // win/score/respawn strategy
    this.enabledCrates = null;
    this.round = null;
    this.spawner = null;
    this.phase = RoundPhase.COUNTDOWN;
    this._timer = 0;
    this.countdownValue = C.FLOW.COUNTDOWN_START_VALUE;
    this.showGo = false;
    this.roundResult = null;
    this.matchWinner = null;
    this.matchOver = false;
    this.roundNumber = 0;
    this._humanControllers = new Map();
    this.reviveBots = false; // online: respawn killed bots while a human is alive
  }

  get sim() {
    return this.round;
  }

  configure(players, { pointsToWin = 5, mode = GameModeId.CLASSIC, enabledCrates = null, humanControllers = new Map(), reviveBots = false } = {}) {
    this.players = players;
    this.mode = createMode(mode, { pointsToWin }); // team mode reads the target from here
    this.pointsToWin = pointsToWin;
    this.score = new Score(pointsToWin);
    this.enabledCrates = enabledCrates;
    this._humanControllers = humanControllers;
    this.reviveBots = reviveBots;
    for (const p of players) {
      p.score = 0;
      this.score.register(p.slot);
    }
  }

  /** Current mode id (for snapshots / HUD). */
  get modeId() {
    return this.mode.id;
  }

  /** Seconds left on the round clock for timed modes, or null. */
  get timeRemaining() {
    return this.mode.timeRemaining(this);
  }

  start() {
    this.matchOver = false;
    this.matchWinner = null;
    this.roundNumber = 0;
    this.score.reset();
    for (const p of this.players) p.score = 0;
    this._beginRound();
  }

  _beginRound() {
    this.roundNumber++;
    const maze = this.mazeGen.generate(this.players.length);
    this.round = new B2Round(maze, this.bus);
    this.round.mode = this.mode;
    this.round.reviveBots = this.reviveBots;
    this.spawner = new CrateSpawner(this.enabledCrates, { goldRush: this.mode.id === GameModeId.GOLD_RUSH });
    const spawns = maze.tankSpawns;
    this.players.forEach((player, i) => {
      const spawn = spawns[i % spawns.length];
      this.round.addTank(player, spawn);
      const controller = player.isAI ? new AIController(player) : this._humanControllers.get(player.slot) || { think: () => null };
      this.round.setController(player.slot, controller);
    });
    this.phase = RoundPhase.COUNTDOWN;
    this.countdownValue = C.FLOW.COUNTDOWN_START_VALUE;
    this.showGo = false;
    this._timer = 0;
    this.roundResult = null;
    this.mode.onRoundStart(this.round);
    this.bus.emit('round:created', { round: this.roundNumber, mode: this.mode.id });
  }

  update(dt) {
    if (!this.round || this.matchOver) return;
    this._timer += dt;
    switch (this.phase) {
      case RoundPhase.COUNTDOWN:
        this._updateCountdown();
        this.round.update(dt, false);
        break;
      case RoundPhase.PLAYING:
        this.spawner.update(dt, this.round);
        this.mode.onTick(this.round, dt);
        this.round.update(dt, true);
        if (this.round.finished) this._endRound();
        break;
      case RoundPhase.ENDING:
        this.round.update(dt, false);
        if (this._timer >= C.FLOW.ROUND_FINISHING_DURATION) this._afterRound();
        break;
      default:
        break;
    }
  }

  _updateCountdown() {
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
    const winnerSlot = this.round.winnerSlot;
    this.roundResult = { winnerSlot };
    this.mode.onRoundEnd(this, winnerSlot); // classic: +1 to the winner; frag modes: no-op
    this.bus.emit('round:ended', { winnerSlot, round: this.roundNumber, mode: this.mode.id });
    this.phase = RoundPhase.ENDING;
    this._timer = 0;
  }

  _afterRound() {
    if (this.mode.isMatchOver(this)) {
      this.matchOver = true;
      const ws = this.mode.matchWinnerSlot(this);
      this.matchWinner = ws != null ? this.players.find((p) => p.slot === ws) || null : null;
      this.bus.emit('match:over', { winner: this.matchWinner });
      return;
    }
    this._beginRound();
  }

  get isPlaying() {
    return this.phase === RoundPhase.PLAYING;
  }
}
