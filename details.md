# Kick Off to Mars — Project Details

A single-page Phaser 3 arcade game about docking a Satellite at a randomized
sequence of Black Holes and then returning it to Earth, on a limited launch
budget. No physics engine (no Arcade/Matter Physics) — every motion is
explicit vector math written by hand.

## File layout

- `index.html` — page shell. Loads Phaser 3 from a CDN
  (`https://cdn.jsdelivr.net/npm/phaser@3.70.0/dist/phaser.min.js`), then
  `main.js`. The `#game-container` div (where the canvas mounts) and the
  `#hud` div are currently commented out in the body — the in-canvas mission
  text (see below) replaced the need for that HUD div, so don't
  un-comment it as a fix for anything; if the canvas has no `#game-container`
  to mount into, Phaser falls back to appending it to `document.body`
  directly, which is the current working behavior.
- `style.css` — centers the game canvas, dark theme (`#050510` background),
  styles for `#game-container` (1920x1080) and `#hud` (currently unused/
  commented out in HTML).
- `main.js` — the entire game: two Phaser Scenes (`MenuScene`, `MainScene`)
  plus the Phaser game config, all in one file.
- `res/` — expected location for optional art assets: `earth.png`,
  `blackhole.png`, `satellite.png`. **This folder is currently empty.** The
  game loads these by exact filename in `MainScene.preload()`; any that are
  missing 404 silently and the game falls back to primitive-shape
  placeholders (colored circles/triangle) for that object. Drop in files
  with those exact names to swap in real art — no code changes needed, they
  auto-scale to match the placeholder sizes.

## Canvas / config

- 1920x1080, background `#050510`.
- `config.scene = [MenuScene, MainScene]` — `MenuScene` is the entry point.
- `config.parent = 'game-container'`.

## Scenes

### MenuScene
Purely presentational title screen. Decorative spinning Earth + 4 spinning
Black Hole placeholders (tweened, not the real game objects), title text,
brief instructions, and a blinking "PRESS SPACE TO START" prompt. Pressing
`SPACE` or clicking the prompt calls `this.scene.start('MainScene')`. Holds
no game state.

### MainScene
All actual gameplay. Key pieces below.

## Core bodies

- **Earth**: fixed at canvas center (`this.earth = {x, y}`, a plain object,
  not a Phaser game object — used everywhere as an orbit-center reference).
  Rendered via `this.earthContainer` (a Phaser Container) so it can spin in
  place (`earthSpinSpeed = 0.4` rad/sec) without moving position. Radius
  `earthRadius = 40`.
- **Black Holes**: 8 of them (`blackHoleCount`), each with a unique `id`
  1–8. They sit at **fixed positions relative to Earth** — they do NOT
  orbit. All 8 sit on one ring at `blackHoleDistanceFromCenter` (currently
  `earthRadius + 4.5 * earthDiameter = 400px` from Earth's center), evenly
  spaced by angle (`360° / 8 = 45°` apart) so they can never overlap or sit
  close together, with one shared random rotation offset per run/restart so
  the layout isn't identical every time. Each spins in place on its own axis
  at a random speed (`0.005–0.015 rad/frame`) and random direction (CW/CCW)
  — this is purely visual (a `Container.rotation` tween-like increment), it
  does not move the black hole's `x`/`y`. Radius `blackHoleRadius = 20`.
  Each also renders a small ID label (Phaser Text, centered) and a static
  stroked-circle "orbit ring" at `blackHoleOrbitRadius` (see below).
- **Satellite**: the player-controlled object, red triangle (or
  `satellite.png`) pointing "up" by default. Exposes `.x`, `.y`, `.rotation`
  regardless of whether it's rendered as an `Image` or a `Triangle`.

## Orbit rings (visual + gameplay-coupled)

- `earthOrbitRadius = 80` — both the satellite's default parked orbit radius
  around Earth AND the re-capture trigger threshold when flying back
  (`earthCaptureRadius = earthOrbitRadius`). A stroked ring is drawn at this
  radius around Earth so the player can see exactly where docking happens.
- `blackHoleOrbitRadius = blackHoleRadius + 30 = 50` — same idea per Black
  Hole: it's both the capture-trigger distance during flight AND the radius
  of the static ring drawn around each Black Hole. Capture always resolves
  right at that visible ring, never flush against the surface.
- These "ring = trigger threshold" pairings were a deliberate fix so
  docking/capture never looks like it happens on top of (or inside) a body's
  surface.

## Satellite state machine (explicit vector math, no physics engine)

States: `SATELLITE_STATE.ORBITING` | `SATELLITE_STATE.FLYING`. Starts
`ORBITING` around Earth.

- **ORBITING** (`updateSatelliteOrbit`): `this.angle` advances by
  `angularSpeed` (1.2 rad/sec) each frame; position =
  `center + orbitRadius * (cos(angle), sin(angle))`, where `center` is
  `this.satelliteOrbitCenter` (either `this.earth` or a captured Black Hole
  object — both just need `.x`/`.y`). Satellite always faces radially
  outward from its current center (`rotation = outwardAngle + PI/2`, the
  `PI/2` compensates for the triangle/art's nose pointing "up" by default).
- **Launch** (`launchSatellite`, triggered by `SPACE` while ORBITING and
  `launchesLeft > 0`): captures the current facing direction
  (`cos(angle), sin(angle)`) as a fixed velocity vector
  (`satelliteFlightSpeed = 250` px/sec), switches to `FLYING`, decrements
  `launchesLeft`.
- **FLYING** (`updateSatelliteFlight`): integrates `position += velocity *
  dt` in a straight line. Each frame checks `Phaser.Math.Distance.Between`
  against all 8 Black Holes, then Earth, in that order:
  - Black Hole within `blackHoleOrbitRadius` → `captureSatelliteToBlackHole`
    (becomes the new orbit center/parent; advances `currentMissionIndex` if
    it's the current mission target — see Mission System).
  - Earth within `earthCaptureRadius` → `captureSatelliteToEarth` (checks
    win condition — see below).
  - Off-canvas bounds (`< 0` or `> scale.width/height`) →
    `triggerLose('Out of Bounds')`.

## Mission System (module-level globals, not `this.*`)

Declared as top-of-file `let` bindings (intentionally global, not scene
state) so they persist independent of scene identity:
`missionSequence`, `currentMissionIndex`, `totalLaunchesAllowed`,
`launchesLeft`.

- `generateMissionSequence(blackHoleCount)` — shuffles IDs `1..8`
  (`Phaser.Utils.Array.Shuffle`), takes a random-length slice of 3–5
  (`Phaser.Math.Between(3, 5)`). This becomes the ordered list of Black Hole
  IDs the player must dock at, in order.
- **Launch budget** (`calculateTotalLaunchesAllowed`):
  `missionSequence.length + 1 + countOppositePairs(...)`.
  - `+1` is the mandatory "return to Earth" leg.
  - **Opposite-pair bonus**: since the 8 Black Holes sit evenly spaced on
    one ring, ID `n` is diametrically opposite ID `n ± 4` (1↔5, 2↔6, 3↔7,
    4↔8). `countOppositePairs` scans the mission sequence for
    back-to-back pairs whose IDs differ by exactly 4 and grants one bonus
    launch per such pair (flying straight across the ring past Earth wastes
    the outbound leg, so the budget compensates). Example:
    sequence `[3, 8, 4]` → `(3,8)` diff 5 (not opposite), `(8,4)` diff 4
    (opposite) → 1 bonus launch.
- **Mission progress**: landing on a Black Hole whose `id` matches
  `missionSequence[currentMissionIndex]` advances the index. Landing on any
  other Black Hole is allowed (an "intermediate landing") but doesn't
  advance progress — you can land anywhere, only the *correct next* target
  counts.
- **Earth becomes the final target** once `currentMissionIndex ===
  missionSequence.length`. The mission UI (top-left text) reflects this by
  appending `EARTH` / `[EARTH]` to the sequence display.

## Win / Lose

`this.gameState`: `'PLAYING' | 'WIN' | 'LOSE'`. Anything other than
`'PLAYING'` freezes the entire simulation (the `update()` loop returns
early — no more spinning, flying, or launches) and shows a centered overlay
text.

- **Win**: `captureSatelliteToEarth()` triggers `triggerWin()` only if
  `currentMissionIndex === missionSequence.length` at the moment of
  re-docking with Earth (i.e., the full sequence was completed in order
  *and* the satellite made it back).
- **Lose**: two triggers, both call `triggerLose(reason)`:
  1. Flying out of the canvas bounds — instant loss, any time.
  2. `checkMissionOutcome()`, run every frame: once `launchesLeft` hits 0
     and the satellite has come to rest (state is `ORBITING`, not still
     `FLYING`), if it isn't "docked at Earth with the full sequence
     complete", it's a loss (`'Launches Exhausted'`).
- **Restart**: pressing `R` while `gameState !== 'PLAYING'` calls
  `restartGame()`: regenerates a brand-new `missionSequence` (and launch
  budget), resets the satellite to Earth orbit, and re-randomizes every
  Black Hole's fixed position (new angle offset on the same ring, still
  evenly spaced/non-overlapping) and spin speed/direction.

## UI

- Top-left text (`this.missionText`, screen-space via `setScrollFactor(0)`):
  mission sequence with `✓` on completed targets, `[ ]` around the current
  target, plus `LAUNCHES LEFT: n / total`. Rebuilt via `refreshMissionUI()`
  on every state-relevant change (launch, capture, restart).
- Center-screen overlay (`this.endScreenText`, hidden until win/lose):
  `MISSION SUCCESS` or `GAME OVER (reason)`, plus `Press R to Restart`.

## Controls

- `SPACE` — on the menu, starts the game; in-game, launches the satellite
  (only while `ORBITING` and launches remain).
- `R` — restarts the run (only while the game is in a `WIN`/`LOSE` state).

## Notable implementation choices worth preserving

- Distance/capture checks always use `Phaser.Math.Distance.Between` — no
  Arcade Physics colliders anywhere in this project, by design.
- Black Hole "spin" and Earth "spin" are purely cosmetic
  (`Container.rotation`) — they do not affect `x`/`y`, which is what makes
  them safe to use as stable orbit centers for the satellite.
- The satellite's orbit-center field (`this.satelliteOrbitCenter`) can point
  at either `this.earth` (a plain `{x, y}` object) or a live Black Hole
  object from `this.blackHoles` — both just need `.x`/`.y` properties, which
  is why capture logic can reassign it directly without type branching.
