# Mobile tank control — research findings & decision

Deep-research (103 agents, adversarially verified) on the best on-screen control
for a top-down tank maze game where tanks move along their facing at a capped
turn rate. Summary of the high-confidence findings and what we implemented.

## Verdict: heading-based steering with a capped turn rate + simultaneous drive

The best-feeling scheme is a **hybrid of "point where you want to go" and
tank-drive**: a single **floating** left thumb-stick whose **angle sets a target
heading**; the tank **rotates toward it at its capped turn rate while driving
forward in the same frame** whenever the stick is deflected past the dead zone.

Why this over the alternatives:

- **Pure tank-drive** (up=forward, left/right=rotate) is the classic
  *turn-then-drive lag* antipattern — you must first rotate, then push forward
  (two actions). This is what made our movement feel "weird".
- **Point-then-drive** (rotate fully toward target *before* moving) feels laggy.
  The fix is to **turn and drive in the same frame** (drive while the target is
  within a wide arc of the current facing).
- **Twin-stick** needs two thumbs and doesn't suit a one-hand casual maze game.

## Concrete rules (verified, high-confidence)

1. **One target angle from the whole stick vector** via `atan2(vy, vx)` — never
   mix independent X-rotate / Y-drive channels (that causes diagonal
   cardinal-snapping = the "weird curving").
2. **Radial (scaled) dead zone** on the whole-vector magnitude, ~**15–20%** of
   the stick radius — not per-axis dead zones.
3. **Allow simultaneous turn + drive.** Drive forward whenever the heading error
   is within a wide arc (~110°); only rotate-in-place when the target is roughly
   behind you.
4. **Do NOT snap the body** to the stick; rotate toward it at the capped rate
   (clamp per-frame rotation to `turnSpeed * dt`). Reverse = target + 180°, never
   a negative turn delta.
5. **Floating / re-centering joystick** (appears under the finger), not a fixed
   knob.
6. **Reconcile the server turn cap with a responsive stick via client-side
   prediction** — run the *same* capped-rotation code client-side so the local
   tank moves instantly; keep the server authoritative and smooth corrections
   over ~100–200 ms. Do **not** loosen the turn cap.

## What we implemented (src/phaser/TouchControls.js)

- Floating stick (touch anywhere in the left zone → stick appears under finger).
- `read(currentRot)`: `desired = atan2(vy,vx)`, `err = shortAngle(desired −
  currentRot)`, `turn = clamp(err / 0.35, −1, 1)`, `drive = |err| < 1.95 ? 1 : 0`.
- Radial dead zone `STICK_DEAD = 0.18`.
- Client-side prediction already runs the sim's exact capped-rotation movement
  for the local tank (PhaserOnlineGame `_predict`), reconciling to snapshots.

## Sources
- Tank controls (Wikipedia); Unity `Mathf.MoveTowardsAngle` docs; sharpcoderblog
  mobile joystick tutorial; gamedeveloper.com "Doing thumbstick dead zones
  right"; Valve Source multiplayer networking; Gabriel Gambetta client-side
  prediction & server reconciliation.
