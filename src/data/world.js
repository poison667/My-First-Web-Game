// World layout data. Coordinates are world units on the XZ plane (Y is up).
// The town of BRACKENRIDGE is a compact school-town. Exterior buildings live in
// the main map; interiors are separate rooms placed in a far "interior zone"
// and connected through doors.

// Named locations used by missions, NPC schedules, and map markers.
// NOTE: coordinates point to OPEN, walkable ground near each place (in front of
// buildings), so goto/defeat/collect objectives are always reachable.
export const LOCATIONS = {
  school_gate:     { x: -70, z: -34, name: 'School Gate' },
  school_main:     { x: -70, z: -56, name: 'Brackenridge High' },
  gym:             { x: -22, z: -70, name: 'School Gym' },
  quad:            { x: -46, z: -48, name: 'School Quad' },
  bleachers:       { x: -22, z: -58, name: 'Sports Field' },
  downtown:        { x: 62, z: 14,  name: 'Downtown Square' },
  general_store:   { x: 44, z: -8,  name: 'Corner Store' },
  hardware:        { x: 84, z: -6,  name: 'Hardware & Sports' },
  clothing:        { x: 44, z: 26,  name: 'Threads Boutique' },
  diner:           { x: 84, z: 26,  name: "Rosa's Diner" },
  pawn:            { x: 92, z: 6,   name: 'Cash Corner Pawn' },
  arcade:          { x: 62, z: 36,  name: 'Neon Arcade' },
  park:            { x: 0, z: 86,   name: 'Central Park' },
  court:           { x: 20, z: 92,  name: 'Basketball Court' },
  skatepark:       { x: -20, z: 96, name: 'Skate Park' },
  home:            { x: -96, z: 54, name: 'Your Home' },
  friend_house:    { x: -96, z: 24, name: 'Devon\'s House' },
  bus_stop:        { x: 8, z: -10,  name: 'Bus Stop' },
  gas_station:     { x: 108, z: 44, name: 'Gas Station' },
  warehouse:       { x: 118, z: 78, name: 'Dockside Warehouse' },
  docks:           { x: 92, z: 116, name: 'The Docks' },
  alley_north:     { x: 60, z: -30, name: 'North Alley' },
  alley_east:      { x: 100, z: 28, name: 'East Alley' },
  overpass:        { x: 0, z: -108, name: 'Highway Overpass' },
  clocktower:      { x: 0, z: 14,   name: 'Old Clock Tower' },
  bank:            { x: 62, z: 4,   name: 'Brackenridge Bank' },
  townhall:        { x: 24, z: 16,  name: 'Town Hall' },
  residential:     { x: -84, z: 28, name: 'Residential Street' },
  house3:          { x: -70, z: 50, name: 'Maple Street House' },
  house4:          { x: -70, z: 22, name: 'Oak Street House' },
  school_annex:    { x: -100, z: -60, name: 'Science Wing' },
  depot:           { x: 80, z: 84, name: 'Freight Depot' },
};

// Exterior buildings. enterable ones list a `door` (world pos) and `interior` id.
export const BUILDINGS = [
  // --- School campus ---
  { id: 'school', x: -70, z: -74, w: 44, d: 26, h: 12, color: 0xc9b79c, roof: 0x7a2f2f, label: 'BRACKENRIDGE HIGH',
    enterable: true, door: { x: -70, z: -60 }, interior: 'school' },
  { id: 'gym', x: -22, z: -86, w: 26, d: 20, h: 10, color: 0x9aa7b4, roof: 0x556070, label: 'GYM',
    enterable: true, door: { x: -22, z: -74 }, interior: 'gym' },
  { id: 'school_annex', x: -100, z: -74, w: 18, d: 20, h: 9, color: 0xc9b79c, roof: 0x7a2f2f, label: 'SCIENCE WING' },

  // --- Downtown shops ---
  { id: 'store', x: 44, z: -22, w: 18, d: 16, h: 8, color: 0xd98c5f, roof: 0x5a3a28, label: 'CORNER STORE',
    enterable: true, door: { x: 44, z: -12 }, interior: 'store' },
  { id: 'hardware', x: 84, z: -22, w: 20, d: 16, h: 8, color: 0x6f8fae, roof: 0x33465a, label: 'HARDWARE & SPORTS',
    enterable: true, door: { x: 84, z: -12 }, interior: 'hardware' },
  { id: 'clothing', x: 44, z: 32, w: 18, d: 16, h: 8, color: 0xc86fb0, roof: 0x5a2f50, label: 'THREADS',
    enterable: true, door: { x: 44, z: 22 }, interior: 'clothing' },
  { id: 'diner', x: 84, z: 32, w: 20, d: 16, h: 7, color: 0xe8c15a, roof: 0xb03030, label: "ROSA'S DINER",
    enterable: true, door: { x: 84, z: 22 }, interior: 'diner' },
  { id: 'pawn', x: 106, z: 6, w: 16, d: 16, h: 8, color: 0x7a6f9a, roof: 0x3a3350, label: 'CASH CORNER PAWN',
    enterable: true, door: { x: 96, z: 6 }, interior: 'pawn' },
  { id: 'arcade', x: 62, z: 42, w: 22, d: 16, h: 9, color: 0x5f4b8b, roof: 0x2a2050, label: 'NEON ARCADE',
    enterable: true, door: { x: 62, z: 32 }, interior: 'arcade' },
  { id: 'bank', x: 62, z: -6, w: 20, d: 14, h: 11, color: 0xbfc6cf, roof: 0x6a7380, label: 'BRACKENRIDGE BANK' },
  { id: 'townhall', x: 24, z: 6, w: 22, d: 16, h: 13, color: 0xd8d2c4, roof: 0x8a7f6a, label: 'TOWN HALL' },

  // --- Residential ---
  { id: 'home', x: -96, z: 42, w: 14, d: 14, h: 8, color: 0x8fb08a, roof: 0x4a6a45, label: 'HOME',
    enterable: true, door: { x: -96, z: 50 }, interior: 'home' },
  { id: 'friend', x: -96, z: 12, w: 14, d: 14, h: 8, color: 0xb0a88a, roof: 0x6a6045, label: "DEVON'S",
    enterable: true, door: { x: -96, z: 20 }, interior: 'friend' },
  { id: 'house3', x: -70, z: 42, w: 14, d: 14, h: 8, color: 0xa88f8f, roof: 0x6a4545, label: '' },
  { id: 'house4', x: -70, z: 14, w: 14, d: 14, h: 8, color: 0x8f9fb0, roof: 0x45556a, label: '' },
  { id: 'house5', x: -120, z: 28, w: 14, d: 14, h: 8, color: 0x9fb08f, roof: 0x556a45, label: '' },

  // --- Docks / industrial (gang turf) ---
  { id: 'warehouse', x: 118, z: 98, w: 32, d: 28, h: 13, color: 0x6a6a72, roof: 0x33333a, label: 'WAREHOUSE 7',
    enterable: true, door: { x: 118, z: 84 }, interior: 'warehouse' },
  { id: 'depot', x: 80, z: 96, w: 24, d: 20, h: 10, color: 0x5a5f66, roof: 0x2f3338, label: 'FREIGHT DEPOT' },
  { id: 'gas', x: 116, z: 44, w: 14, d: 12, h: 6, color: 0xd85a5a, roof: 0x6a2020, label: 'GAS' },
];

// Interiors: each is a room built in the interior zone. `shop` opens a shop.
// `exit` is the world position the player returns to when leaving.
export const INTERIORS = {
  school:   { name: 'Brackenridge High', w: 40, d: 28, floor: 0xcbbfa6, wall: 0xe6ddc8, exit: 'school',
              zones: ['Hallway', 'Classroom', 'Cafeteria', 'Principal Office'] },
  gym:      { name: 'School Gym', w: 26, d: 20, floor: 0xcaa06a, wall: 0xd8d8d8, exit: 'gym', activity: 'gym' },
  store:    { name: 'Corner Store', w: 18, d: 16, floor: 0xdadada, wall: 0xf0e8d8, exit: 'store', shop: 'store' },
  hardware: { name: 'Hardware & Sports', w: 20, d: 16, floor: 0xbfc4c9, wall: 0xdfe4e9, exit: 'hardware', shop: 'hardware' },
  clothing: { name: 'Threads Boutique', w: 18, d: 16, floor: 0xe8d8e4, wall: 0xf5e8f2, exit: 'clothing', shop: 'clothing' },
  diner:    { name: "Rosa's Diner", w: 20, d: 16, floor: 0xd8c088, wall: 0xf0e0b0, exit: 'diner', shop: 'diner' },
  pawn:     { name: 'Cash Corner Pawn', w: 16, d: 16, floor: 0xbdb6c9, wall: 0xd8d2e2, exit: 'pawn', shop: 'pawn' },
  arcade:   { name: 'Neon Arcade', w: 22, d: 16, floor: 0x2a2050, wall: 0x3a2a6a, exit: 'arcade', activity: 'arcade' },
  home:     { name: 'Your Home', w: 14, d: 14, floor: 0xc9a878, wall: 0xe8d8bd, exit: 'home', activity: 'home' },
  friend:   { name: "Devon's House", w: 14, d: 14, floor: 0xbfa878, wall: 0xdcd0bd, exit: 'friend' },
  warehouse:{ name: 'Warehouse 7', w: 32, d: 26, floor: 0x555a60, wall: 0x6a6f76, exit: 'warehouse' },
};

// Shops: stock is a list of item ids. Prices come from ITEMS (buyMul on buy).
export const SHOPS = {
  store:    { name: 'Corner Store', buyMul: 1.0, sellMul: 0.4, stock: ['soda','burger','energy','candy','coffee','spraycan','medkit'] },
  hardware: { name: 'Hardware & Sports', buyMul: 1.0, sellMul: 0.45, stock: ['bat','skateboard','crowbar','pipe','lockpick','medkit'] },
  clothing: { name: 'Threads Boutique', buyMul: 1.0, sellMul: 0.5, stock: ['hoodie','jacket','varsity','backpack','flowers','necklace'] },
  diner:    { name: "Rosa's Diner", buyMul: 1.0, sellMul: 0.3, stock: ['burger','coffee','soda','medkit'] },
  pawn:     { name: 'Cash Corner Pawn', buyMul: 1.15, sellMul: 0.65, stock: ['crowbar','taser','lockpick','necklace','mixtape'] },
};
