// Central configuration & tunable constants
export const CONFIG = {
  version: '2.0.0',
  saveKey: 'brackenridge_save_v1',
  settingsKey: 'brackenridge_settings_v1',

  // ---------------------------------------------------------------------
  // PLAYER CONTROLLER
  // Tuned for a responsive, weighty third-person feel:
  //  - instant input response with short acceleration ramps
  //  - separate speed tiers (walk / jog / sprint / crouch / aim)
  //  - forgiving jump (coyote time + input buffering + variable height)
  //  - parkour thresholds that decide step / vault / mantle / climb
  // ---------------------------------------------------------------------
  player: {
    // --- capsule & proportions (metres) ---
    height: 1.82,
    crouchHeight: 1.20,
    radius: 0.36,
    eyeHeight: 1.62,
    crouchEyeHeight: 1.05,

    // --- speed tiers (m/s) ---
    walkSpeed: 1.95,        // hold Alt (or gentle stick)
    jogSpeed: 4.50,         // default movement
    sprintSpeed: 7.60,      // hold Shift
    crouchSpeed: 1.75,
    aimSpeed: 2.60,         // while aiming down sights
    backpedalMul: 0.70,     // slower moving backwards
    strafeMul: 0.88,

    // --- acceleration / friction ---
    groundAccel: 34,
    groundDecel: 42,
    sprintAccel: 24,
    airAccel: 14,
    airControl: 0.62,
    airDrag: 0.25,
    turnSpeed: 14,          // rad/s, how fast the body yaws to face movement
    turnSpeedFast: 8,       // at sprint speed (wider arcs, more natural)
    aimTurnSpeed: 24,       // snappier when strafing/aiming

    // --- jump & gravity ---
    gravity: 23,
    jumpVelocity: 6.7,
    sprintJumpBoost: 0.85,
    lowJumpGravityMul: 2.2, // released jump early -> short hop
    fallGravityMul: 1.35,   // snappier descent
    maxFallSpeed: 42,
    coyoteTime: 0.13,
    jumpBufferTime: 0.17,
    landRecovery: 0.22,
    hardLandSpeed: 16,      // triggers heavy landing
    fallDamageSpeed: 23,    // below this, no damage
    fallDamageScale: 3.4,

    // --- stamina ---
    maxStamina: 100,
    sprintDrain: 11,
    jumpCost: 5,
    climbDrain: 8,
    staminaRegen: 19,
    staminaRegenDelay: 0.7,
    exhaustedRecover: 22,   // stamina needed before sprinting again

    // --- slide (sprint + crouch) ---
    slideMinSpeed: 5.40,    // must already be running this fast to slide
    slideBoost: 1.12,       // entry speed multiplier
    slideFriction: 6.00,    // m/s^2 bled off while sliding
    slideSteer: 2.20,       // rad/s of steering authority mid-slide
    slideMinTime: 0.22,
    slideMaxTime: 0.85,
    slideExitSpeed: 2.80,   // drop below this and you stand back up
    slideCost: 9,           // stamina
    slideCooldown: 0.60,

    // --- parkour thresholds (relative to foot height) ---
    stepHeight: 0.45,       // walked over automatically
    vaultMinHeight: 0.45,
    vaultMaxHeight: 1.32,   // railings, crates, car hoods -> vault over
    vaultMaxDepth: 2.3,     // thicker than this: mantle on top instead
    vaultDuration: 0.52,
    mantleMaxHeight: 2.45,  // ledges, roofs, containers -> climb up

    // --- ledge hang (catching a lip in mid-air) ---
    hangMinHeight: 1.05,    // lips higher than this are caught instead of mantled
    hangMaxHeight: 3.60,    // how far above the feet the hands can still catch
    hangDrop: 1.70,         // distance the feet hang below the lip
    hangReach: 0.62,        // how far the chest sits from the wall while hanging
    shimmySpeed: 1.35,      // sideways m/s along a ledge
    hangDrain: 6,           // stamina per second while hanging
    hangMantleCost: 16,
    hangCooldown: 0.45,     // stops an instant re-grab after dropping

    mantleDuration: 0.80,
    ledgeReach: 0.80,       // forward probe distance
    ladderSpeed: 2.5,

    // --- melee combat ---
    maxHealth: 100,
    attackDamage: 12,
    attackRange: 2.4,
    attackCooldown: 0.45,
    comboWindow: 0.62,      // time after a strike to chain the next hit
    meleeLunge: 3.2,        // forward impulse on each swing

    // legacy aliases (kept so older saves/systems keep working)
    walkSpeedLegacy: 5.2,
    runSpeed: 7.6,
    jumpForce: 6.7,
  },

  // ---------------------------------------------------------------------
  // THIRD-PERSON CAMERA (spring arm)
  // ---------------------------------------------------------------------
  camera: {
    distance: 5.2,
    minDistance: 1.6,
    maxDistance: 9.5,
    height: 1.58,           // pivot height above the feet
    crouchHeight: 1.08,
    shoulder: 0.55,         // lateral offset of the pivot
    sensitivity: 0.0022,
    minPitch: -1.15,
    maxPitch: 1.05,
    collisionRadius: 0.28,
    followLag: 14,          // horizontal pivot follow stiffness
    followLagY: 9,          // vertical follow (softer, hides step-ups)
    rotateLag: 26,          // look smoothing (high = snappy)
    pullInSpeed: 60,        // camera collision: retract fast
    pullOutSpeed: 6,        // extend slowly
    fov: 62,
    fovSprint: 72,
    fovAim: 44,
    fovVehicle: 70,
    aimDistance: 1.9,
    aimShoulder: 0.78,
    aimHeight: 1.60,
    sprintDistance: 5.9,
    crouchDistance: 4.2,
    slideDistance: 5.6,
    vehicleDistance: 8.4,
    vehicleHeight: 2.4,
    // the chase camera is pulled back and raised in proportion to the body,
    // so a bus is framed like a bus and a scooter like a scooter
    vehicleSizeScale: 0.85,
    vehicleMinDistance: 5.0,
    vehicleMaxDistance: 16.0,
    vehicleSpeedPull: 2.6,  // extra distance at full chat
    vehicleFovSpeed: 16,    // extra FOV degrees at full chat
    lookAhead: 0.28,        // leads the camera in the direction of travel
  },

  // ---------------------------------------------------------------------
  // RANGED WEAPONS
  // ---------------------------------------------------------------------
  weapons: {
    pistol: {
      name: 'Pistol', damage: 34, fireRate: 0.21, magSize: 12, reloadTime: 1.35,
      range: 85, spreadHip: 0.055, spreadAim: 0.008, spreadMove: 0.05,
      recoilPitch: 0.035, recoilYaw: 0.012, shake: 0.22, muzzle: 0.32,
    },
    revolver: {
      name: 'Revolver', damage: 62, fireRate: 0.55, magSize: 6, reloadTime: 2.1,
      range: 95, spreadHip: 0.07, spreadAim: 0.012, spreadMove: 0.06,
      recoilPitch: 0.075, recoilYaw: 0.02, shake: 0.45, muzzle: 0.42,
    },
  },

  world: {
    dayLengthSeconds: 1200,     // one in-game day = 20 real minutes
    startHour: 8,
    npcCount: 46,               // ambient NPCs count in data
    trafficCars: 8,
  },

  // ---------------------------------------------------------------------
  // VEHICLES
  // Per-vehicle specifications live in data/vehicles.js — these are the
  // global rules that apply to the whole fleet.
  // ---------------------------------------------------------------------
  vehicle: {
    // Fuel burns at a realistic litres-per-hour, which would make a tank last
    // for hours of play. Scaling it up turns fuel into an actual decision
    // without making the consumption model a lie.
    fuelScale: 24,
    enterRange: 3.6,            // metres you can be from a door to get in
    exitMaxSpeed: 6.0,          // m/s above which you cannot bail out
    stationRange: 7.0,          // metres from a pump to refuel
    damageShakeScale: 0.06,     // camera shake per m/s of impact
    hurtSpeed: 7.0,             // impact speed that starts hurting the driver
    hurtScale: 2.2,             // damage per m/s above that
    crimeOnTheft: true,         // hot-wiring a locked vehicle is noticed
    stealWantedLevel: 1,
    emergencyStealWanted: 2,
    wetGrip: 0.78,              // grip multiplier in the rain
    nightLightsFrom: 18.3,      // hour headlights come on
    nightLightsTo: 6.6,
    hornScareRadius: 12,        // NPCs react to the horn within this
    sirenScareRadius: 20,
  },

  presets: {
    low:    { shadows: false, pixelRatio: 0.65, drawDistance: 140, npcSim: 26, weather: false, antialias: false },
    medium: { shadows: true,  pixelRatio: 0.9,  drawDistance: 220, npcSim: 40, weather: true,  antialias: true  },
    high:   { shadows: true,  pixelRatio: 1.0,  drawDistance: 320, npcSim: 60, weather: true,  antialias: true  },
  },

  defaultSettings: {
    preset: 'medium',
    resolutionScale: 1.0,
    masterVolume: 0.7,
    musicVolume: 0.5,
    invertY: false,
    sensitivity: 1.0,
    aimSensitivity: 0.6,     // multiplier applied while aiming
    toggleCrouch: false,     // Ctrl holds, C always toggles
    toggleAim: false,
    autoVault: true,         // vault automatically when running into low cover
    cameraShake: 1.0,
    shoulderSide: 1,         // 1 = right shoulder, -1 = left
  },
};

export const COLORS = {
  road: 0x2b2d33,
  sidewalk: 0x8a8d94,
  grass: 0x4f7a3a,
  park: 0x3f7233,
  water: 0x2f6f8f,
};
