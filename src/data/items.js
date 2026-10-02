// Data-driven item catalog. type: consumable | weapon | gear | quest | misc
export const ITEMS = {
  // Consumables
  soda:        { name: 'Soda Can',        type: 'consumable', price: 3,   heal: 10, icon: '🥤', desc: 'Restores a little health.' },
  burger:      { name: 'Diner Burger',    type: 'consumable', price: 8,   heal: 35, icon: '🍔', desc: 'A hearty meal. Restores health.' },
  energy:      { name: 'Energy Drink',    type: 'consumable', price: 6,   stamina: 100, icon: '⚡', desc: 'Instantly refills stamina.' },
  medkit:      { name: 'First-Aid Kit',   type: 'consumable', price: 40,  heal: 100, icon: '🩹', desc: 'Fully restores health.' },
  coffee:      { name: 'Coffee',          type: 'consumable', price: 4,   heal: 6, stamina: 40, icon: '☕', desc: 'Wakes you right up.' },
  candy:       { name: 'Candy Bar',       type: 'consumable', price: 2,   heal: 8, icon: '🍫', desc: 'A quick sugar rush.' },

  // Weapons
  fists:       { name: 'Fists',           type: 'weapon', price: 0,    damage: 12, range: 2.2, icon: '👊', desc: 'Always ready.' },
  bat:         { name: 'Baseball Bat',    type: 'weapon', price: 60,   damage: 24, range: 2.8, icon: '🏏', desc: 'A solid swing.' },
  skateboard:  { name: 'Skateboard',      type: 'weapon', price: 45,   damage: 18, range: 2.6, icon: '🛹', desc: 'Ride it or swing it.' },
  crowbar:     { name: 'Crowbar',         type: 'weapon', price: 90,   damage: 30, range: 2.7, icon: '🪛', desc: 'Pries and pounds.' },
  pipe:        { name: 'Lead Pipe',       type: 'weapon', price: 75,   damage: 27, range: 2.7, icon: '🔧', desc: 'Heavy and blunt.' },
  taser:       { name: 'Stun Baton',      type: 'weapon', price: 140,  damage: 40, range: 2.5, icon: '🔌', desc: 'Drops most foes fast.' },

  // Ranged weapons (hold right mouse to aim, left mouse to fire, R to reload)
  pistol:      { name: '9mm Pistol',      type: 'weapon', ranged: true, price: 320, damage: 34, range: 85, icon: '🔫', desc: 'Sidearm. Aim with right mouse, fire with left.' },
  revolver:    { name: '.44 Revolver',    type: 'weapon', ranged: true, price: 650, damage: 62, range: 95, icon: '🔫', desc: 'Heavy, slow, and it hits like a truck.' },
  ammo:        { name: 'Box of Ammo',     type: 'consumable', price: 25, ammo: 24, icon: '📦', desc: 'Refills 24 rounds of reserve ammunition.' },

  // Gear
  hoodie:      { name: 'Grey Hoodie',     type: 'gear', price: 30,  armor: 10, icon: '🧥', desc: 'Blend in. Light protection.' },
  jacket:      { name: 'Leather Jacket',  type: 'gear', price: 120, armor: 25, icon: '🧥', desc: 'Street armor with style.' },
  varsity:     { name: 'Varsity Jacket',  type: 'gear', price: 100, armor: 20, icon: '🧥', desc: 'School pride, decent protection.' },
  backpack:    { name: 'Bigger Backpack', type: 'gear', price: 80,  slots: 6, icon: '🎒', desc: 'Carry more items.' },

  // Quest / misc
  textbook:    { name: 'Chem Textbook',   type: 'quest', price: 0, icon: '📗', desc: 'Needed for class.' },
  lockpick:    { name: 'Lockpick Set',    type: 'misc', price: 55, icon: '🗝️', desc: 'Opens some locked doors.' },
  spraycan:    { name: 'Spray Can',       type: 'misc', price: 15, icon: '🎨', desc: 'For leaving your mark.' },
  phone:       { name: 'Burner Phone',    type: 'quest', price: 0, icon: '📱', desc: 'Untraceable contact line.' },
  package:     { name: 'Sealed Package',  type: 'quest', price: 0, icon: '📦', desc: "Don't ask what's inside." },
  flowers:     { name: 'Bouquet',         type: 'gift', price: 20, icon: '💐', affinity: 8, desc: 'A thoughtful gift.' },
  necklace:    { name: 'Silver Necklace', type: 'gift', price: 65, icon: '📿', affinity: 16, desc: 'A special present.' },
  mixtape:     { name: 'Mixtape',         type: 'gift', price: 12, icon: '📼', affinity: 10, desc: 'Songs that mean something.' },
  cash_stack:  { name: 'Cash Stack',      type: 'misc', price: 0, icon: '💵', desc: 'Cold hard cash.' },
};

export function itemName(id) { return ITEMS[id]?.name || id; }
