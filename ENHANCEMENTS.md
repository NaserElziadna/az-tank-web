# AZ Tank — Audit & Enhancement Report

Produced by a fan-out study: **12 read-only code-audit agents** (one per subsystem)
+ **5 web-research agents** (netcode, voice, canvas perf, AI, mobile UX), then the
critical bug claims were spot-verified against the code. Items are grouped by
priority; each subsystem section lists the meaningful fixes.

Legend: 🔴 fix-now bug · 🟡 quick win · 🟢 enhancement.

---

## 🔝 Top priorities (highest value first)

1. **Delete the dead "clean-engine" path (verified).** `src/game/GameController.js`,
   `src/game/round/RoundSimulation.js`, `src/rendering/GameRenderer.js`,
   `src/physics/PhysicsWorld.js`, and most of `src/entities/*` are unused — both
   online and local play run `PhaserGame → B2Match → B2Round` (Box2D). ~1000 LOC of
   confusion + a second physics engine loaded for nothing. Also delete the unused
   `src/game/services/AudioService.js` (duplicate of PhaserAudio) and unused art
   (`diamondGlow/diamondRays/sparkle/celebration/placeholder-*.png`, ~50 KB).
2. **Small real bugs (verified):**
   - `LaserWeapon.js:29` `this._lock += 1/60` → `+= dt` (laser charge is frame-rate
     dependent; wrong on frame drops).
   - `B2Round.js:159` `treadOffset += … * (1/60)` → `* dt` (tread animation desyncs).
   - `GameConstants.js:32` bounce window `0.035s` is ~2 frames → legit corner
     double-bounces can be mis-destroyed; raise to ~`0.06s`.
   - `TankIconCompositor.get()` can null-deref if a tank part fails to load — add a guard.
   - Shield `weaken` is stored (`TankEntity.js:87`) but never decremented/checked —
     either implement the weakened phase or drop the constant.
3. **Mobile safe-area bug (verified).** `index.html` viewport lacks
   `viewport-fit=cover`, so every `env(safe-area-inset-*)` you wrote (touch buttons,
   HUD strip) resolves to **0** on notched phones. One-line, high value.
4. **Performance — pre-render the maze once to an offscreen canvas.** `MazeRenderer`
   rebuilds the whole floor + checkerboard + two wall passes + a gradient **every
   frame**; the maze never changes mid-round. Blit a cached bitmap instead — the
   single biggest per-frame win. (Also cap DPR at ~2, cache tank/text bitmaps,
   pre-bake particle sprite.)
5. **Server tier is the movement-lag ceiling.** Render free = throttled/shared CPU,
   so the 60 Hz sim runs behind and rubber-bands everyone. Decouple **snapshot send
   rate (15–20 Hz) from the 60 Hz sim**, and for real smoothness use the **$7 Starter**
   instance (0.5 CPU, no throttle, no cold start).
6. **Voice reliability.** No TURN server → ~14–20% of players (symmetric NAT/carrier)
   silently get no audio; ICE errors are swallowed; add `autoGainControl`; buffer ICE
   candidates until remote-desc is set; move to perfect-negotiation.
7. **Netcode robustness.** Add snapshot **sequence numbers** (detect loss/reorder),
   **adaptive** interpolation delay (not hardcoded 70 ms), and move the reconnect
   token to `sessionStorage`.
8. **No tests exist.** Add a tiny integration harness (2 bots, verify round lifecycle
   + collisions) to catch regressions on all this refactoring.

---

## Icons & visual assets  🔴
- 🔴 `_drawTankSprite()` (PhaserRenderer) is dead — in-game tanks are always vector.
  Either wire sprite rendering or delete the method + unused sprite assets.
- 🟡 Delete unused art (~50 KB); add a null guard + load timeout in `AssetStore`/compositor.
- 🟢 Asset preload progress bar; dynamic 140/200/320px tank parts by DPI; bake the
  8-pass outline into one offscreen pass.

## Tank rendering & model  🟡
- (The `GameRenderer` "missing health bars / spawnAnim" issues are in the **dead**
  local path — moot once it's deleted. `PhaserRenderer` already does them right.)
- 🟢 Smooth health-bar interpolation (lerp prev→current); damage flash/screen-shake on
  hit; colour-blind tank patterns; make spawn-pop/phasing constants configurable.

## Movement, physics & control feel  🟡
- 🔴 `treadOffset` uses `1/60` not `dt` (see top bugs).
- 🟡 Speed-boost velocity **snaps** — ramp it (lerp over ~0.1 s) so pickups feel smooth.
- 🟡 Harmonize touch turn sensitivity with keyboard; the heading-based stick (just
  shipped, see CONTROLS_RESEARCH.md) is the right model.
- 🟢 Vibration API haptics on wall-bump/fire; GamepadAPI support; variable-friction tiles.

## Powerups, weapons & abilities  🔴
- 🔴 `LaserWeapon` frame-rate-dependent charge (top bugs). Mine cooldown hardcoded
  (`0.4`) instead of a constant. Weapons lost on bot revive (imbalance in revive mode).
- 🟡 Add dry-fire / "ammo out" + "ability slot full" feedback (currently silent).
  Gatling charge / homing-arming visual indicator.
- 🟢 Ability **queue** (hold 2) or **cooldown** model instead of one-shot; weapon+upgrade
  combos; recoil/knockback; finish the **shield weaken** mechanic.

## Audio  🟡
- 🔴 `SettingsService` sound-enable/volume is **never applied** — the toggle/slider do
  nothing. Wire `PhaserAudio.setEnabled/​setVolume` on boot.
- 🔴 No mobile autoplay unlock — add a first-gesture `resume()`.
- 🟡 Delete dead `AudioService.js`; add an in-menu sound toggle; normalize volumes.
- 🟢 Background music; **duck game SFX 30% while a teammate speaks** (voice); per-crate
  pickup pitches; sound pooling for gatling/bounces; deaf-player visual sound cues.

## Layout / UI / UX  🟡
- 🟡 `:focus-visible` styles (keyboard a11y); disable Create/Join during async connect
  (double-submit); debounce bot-setting spam; `aria-label` the emoji buttons; live
  room-code validation.
- 🟢 Screen transition framework; reusable modal/dialog; loading spinners; quick-play
  matchmaking; persistent settings gear.

## AI tanks  🔴 (CPU-sensitive on free host)
- 🔴 **Throttle aiming to ~10–15 Hz** (biggest safe CPU win) — `_aimSolution` does up to
  5×5 raycasts per bot per 60 Hz tick; **stagger** bot thinking across frames.
- 🔴 Cap bounce depth at ~3 (LETHAL's 5 = 25 raycasts/solve, and reads as unfair).
- 🟡 Null-guard `ctrl?.think()`; cache `reachableTiles()`; cap the unbounded vendetta
  grudge; add AI-vs-AI fire guard; explicit **miss chance** for EASY (feels beatable).
- 🟢 Lead moving targets (MEDIUM+); barrel-settle dwell before firing; robust
  later-segment self-ricochet rejection; Reynolds wander for believable idle motion.

## Shooting & projectiles  🟡
- 🔴 Bounce anti-rattle window too tight (top bugs). Shield ricochets aren't flagged
  `bounced` (deadly-to-owner inconsistent with walls).
- 🟡 Early-return past `maxLifetime` before physics sync; log ricochet-kill events.
- 🟢 AI threat-dodge that accounts for **bounce paths**; homing "give up → fly straight";
  per-weapon fire-readiness gate.

## Netcode / online multiplayer  🔴
- 🔴 No sequence numbers (can't detect loss/reorder); reconnect token in `localStorage`
  (use `sessionStorage`); extrapolation cap of 2.0 freezes-then-snaps at high latency.
- 🟡 Adaptive interp delay from measured jitter; visual "no signal" indicator on
  starvation; validate `PROTOCOL_VERSION` on snapshots; exponential reconnect backoff.
- 🟢 **Decouple send rate (15–20 Hz) from sim (60 Hz)** [do this]; **delta snapshots**
  (only changed entities) then **binary** (MessagePack) — 50–70% bandwidth; move static
  per-entity fields (color/name/maxHp) to ROUND_START; send hp as int.

## Player voice chat  🔴
- 🔴 **No TURN** (symmetric NAT fails silently); ICE errors swallowed; offer/answer
  desync + no connection timeout → zombie peers; audio-element leak if disposed during
  reconnect grace.
- 🟡 Add `autoGainControl`; buffer ICE until remote-desc set; make peer creation
  idempotent; log ICE failures; ensure dispose order (voice before net).
- 🟢 **Perfect-negotiation** rewrite; env-driven TURN (metered/Cloudflare); Opus DTX
  (`usedtx=1`, `maxaveragebitrate=24000`) to cut silent-uplink CPU; ICE-restart on
  network handoff; spatial audio by tank position; start muted / push-to-talk.

## Performance  🟡
- 🟡 Swap-remove instead of 4× `.filter()` per frame; hoist `performance.now()` out of
  the draw loop; cache `ctx.font`; skip HUD layer entirely on mobile (drawHud=false).
- 🟢 Offscreen maze/particle/text bitmaps (see #4); code-split Phaser (1.3 MB) behind the
  menu; opaque context + `clearBeforeRender=false`; capped DPR; later WASM physics.

## Architecture & best practices  🔴
- 🔴 Dead code + dual physics engines (top #1). No tests. Server message-handler errors
  swallowed (client never learns). Timers (`_pingTimer`/`_hudTimer`) leak risk on rapid
  screen swaps.
- 🟡 Structured server error replies (`MSG.ERROR`); fix the Phaser boot try/catch at the
  root (boot in `_create`, not constructor); async log sink (don't block the event loop
  with `appendFileSync`).
- 🟢 Unify `GameController`+`B2Match` into one orchestrator behind a `PhysicsBackend`
  interface; test suite (core/ units + sim integration + online E2E); replay system
  (record snapshots+seed); weapon-balance telemetry.

---

## Suggested order of work
1. **Cleanup week:** delete dead code/assets/AudioService; fix the 5 verified bugs;
   `viewport-fit=cover`; wire the sound toggle. (Low risk, high signal-to-noise.)
2. **Feel week:** pre-render maze offscreen + DPR cap (perf); AI aim throttle+stagger;
   speed-boost ramp; decouple snapshot send rate.
3. **Robustness week:** voice TURN + ICE buffering + perfect-negotiation; snapshot
   sequence numbers + adaptive interp; sessionStorage token; a small test harness.
4. **Polish/growth:** PWA manifest + fullscreen/orientation; ability queue/cooldown;
   music + SFX ducking; delta/binary netcode; ($7 Render Starter for smooth real-time).
