// Central configuration & tunable constants
export const CONFIG = {
  version: '1.0.0',
  saveKey: 'brackenridge_save_v1',
  settingsKey: 'brackenridge_settings_v1',

  player: {
    walkSpeed: 5.2,
    runSpeed: 9.5,
    jumpForce: 7.2,
    gravity: 20,
    height: 1.8,
    radius: 0.45,
    maxHealth: 100,
    maxStamina: 100,
    staminaDrain: 18,   // per second while sprinting
    staminaRegen: 14,   // per second while not sprinting
    attackDamage: 12,
    attackRange: 2.4,
    attackCooldown: 0.45,
  },

  camera: {
    distance: 6.5,
    minDistance: 2.5,
    maxDistance: 11,
    height: 2.0,
    sensitivity: 0.0024,
    minPitch: -0.9,
    maxPitch: 0.9,
  },

  world: {
    dayLengthSeconds: 1200,     // one in-game day = 20 real minutes
    startHour: 8,
    npcCount: 46,               // ambient NPCs count in data
    trafficCars: 8,
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
  },
};

export const COLORS = {
  road: 0x2b2d33,
  sidewalk: 0x8a8d94,
  grass: 0x4f7a3a,
  park: 0x3f7233,
  water: 0x2f6f8f,
};
