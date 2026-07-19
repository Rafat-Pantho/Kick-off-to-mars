// ---------------------------------------------------------------------------
// Phaser 3 - Orbital Mechanics Demo
// Earth (blue circle) at the center, a Satellite (red triangle) driven by a
// custom physics state machine, and 8 Black Holes (purple circles) orbiting
// Earth at varied speeds.
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
let totalLaunchesAllowed = 0;   // missionSequence.length + 1
let launchesLeft = 0;           // Launches remaining this run

// Builds a random mission: 3-5 unique Black Hole IDs drawn from
// [1, blackHoleCount] in a random order.
function generateMissionSequence(blackHoleCount) {
  const ids = Array.from({ length: blackHoleCount }, (_, i) => i + 1);
  Phaser.Utils.Array.Shuffle(ids);

  const sequenceLength = Phaser.Math.Between(3, 5);
  return ids.slice(0, sequenceLength);
}

class MainScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainScene' });

    // --- Satellite orbit configuration ----------------------------------
    this.earthOrbitRadius = 80;     // Default orbit radius when circling Earth
    this.angularSpeed = 1.2;        // Radians per second while orbiting
    this.angle = 0;                 // Current orbital angle (relative to parent)

    // --- Satellite flight (state machine) configuration -----------------
    this.satelliteState = SATELLITE_STATE.ORBITING;
    this.satelliteFlightSpeed = 250; // Pixels per second while FLYING
    this.captureRadius = 25;         // Distance at which a Black Hole captures the satellite
    this.satelliteVelocity = { x: 0, y: 0 };
    this.satelliteOrbitCenter = null; // Current parent body: Earth or a Black Hole's graphics
    this.satelliteOrbitRadius = this.earthOrbitRadius;
    this.earthCaptureRadius = 40;     // Distance at which Earth re-captures the satellite (matches Earth's drawn radius)

    // --- Black hole configuration ---------------------------------------
    this.blackHoleCount = 8;
    this.blackHoleMinRadius = 150;
    this.blackHoleMaxRadius = 280;
    this.blackHoles = [];           // Populated in create()

    // --- Mission tracking -------------------------------------------------
    this.satelliteCapturedBlackHoleId = null; // ID of the Black Hole currently orbited, if any

    // --- Overall game state -----------------------------------------------
    // 'PLAYING' | 'WIN' | 'LOSE'. Anything other than 'PLAYING' freezes the
    // simulation and shows the end screen until the player presses R.
    this.gameState = 'PLAYING';
  }

  create() {
    // -------------------------------------------------------------------
    // Earth: a static blue circle placeholder at the center of the canvas.
    // -------------------------------------------------------------------
    this.earth = { x: 400, y: 300 };

    this.earthGraphics = this.add.circle(
      this.earth.x,
      this.earth.y,
      40,           // radius
      0x2266ff       // blue
    );

    // -------------------------------------------------------------------
    // Satellite: a red triangle placeholder. Phaser triangles are defined
    // by three points relative to their origin; we build an isosceles
    // triangle pointing "up" (along -y) by default, then rotate it each
    // frame to face outward from its current orbit center / travel path.
    // -------------------------------------------------------------------
    const satWidth = 16;
    const satHeight = 24;

    this.satellite = this.add.triangle(
      0, 0,                              // position set below
      0, -satHeight / 2,                 // top point (the "nose")
      -satWidth / 2, satHeight / 2,      // bottom-left point
      satWidth / 2, satHeight / 2,       // bottom-right point
      0xff3333                           // red
    );

    // Start orbiting Earth.
    this.satelliteOrbitCenter = this.earth;
    this.satelliteOrbitRadius = this.earthOrbitRadius;
    this.satelliteState = SATELLITE_STATE.ORBITING;
    this.updateSatelliteOrbit(0);

    // -------------------------------------------------------------------
    // Black Holes: 8 purple circle placeholders orbiting Earth at evenly
    // spaced radii, each with its own ID, speed, and rotation direction.
    // -------------------------------------------------------------------
    this.createBlackHoles();

    // -------------------------------------------------------------------
    // Mission: pick a random ordered sequence of Black Hole IDs to visit,
    // and derive the launch budget from its length.
    // -------------------------------------------------------------------
    missionSequence = generateMissionSequence(this.blackHoleCount);
    currentMissionIndex = 0;
    totalLaunchesAllowed = missionSequence.length + 1;
    launchesLeft = totalLaunchesAllowed;

    // -------------------------------------------------------------------
    // UI: screen-space text overlay in the top-left corner showing the
    // mission sequence (current target highlighted) and launches left.
    // -------------------------------------------------------------------
    this.missionText = this.add.text(16, 16, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#e6ecff',
      backgroundColor: 'rgba(5, 5, 16, 0.55)',
      padding: { x: 8, y: 6 },
    });
    this.missionText.setScrollFactor(0);
    this.missionText.setDepth(1000);
    this.refreshMissionUI();

    // Screen-space end-of-game overlay ("MISSION SUCCESS" / "GAME OVER"),
    // hidden until a win or loss is triggered.
    this.endScreenText = this.add.text(400, 300, '', {
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
  // Builds the 8 Black Hole orbiters: evenly spaced radii between
  // blackHoleMinRadius and blackHoleMaxRadius, a unique ID (1-8), a random
  // slow angular velocity, and a random initial rotation direction.
  // -----------------------------------------------------------------------
  createBlackHoles() {
    const count = this.blackHoleCount;
    // Step between consecutive radii so they are evenly distributed across
    // the full [min, max] range (inclusive), keeping every orbit distinct.
    const radiusStep =
      count > 1
        ? (this.blackHoleMaxRadius - this.blackHoleMinRadius) / (count - 1)
        : 0;

    for (let i = 0; i < count; i++) {
      const id = i + 1;
      const orbitRadius = this.blackHoleMinRadius + radiusStep * i;

      // Random speed in [0.005, 0.015] rad/frame, random initial angle,
      // and a random direction (+1 clockwise / -1 counterclockwise).
      const speed = Phaser.Math.FloatBetween(0.005, 0.015);
      const direction = Math.random() < 0.5 ? -1 : 1;
      const startAngle = Math.random() * Math.PI * 2;

      const graphics = this.add.circle(0, 0, 20, 0x9933ff); // purple

      const label = this.add.text(0, 0, String(id), {
        fontSize: '14px',
        color: '#ffffff',
        fontStyle: 'bold',
      });
      label.setOrigin(0.5, 0.5);

      const blackHole = {
        id,
        orbitRadius,
        angle: startAngle,
        angularVelocity: speed * direction,
        graphics,
        label,
      };

      this.blackHoles.push(blackHole);
      this.updateBlackHolePosition(blackHole);
    }
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

    // Advance each Black Hole independently along its own orbit around Earth.
    for (const blackHole of this.blackHoles) {
      blackHole.angle += blackHole.angularVelocity;

      if (blackHole.angle > Math.PI * 2) {
        blackHole.angle -= Math.PI * 2;
      } else if (blackHole.angle < -Math.PI * 2) {
        blackHole.angle += Math.PI * 2;
      }

      this.updateBlackHolePosition(blackHole);
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
        blackHole.graphics.x,
        blackHole.graphics.y
      );

      if (distance < this.captureRadius) {
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
    this.satelliteOrbitCenter = blackHole.graphics;
    this.satelliteOrbitRadius = Phaser.Math.Distance.Between(
      this.satellite.x,
      this.satellite.y,
      blackHole.graphics.x,
      blackHole.graphics.y
    );
    this.angle = Math.atan2(
      this.satellite.y - blackHole.graphics.y,
      this.satellite.x - blackHole.graphics.x
    );

    this.satelliteVelocity = { x: 0, y: 0 };
    this.satelliteState = SATELLITE_STATE.ORBITING;
    this.satelliteCapturedBlackHoleId = blackHole.id;

    // Mission progress: capturing the current target advances the sequence.
    // Landing on a Black Hole that isn't the active target is still allowed
    // (an intermediate landing) but does not advance currentMissionIndex.
    if (blackHole.id === missionSequence[currentMissionIndex]) {
      currentMissionIndex += 1;
    }
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
    console.log(`GAME OVER (${reason})`);
    this.showEndScreen('GAME OVER', 'Press R to Restart');
  }

  showEndScreen(title, subtitle) {
    this.endScreenText.setText(`${title}\n\n${subtitle}`);
    this.endScreenText.setVisible(true);
  }

  // -----------------------------------------------------------------------
  // Fully resets the run: a new random mission sequence, a refreshed
  // launch counter, the satellite back on its starting Earth orbit, and
  // every Black Hole re-randomized onto its (fixed-radius) orbit.
  // -----------------------------------------------------------------------
  restartGame() {
    missionSequence = generateMissionSequence(this.blackHoleCount);
    currentMissionIndex = 0;
    totalLaunchesAllowed = missionSequence.length + 1;
    launchesLeft = totalLaunchesAllowed;

    this.resetSatelliteToEarthOrbit();
    this.updateSatelliteOrbit(0);

    for (const blackHole of this.blackHoles) {
      blackHole.angle = Math.random() * Math.PI * 2;
      const speed = Phaser.Math.FloatBetween(0.005, 0.015);
      const direction = Math.random() < 0.5 ? -1 : 1;
      blackHole.angularVelocity = speed * direction;
      this.updateBlackHolePosition(blackHole);
    }

    this.endScreenText.setVisible(false);
    this.gameState = 'PLAYING';
    this.refreshMissionUI();
  }

  // -----------------------------------------------------------------------
  // Positions a single Black Hole's circle and its ID label on its orbit,
  // keeping the label centered on top of the placeholder each frame.
  // -----------------------------------------------------------------------
  updateBlackHolePosition(blackHole) {
    const x = this.earth.x + blackHole.orbitRadius * Math.cos(blackHole.angle);
    const y = this.earth.y + blackHole.orbitRadius * Math.sin(blackHole.angle);

    blackHole.graphics.x = x;
    blackHole.graphics.y = y;

    blackHole.label.x = x;
    blackHole.label.y = y;
  }
}

// ---------------------------------------------------------------------------
// Phaser game configuration
// ---------------------------------------------------------------------------
const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#050510',
  parent: 'game-container',
  scene: [MainScene],
};

new Phaser.Game(config);
