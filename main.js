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
// Story / Mission Briefing Scene
// The game's actual entry point: a text-only briefing screen setting up the
// premise before handing off to the Menu. Purely presentational - no game
// state lives here. Content is laid out top-to-bottom with a running `y`
// cursor so each block's height (which varies with word-wrap) pushes the
// next one down automatically, rather than using hardcoded positions.
// ---------------------------------------------------------------------------
class StoryScene extends Phaser.Scene {
  constructor() {
    super({ key: 'StoryScene' });
  }

  create() {
    const centerX = this.scale.width / 2;
    const contentWidth = 1100;
    const leftX = centerX - contentWidth / 2;
    const startY = 80;
    let y = startY;

    // Every block created below is collected here so the whole briefing can
    // be shifted as one unit once its total height is known, centering it
    // vertically instead of leaving it pinned to the top of a much taller
    // 1080px canvas.
    const allTexts = [];

    const addHeading = (text, fontSize, color, marginBottom) => {
      const t = this.add
        .text(centerX, y, text, {
          fontFamily: 'monospace',
          fontSize,
          color,
          fontStyle: 'bold',
          align: 'center',
        })
        .setOrigin(0.5, 0);
      allTexts.push(t);
      y += t.height + marginBottom;
      return t;
    };

    const addSectionHeader = (text) => {
      const t = this.add
        .text(leftX, y, text, {
          fontFamily: 'monospace',
          fontSize: '24px',
          color: '#66ddff',
          fontStyle: 'bold',
        })
        .setOrigin(0, 0);
      allTexts.push(t);
      y += t.height + 10;
      return t;
    };

    const addBody = (text) => {
      const t = this.add
        .text(leftX, y, text, {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#c7d0f0',
          lineSpacing: 6,
          wordWrap: { width: contentWidth },
        })
        .setOrigin(0, 0);
      allTexts.push(t);
      y += t.height + 26;
      return t;
    };

    const addBullet = (text) => {
      const t = this.add
        .text(leftX + 24, y, `•  ${text}`, {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#c7d0f0',
          lineSpacing: 6,
          wordWrap: { width: contentWidth - 24 },
        })
        .setOrigin(0, 0);
      allTexts.push(t);
      y += t.height + 14;
      return t;
    };

    addHeading('MISSION BRIEFING', '40px', '#ffffff', 50);

    addSectionHeader('THE DISCOVERY');
    addBody(
      'Scientists have detected 8 mysterious black holes orbiting Earth. ' +
        'Strange, sequenced signals are broadcasting from them, and we need to know why.'
    );

    addSectionHeader('THE MISSION');
    addBody(
      'We have launched a probe to investigate, but there is a problem: fuel is ' +
        'critically limited. The satellite does not have enough fuel to fly to a ' +
        'distant black hole and fly straight back.'
    );
    addBody(
      "To survive, you must navigate by jumping directly from one black hole's " +
        'orbit to the next, following the exact signal sequence.'
    );

    addSectionHeader('YOUR OBJECTIVES:');
    addBullet('Follow the Sequence: Jump between the black holes in the exact target order provided.');
    addBullet('Conserve Fuel: You only have a strictly limited number of engine thrusts (kick-offs). Use them wisely.');
    addBullet("Bring it Home: Once the sequence is complete, you must safely return to Earth's orbit to transmit the data.");

    y += 6;
    addHeading('Good luck.', '22px', '#a9b6e8', 30);

    // -------------------------------------------------------------------
    // Continue prompt: blinking text, triggered by SPACE or a click/tap.
    // -------------------------------------------------------------------
    const continueText = this.add
      .text(centerX, y + 10, 'PRESS SPACE OR TAP TO CONTINUE', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#66ddff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true });
    allTexts.push(continueText);
    y += continueText.height;

    this.tweens.add({
      targets: continueText,
      alpha: 0.2,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Advance on a tap anywhere on screen, not just on the prompt itself -
    // the prompt is a small target on a phone.
    this.input.on('pointerdown', () => this.scene.start('MenuScene'));

    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Center the whole briefing block vertically: shift every text object
    // down (or up) by the difference between its natural top offset and
    // where a block of this total height should start to be centered.
    const totalContentHeight = y - startY;
    const centeredStartY = (this.scale.height - totalContentHeight) / 2;
    const verticalShift = centeredStartY - startY;
    allTexts.forEach((t) => {
      t.y += verticalShift;
    });
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.scene.start('MenuScene');
    }
  }
}

// ---------------------------------------------------------------------------
// Main Menu Scene
// Title screen with a prompt to start. Purely presentational - no game
// state lives here.
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
      .text(centerX, previewY + 228, 'SPACE or TAP — Launch     R or TAP — Restart', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#a9b6e8',
      })
      .setOrigin(0.5, 0.5);

    // -------------------------------------------------------------------
    // Start prompt: blinking text, triggered by SPACE or a click/tap.
    // -------------------------------------------------------------------
    const startText = this.add
      .text(centerX, previewY + 280, 'PRESS SPACE OR TAP TO START', {
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

    // Start on a tap anywhere on screen, not just on the prompt itself -
    // the prompt is a small target on a phone.
    this.input.on('pointerdown', () => this.scene.start('MainScene'));

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
    this.blackHoleRadius = 50;      // Drawn radius of each Black Hole's circle placeholder
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
      // Points are given in POSITIVE coordinates (0..satWidth, 0..satHeight)
      // rather than centered ones. Phaser's Triangle derives its size — and
      // therefore its displayOrigin — from `Math.max` of the supplied point
      // coords, so negative values yield a wrong origin and the shape draws
      // offset from its own x/y (the anchor ends up on a corner instead of
      // the middle). Positive coords give size 16x24, origin (8, 12), which
      // renders the same triangle correctly centered on x/y.
      this.satellite = this.add.triangle(
        0, 0,                              // position set below
        satWidth / 2, 0,                   // top point (the "nose")
        0, satHeight,                      // bottom-left point
        satWidth, satHeight,               // bottom-right point
        0xff3333                           // red
      );
    }

    // Distance from the satellite's center to its tail, so the exhaust trail
    // can be emitted from the middle of its rear edge rather than its center.
    this.satelliteTailOffset = satHeight / 2;

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
      fontSize: '32px',
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
    // Touch/mouse mirrors both so the game is fully playable on a phone
    // with no keyboard: a tap anywhere launches while playing, and taps
    // the restart once an end screen is up. The whole screen is the tap
    // target rather than a small prompt, which matters on small displays.
    // -------------------------------------------------------------------
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    this.input.on('pointerdown', () => {
      if (this.gameState !== 'PLAYING') {
        this.restartGame();
      } else {
        this.tryLaunchSatellite();
      }
    });
  }

  // -----------------------------------------------------------------------
  // Shared entry point for both SPACEBAR and touch/click: launches only if
  // the satellite is settled in an orbit and a launch is still available.
  // -----------------------------------------------------------------------
  tryLaunchSatellite() {
    if (this.satelliteState === SATELLITE_STATE.ORBITING && launchesLeft > 0) {
      this.launchSatellite();
    }
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
        fontSize: '22px',
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

    // Launch the satellite on SPACEBAR (touch is handled by the pointerdown
    // listener in create(); both funnel through tryLaunchSatellite).
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.tryLaunchSatellite();
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
    // `this.angle`), emitted from the satellite's exact center, and follow
    // the satellite for the rest of the flight.
    // Mutates the angle EmitterOp's `start`/`end` directly rather than
    // calling the emitter's own `setAngle()` — that method silently breaks
    // the emitter's rendering afterward (a Phaser 3.70 quirk). Note this is
    // NOT `propertyValue` (that field is only a stored copy for toJSON()
    // and isn't read by the random-range emit logic, which pulls from
    // `start`/`end` — setting only `propertyValue` silently no-ops and
    // leaves the emitter on its original 0-360 default range).
    const trailAngleDeg = Phaser.Math.RadToDeg(this.angle) + 180;
    this.thrusterEmitter.ops.angle.start = trailAngleDeg - 20;
    this.thrusterEmitter.ops.angle.end = trailAngleDeg + 20;

    // Follow the middle of the satellite's rear edge, not its center: step
    // back from the center by half the satellite's length, opposite the
    // travel direction. startFollow's offset is in unrotated world axes, but
    // the flight direction is fixed at launch, so computing it once here
    // keeps the trail pinned to the tail for the whole flight.
    this.thrusterEmitter.startFollow(
      this.satellite,
      -Math.cos(this.angle) * this.satelliteTailOffset,
      -Math.sin(this.angle) * this.satelliteTailOffset
    );
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
    this.showEndScreen('MISSION SUCCESS', 'Press R or Tap to Restart');
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
    this.showEndScreen(title, 'Press R or Tap to Restart');
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
  scene: [StoryScene, MenuScene, MainScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);
