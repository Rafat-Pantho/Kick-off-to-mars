// ---------------------------------------------------------------------------
// Phaser 3 - Orbital Mechanics Demo
// Earth (blue circle) at the center, spinning on its own axis. A Satellite
// (red triangle) driven by a custom physics state machine. 8 Black Holes
// (purple circles) sit at fixed positions around Earth and spin in place.
//
// No Arcade Physics is used anywhere. All motion is explicit vector math
// computed by hand each frame (position += velocity, angle-based orbits,
// Phaser.Math.Distance.Between for proximity checks).
// ---------------------------------------------------------------------------

const SATELLITE_STATE = {
  ORBITING: 'ORBITING',
  FLYING: 'FLYING',
};

// ---------------------------------------------------------------------------
// Mission System (global state)
// The mission is a sequence of Black Hole IDs the player must dock the
// Satellite with, in order, before running out of launches.
// ---------------------------------------------------------------------------
let missionSequence = [];       // e.g. [3, 6, 2] - ordered target Black Hole IDs
let currentMissionIndex = 0;    // Index into missionSequence of the current target
let totalLaunchesAllowed = 0;   // missionSequence.length + 1 + opposite-pair bonus (see below)
let launchesLeft = 0;           // Launches remaining this run

// Builds a random mission: 3-5 unique Black Hole IDs drawn from
// [1, blackHoleCount] in a random order.
function generateMissionSequence(blackHoleCount) {
  const ids = Array.from({ length: blackHoleCount }, (_, i) => i + 1);
  Phaser.Utils.Array.Shuffle(ids);

  const sequenceLength = Phaser.Math.Between(3, 5);
  return ids.slice(0, sequenceLength);
}

// Since the Black Holes sit evenly spaced on one ring, ID `n` is exactly
// diametrically opposite ID `n + blackHoleCount / 2` (circular, e.g. with 8
// holes: 1<->5, 2<->6, 3<->7, 4<->8). Flying directly across the ring wastes
// the outbound leg's momentum on the way past Earth, so each back-to-back
// pair of opposite targets in the sequence earns one bonus launch.
// e.g. sequence [3, 8, 4] with 8 Black Holes: (3,8) is not opposite (diff 5),
// (8,4) is opposite (diff 4) -> 1 bonus launch.
function countOppositePairs(sequence, blackHoleCount) {
  const oppositeDistance = blackHoleCount / 2;
  let count = 0;

  for (let i = 0; i < sequence.length - 1; i++) {
    if (Math.abs(sequence[i] - sequence[i + 1]) === oppositeDistance) {
      count += 1;
    }
  }

  return count;
}

// Precomputes the launch budget for a mission: one launch per target, one
// extra "return to Earth" launch, plus one bonus launch for every
// consecutive opposite-side pair in the sequence.
function calculateTotalLaunchesAllowed(sequence, blackHoleCount) {
  return sequence.length + 1 + countOppositePairs(sequence, blackHoleCount);
}

// ---------------------------------------------------------------------------
// Main Menu Scene
// The game's entry point: title, brief instructions, and a prompt to start.
// Purely presentational - no game state lives here.
// ---------------------------------------------------------------------------
class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    // -------------------------------------------------------------------
    // Decorative preview: a spinning Earth with a couple of stationary
    // Black Hole placeholders on a ring, echoing the actual gameplay scene.
    // -------------------------------------------------------------------
    const previewY = centerY - 120;

    const earthContainer = this.add.container(centerX, previewY);
    const earthBody = this.add.circle(0, 0, 36, 0x2266ff);
    const earthMarker = this.add.circle(16, 0, 5, 0x66ddff);
    earthContainer.add([earthBody, earthMarker]);
    this.tweens.add({
      targets: earthContainer,
      rotation: Math.PI * 2,
      duration: 6000,
      repeat: -1,
      ease: 'Linear',
    });

    const previewBlackHoleCount = 4;
    const previewRadius = 100;
    for (let i = 0; i < previewBlackHoleCount; i++) {
      const angle = (Math.PI * 2 * i) / previewBlackHoleCount;
      const x = centerX + previewRadius * Math.cos(angle);
      const y = previewY + previewRadius * Math.sin(angle);
      const holeContainer = this.add.container(x, y);
      const holeBody = this.add.circle(0, 0, 14, 0x9933ff);
      const holeMarker = this.add.circle(8, 0, 3, 0xe0c3ff);
      holeContainer.add([holeBody, holeMarker]);
      this.tweens.add({
        targets: holeContainer,
        rotation: Math.PI * 2 * (i % 2 === 0 ? 1 : -1),
        duration: 3000 + i * 400,
        repeat: -1,
        ease: 'Linear',
      });
    }

    // -------------------------------------------------------------------
    // Title and instructions.
    // -------------------------------------------------------------------
    this.add
      .text(centerX, previewY + 150, 'KICK OFF TO MARS', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5);

    this.add
      .text(
        centerX,
        previewY + 200,
        'Dock the Satellite at every mission target, then return to Earth.',
        {
          fontFamily: 'monospace',
          fontSize: '15px',
          color: '#a9b6e8',
        }
      )
      .setOrigin(0.5, 0.5);

    this.add
      .text(centerX, previewY + 228, 'SPACE — Launch     R — Restart', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#a9b6e8',
      })
      .setOrigin(0.5, 0.5);

    // -------------------------------------------------------------------
    // Start prompt: blinking text, triggered by SPACE or a click/tap.
    // -------------------------------------------------------------------
    const startText = this.add
      .text(centerX, previewY + 280, 'PRESS SPACE TO START', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#66ddff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true });

    this.tweens.add({
      targets: startText,
      alpha: 0.2,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    startText.on('pointerdown', () => this.scene.start('MainScene'));

    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.scene.start('MainScene');
    }
  }
}

class MainScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainScene' });

    // --- Earth configuration ---------------------------------------------
    this.earthRadius = 40;          // Drawn radius of Earth's circle placeholder
    this.earthSpinSpeed = 0.4;      // Radians per second Earth spins on its own axis

    // --- Satellite orbit configuration ----------------------------------
    this.earthOrbitRadius = 80;     // Default orbit radius when circling Earth
    this.angularSpeed = 1.2;        // Radians per second while orbiting
    this.angle = 0;                 // Current orbital angle (relative to parent)
    // Time spent continuously orbiting the current parent body, reset on
    // every new capture. A Black Hole only counts as visited once this
    // reaches fullRevolutionTime (one complete lap) - see updateSatelliteOrbit.
    this.orbitTimeAtCurrentBody = 0;
    this.fullRevolutionTime = (Math.PI * 2) / this.angularSpeed; // seconds for one lap

    // --- Satellite flight (state machine) configuration -----------------
    this.satelliteState = SATELLITE_STATE.ORBITING;
    this.satelliteFlightSpeed = 250; // Pixels per second while FLYING
    this.satelliteVelocity = { x: 0, y: 0 };
    this.satelliteOrbitCenter = null; // Current parent body: Earth or a Black Hole
    this.satelliteOrbitRadius = this.earthOrbitRadius;
    // The satellite re-docks with a body the instant it enters that body's
    // orbit ring, so the capture threshold IS the visible orbit radius -
    // docking always happens at a comfortable, non-overlapping distance
    // from the surface, never right on top of it.
    this.earthCaptureRadius = this.earthOrbitRadius;

    // --- Black hole configuration ---------------------------------------
    // Black Holes sit at fixed positions relative to Earth (they do not
    // orbit); they only spin in place around their own center. All 8 sit
    // on a single ring, well out from Earth's surface (4.5x Earth's
    // diameter, comfortable on the larger 1920x1080 canvas), evenly spaced
    // around it so none ever overlap or sit close together.
    this.blackHoleCount = 8;
    this.blackHoleRadius = 20;      // Drawn radius of each Black Hole's circle placeholder
    this.blackHoleDistanceFromCenter =
      this.earthRadius + 4.5 * (this.earthRadius * 2); // surface + 4.5x Earth's diameter
    this.blackHoleOrbitRadius = this.blackHoleRadius + 30; // satellite's docking ring: 30px out from the surface
    this.blackHoles = [];           // Populated in create()

    // --- Mission tracking -------------------------------------------------
    this.satelliteCapturedBlackHoleId = null; // ID of the Black Hole currently orbited, if any

    // --- Overall game state -----------------------------------------------
    // 'PLAYING' | 'WIN' | 'LOSE'. Anything other than 'PLAYING' freezes the
    // simulation and shows the end screen until the player presses R.
    this.gameState = 'PLAYING';
  }

  // -----------------------------------------------------------------------
  // Attempts to load the real art from res/. Any file that's missing just
  // fails its individual request (404) - the loader still completes and
  // create() falls back to the primitive-shape placeholders for that asset.
  // -----------------------------------------------------------------------
  preload() {
    this.load.image('earthImg', 'res/earth.png');
    this.load.image('blackholeImg', 'res/blackhole.png');
    this.load.image('satelliteImg', 'res/satellite.png');
  }

  create() {
    // -------------------------------------------------------------------
    // Particle system setup: a shared 1-bit dot texture (generated once,
    // no external art needed) feeds three emitters — an ambient starfield
    // backdrop, a rocket-exhaust trail while FLYING, and a one-shot burst
    // on capture. Created first so the starfield naturally renders behind
    // everything added after it.
    // -------------------------------------------------------------------
    this.createParticleTextures();
    this.createStarfield();
    this.createFlightParticles();

    // -------------------------------------------------------------------
    // Earth: uses res/earth.png (scaled to the same diameter as the old
    // placeholder circle) if it loaded, otherwise falls back to a blue
    // circle with a small offset "landmass" marker so its own-axis spin
    // is still visible. Its position is fixed.
    // -------------------------------------------------------------------
    this.earth = { x: this.scale.width / 2, y: this.scale.height / 2 };

    this.earthContainer = this.add.container(this.earth.x, this.earth.y);
    if (this.textures.exists('earthImg')) {
      const earthSprite = this.add.image(0, 0, 'earthImg');
      earthSprite.setDisplaySize(this.earthRadius * 2, this.earthRadius * 2);
      this.earthContainer.add(earthSprite);
    } else {
      const earthBody = this.add.circle(0, 0, this.earthRadius, 0x2266ff); // blue
      const earthMarker = this.add.circle(18, 0, 6, 0x66ddff);             // lighter "landmass" marker
      this.earthContainer.add([earthBody, earthMarker]);
    }

    // Visible orbit ring: shows exactly where the satellite settles around
    // Earth (and where flying back into range re-docks it), a comfortable
    // distance out from the surface rather than right on top of it.
    this.add
      .circle(this.earth.x, this.earth.y, this.earthOrbitRadius)
      .setStrokeStyle(2, 0x4477ff, 0.35);

    // -------------------------------------------------------------------
    // Satellite: uses res/satellite.png (scaled to match the old triangle's
    // bounding box) if it loaded, otherwise falls back to a red triangle
    // placeholder. Either way `this.satellite` exposes the same x/y/rotation
    // API used everywhere else. The art is assumed to point "up" by default,
    // same convention as the triangle's nose.
    // -------------------------------------------------------------------
    const satWidth = 16;
    const satHeight = 24;

    if (this.textures.exists('satelliteImg')) {
      this.satellite = this.add.image(0, 0, 'satelliteImg');
      this.satellite.setDisplaySize(satWidth, satHeight);
    } else {
      this.satellite = this.add.triangle(
        0, 0,                              // position set below
        0, -satHeight / 2,                 // top point (the "nose")
        -satWidth / 2, satHeight / 2,      // bottom-left point
        satWidth / 2, satHeight / 2,       // bottom-right point
        0xff3333                           // red
      );
    }

    // Start orbiting Earth.
    this.satelliteOrbitCenter = this.earth;
    this.satelliteOrbitRadius = this.earthOrbitRadius;
    this.satelliteState = SATELLITE_STATE.ORBITING;
    this.updateSatelliteOrbit(0);

    // -------------------------------------------------------------------
    // Black Holes: 8 purple circle placeholders at fixed positions around
    // Earth (evenly spaced distances), each with its own ID and spinning
    // in place at its own speed/direction.
    // -------------------------------------------------------------------
    this.createBlackHoles();

    // -------------------------------------------------------------------
    // Mission: pick a random ordered sequence of Black Hole IDs to visit,
    // and precompute the launch budget from its length (plus bonus
    // launches for consecutive opposite-side targets).
    // -------------------------------------------------------------------
    missionSequence = generateMissionSequence(this.blackHoleCount);
    currentMissionIndex = 0;
    totalLaunchesAllowed = calculateTotalLaunchesAllowed(missionSequence, this.blackHoleCount);
    launchesLeft = totalLaunchesAllowed;

    // -------------------------------------------------------------------
    // UI: screen-space text overlay in the top-left corner showing the
    // mission sequence (current target highlighted) and launches left.
    // -------------------------------------------------------------------
    this.missionText = this.add.text(16, 16, '', {
      fontFamily: 'monospace',
      fontSize: '26px',
      color: '#e6ecff',
      backgroundColor: 'rgba(5, 5, 16, 0.55)',
      padding: { x: 8, y: 6 },
    });
    this.missionText.setScrollFactor(0);
    this.missionText.setDepth(1000);
    this.refreshMissionUI();

    // Screen-space end-of-game overlay ("MISSION SUCCESS" / "GAME OVER"),
    // hidden until a win or loss is triggered.
    this.endScreenText = this.add.text(this.scale.width / 2, this.scale.height / 2, '', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#ffffff',
      align: 'center',
      backgroundColor: 'rgba(5, 5, 16, 0.75)',
      padding: { x: 24, y: 18 },
    });
    this.endScreenText.setOrigin(0.5, 0.5);
    this.endScreenText.setScrollFactor(0);
    this.endScreenText.setDepth(2000);
    this.endScreenText.setVisible(false);

    // -------------------------------------------------------------------
    // Input: SPACEBAR launches the satellite out of orbit, R restarts.
    // -------------------------------------------------------------------
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
  }

  // -----------------------------------------------------------------------
  // Builds the 8 Black Holes at fixed positions relative to Earth, all on
  // a single ring at blackHoleDistanceFromCenter, evenly spaced by angle
  // (360 / count degrees apart) so they can never overlap or sit close to
  // one another. The whole ring gets one random rotation offset so the
  // layout isn't identical every run. Each Black Hole spins in place at
  // its own slow, random speed/direction — it does not travel around Earth.
  // Each also gets a visible docking-orbit ring at a comfortable distance
  // from its surface. Uses res/blackhole.png (scaled to match the old
  // placeholder circle) if it loaded, otherwise falls back to the purple
  // circle + spin-indicator marker.
  // -----------------------------------------------------------------------
  createBlackHoles() {
    const count = this.blackHoleCount;
    const angleStep = (Math.PI * 2) / count;
    const ringOffset = Math.random() * Math.PI * 2; // rotates the whole ring, keeps even spacing
    const hasBlackHoleImage = this.textures.exists('blackholeImg');

    for (let i = 0; i < count; i++) {
      const id = i + 1;
      const distanceFromEarth = this.blackHoleDistanceFromCenter;
      const positionAngle = ringOffset + angleStep * i;

      // Fixed world position, computed once and never updated again.
      const x = this.earth.x + distanceFromEarth * Math.cos(positionAngle);
      const y = this.earth.y + distanceFromEarth * Math.sin(positionAngle);

      // Random spin speed in [0.005, 0.015] rad/frame and a random
      // direction (+1 clockwise / -1 counterclockwise) for its own-axis
      // rotation.
      const spinRate = Phaser.Math.FloatBetween(0.005, 0.015);
      const spinDirection = Math.random() < 0.5 ? -1 : 1;

      const container = this.add.container(x, y);
      if (hasBlackHoleImage) {
        const sprite = this.add.image(0, 0, 'blackholeImg');
        sprite.setDisplaySize(this.blackHoleRadius * 2, this.blackHoleRadius * 2);
        container.add(sprite);
      } else {
        const body = this.add.circle(0, 0, this.blackHoleRadius, 0x9933ff); // purple
        const marker = this.add.circle(12, 0, 4, 0xe0c3ff);                 // spin indicator
        container.add([body, marker]);
      }

      // Visible orbit ring: shows exactly where the satellite docks around
      // this Black Hole, comfortably away from its surface.
      const orbitRing = this.add
        .circle(x, y, this.blackHoleOrbitRadius)
        .setStrokeStyle(2, 0xaa66ff, 0.3);

      const label = this.add.text(x, y, String(id), {
        fontSize: '14px',
        color: '#ffffff',
        fontStyle: 'bold',
      });
      label.setOrigin(0.5, 0.5);

      const blackHole = {
        id,
        x,
        y,
        distanceFromEarth,
        positionAngle,
        spinAngle: 0,
        spinSpeed: spinRate * spinDirection,
        container,
        orbitRing,
        label,
      };

      this.blackHoles.push(blackHole);
    }
  }

  // -----------------------------------------------------------------------
  // Generates the shared 8x8 white dot texture used by every particle
  // emitter (starfield, exhaust trail, capture burst). Tinted per-emitter
  // at emit time, so one texture covers all three effects. Guarded so it's
  // safe to call again if create() ever re-runs.
  // -----------------------------------------------------------------------
  createParticleTextures() {
    if (this.textures.exists('particleDot')) return;

    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('particleDot', 8, 8);
    g.destroy();
  }

  // -----------------------------------------------------------------------
  // Ambient background: faint, slow-drifting particles scattered across the
  // whole canvas as a twinkling starfield. Purely decorative, always
  // running (even on the end screen), sent behind every other game object.
  // -----------------------------------------------------------------------
  createStarfield() {
    this.starEmitter = this.add.particles(0, 0, 'particleDot', {
      x: { min: 0, max: this.scale.width },
      y: { min: 0, max: this.scale.height },
      lifespan: { min: 4000, max: 8000 },
      speedX: { min: -4, max: 4 },
      speedY: { min: -4, max: 4 },
      scale: { min: 0.15, max: 0.45 },
      alpha: { start: 0.9, end: 0 },
      quantity: 1,
      frequency: 120,
      tint: 0xaad4ff,
      blendMode: 'ADD',
    });
    this.starEmitter.setDepth(-10);
  }

  // -----------------------------------------------------------------------
  // Gameplay-coupled particle effects on the satellite:
  //  - thrusterEmitter: a continuous exhaust trail, active only while
  //    FLYING, following the satellite and pointed back along its travel
  //    direction (set at launch time, since velocity is constant in flight).
  //  - burstEmitter: a one-shot radial burst fired at the exact capture
  //    point when the satellite docks at a Black Hole or Earth.
  // Both start stopped/idle and are driven explicitly from the satellite
  // state machine (launchSatellite / captureSatelliteTo*).
  // -----------------------------------------------------------------------
  createFlightParticles() {
    // Starts with `emitting: false` (rather than emitting immediately and
    // calling `.stop()` afterward) — a Phaser quirk means an emitter that's
    // stopped before it has ever emitted a single particle never properly
    // resumes rendering on a later `.start()`.
    this.thrusterEmitter = this.add.particles(0, 0, 'particleDot', {
      speed: { min: 30, max: 90 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: { min: 200, max: 400 },
      frequency: 20,
      tint: [0xffcc55, 0xff6622],
      blendMode: 'ADD',
      emitting: false,
    });
    this.thrusterEmitter.setDepth(5);

    this.burstEmitter = this.add.particles(0, 0, 'particleDot', {
      speed: { min: 80, max: 220 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 450,
      tint: 0x99e6ff,
      blendMode: 'ADD',
      emitting: false,
    });
    this.burstEmitter.setDepth(5);
  }

  update(time, delta) {
    // Restart works even while the simulation is frozen on an end screen.
    if (Phaser.Input.Keyboard.JustDown(this.restartKey) && this.gameState !== 'PLAYING') {
      this.restartGame();
      return;
    }

    // Freeze the simulation once the mission has ended (win or lose).
    if (this.gameState !== 'PLAYING') {
      return;
    }

    // Earth spins on its own axis; its position never changes.
    this.earthContainer.rotation += this.earthSpinSpeed * (delta / 1000);

    // Each Black Hole spins in place on its own axis; its position never
    // changes (they do not orbit Earth).
    for (const blackHole of this.blackHoles) {
      blackHole.spinAngle += blackHole.spinSpeed;
      blackHole.container.rotation = blackHole.spinAngle;
    }

    // Launch the satellite on SPACEBAR, only while it is orbiting and a
    // launch is available.
    if (
      Phaser.Input.Keyboard.JustDown(this.spaceKey) &&
      this.satelliteState === SATELLITE_STATE.ORBITING &&
      launchesLeft > 0
    ) {
      this.launchSatellite();
    }

    // Drive the Satellite's custom physics state machine.
    if (this.satelliteState === SATELLITE_STATE.ORBITING) {
      this.updateSatelliteOrbit(delta);
    } else if (this.satelliteState === SATELLITE_STATE.FLYING) {
      this.updateSatelliteFlight(delta);
    }

    this.checkMissionOutcome();
  }

  // -----------------------------------------------------------------------
  // ORBITING state: the satellite circles its current parent body
  // (Earth, or a captured Black Hole) at a fixed radius, facing outward.
  // -----------------------------------------------------------------------
  updateSatelliteOrbit(delta) {
    this.angle += this.angularSpeed * (delta / 1000);

    if (this.angle > Math.PI * 2) {
      this.angle -= Math.PI * 2;
    } else if (this.angle < -Math.PI * 2) {
      this.angle += Math.PI * 2;
    }

    const center = this.satelliteOrbitCenter;
    const x = center.x + this.satelliteOrbitRadius * Math.cos(this.angle);
    const y = center.y + this.satelliteOrbitRadius * Math.sin(this.angle);

    this.satellite.x = x;
    this.satellite.y = y;

    // Face outward from the current parent body.
    const outwardAngle = Math.atan2(y - center.y, x - center.x);
    this.satellite.rotation = outwardAngle + Math.PI / 2;

    // Mission progress: a Black Hole only counts as visited once the
    // satellite has stayed in orbit around it for one full lap. Checked
    // continuously (not just at launch) so it's credited the instant the
    // lap completes, even if the player keeps orbiting past that point.
    this.orbitTimeAtCurrentBody += delta / 1000;
    if (
      this.satelliteCapturedBlackHoleId !== null &&
      this.satelliteCapturedBlackHoleId === missionSequence[currentMissionIndex] &&
      this.orbitTimeAtCurrentBody >= this.fullRevolutionTime
    ) {
      currentMissionIndex += 1;
      this.refreshMissionUI();
    }
  }

  // -----------------------------------------------------------------------
  // Transition: ORBITING -> FLYING.
  // Captures the satellite's current facing direction as a fixed linear
  // velocity vector (explicit vector math, no physics engine involved).
  // -----------------------------------------------------------------------
  launchSatellite() {
    // The satellite faces radially outward, i.e. exactly along `this.angle`
    // (the same direction used to place it on its orbit).
    const vx = Math.cos(this.angle) * this.satelliteFlightSpeed;
    const vy = Math.sin(this.angle) * this.satelliteFlightSpeed;

    this.satelliteVelocity = { x: vx, y: vy };
    this.satelliteState = SATELLITE_STATE.FLYING;

    // Exhaust trail: point back along the travel direction (opposite of
    // `this.angle`) and follow the satellite for the rest of the flight.
    // Mutates the angle EmitterOp's value directly rather than calling the
    // emitter's own `setAngle()` — that method silently breaks the
    // emitter's rendering afterward (a Phaser 3.70 quirk), even though the
    // underlying op it should be updating works fine when set directly.
    const trailAngleDeg = Phaser.Math.RadToDeg(this.angle) + 180;
    this.thrusterEmitter.ops.angle.propertyValue = { min: trailAngleDeg - 20, max: trailAngleDeg + 20 };
    this.thrusterEmitter.startFollow(this.satellite);
    this.thrusterEmitter.start();

    launchesLeft -= 1;
    this.refreshMissionUI();
  }

  // -----------------------------------------------------------------------
  // FLYING state: travel in a straight line by integrating the velocity
  // vector into position each frame. Checks for Black Hole capture and
  // for leaving the screen bounds.
  // -----------------------------------------------------------------------
  updateSatelliteFlight(delta) {
    const dt = delta / 1000;

    this.satellite.x += this.satelliteVelocity.x * dt;
    this.satellite.y += this.satelliteVelocity.y * dt;

    // Constantly check distance to every Black Hole for a capture event.
    for (const blackHole of this.blackHoles) {
      const distance = Phaser.Math.Distance.Between(
        this.satellite.x,
        this.satellite.y,
        blackHole.x,
        blackHole.y
      );

      if (distance < this.blackHoleOrbitRadius) {
        this.captureSatelliteToBlackHole(blackHole);
        return;
      }
    }

    // Check distance to Earth: flying back within capture range re-docks
    // the satellite in Earth orbit (a win, if the Black Hole sequence is
    // already complete; otherwise just an intermediate landing).
    const earthDistance = Phaser.Math.Distance.Between(
      this.satellite.x,
      this.satellite.y,
      this.earth.x,
      this.earth.y
    );

    if (earthDistance < this.earthCaptureRadius) {
      this.captureSatelliteToEarth();
      return;
    }

    // Out-of-bounds check.
    const width = this.scale.width;
    const height = this.scale.height;

    if (
      this.satellite.x < 0 ||
      this.satellite.x > width ||
      this.satellite.y < 0 ||
      this.satellite.y > height
    ) {
      console.log('Out of Bounds');
      this.triggerLose('Out of Bounds');
    }
  }

  // -----------------------------------------------------------------------
  // Transition: FLYING -> ORBITING (captured by a Black Hole).
  // The Black Hole becomes the satellite's new parent body; the orbit
  // radius/angle are derived from the satellite's position at the exact
  // moment of capture so there is no visual snap.
  // -----------------------------------------------------------------------
  captureSatelliteToBlackHole(blackHole) {
    // Black Holes are stationary, so a plain {x, y} reference is a stable
    // orbit center (unlike the satellite's own orbit, this one never moves).
    this.satelliteOrbitCenter = blackHole;
    this.satelliteOrbitRadius = Phaser.Math.Distance.Between(
      this.satellite.x,
      this.satellite.y,
      blackHole.x,
      blackHole.y
    );
    this.angle = Math.atan2(
      this.satellite.y - blackHole.y,
      this.satellite.x - blackHole.x
    );

    this.satelliteVelocity = { x: 0, y: 0 };
    this.satelliteState = SATELLITE_STATE.ORBITING;
    this.satelliteCapturedBlackHoleId = blackHole.id;
    // Docking alone doesn't count as visiting this target - the satellite
    // must stay in orbit for one full lap (tracked in updateSatelliteOrbit).
    // Landing on a Black Hole that isn't the active target is still allowed
    // (an intermediate landing) but can never advance currentMissionIndex.
    this.orbitTimeAtCurrentBody = 0;

    this.thrusterEmitter.stop();
    // explode(count, x, y) doesn't reliably render — position the emitter
    // first and explode with no coordinate args instead.
    this.burstEmitter.setPosition(this.satellite.x, this.satellite.y);
    this.burstEmitter.explode(24);

    this.refreshMissionUI();
  }

  // -----------------------------------------------------------------------
  // Transition: FLYING -> ORBITING (captured by Earth).
  // Once currentMissionIndex reaches missionSequence.length, Earth becomes
  // the final target: successfully docking back here is the win condition.
  // Before that, it's just an intermediate landing (mission does not end).
  // -----------------------------------------------------------------------
  captureSatelliteToEarth() {
    this.satelliteOrbitCenter = this.earth;
    this.satelliteOrbitRadius = Phaser.Math.Distance.Between(
      this.satellite.x,
      this.satellite.y,
      this.earth.x,
      this.earth.y
    );
    this.angle = Math.atan2(
      this.satellite.y - this.earth.y,
      this.satellite.x - this.earth.x
    );

    this.satelliteVelocity = { x: 0, y: 0 };
    this.satelliteState = SATELLITE_STATE.ORBITING;
    this.satelliteCapturedBlackHoleId = null;
    this.orbitTimeAtCurrentBody = 0;

    this.thrusterEmitter.stop();
    // explode(count, x, y) doesn't reliably render — position the emitter
    // first and explode with no coordinate args instead.
    this.burstEmitter.setPosition(this.satellite.x, this.satellite.y);
    this.burstEmitter.explode(24);

    this.refreshMissionUI();

    if (currentMissionIndex === missionSequence.length) {
      this.triggerWin();
    }
  }

  // -----------------------------------------------------------------------
  // Resets the satellite's physics state back to its starting orbit around
  // Earth. Used when (re)starting a run.
  // -----------------------------------------------------------------------
  resetSatelliteToEarthOrbit() {
    this.satelliteOrbitCenter = this.earth;
    this.satelliteOrbitRadius = this.earthOrbitRadius;
    this.angle = 0;
    this.satelliteVelocity = { x: 0, y: 0 };
    this.satelliteState = SATELLITE_STATE.ORBITING;
    this.satelliteCapturedBlackHoleId = null;
    this.orbitTimeAtCurrentBody = 0;
    this.thrusterEmitter.stop();
  }

  // -----------------------------------------------------------------------
  // Rebuilds the top-left screen-space UI text from the current mission
  // state: the target sequence (with the current target highlighted) and
  // the number of launches left. Once the Black Hole sequence is complete,
  // Earth is appended as the final active target.
  // -----------------------------------------------------------------------
  refreshMissionUI() {
    const targets = missionSequence.map((id, index) => {
      if (index < currentMissionIndex) return `${id}✓`; // completed: checkmark
      if (index === currentMissionIndex) return `[${id}]`; // current target
      return `${id}`;
    });

    const sequenceComplete = currentMissionIndex === missionSequence.length;
    targets.push(sequenceComplete ? '[EARTH]' : 'EARTH');

    this.missionText.setText(
      `MISSION TARGETS: ${targets.join('  ')}\nLAUNCHES LEFT: ${launchesLeft} / ${totalLaunchesAllowed}`
    );
  }

  // -----------------------------------------------------------------------
  // Loss check: once the player is out of launches, if the satellite has
  // come to rest anywhere other than "docked at Earth with the full
  // Black Hole sequence complete" (that exact case is already handled as
  // a win by captureSatelliteToEarth), the mission has failed.
  // -----------------------------------------------------------------------
  checkMissionOutcome() {
    if (this.gameState !== 'PLAYING') return;
    if (launchesLeft > 0) return;
    if (this.satelliteState !== SATELLITE_STATE.ORBITING) return; // still resolving

    const sequenceComplete = currentMissionIndex === missionSequence.length;
    const isDockedAtEarth = this.satelliteCapturedBlackHoleId === null;

    if (!(sequenceComplete && isDockedAtEarth)) {
      this.triggerLose('Launches Exhausted');
    }
  }

  // -----------------------------------------------------------------------
  // Win/Lose screen state.
  // -----------------------------------------------------------------------
  triggerWin() {
    if (this.gameState !== 'PLAYING') return;
    this.gameState = 'WIN';
    console.log('MISSION SUCCESS');
    this.showEndScreen('MISSION SUCCESS', 'Press R to Restart');
  }

  triggerLose(reason) {
    if (this.gameState !== 'PLAYING') return;
    this.gameState = 'LOSE';
    // 'Out of Bounds' is a fatal crash (GAME OVER); 'Launches Exhausted'
    // means the run ended without completing the mission - e.g. a Black
    // Hole was left before finishing its required lap - which is a mission
    // failure (LOSE) rather than a crash.
    const title = reason === 'Launches Exhausted' ? 'LOSE' : 'GAME OVER';
    console.log(`${title} (${reason})`);
    this.showEndScreen(title, 'Press R to Restart');
  }

  showEndScreen(title, subtitle) {
    this.endScreenText.setText(`${title}\n\n${subtitle}`);
    this.endScreenText.setVisible(true);
  }

  // -----------------------------------------------------------------------
  // Fully resets the run: a new random mission sequence, a refreshed
  // launch counter, the satellite back on its starting Earth orbit, and
  // every Black Hole re-randomized onto the same evenly-spaced ring (a
  // fresh random rotation offset, still guaranteeing no overlap) with a
  // fresh spin speed/direction.
  // -----------------------------------------------------------------------
  restartGame() {
    missionSequence = generateMissionSequence(this.blackHoleCount);
    currentMissionIndex = 0;
    totalLaunchesAllowed = calculateTotalLaunchesAllowed(missionSequence, this.blackHoleCount);
    launchesLeft = totalLaunchesAllowed;

    this.resetSatelliteToEarthOrbit();
    this.updateSatelliteOrbit(0);

    const angleStep = (Math.PI * 2) / this.blackHoleCount;
    const ringOffset = Math.random() * Math.PI * 2;

    this.blackHoles.forEach((blackHole, i) => {
      blackHole.positionAngle = ringOffset + angleStep * i;
      blackHole.x = this.earth.x + blackHole.distanceFromEarth * Math.cos(blackHole.positionAngle);
      blackHole.y = this.earth.y + blackHole.distanceFromEarth * Math.sin(blackHole.positionAngle);

      blackHole.container.x = blackHole.x;
      blackHole.container.y = blackHole.y;
      blackHole.orbitRing.x = blackHole.x;
      blackHole.orbitRing.y = blackHole.y;
      blackHole.label.x = blackHole.x;
      blackHole.label.y = blackHole.y;

      blackHole.spinAngle = 0;
      const spinRate = Phaser.Math.FloatBetween(0.005, 0.015);
      const spinDirection = Math.random() < 0.5 ? -1 : 1;
      blackHole.spinSpeed = spinRate * spinDirection;
    });

    this.endScreenText.setVisible(false);
    this.gameState = 'PLAYING';
    this.refreshMissionUI();
  }
}

// ---------------------------------------------------------------------------
// Phaser game configuration
// ---------------------------------------------------------------------------
const config = {
  type: Phaser.AUTO,
  width: 1920,
  height: 1080,
  backgroundColor: '#050510',
  parent: 'game-container',
  scene: [MenuScene, MainScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);
