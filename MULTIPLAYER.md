# Online Multiplayer — Goal & Plan

> Branch: `feature/online-multiplayer`. Author: Claude (driving autonomously).
> No automated tests — the human tests the full flow at the end.

## The Goal (definition of done)

Two or more people, each in their own browser, play AZ Tank together in real time:

1. Player A clicks **Online → Create Room**, gets a 4-letter **room code**.
2. Players B/C/D enter the code and **join**. Empty slots are filled by **AI bots**.
3. Host starts the match. Everyone sees the **same maze, tanks, bullets, pickups**
   moving in sync, driven by an **authoritative Node server**.
4. Rounds play out (countdown → play → someone wins → next round) exactly like
   local play. Scores track across the match.
5. If a human leaves, their tank becomes a bot (or is removed) and play continues.
6. The whole thing is **deployable to Render free tier** (one Node web service
   serving both the static client and the WebSocket game server).

It should *feel* like the same game — just with friends instead of local AI.

## Architecture (decided)

- **Authoritative Node server** runs the existing JS sim headless. One sim per room.
- Clients send **input intents**; server steps at fixed 60Hz and broadcasts
  **state snapshots** (~20–30Hz) + discrete events.
- Maze syncs as a single **mulberry32 seed** (server-generated).
- Bots = server-side `AIController`, identical to local play.
- Transport: **WebSocket** (`ws`). JSON messages for v1 (optimize to binary later
  only if needed — bandwidth is tiny for 2–4 tanks).
- Client renders **interpolated** remote state. No client prediction in v1
  (tanks are slow; latency-forgiving). Add prediction later if it feels laggy.

## Phases

### Phase 0 — Headless sim ✅ proves the foundation
- Extract the pure simulation (`B2Match`/`B2Round`/`Box2DWorld`/AI/weapons/maze)
  so it imports and runs in Node with **zero Phaser/DOM/`window` references**.
- Node entry that runs one full round with bots and logs tank positions/events.
- Confirm box2dweb runs headless (fallback: custom `PhysicsWorld` substrate).

### Phase 1 — Networked core
- `ws` server: room registry, create/join by code, per-room game instance.
- Protocol: `createRoom`, `joinRoom`, `roomState`, `startMatch`, `mazeSeed`,
  `input`, `snapshot`, `roundStart`, `roundEnd`, `ping`/`pong`.
- Client: Online menu + lobby UI (code, player list), send inputs, render
  interpolated snapshots. Bots fill empty slots.

### Phase 2 — Robustness & feel
- Discrete events (tank/projectile/pickup destroyed) layered on snapshots.
- Disconnect/reconnect handling; leaver → bot.
- Ping display; snapshot interpolation buffer tuning.

### Phase 3 — Polish (optional)
- Client-side prediction for the local tank + server reconciliation.
- Binary message packing if bandwidth ever matters.

## Acceptance checklist (for the human's final test)

- [ ] Create room → get code; second browser joins with code.
- [ ] Both browsers see identical maze + synchronized tank/bullet motion.
- [ ] Bots fill empty slots and behave like local AI.
- [ ] Full match runs: countdown, rounds, scoring, match-over.
- [ ] A leaver doesn't crash the room.
- [ ] Deploys to Render and works over the public internet.
