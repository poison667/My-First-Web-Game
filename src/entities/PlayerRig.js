import * as THREE from 'three';
import { CONFIG } from '../config.js';

// ---------------------------------------------------------------------------
// Jointed humanoid rig for the player character.
//
// Built from primitives (no external assets) but with a real joint hierarchy:
//   root → hips → spine → chest → neck → head
//                     ↳ shoulder → upperArm → forearm → hand → weapon socket
//          hips → thigh → shin → foot
//
// The animator drives joint rotations; nothing here animates by itself.
// ---------------------------------------------------------------------------

const NOMINAL_HEIGHT = 1.88;    // height of the rig as modelled

function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

function box(w, h, d, material, y = 0, z = 0, x = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export function buildPlayerRig(opts = {}) {
  const skinC = opts.skin ?? 0xe8b48c;
  const shirtC = opts.shirt ?? 0x2f6f9f;
  const pantsC = opts.pants ?? 0x27323c;
  const shoeC = opts.shoes ?? 0x1c1c22;
  const hairC = opts.hair ?? 0x241a12;

  const skin = mat(skinC);
  const shirt = mat(shirtC);
  const shirtDark = mat(new THREE.Color(shirtC).multiplyScalar(0.82).getHex());
  const pants = mat(pantsC);
  const shoes = mat(shoeC);
  const hair = mat(hairC);

  const root = new THREE.Group();          // origin at the feet
  root.name = 'playerRoot';

  // --- Hips / pelvis -------------------------------------------------------
  const hips = joint(root, 0, 0.97, 0);
  hips.add(box(0.40, 0.22, 0.26, pants, -0.02));
  hips.add(box(0.42, 0.06, 0.28, mat(0x1a1a20), 0.10));   // belt

  // --- Torso ---------------------------------------------------------------
  const spine = joint(hips, 0, 0.10, 0);
  spine.add(box(0.44, 0.28, 0.26, shirt, 0.14));
  const chest = joint(spine, 0, 0.26, 0);
  chest.add(box(0.52, 0.32, 0.28, shirt, 0.15));
  chest.add(box(0.54, 0.10, 0.30, shirtDark, 0.29));      // shoulder yoke
  const neck = joint(chest, 0, 0.30, 0);
  neck.add(box(0.13, 0.10, 0.13, skin, 0.05));

  // --- Head ----------------------------------------------------------------
  const head = joint(neck, 0, 0.09, 0);
  head.add(box(0.25, 0.27, 0.25, skin, 0.13));
  head.add(box(0.27, 0.08, 0.27, hair, 0.26));            // hair cap
  head.add(box(0.27, 0.12, 0.05, hair, 0.19, -0.12));     // back of hair
  const eyeMat = mat(0x1b1b22);
  head.add(box(0.045, 0.045, 0.02, eyeMat, 0.15, 0.126, -0.06));
  head.add(box(0.045, 0.045, 0.02, eyeMat, 0.15, 0.126, 0.06));
  head.add(box(0.05, 0.05, 0.04, skin, 0.10, 0.13));      // nose

  // --- Arms ----------------------------------------------------------------
  function makeArm(side) {
    const s = side === 'L' ? -1 : 1;
    const shoulder = joint(chest, s * 0.30, 0.22, 0);
    shoulder.add(box(0.16, 0.14, 0.20, shirt, 0.02));
    const upper = joint(shoulder, 0, -0.04, 0);
    upper.add(box(0.14, 0.28, 0.16, shirt, -0.14));
    const fore = joint(upper, 0, -0.28, 0);
    fore.add(box(0.12, 0.26, 0.13, skin, -0.13));
    const hand = joint(fore, 0, -0.26, 0);
    hand.add(box(0.11, 0.12, 0.09, skin, -0.05));
    return { shoulder, upper, fore, hand };
  }
  const armL = makeArm('L');
  const armR = makeArm('R');

  // Weapon socket: +Z of the socket runs along the arm, so props point the way
  // the hand points no matter how the arm is posed.
  const weaponSocket = new THREE.Group();
  weaponSocket.position.set(0, -0.08, 0.02);
  weaponSocket.rotation.x = Math.PI / 2;
  armR.hand.add(weaponSocket);

  // --- Legs ----------------------------------------------------------------
  function makeLeg(side) {
    const s = side === 'L' ? -1 : 1;
    const thigh = joint(hips, s * 0.13, -0.09, 0);
    thigh.add(box(0.18, 0.44, 0.19, pants, -0.22));
    const shin = joint(thigh, 0, -0.44, 0);
    shin.add(box(0.15, 0.42, 0.16, pants, -0.21));
    const foot = joint(shin, 0, -0.42, 0);
    foot.add(box(0.17, 0.10, 0.28, shoes, -0.05, 0.05));
    return { thigh, shin, foot };
  }
  const legL = makeLeg('L');
  const legR = makeLeg('R');

  // --- Props ---------------------------------------------------------------
  const props = buildProps(weaponSocket);
  const holster = new THREE.Group();            // sidearm on the right thigh
  holster.position.set(0.02, -0.18, 0.04);
  holster.rotation.set(0.2, 0, 0.25);
  legR.thigh.add(holster);
  const holsterGun = makePistol();
  holsterGun.scale.setScalar(0.9);
  holster.add(holsterGun);

  const backSling = new THREE.Group();          // melee weapon slung on the back
  backSling.position.set(0, 0.16, -0.17);
  backSling.rotation.set(0.1, 0, Math.PI / 5);
  chest.add(backSling);

  root.scale.setScalar(CONFIG.player.height / NOMINAL_HEIGHT);

  const rig = {
    root, hips, spine, chest, neck, head,
    armL, armR, legL, legR,
    weaponSocket, props, holster, backSling,
    materials: { skin, shirt, shirtDark, pants, shoes, hair },
    nominalHeight: NOMINAL_HEIGHT,
    // Compatibility shim so legacy code that recolours a "torso" still works.
    parts: { torso: chest.children[0], head: head.children[0], leftArm: armL.upper, rightArm: armR.upper, leftLeg: legL.thigh, rightLeg: legR.thigh },
  };
  root.userData.parts = rig.parts;

  rig.setOutfit = (o = {}) => {
    if (o.shirt !== undefined) { shirt.color.setHex(o.shirt); shirtDark.color.setHex(new THREE.Color(o.shirt).multiplyScalar(0.82).getHex()); }
    if (o.pants !== undefined) pants.color.setHex(o.pants);
    if (o.hair !== undefined) hair.color.setHex(o.hair);
    if (o.skin !== undefined) skin.color.setHex(o.skin);
    if (o.shoes !== undefined) shoes.color.setHex(o.shoes);
  };

  /** Show a weapon in hand ('fists' hides everything), optionally slung. */
  rig.setWeaponVisual = (kind, drawn = true) => {
    for (const [k, obj] of Object.entries(props)) obj.visible = drawn && k === kind;
    const meleeSlung = !drawn && props[kind] && kind !== 'pistol' && kind !== 'fists';
    backSling.visible = !!meleeSlung;
    if (meleeSlung) {
      while (backSling.children.length) backSling.remove(backSling.children[0]);
      const clone = props[kind].clone();
      clone.visible = true;
      clone.rotation.set(Math.PI / 2, 0, 0);
      backSling.add(clone);
    }
    holster.visible = kind !== 'pistol' ? rig._hasPistol === true : false;
  };
  rig.setHasPistol = (v) => { rig._hasPistol = v; holster.visible = !!v; };
  rig.setWeaponVisual('fists', true);

  return rig;
}

// ---------------------------------------------------------------------------
// Hand props. Each model points along +Z in socket space.
// ---------------------------------------------------------------------------

function makePistol() {
  const g = new THREE.Group();
  const body = mat(0x2a2d33);
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.3), body);
  slide.position.set(0, 0.03, 0.12);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.17, 0.08), mat(0x1c1f24));
  grip.position.set(0, -0.08, 0.0);
  grip.rotation.x = -0.25;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 6), mat(0x44474d));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, 0.3);
  g.add(slide, grip, barrel);
  g.castShadow = true;
  return g;
}

function buildProps(socket) {
  const props = {};

  // Baseball bat
  const bat = new THREE.Group();
  const batMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, 0.9, 8), mat(0xb98a4e));
  batMesh.rotation.x = Math.PI / 2;
  batMesh.position.z = 0.42;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.18, 8), mat(0x33261c));
  grip.rotation.x = Math.PI / 2; grip.position.z = 0.04;
  bat.add(batMesh, grip);
  props.bat = bat;

  // Crowbar
  const crow = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.78), mat(0xb4474a));
  shaft.position.z = 0.38;
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.16, 0.05), mat(0xb4474a));
  hook.position.set(0, 0.07, 0.74); hook.rotation.x = 0.5;
  crow.add(shaft, hook);
  props.crowbar = crow;

  // Lead pipe
  const pipe = new THREE.Group();
  const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 8), mat(0x9aa0a8));
  pm.rotation.x = Math.PI / 2; pm.position.z = 0.38;
  pipe.add(pm);
  props.pipe = pipe;

  // Skateboard
  const skate = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.78), mat(0x4b2e83));
  deck.position.z = 0.42;
  skate.add(deck);
  for (const z of [0.18, 0.66]) for (const x of [-0.08, 0.08]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 8), mat(0xe8e8e8));
    w.rotation.z = Math.PI / 2; w.position.set(x, -0.05, z);
    skate.add(w);
  }
  props.skateboard = skate;

  // Stun baton
  const taser = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8), mat(0x22252b));
  handle.rotation.x = Math.PI / 2; handle.position.z = 0.17;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 6), new THREE.MeshBasicMaterial({ color: 0x66e0ff }));
  tip.rotation.x = Math.PI / 2; tip.position.z = 0.42;
  taser.add(handle, tip);
  props.taser = taser;

  // Pistol
  props.pistol = makePistol();

  // Fists = no prop
  props.fists = new THREE.Group();

  for (const p of Object.values(props)) { p.visible = false; socket.add(p); }
  return props;
}

export { makePistol };
