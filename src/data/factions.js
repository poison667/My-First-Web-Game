// Factions drive the gangster storyline and street reputation.
export const FACTIONS = {
  eastside: {
    name: 'Eastside Kings',
    color: 0xef476f,
    turf: 'The Docks & Warehouse District',
    desc: 'The dominant crew running the east waterfront. Ambitious and ruthless.',
    rivals: ['northmarket'],
  },
  northmarket: {
    name: 'North Market Crew',
    color: 0x4cc9f0,
    turf: 'Downtown & the Market',
    desc: 'Old-money street operators controlling downtown corners.',
    rivals: ['eastside'],
  },
  hallcliques: {
    name: 'Hall Cliques',
    color: 0xffca3a,
    turf: 'Brackenridge High',
    desc: 'The social factions that rule the school hallways.',
    rivals: [],
  },
  lawdogs: {
    name: 'Brackenridge PD',
    color: 0x06d6a0,
    turf: 'Everywhere',
    desc: 'The law. Cross them and the heat comes.',
    rivals: ['eastside', 'northmarket'],
  },
};

// Named reputation tracks shown to the player.
export const REPUTATION_TRACKS = [
  { key: 'overall',  name: 'Overall',        desc: 'How the whole town sees you.' },
  { key: 'school',   name: 'School Standing', desc: 'Grades, clubs, attendance.' },
  { key: 'student',  name: 'Student Cred',    desc: 'How classmates view you.' },
  { key: 'staff',    name: 'Teacher/Staff',   desc: 'Faculty and security opinion.' },
  { key: 'street',   name: 'Street Rep',      desc: 'Your name in the underworld.' },
  { key: 'eastside', name: 'Eastside Kings',  desc: 'Standing with the Kings.' },
  { key: 'northmarket', name: 'North Market', desc: 'Standing with the Market Crew.' },
  { key: 'lawdogs',  name: 'Police Heat',     desc: 'Lower is better. High = wanted.' },
];
