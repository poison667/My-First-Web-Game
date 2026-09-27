// Named NPCs. Each has a daily schedule (list of {from,to,at} location keys),
// relationship defaults, and metadata used by dialogue, missions and factions.
// role: friend | rival | staff | contact | boss | enforcer | shopkeeper | civilian | law
export const NPCS = {
  // ---------------- Student world ----------------
  devon: {
    name: 'Devon Cole', emoji: '🧑🏾', color: 0x3f8fd0, faction: 'hallcliques', role: 'friend', romance: false,
    bio: 'Your ride-or-die best friend since middle school.',
    home: 'friend_house',
    schedule: [ {from:7,to:15,at:'school_gate'}, {from:15,to:18,at:'court'}, {from:18,to:23,at:'friend_house'}, {from:23,to:7,at:'friend_house'} ],
  },
  mia: {
    name: 'Mia Santos', emoji: '👩🏻', color: 0xe86fa0, faction: 'hallcliques', role: 'friend', romance: true,
    bio: 'Sharp, kind, president of the debate club. Easy to like.',
    home: 'home',
    schedule: [ {from:7,to:15,at:'school_main'}, {from:15,to:18,at:'diner'}, {from:18,to:22,at:'park'}, {from:22,to:7,at:'home'} ],
  },
  jade: {
    name: 'Jade Kimura', emoji: '👩🏻‍🎤', color: 0x9b5de5, faction: 'hallcliques', role: 'friend', romance: true,
    bio: 'Skate-punk artist who runs the town like it owes her nothing.',
    home: 'home',
    schedule: [ {from:8,to:15,at:'school_gate'}, {from:15,to:20,at:'skatepark'}, {from:20,to:23,at:'arcade'}, {from:23,to:8,at:'home'} ],
  },
  brett: {
    name: 'Brett Vaughn', emoji: '💪🏼', color: 0xd0863f, faction: 'hallcliques', role: 'rival', romance: false,
    bio: 'Star jock and hallway tyrant. Thinks the school is his.',
    home: 'home',
    schedule: [ {from:8,to:15,at:'school_gate'}, {from:15,to:19,at:'court'}, {from:19,to:23,at:'downtown'}, {from:23,to:8,at:'home'} ],
  },
  coach_dan: {
    name: 'Coach Dan', emoji: '🧔🏼', color: 0x556070, faction: 'lawdogs', role: 'staff', romance: false,
    bio: 'Gym teacher who believes sweat solves everything.',
    home: 'gym',
    schedule: [ {from:7,to:17,at:'gym'}, {from:17,to:20,at:'court'}, {from:20,to:7,at:'home'} ],
  },
  principal_hale: {
    name: 'Principal Hale', emoji: '👨🏽‍🏫', color: 0x7a2f2f, faction: 'lawdogs', role: 'staff', romance: false,
    bio: 'Runs Brackenridge High with an iron planner.',
    home: 'school_main',
    schedule: [ {from:7,to:16,at:'school_main'}, {from:16,to:18,at:'townhall'}, {from:18,to:7,at:'home'} ],
  },
  ms_portela: {
    name: 'Ms. Portela', emoji: '👩🏽‍🏫', color: 0x8f6fb0, faction: 'lawdogs', role: 'staff', romance: false,
    bio: 'Chemistry teacher. Tough but fair.',
    home: 'school_main',
    schedule: [ {from:8,to:16,at:'school_main'}, {from:16,to:18,at:'general_store'}, {from:18,to:8,at:'home'} ],
  },
  liam: {
    name: 'Liam Park', emoji: '🧑🏻‍💻', color: 0x4cc9f0, faction: 'hallcliques', role: 'friend', romance: false,
    bio: 'Robotics-club genius who owes you a few favors.',
    home: 'home',
    schedule: [ {from:8,to:16,at:'school_main'}, {from:16,to:21,at:'arcade'}, {from:21,to:8,at:'home'} ],
  },

  // ---------------- Gangster world ----------------
  vince: {
    name: 'Vince Moretti', emoji: '🕴🏻', color: 0xef476f, faction: 'eastside', role: 'boss', romance: false,
    bio: 'Boss of the Eastside Kings. Charming, patient, deadly.',
    home: 'warehouse',
    schedule: [ {from:0,to:24,at:'warehouse'} ],
  },
  knuckles: {
    name: 'Knuckles', emoji: '🧟‍♂️', color: 0xb03030, faction: 'eastside', role: 'enforcer', romance: false,
    bio: 'Vince\'s enforcer. All muscle, short fuse.',
    home: 'docks',
    schedule: [ {from:0,to:24,at:'docks'} ],
  },
  tasha: {
    name: 'Tasha Reed', emoji: '👩🏾‍🦱', color: 0x4cc9f0, faction: 'northmarket', role: 'contact', romance: false,
    bio: 'North Market lieutenant who plays every angle.',
    home: 'pawn',
    schedule: [ {from:9,to:20,at:'downtown'}, {from:20,to:9,at:'pawn'} ],
  },
  marcus: {
    name: 'Marcus Vane', emoji: '👨🏿‍💼', color: 0x3a3350, faction: 'northmarket', role: 'boss', romance: false,
    bio: 'The calm mind running North Market from the pawn shop.',
    home: 'pawn',
    schedule: [ {from:0,to:24,at:'pawn'} ],
  },
  rosa: {
    name: 'Rosa', emoji: '👩🏽‍🍳', color: 0xb03030, faction: null, role: 'contact', romance: false,
    bio: 'Owns the diner. Knows everyone, tells no one.',
    home: 'diner',
    schedule: [ {from:6,to:22,at:'diner'}, {from:22,to:6,at:'home'} ],
  },
  officer_reyes: {
    name: 'Officer Reyes', emoji: '👮🏽', color: 0x06d6a0, faction: 'lawdogs', role: 'law', romance: false,
    bio: 'Beat cop who actually cares about Brackenridge.',
    home: 'townhall',
    schedule: [ {from:7,to:19,at:'downtown'}, {from:19,to:7,at:'townhall'} ],
  },

  // ---------------- Shopkeepers / civilians ----------------
  clerk: {
    name: 'Ravi (Clerk)', emoji: '🧑🏽‍💼', color: 0xd98c5f, faction: null, role: 'shopkeeper', romance: false,
    bio: 'Runs the corner store on caffeine and gossip.',
    home: 'general_store', shop: 'store',
    schedule: [ {from:6,to:23,at:'general_store'}, {from:23,to:6,at:'general_store'} ],
  },
  tailor: {
    name: 'Nadia (Threads)', emoji: '👩🏻‍🎨', color: 0xc86fb0, faction: null, role: 'shopkeeper', romance: false,
    bio: 'Fashion-forward and fiercely opinionated.',
    home: 'clothing', shop: 'clothing',
    schedule: [ {from:9,to:20,at:'clothing'}, {from:20,to:9,at:'clothing'} ],
  },
  gearhead: {
    name: 'Sal (Hardware)', emoji: '👨🏼‍🔧', color: 0x33465a, faction: null, role: 'shopkeeper', romance: false,
    bio: 'Sells tools, bats, and no questions.',
    home: 'hardware', shop: 'hardware',
    schedule: [ {from:8,to:20,at:'hardware'}, {from:20,to:8,at:'hardware'} ],
  },
  broker: {
    name: 'Otis (Pawn)', emoji: '🧓🏿', color: 0x3a3350, faction: 'northmarket', role: 'shopkeeper', romance: false,
    bio: 'Buys anything, asks nothing, connected to everything.',
    home: 'pawn', shop: 'pawn',
    schedule: [ {from:9,to:22,at:'pawn'}, {from:22,to:9,at:'pawn'} ],
  },
};

// Ambient / crowd NPC visual styles (used to spawn unnamed pedestrians).
export const AMBIENT_STYLES = [
  0xcf6a6a, 0x6acf8a, 0x6a8fcf, 0xcfc06a, 0xb06acf, 0x6acfc0, 0xcf9a6a, 0x9a6acf,
  0x8a8a8a, 0xd0a0b0, 0xa0b0d0, 0xb0d0a0,
];
export const AMBIENT_NAMES = ['Resident','Student','Shopper','Commuter','Jogger','Local','Tourist','Vendor'];
