import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural vehicle bodies.
//
// Every body is built from the catalogue's real dimensions (length / width /
// height / wheelbase / track / wheelRadius) so the thing you see is the thing
// the physics collides with. buildVehicleBody() returns the group plus the
// parts the simulation animates: wheels, lights, beacons, suspension.
// ---------------------------------------------------------------------------

const LIGHT_ON = 0xfff0c0;
const LIGHT_OFF = 0x6f6a58;
const TAIL_OFF = 0x6a1f1f;
const TAIL_ON = 0xff5a4a;

function mat(color, opts = {}) { return new THREE.MeshLambertMaterial({ color, ...opts }); }
function emissive(color) { return new THREE.MeshBasicMaterial({ color }); }

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A box with the top face inset — cabs, bonnets and tapered noses. */
function wedge(w, h, d, topScaleX, topScaleZ, material, x = 0, y = 0, z = 0, shiftZ = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * topScaleX);
      p.setZ(i, p.getZ(i) * topScaleZ + shiftZ);
    }
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function darken(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c.getHex();
}

// ---------------------------------------------------------------------------

/**
 * @returns {{group:THREE.Group, wheels:Array, headlights:Array, taillights:Array,
 *            beacons:Array, bodyMaterial:THREE.Material, seatHeight:number}}
 */
export function buildVehicleBody(def, colour) {
  const group = new THREE.Group();
  const paint = mat(colour);
  const trim = mat(darken(colour, 0.55));
  const glass = mat(0x2a3646);
  const tyre = mat(0x16161a);
  const steel = mat(0x8c9196);
  const dark = mat(0x23262b);

  const parts = {
    group, wheels: [], headlights: [], taillights: [], beacons: [],
    bodyMaterial: paint, glassMaterial: glass,
  };

  const L = def.length, W = def.width, H = def.height;
  const builder = BODIES[def.body] || BODIES.sedan;
  builder({ def, L, W, H, paint, trim, glass, tyre, steel, dark, parts, group });

  // --- wheels: placed from the wheelbase/track so they match the physics ---
  if (!parts.wheels.length) addWheels(parts, group, def, tyre);

  return parts;
}

function addWheels(parts, group, def, tyre, opts = {}) {
  const r = def.wheelRadius;
  const width = opts.width ?? Math.min(0.42, def.track * 0.22);
  const halfTrack = def.track / 2;
  const front = def.wheelbase / 2 + (opts.frontBias ?? 0);
  const rear = -def.wheelbase / 2 + (opts.rearBias ?? 0);
  const geo = new THREE.CylinderGeometry(r, r, width, opts.segments ?? 14);
  const hub = new THREE.CylinderGeometry(r * 0.52, r * 0.52, width + 0.02, 8);
  const hubMat = mat(0x9aa0a6);
  const spots = opts.spots || [
    [-halfTrack, front, true], [halfTrack, front, true],
    [-halfTrack, rear, false], [halfTrack, rear, false],
  ];
  for (const [wx, wz, isFront] of spots) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, r, wz);
    const mesh = new THREE.Mesh(geo, tyre);
    mesh.rotation.z = Math.PI / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    const cap = new THREE.Mesh(hub, hubMat);
    cap.rotation.z = Math.PI / 2;
    mesh.add(cap);
    group.add(pivot);
    parts.wheels.push({ pivot, mesh, front: isFront, steered: isFront });
  }
}

function addLights(parts, group, def, { y, z, spread, size = 0.3 }) {
  const headMat = emissive(LIGHT_OFF);
  const tailMat = emissive(TAIL_OFF);
  for (const sx of [-spread, spread]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.5, 0.08), headMat);
    h.position.set(sx, y, z);
    group.add(h);
    parts.headlights.push(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(size * 0.9, size * 0.45, 0.08), tailMat);
    t.position.set(sx, y, -z);
    group.add(t);
    parts.taillights.push(t);
  }
}

/** Roof light bar for emergency vehicles — alternating red/blue beacons. */
function addBeacons(parts, group, { y, z = 0, width = 1.2, kind = 'police' }) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, 0.26), mat(0x1a1c20));
  bar.position.set(0, y, z);
  group.add(bar);
  const colours = kind === 'fire' ? [0xff2a18, 0xff2a18] : kind === 'ambulance' ? [0xff2a2a, 0x3aa0ff] : [0x2a6bff, 0xff2a2a];
  for (let i = 0; i < 2; i++) {
    const lens = new THREE.Mesh(new THREE.BoxGeometry(width * 0.4, 0.14, 0.22), emissive(darken(colours[i], 0.25)));
    lens.position.set((i === 0 ? -1 : 1) * width * 0.26, y + 0.1, z);
    group.add(lens);
    parts.beacons.push({ mesh: lens, colour: colours[i], phase: i });
  }
}

// ---------------------------------------------------------------------------
// Body styles
// ---------------------------------------------------------------------------

const BODIES = {
  hatchback(ctx) {
    const { def, L, W, H, paint, glass, parts, group } = ctx;
    const r = def.wheelRadius;
    group.add(box(W, H * 0.44, L, paint, 0, r + H * 0.14, 0));
    group.add(wedge(W * 0.94, H * 0.40, L * 0.56, 0.86, 0.68, glass, 0, r + H * 0.52, -L * 0.04, -0.06));
    group.add(box(W * 0.84, 0.08, L * 0.34, paint, 0, r + H * 0.70, -L * 0.14));
    addLights(parts, group, def, { y: r + H * 0.20, z: L * 0.49, spread: W * 0.34, size: 0.26 });
    group.add(box(W * 1.01, 0.16, 0.2, mat(0x3a3f45), 0, r + H * 0.05, L * 0.49));
    group.add(box(W * 1.01, 0.16, 0.2, mat(0x3a3f45), 0, r + H * 0.05, -L * 0.49));
  },

  sedan(ctx) {
    const { def, L, W, H, paint, glass, parts, group } = ctx;
    const r = def.wheelRadius;
    group.add(box(W, H * 0.46, L, paint, 0, r + H * 0.12, 0));
    group.add(box(W * 0.97, H * 0.14, L * 0.42, paint, 0, r + H * 0.40, L * 0.22)); // bonnet
    group.add(wedge(W * 0.92, H * 0.36, L * 0.46, 0.82, 0.74, glass, 0, r + H * 0.52, -L * 0.08, -0.04));
    group.add(box(W * 0.80, 0.08, L * 0.30, paint, 0, r + H * 0.70, -L * 0.10));
    group.add(box(W * 0.97, H * 0.14, L * 0.30, paint, 0, r + H * 0.40, -L * 0.36)); // boot
    addLights(parts, group, def, { y: r + H * 0.22, z: L * 0.49, spread: W * 0.33 });
  },

  taxi(ctx) {
    BODIES.sedan(ctx);
    const { def, L, W, H, parts, group } = ctx;
    const r = def.wheelRadius;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(W * 0.44, 0.18, 0.26), emissive(0x1a1a1a));
    sign.position.set(0, r + H * 0.78, -L * 0.04);
    group.add(sign);
    parts.taxiSign = sign;
    for (const sx of [-1, 1]) {
      group.add(box(0.02, H * 0.14, L * 0.3, mat(0x1b1b1b), sx * W * 0.505, r + H * 0.24, 0));
    }
  },

  sports(ctx) {
    const { def, L, W, H, paint, glass, parts, group } = ctx;
    const r = def.wheelRadius;
    group.add(wedge(W, H * 0.50, L, 0.94, 0.98, paint, 0, r + H * 0.10, 0));
    group.add(wedge(W * 0.86, H * 0.34, L * 0.40, 0.70, 0.52, glass, 0, r + H * 0.46, -L * 0.04, -0.10));
    group.add(box(W * 0.98, H * 0.10, L * 0.26, paint, 0, r + H * 0.30, L * 0.40)); // low nose
    const wing = box(W * 0.84, 0.06, 0.26, mat(0x1b1b1f), 0, r + H * 0.56, -L * 0.46);
    group.add(wing);
    for (const sx of [-1, 1]) group.add(box(0.08, 0.2, 0.2, mat(0x1b1b1f), sx * W * 0.34, r + H * 0.46, -L * 0.46));
    group.add(box(W * 0.3, 0.06, L * 0.18, mat(0x1b1b1f), 0, r + H * 0.36, L * 0.22)); // bonnet vent
    addLights(parts, group, def, { y: r + H * 0.26, z: L * 0.48, spread: W * 0.32, size: 0.34 });
  },

  muscle(ctx) {
    const { def, L, W, H, paint, glass, parts, group } = ctx;
    const r = def.wheelRadius;
    group.add(box(W, H * 0.50, L, paint, 0, r + H * 0.12, 0));
    group.add(box(W * 0.98, H * 0.16, L * 0.44, paint, 0, r + H * 0.42, L * 0.22));
    group.add(box(W * 0.34, H * 0.12, L * 0.16, mat(0x1b1b1f), 0, r + H * 0.52, L * 0.26)); // hood scoop
    group.add(wedge(W * 0.90, H * 0.32, L * 0.40, 0.88, 0.80, glass, 0, r + H * 0.54, -L * 0.10, -0.03));
    group.add(box(W * 0.86, 0.08, L * 0.26, paint, 0, r + H * 0.70, -L * 0.12));
    group.add(box(W * 0.98, H * 0.16, L * 0.26, paint, 0, r + H * 0.42, -L * 0.38));
    addLights(parts, group, def, { y: r + H * 0.26, z: L * 0.49, spread: W * 0.32, size: 0.28 });
    for (const sx of [-1, 1]) { // side pipes
      group.add(box(0.1, 0.1, L * 0.3, mat(0x9aa0a6), sx * W * 0.50, r * 0.5, -L * 0.1));
    }
  },

  police(ctx) {
    const { def, L, W, H, parts, group } = ctx;
    BODIES.sedan(ctx);
    const r = def.wheelRadius;
    for (const sx of [-1, 1]) {
      group.add(box(0.03, H * 0.22, L * 0.52, mat(0xf2f4f6), sx * W * 0.502, r + H * 0.22, -L * 0.02));
    }
    group.add(box(W * 0.6, H * 0.10, 0.03, mat(0xf2f4f6), 0, r + H * 0.42, L * 0.502));
    addBeacons(parts, group, { y: r + H * 0.78, z: -L * 0.06, width: W * 0.74, kind: 'police' });
    group.add(box(W * 0.9, 0.22, 0.14, mat(0x2b2f36), 0, r + H * 0.26, L * 0.54)); // push bar
  },

  pickup(ctx) {
    const { def, L, W, H, paint, glass, trim, parts, group } = ctx;
    const r = def.wheelRadius;
    group.add(box(W, H * 0.34, L, paint, 0, r + H * 0.20, 0));                        // chassis rail
    group.add(box(W * 0.99, H * 0.30, L * 0.34, paint, 0, r + H * 0.46, L * 0.30));   // bonnet
    group.add(box(W * 0.96, H * 0.40, L * 0.30, paint, 0, r + H * 0.54, 0));          // cab base
    group.add(wedge(W * 0.92, H * 0.30, L * 0.28, 0.90, 0.84, glass, 0, r + H * 0.82, 0.01, -0.02));
    group.add(box(W * 0.88, 0.08, L * 0.26, paint, 0, r + H * 0.97, 0));              // roof
    // bed
    group.add(box(W, H * 0.30, L * 0.40, paint, 0, r + H * 0.45, -L * 0.28));
    group.add(box(W * 0.86, H * 0.22, L * 0.34, mat(0x2d3135), 0, r + H * 0.50, -L * 0.28));
    group.add(box(W * 1.02, H * 0.26, 0.1, trim, 0, r + H * 0.44, -L * 0.49));        // tailgate
    addLights(parts, group, def, { y: r + H * 0.40, z: L * 0.49, spread: W * 0.36, size: 0.32 });
    group.add(box(W * 1.04, 0.2, 0.22, mat(0x6e7479), 0, r + H * 0.22, L * 0.50));    // bumper
    for (const sx of [-1, 1]) group.add(box(0.06, 0.16, L * 0.4, mat(0x3a3f45), sx * W * 0.52, r * 0.7, 0)); // side steps
  },

  van(ctx) {
    const { def, L, W, H, paint, glass, parts, group } = ctx;
    const r = def.wheelRadius;
    group.add(box(W, H * 0.70, L * 0.98, paint, 0, r + H * 0.36, -L * 0.01));          // tall box
    group.add(wedge(W * 0.98, H * 0.22, L * 0.26, 0.96, 0.6, paint, 0, r + H * 0.12, L * 0.40, 0.04)); // snub nose
    group.add(box(W * 0.94, H * 0.26, 0.06, glass, 0, r + H * 0.56, L * 0.47));        // windscreen
    for (const sx of [-1, 1]) {
      group.add(box(0.04, H * 0.22, L * 0.22, glass, sx * W * 0.502, r + H * 0.54, L * 0.26));
    }
    group.add(box(W * 0.96, 0.1, L * 0.9, mat(0xf2f2f2), 0, r + H * 0.71, -L * 0.02)); // roof
    addLights(parts, group, def, { y: r + H * 0.14, z: L * 0.49, spread: W * 0.36, size: 0.3 });
  },

  boxtruck(ctx) {
    const { def, L, W, H, paint, glass, parts, group } = ctx;
    const r = def.wheelRadius;
    const cabLen = L * 0.28;
    group.add(box(W * 0.94, H * 0.12, L * 0.9, mat(0x2b2e33), 0, r + 0.1, 0));         // frame
    group.add(box(W * 0.96, H * 0.52, cabLen, paint, 0, r + H * 0.36, L * 0.5 - cabLen / 2));
    group.add(box(W * 0.90, H * 0.22, 0.06, glass, 0, r + H * 0.52, L * 0.495));
    group.add(box(W, H * 0.62, L * 0.70, mat(0xf0f0f0), 0, r + H * 0.44, -L * 0.14));  // cargo box
    group.add(box(W * 1.01, 0.1, L * 0.70, paint, 0, r + H * 0.75, -L * 0.14));        // box roof trim
    group.add(box(W * 0.98, H * 0.5, 0.08, mat(0xcfcfcf), 0, r + H * 0.40, -L * 0.49)); // roller door
    addLights(parts, group, def, { y: r + H * 0.18, z: L * 0.49, spread: W * 0.34, size: 0.3 });
    addWheels(parts, group, def, ctx.tyre, {
      width: 0.34,
      spots: [
        [-def.track / 2, def.wheelbase / 2, true], [def.track / 2, def.wheelbase / 2, true],
        [-def.track / 2 - 0.1, -def.wheelbase / 2, false], [def.track / 2 + 0.1, -def.wheelbase / 2, false],
        [-def.track / 2 + 0.2, -def.wheelbase / 2, false], [def.track / 2 - 0.2, -def.wheelbase / 2, false],
      ],
    });
  },

  citybus(ctx) {
    const { def, L, W, H, paint, glass, parts, group } = ctx;
    const r = def.wheelRadius;
    group.add(box(W, H * 0.66, L, paint, 0, r + H * 0.38, 0));
    group.add(box(W * 1.002, H * 0.26, L * 0.86, glass, 0, r + H * 0.56, -L * 0.02));  // window band
    group.add(box(W * 0.98, H * 0.30, 0.06, glass, 0, r + H * 0.52, L * 0.50));        // windscreen
    group.add(box(W * 0.98, H * 0.26, 0.06, glass, 0, r + H * 0.52, -L * 0.50));       // rear glass
    group.add(box(W * 0.98, 0.12, L * 0.98, mat(0xf4f6f7), 0, r + H * 0.71, 0));       // roof
    group.add(box(W * 0.5, H * 0.08, 0.06, emissive(0xffcf6a), 0, r + H * 0.66, L * 0.502)); // destination blind
    for (const dz of [L * 0.22, -L * 0.18]) {                                           // doors
      group.add(box(0.05, H * 0.46, L * 0.09, mat(0x1f2630), W * 0.501, r + H * 0.33, dz));
    }
    addLights(parts, group, def, { y: r + H * 0.16, z: L * 0.49, spread: W * 0.36, size: 0.3 });
    addWheels(parts, group, def, ctx.tyre, { width: 0.4 });
  },

  schoolbus(ctx) {
    const { def, L, W, H, paint, glass, parts, group } = ctx;
    const r = def.wheelRadius;
    const nose = L * 0.16;
    group.add(box(W * 0.9, H * 0.34, nose, paint, 0, r + H * 0.26, L * 0.5 - nose / 2)); // bonnet
    group.add(box(W, H * 0.62, L - nose, paint, 0, r + H * 0.40, -nose / 2));
    group.add(box(W * 1.002, H * 0.22, (L - nose) * 0.84, glass, 0, r + H * 0.56, -nose / 2));
    group.add(box(W * 0.94, H * 0.26, 0.06, glass, 0, r + H * 0.56, L * 0.5 - nose + 0.02));
    group.add(box(W * 0.96, 0.12, L - nose, mat(0xf4f6f7), 0, r + H * 0.72, -nose / 2));
    for (const sx of [-1, 1]) group.add(box(W * 1.01, 0.1, (L - nose) * 0.9, mat(0x1b1b1b), 0, r + H * (sx > 0 ? 0.30 : 0.46), -nose / 2));
    // stop sign + warning lamps
    const sign = box(0.04, 0.44, 0.44, mat(0xd01f1f), -W * 0.52, r + H * 0.36, -L * 0.02);
    group.add(sign);
    parts.stopSign = sign;
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.06), emissive(darken(0xff2a2a, 0.25)));
      lamp.position.set(sx * W * 0.3, r + H * 0.74, L * 0.5 - nose + 0.02);
      group.add(lamp);
      parts.beacons.push({ mesh: lamp, colour: 0xff2a2a, phase: sx > 0 ? 1 : 0 });
    }
    addLights(parts, group, def, { y: r + H * 0.22, z: L * 0.49, spread: W * 0.32, size: 0.28 });
    addWheels(parts, group, def, ctx.tyre, { width: 0.38 });
  },

  ambulance(ctx) {
    const { def, L, W, H, paint, glass, parts, group } = ctx;
    const r = def.wheelRadius;
    const cabLen = L * 0.34;
    group.add(box(W * 0.9, H * 0.46, cabLen, paint, 0, r + H * 0.30, L * 0.5 - cabLen / 2));
    group.add(box(W * 0.86, H * 0.24, 0.06, glass, 0, r + H * 0.50, L * 0.495));
    group.add(box(W, H * 0.68, L - cabLen, mat(0xf7f9fa), 0, r + H * 0.40, -cabLen / 2)); // patient box
    group.add(box(W * 1.01, 0.1, L - cabLen, paint, 0, r + H * 0.74, -cabLen / 2));
    for (const sx of [-1, 1]) {                                                            // red stripe
      group.add(box(0.03, H * 0.12, (L - cabLen) * 0.92, mat(0xd8232a), sx * W * 0.502, r + H * 0.42, -cabLen / 2));
      group.add(box(0.03, H * 0.12, 0.5, mat(0xd8232a), sx * W * 0.452, r + H * 0.30, L * 0.3));
    }
    group.add(box(W * 0.9, H * 0.5, 0.08, mat(0xe8ebee), 0, r + H * 0.40, -L * 0.49));    // rear doors
    addBeacons(parts, group, { y: r + H * 0.78, z: L * 0.5 - cabLen * 0.6, width: W * 0.7, kind: 'ambulance' });
    addLights(parts, group, def, { y: r + H * 0.18, z: L * 0.49, spread: W * 0.34, size: 0.3 });
  },

  firetruck(ctx) {
    const { def, L, W, H, paint, glass, steel, parts, group } = ctx;
    const r = def.wheelRadius;
    const cabLen = L * 0.3;
    group.add(box(W, H * 0.56, cabLen, paint, 0, r + H * 0.34, L * 0.5 - cabLen / 2));
    group.add(box(W * 0.94, H * 0.24, 0.06, glass, 0, r + H * 0.56, L * 0.495));
    for (const sx of [-1, 1]) group.add(box(0.05, H * 0.2, cabLen * 0.5, glass, sx * W * 0.501, r + H * 0.54, L * 0.5 - cabLen * 0.55));
    group.add(box(W, H * 0.52, L - cabLen, paint, 0, r + H * 0.32, -cabLen / 2));          // pump body
    for (const sx of [-1, 1]) {                                                            // lockers
      group.add(box(0.06, H * 0.26, (L - cabLen) * 0.8, mat(0x9aa0a6), sx * W * 0.502, r + H * 0.34, -cabLen / 2));
    }
    group.add(box(W * 0.9, 0.12, L - cabLen, mat(0x2f3238), 0, r + H * 0.58, -cabLen / 2)); // deck
    const ladder = new THREE.Group();
    ladder.position.set(0, r + H * 0.66, -cabLen / 2);
    for (const sx of [-1, 1]) ladder.add(box(0.08, 0.08, (L - cabLen) * 0.94, steel, sx * 0.34, 0, 0));
    for (let i = -4; i <= 4; i++) ladder.add(box(0.72, 0.06, 0.06, steel, 0, 0, i * ((L - cabLen) * 0.1)));
    group.add(ladder);
    addBeacons(parts, group, { y: r + H * 0.66, z: L * 0.5 - cabLen * 0.5, width: W * 0.8, kind: 'fire' });
    addLights(parts, group, def, { y: r + H * 0.22, z: L * 0.49, spread: W * 0.36, size: 0.34 });
    group.add(box(W * 1.02, 0.26, 0.2, mat(0xb0b6bb), 0, r + H * 0.12, L * 0.5));
    addWheels(parts, group, def, ctx.tyre, { width: 0.42 });
  },

  motorcycle(ctx) {
    const { def, L, W, H, paint, parts, group, tyre } = ctx;
    const r = def.wheelRadius;
    const frame = new THREE.Group();
    group.add(frame);
    parts.leanGroup = frame;
    frame.add(box(W * 0.5, H * 0.26, L * 0.46, paint, 0, r + H * 0.34, 0));            // tank/airbox
    frame.add(wedge(W * 0.78, H * 0.26, L * 0.34, 0.5, 0.6, paint, 0, r + H * 0.30, L * 0.26, 0.05)); // fairing
    frame.add(box(W * 0.46, H * 0.12, L * 0.3, mat(0x1b1b1f), 0, r + H * 0.52, -L * 0.2)); // seat
    frame.add(box(W * 0.6, H * 0.22, L * 0.18, mat(0x3b3f45), 0, r + H * 0.10, -L * 0.04)); // engine
    frame.add(box(0.1, 0.1, L * 0.36, mat(0x9aa0a6), W * 0.2, r * 0.6, -L * 0.22));     // exhaust
    const bars = box(W * 1.1, 0.07, 0.07, mat(0x2b2e33), 0, r + H * 0.62, L * 0.24);
    frame.add(bars);
    parts.handlebars = bars;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.08), emissive(LIGHT_OFF));
    head.position.set(0, r + H * 0.46, L * 0.46);
    frame.add(head);
    parts.headlights.push(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.06), emissive(TAIL_OFF));
    tail.position.set(0, r + H * 0.46, -L * 0.46);
    frame.add(tail);
    parts.taillights.push(tail);
    const geo = new THREE.CylinderGeometry(r, r, 0.16, 14);
    for (const [wz, isFront] of [[def.wheelbase / 2, true], [-def.wheelbase / 2, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, r, wz);
      const mesh = new THREE.Mesh(geo, tyre);
      mesh.rotation.z = Math.PI / 2;
      mesh.castShadow = true;
      pivot.add(mesh);
      frame.add(pivot);
      parts.wheels.push({ pivot, mesh, front: isFront, steered: isFront });
    }
  },

  scooter(ctx) {
    const { def, L, W, H, paint, parts, group, tyre } = ctx;
    const r = def.wheelRadius;
    const frame = new THREE.Group();
    group.add(frame);
    parts.leanGroup = frame;
    frame.add(box(W * 0.62, H * 0.16, L * 0.5, paint, 0, r + H * 0.22, -L * 0.04));      // floor/body
    frame.add(wedge(W * 0.7, H * 0.44, L * 0.22, 0.6, 0.8, paint, 0, r + H * 0.34, L * 0.34, 0)); // leg shield
    frame.add(box(W * 0.56, H * 0.12, L * 0.28, mat(0x1b1b1f), 0, r + H * 0.40, -L * 0.14)); // seat
    frame.add(box(W * 0.5, H * 0.2, L * 0.2, mat(0x3b3f45), 0, r + H * 0.12, -L * 0.3));  // engine block
    const bars = box(W * 0.98, 0.06, 0.06, mat(0x2b2e33), 0, r + H * 0.62, L * 0.3);
    frame.add(bars);
    parts.handlebars = bars;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.08), emissive(LIGHT_OFF));
    head.position.set(0, r + H * 0.46, L * 0.42);
    frame.add(head);
    parts.headlights.push(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.06), emissive(TAIL_OFF));
    tail.position.set(0, r + H * 0.40, -L * 0.44);
    frame.add(tail);
    parts.taillights.push(tail);
    const geo = new THREE.CylinderGeometry(r, r, 0.14, 12);
    for (const [wz, isFront] of [[def.wheelbase / 2, true], [-def.wheelbase / 2, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, r, wz);
      const mesh = new THREE.Mesh(geo, tyre);
      mesh.rotation.z = Math.PI / 2;
      pivot.add(mesh);
      frame.add(pivot);
      parts.wheels.push({ pivot, mesh, front: isFront, steered: isFront });
    }
  },
};

export const LIGHT_COLOURS = { LIGHT_ON, LIGHT_OFF, TAIL_ON, TAIL_OFF };
export const BODY_STYLES = Object.keys(BODIES);
