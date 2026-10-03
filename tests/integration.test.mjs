// ---------------------------------------------------------------------------
// Static integration audit. There is no browser in CI, so instead of booting
// the renderer we verify the seams that a browser would break on: DOM ids,
// UI method names, UI hooks, config keys, input action names and item ids.
//
//   npm run test:integration
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config.js';
import { DEFAULT_BINDINGS } from '../src/core/Input.js';
import { ITEMS } from '../src/data/items.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push(`  ✓ ${name}`); }
  catch (e) { failed++; results.push(`  ✗ ${name}\n      ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

const SRC = walk('src');
const sources = Object.fromEntries(SRC.map(f => [f, read(f)]));
const html = read('index.html');
const css = read('src/ui/style.css');
const gameJs = sources['src/Game.js'];
const uiJs = sources['src/ui/UI.js'];

console.log('\nIntegration surface');

test('every getElementById target exists in the markup', () => {
  // ids live either in index.html or in a UI template string
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  for (const src of Object.values(sources)) {
    for (const m of src.matchAll(/id="([^"${}]+)"/g)) ids.add(m[1]);
  }
  const missing = [];
  for (const [file, src] of Object.entries(sources)) {
    for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) {
      if (!ids.has(m[1])) missing.push(`${m[1]} (${file})`);
    }
  }
  assert(missing.length === 0, `missing ids: ${missing.join(', ')}`);
});

test('new HUD nodes are present and styled', () => {
  for (const id of ['stance', 'weapon-hud', 'crosshair', 'hitmarker', 'vignette', 'interact-prompt']) {
    assert(html.includes(`id="${id}"`), `index.html is missing #${id}`);
    assert(css.includes(`#${id}`), `style.css has no rule for #${id}`);
  }
  assert(/#crosshair[\s\S]{0,400}--gap/.test(css), 'the crosshair needs a --gap variable for spread feedback');
});

test('every UI method Game.js calls is implemented', () => {
  const defined = new Set();
  for (const m of uiJs.matchAll(/^\s{2}(?:get\s+)?([a-zA-Z_$][\w$]*)\s*\(/gm)) defined.add(m[1]);
  for (const m of uiJs.matchAll(/this\.([a-zA-Z_$][\w$]*)\s*=/g)) defined.add(m[1]);
  const missing = new Set();
  for (const m of gameJs.matchAll(/this\.ui\.([a-zA-Z_$][\w$]*)/g)) {
    if (!defined.has(m[1])) missing.add(m[1]);
  }
  assert(missing.size === 0, `UI is missing: ${[...missing].join(', ')}`);
});

test('every hook the UI calls is provided by Game.js', () => {
  const provided = new Set();
  const block = gameJs.slice(gameJs.indexOf('this.ui.hooks = {'));
  for (const m of block.matchAll(/^\s{6}([a-zA-Z_$][\w$]*):/gm)) provided.add(m[1]);
  const used = new Set([...uiJs.matchAll(/this\.hooks\.([a-zA-Z_$][\w$]*)/g)].map(m => m[1]));
  const missing = [...used].filter(h => !provided.has(h));
  assert(missing.length === 0, `hooks missing from Game.js: ${missing.join(', ')}`);
});

test('every CONFIG path referenced in src exists', () => {
  const missing = new Set();
  for (const [file, src] of Object.entries(sources)) {
    for (const m of src.matchAll(/\bCONFIG\.([a-zA-Z_$][\w$.]*)/g)) {
      const parts = m[1].split('.').filter(Boolean);
      let node = CONFIG, ok = true;
      for (const part of parts) {
        if (node && typeof node === 'object' && part in node) node = node[part];
        else { ok = false; break; }
      }
      if (!ok) missing.add(`CONFIG.${m[1]} (${file})`);
    }
  }
  assert(missing.size === 0, [...missing].join(', '));
});

test('every weapon in CONFIG.weapons is fully specified', () => {
  const need = ['name', 'damage', 'range', 'fireRate', 'magSize', 'reloadTime',
    'spreadHip', 'spreadAim', 'spreadMove', 'recoilPitch', 'recoilYaw', 'shake'];
  for (const [id, w] of Object.entries(CONFIG.weapons)) {
    for (const k of need) assert(w[k] !== undefined, `CONFIG.weapons.${id} is missing "${k}"`);
    assert(ITEMS[id], `weapon ${id} has no matching item in data/items.js`);
  }
});

test('firearm items declare ammo and are buyable somewhere', () => {
  const worldJs = read('src/data/world.js');
  for (const id of Object.keys(CONFIG.weapons)) {
    assert(ITEMS[id].type === 'weapon' && ITEMS[id].ranged, `${id} should be a ranged weapon item`);
    assert(worldJs.includes(`'${id}'`), `${id} is not stocked by any shop`);
  }
  assert(ITEMS.ammo, 'ammo item exists');
  assert(worldJs.includes("'ammo'"), 'ammo is stocked somewhere');
});

test('every input action used in src is bound', () => {
  const bound = new Set(Object.keys(DEFAULT_BINDINGS));
  bound.add('move');                                   // synthesised axis
  const unknown = new Set();
  for (const [file, src] of Object.entries(sources)) {
    if (file === 'src/core/Input.js') continue;
    for (const m of src.matchAll(/input\.(?:down|pressed|released)\('([^']+)'\)/g)) {
      if (!bound.has(m[1])) unknown.add(`${m[1]} (${file})`);
    }
  }
  assert(unknown.size === 0, `unbound actions: ${[...unknown].join(', ')}`);
});

test('every player event is handled by Game.js', () => {
  const playerJs = sources['src/entities/Player.js'];
  const emitted = new Set([...playerJs.matchAll(/this\.onEvent\('([^']+)'/g)].map(m => m[1]));
  const handled = gameJs.slice(gameJs.indexOf('_onPlayerEvent'));
  const missing = [...emitted].filter(e => !handled.includes(`'${e}'`));
  assert(missing.length === 0, `unhandled player events: ${missing.join(', ')}`);
});

test('every vehicle system event is handled by Game.js', () => {
  const vehicleJs = sources['src/entities/Vehicle.js'];
  const emitted = new Set([...vehicleJs.matchAll(/this\._emit\('([^']+)'/g)].map(m => m[1]));
  assert(emitted.size >= 8, `only ${emitted.size} vehicle events are emitted`);
  const handled = gameJs.slice(gameJs.indexOf('_onVehicleEvent'));
  // 'lights' and 'gear-change' are cosmetic; everything else must be acted on
  const cosmetic = new Set(['lights', 'engine-stop', 'skid', 'impact', 'engine-dead']);
  const missing = [...emitted].filter(e => !cosmetic.has(e) && !handled.includes(`'${e}'`));
  assert(missing.length === 0, `unhandled vehicle events: ${missing.join(', ')}`);
});

test('the vehicle HUD is present, styled and driven by the UI', () => {
  for (const id of ['vehicle-hud', 'vh-speed', 'vh-gear', 'vh-fuel', 'vh-health', 'vh-name']) {
    assert(html.includes(`id="${id}"`), `index.html is missing #${id}`);
  }
  assert(css.includes('#vehicle-hud'), 'style.css has no rule for #vehicle-hud');
  assert(uiJs.includes('updateVehicleHUD'), 'UI.js cannot drive the vehicle HUD');
  assert(gameJs.includes('updateVehicleHUD'), 'Game.js never updates the vehicle HUD');
});

test('every vehicle in the catalogue can be built and measured', () => {
  const vehiclesJs = sources['src/data/vehicles.js'];
  const bodies = new Set([...sources['src/entities/VehicleMeshes.js'].matchAll(/^  (\w+)\(ctx\)/gm)].map(m => m[1]));
  for (const m of vehiclesJs.matchAll(/body: '([^']+)'/g)) {
    assert(bodies.has(m[1]), `no mesh builder for body style '${m[1]}'`);
  }
});

test('every weapon event is handled by Game.js', () => {
  const weaponsJs = sources['src/systems/Weapons.js'];
  const emitted = new Set([...weaponsJs.matchAll(/this\.onEvent\('([^']+)'/g)].map(m => m[1]));
  const missing = [...emitted].filter(e => !gameJs.includes(`'${e}'`));
  assert(missing.length === 0, `unhandled weapon events: ${missing.join(', ')}`);
});

test('no stale imports (every imported file exists)', () => {
  const missing = [];
  for (const [file, src] of Object.entries(sources)) {
    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = path.resolve(path.dirname(path.join(ROOT, file)), m[1]);
      if (!fs.existsSync(target)) missing.push(`${m[1]} (${file})`);
    }
  }
  assert(missing.length === 0, missing.join(', '));
});

test('index.html still loads the game entry point and the import map', () => {
  assert(/type="importmap"/.test(html), 'import map');
  assert(/three@0\.160\.0/.test(html), 'three pinned to 0.160.0');
  assert(/src\/main\.js/.test(html), 'main.js entry');
});

test('no debugger statements or stray console.log in src', () => {
  const bad = [];
  for (const [file, src] of Object.entries(sources)) {
    if (/\bdebugger\b/.test(src)) bad.push(`debugger in ${file}`);
    for (const m of src.matchAll(/console\.log\(/g)) bad.push(`console.log in ${file}`);
  }
  assert(bad.length === 0, bad.join(', '));
});

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
