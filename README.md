# AZ Tank

A clean, original re-implementation of the classic top-down **tank maze battle** game
(in the spirit of *Tank Trouble*). Single screen, local play: **2–4 tanks**, any mix of
**humans and AI**. Drive through a freshly generated maze each round, bounce shots off the
walls, grab weapon crates, and be the last tank standing.

Built from scratch with a layered, pattern-driven architecture — no game framework, no
physics library. Just clean ES modules, an HTML5 canvas, and Vite.

## Quick start

```bash
npm install
npm run dev      # opens http://localhost:5173
```

Build for production:

```bash
npm run build    # -> dist/
npm run preview  # serve the build locally
```

## Controls (defaults)

| Player | Move / Turn        | Fire |
| ------ | ------------------ | ---- |
| 1      | Arrow keys         | `M`  |
| 2      | `E` `S` `D` `F`    | `Q`  |
| 3      | `U` `J` `H` `K`    | `O`  |
| 4      | Numpad `8 5 4 6`   | `+`  |

AI players need no keys. Mix and match in the setup screen.

## Architecture

The code is organised in layers, each depending only on the ones beneath it:

```
src/
  core/        Engine foundation — math, RNG, event bus, fixed-timestep loop,
               input, object pool, finite-state machine. Knows nothing about tanks.
  physics/     Custom 2D physics: circle bodies, capsule walls, collision
               resolution, bullet reflection, raycasts.
  maze/        Maze generation (Strategy) + a navigation graph for AI pathfinding.
  models/      Pure data: Player, Score, enums.
  entities/    Simulation objects: tanks, projectiles, crates, traps, collectibles.
  weapons/     Weapon behaviours behind a common interface (Factory + Strategy).
  ai/          AI controller, pathfinding and steering behaviours (state machine).
  rendering/   Canvas renderers (tank/maze/HUD/effects) + particle system + camera.
  game/        Orchestration: round simulation, controllers, services, app shell.
  ui/          Menu, player-setup and in-game overlay screens.
```

### Design patterns in use

- **Observer** — `EventBus` decouples gameplay events from HUD / audio / scoring.
- **State** — `StateMachine` drives both the round lifecycle and AI behaviour.
- **Strategy** — interchangeable maze generators, weapon behaviours, AI profiles.
- **Factory** — `WeaponFactory` builds weapons from a type enum.
- **Object Pool** — projectiles and particles are recycled to avoid GC churn.
- **Facade** — `Renderer` hides canvas/DPI/transform details from sprite code.

### Why no Box2D / Phaser?

The original uses heavyweight libraries; this clone implements a focused custom
engine instead. It keeps the dependency surface tiny, makes the physics fully
deterministic under a fixed timestep, and keeps every behaviour readable in one place.

## License

MIT — original code. Game concept and mechanics are reimplemented from scratch;
no original assets or source are included.
