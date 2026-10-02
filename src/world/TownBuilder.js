import * as THREE from 'three';
import { BUILDINGS, INTERIORS, LOCATIONS } from '../data/world.js';
import { COLORS } from '../config.js';
import { makeBox } from '../systems/Physics.js';

// Builds the entire town + interiors as efficient Three.js geometry.
// Returns { root, colliders, doors, shopCounters, activityMarkers, collectibles, interiorCenters, labels }.
export class TownBuilder {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.colliders = [];        // AABB volumes (see systems/Physics.js)
    this.ladders = [];          // {x, z, yaw, bottom, top}
    this.doors = [];            // {pos:Vector3, kind:'enter'|'exit', interior, exit, name}
    this.shopCounters = [];     // {pos, shop, name}
    this.activityMarkers = [];  // {pos, activity, name}
    this.collectibles = [];     // {id, mesh, pos, name}
    this.interiorCenters = {};  // interiorId -> {x,z}
    this.labels = [];
  }

  /**
   * Register a solid volume.
   * opts: { height, minY, climb, vault, type, tall }  (boolean = legacy `tall`)
   */
  addCollider(cx, cz, w, d, opts = {}) {
    if (typeof opts === 'boolean') opts = { height: opts ? 20 : 1.2, tall: opts };
    const box = makeBox(cx, cz, w, d, {
      minY: opts.minY ?? 0,
      maxY: opts.height ?? opts.maxY ?? 20,
      tall: opts.tall,
      climb: opts.climb,
      vault: opts.vault,
      type: opts.type,
      label: opts.label,
    });
    this.colliders.push(box);
    return box;
  }

  build() {
    this._ground();
    this._roads();
    this._buildings();
    this._park();
    this._props();
    this._clocktower();
    this._parkour();
    this._interiors();
    this._collectibles();
    return this;
  }

  _ground() {
    const g = new THREE.PlaneGeometry(600, 600);
    const m = new THREE.MeshLambertMaterial({ color: COLORS.grass });
    const ground = new THREE.Mesh(g, m);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
  }

  _roadStrip(x, z, w, d, color, y = 0.02) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  _roads() {
    const hs = [-30, 10, 50, 90];   // horizontal road z positions
    const vs = [-110, -40, 20, 70, 110]; // vertical road x positions
    for (const z of hs) {
      this._roadStrip(0, z, 300, 12, COLORS.sidewalk, 0.015);
      this._roadStrip(0, z, 300, 8, COLORS.road, 0.02);
      // dashed center line
      for (let x = -140; x < 140; x += 8) this._roadStrip(x, z, 3, 0.5, 0xffe08a, 0.03);
    }
    for (const x of vs) {
      this._roadStrip(x, 5, 12, 260, COLORS.sidewalk, 0.015);
      this._roadStrip(x, 5, 8, 260, COLORS.road, 0.02);
      for (let z = -120; z < 130; z += 8) this._roadStrip(x, z, 0.5, 3, 0xffe08a, 0.03);
    }
    this.roadZ = hs; this.roadX = vs;
  }

  _makeLabel(text, x, y, z, color = '#ffca3a') {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(10,12,18,0.75)'; ctx.fillRect(0, 0, 256, 64);
    ctx.font = 'bold 26px Trebuchet MS'; ctx.fillStyle = color; ctx.textAlign = 'center';
    ctx.fillText(text, 128, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
    spr.position.set(x, y, z);
    spr.scale.set(10, 2.5, 1);
    this.root.add(spr);
    this.labels.push(spr);
  }

  _buildings() {
    const roofMatCache = {};
    for (const b of BUILDINGS) {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(b.w, b.h, b.d),
        new THREE.MeshLambertMaterial({ color: b.color })
      );
      body.position.set(b.x, b.h / 2, b.z);
      body.castShadow = true; body.receiveShadow = true;
      this.root.add(body);

      // roof slab
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(b.w + 1, 0.6, b.d + 1),
        new THREE.MeshLambertMaterial({ color: b.roof })
      );
      roof.position.set(b.x, b.h + 0.3, b.z);
      roof.castShadow = true;
      this.root.add(roof);

      // simple windows (front face, +z)
      const winMat = new THREE.MeshLambertMaterial({ color: 0x9fd0e8, emissive: 0x223344, emissiveIntensity: 0.3 });
      const cols = Math.max(1, Math.floor(b.w / 5));
      const rows = Math.max(1, Math.floor(b.h / 4));
      for (let cx = 0; cx < cols; cx++) {
        for (let ry = 0; ry < rows; ry++) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.8), winMat);
          win.position.set(b.x - b.w / 2 + 2.5 + cx * (b.w / cols), 2.5 + ry * 3.2, b.z + b.d / 2 + 0.06);
          this.root.add(win);
        }
      }

      this.addCollider(b.x, b.z, b.w, b.d, { height: b.h + 0.6, climb: false, vault: false, label: b.id });

      if (b.label) this._makeLabel(b.label, b.x, b.h + 2.4, b.z);

      // Door marker for enterable buildings
      if (b.enterable && b.door) {
        const door = this._doorMesh(b.door.x, b.door.z, 0x5a3a1a);
        this.doors.push({ pos: new THREE.Vector3(b.door.x, 1, b.door.z), kind: 'enter', interior: b.interior, name: INTERIORS[b.interior]?.name || b.label });
      }
    }
  }

  _doorMesh(x, z, color) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, 0.3), new THREE.MeshLambertMaterial({ color, emissive: 0x332200, emissiveIntensity: 0.4 }));
    door.position.set(x, 1.5, z);
    this.root.add(door);
    // glow ring on ground
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 20), new THREE.MeshBasicMaterial({ color: 0xffca3a, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.05, z);
    this.root.add(ring);
    return door;
  }

  _park() {
    const p = LOCATIONS.park;
    const grass = new THREE.Mesh(new THREE.CircleGeometry(34, 24), new THREE.MeshLambertMaterial({ color: COLORS.park }));
    grass.rotation.x = -Math.PI / 2; grass.position.set(p.x, 0.03, p.z); grass.receiveShadow = true;
    this.root.add(grass);

    // pond
    const pond = new THREE.Mesh(new THREE.CircleGeometry(8, 20), new THREE.MeshLambertMaterial({ color: COLORS.water }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(p.x - 12, 0.05, p.z + 8);
    this.root.add(pond);

    // basketball court
    const c = LOCATIONS.court;
    this._roadStrip(c.x, c.z, 18, 26, 0x9a6a3a, 0.04);
    const hoop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.5, 0.3), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    hoop.position.set(c.x, 1.75, c.z - 12); this.root.add(hoop);

    // skatepark ramps
    const s = LOCATIONS.skatepark;
    this._roadStrip(s.x, s.z, 22, 20, 0x777777, 0.04);
    for (let i = 0; i < 3; i++) {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(6, 2, 4), new THREE.MeshLambertMaterial({ color: 0x8a8f96 }));
      ramp.position.set(s.x - 6 + i * 6, 1, s.z + (i % 2 ? 4 : -4)); ramp.rotation.z = 0.2;
      ramp.castShadow = true; this.root.add(ramp);
    }
  }

  _props() {
    // Trees via InstancedMesh (trunk + canopy) for low draw calls.
    const treeSpots = [];
    // scatter trees around park and streets
    const p = LOCATIONS.park;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2; const r = 20 + (i % 3) * 5;
      treeSpots.push([p.x + Math.cos(a) * r, p.z + Math.sin(a) * r]);
    }
    for (let x = -130; x <= 130; x += 26) { treeSpots.push([x, -34]); treeSpots.push([x, 54]); }
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 3, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
    const canopyGeo = new THREE.IcosahedronGeometry(2.4, 0);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3f7a3a });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeSpots.length);
    trunks.castShadow = canopies.castShadow = true;
    const m = new THREE.Matrix4();
    treeSpots.forEach((s, i) => {
      m.makeTranslation(s[0], 1.5, s[1]); trunks.setMatrixAt(i, m);
      m.makeTranslation(s[0], 4.2, s[1]); canopies.setMatrixAt(i, m);
      this.addCollider(s[0], s[1], 1.1, 1.1, { height: 5, climb: false, vault: false });
    });
    trunks.instanceMatrix.needsUpdate = true; canopies.instanceMatrix.needsUpdate = true;
    this.root.add(trunks); this.root.add(canopies);

    // Street lamps via InstancedMesh
    const lampSpots = [];
    for (const x of this.roadX) for (const z of this.roadZ) lampSpots.push([x + 6, z + 6]);
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 6);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x2b2b30 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
    const bulbGeo = new THREE.SphereGeometry(0.4, 8, 8);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
    const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampSpots.length);
    lampSpots.forEach((s, i) => {
      m.makeTranslation(s[0], 3, s[1]); poles.setMatrixAt(i, m);
      m.makeTranslation(s[0], 6.1, s[1]); bulbs.setMatrixAt(i, m);
    });
    poles.instanceMatrix.needsUpdate = true; bulbs.instanceMatrix.needsUpdate = true;
    this.root.add(poles); this.root.add(bulbs);
    this.lampBulbs = bulbs;

    // benches in park
    for (let i = 0; i < 4; i++) {
      const bx = p.x + (i - 1.5) * 8, bz = p.z - 16;
      const b = new THREE.Mesh(new THREE.BoxGeometry(3, 0.45, 1), new THREE.MeshLambertMaterial({ color: 0x7a5a3a }));
      b.position.set(bx, 0.52, bz); b.castShadow = true; this.root.add(b);
      const back = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 0.14), new THREE.MeshLambertMaterial({ color: 0x6a4e32 }));
      back.position.set(bx, 0.95, bz - 0.42); this.root.add(back);
      for (const lx of [-1.3, 1.3]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.9), new THREE.MeshLambertMaterial({ color: 0x4a4a52 }));
        leg.position.set(bx + lx, 0.25, bz); this.root.add(leg);
      }
      this.addCollider(bx, bz, 3, 1, { height: 0.75, tall: false });
    }
  }

  _clocktower() {
    const t = LOCATIONS.clocktower;
    const base = new THREE.Mesh(new THREE.BoxGeometry(8, 26, 8), new THREE.MeshLambertMaterial({ color: 0xb0a890 }));
    base.position.set(t.x, 13, t.z); base.castShadow = true; this.root.add(base);
    const top = new THREE.Mesh(new THREE.ConeGeometry(6.5, 8, 4), new THREE.MeshLambertMaterial({ color: 0x7a2f2f }));
    top.position.set(t.x, 30, t.z); top.rotation.y = Math.PI / 4; this.root.add(top);
    const face = new THREE.Mesh(new THREE.CircleGeometry(2.2, 20), new THREE.MeshBasicMaterial({ color: 0xf0e8d0 }));
    face.position.set(t.x, 20, t.z + 4.05); this.root.add(face);
    this.clockHand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, 0.1), new THREE.MeshBasicMaterial({ color: 0x222 }));
    this.clockHand.position.set(t.x, 20, t.z + 4.1); this.root.add(this.clockHand);
    this.addCollider(t.x, t.z, 8, 8, { height: 26, climb: false, vault: false });
  }


  // =========================================================================
  // Parkour furniture: things to vault, climb, stack and reach roofs with.
  // Everything is axis-aligned so it matches the collision model exactly.
  // =========================================================================
  _parkour() {
    const L = new THREE.MeshLambertMaterial({ color: 0x8a6a3f });   // crate
    const L2 = new THREE.MeshLambertMaterial({ color: 0x6f5431 });  // crate dark
    const steel = new THREE.MeshLambertMaterial({ color: 0x8d949c });
    const steelDark = new THREE.MeshLambertMaterial({ color: 0x5a616a });
    const concrete = new THREE.MeshLambertMaterial({ color: 0xa8a49a });
    const plank = new THREE.MeshLambertMaterial({ color: 0xc19a5b });

    const solid = (x, y, z, w, h, d, mat, opts = {}) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y + h / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      this.root.add(m);
      this.addCollider(x, z, w, d, { minY: y, height: y + h, tall: h > 2.5, ...opts });
      return m;
    };

    // --- crate / container helpers ---
    const crate = (x, z, size = 1.2, y = 0, mat = L) => solid(x, y, z, size, size, size, mat);
    const container = (x, z, w = 6, d = 2.5, y = 0, h = 2.4, color = 0x3f6b5c) =>
      solid(x, y, z, w, h, d, new THREE.MeshLambertMaterial({ color }));
    const lowWall = (x, z, w, d, h = 0.9, mat = concrete) => solid(x, 0, z, w, h, d, mat);

    const dumpster = (x, z, color = 0x3f6e4a) => {
      solid(x, 0, z, 2.4, 1.35, 1.4, new THREE.MeshLambertMaterial({ color }));
      const lid = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 1.5), new THREE.MeshLambertMaterial({ color: 0x2f5438 }));
      lid.position.set(x, 1.42, z); lid.castShadow = true; this.root.add(lid);
    };

    // --- scaffolding platform with poles ---
    const platform = (x, z, w, d, y, mat = plank) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), mat);
      m.position.set(x, y - 0.11, z); m.castShadow = true; m.receiveShadow = true;
      this.root.add(m);
      this.addCollider(x, z, w, d, { minY: y - 0.22, height: y, tall: false });
      for (const sx of [-w / 2 + 0.2, w / 2 - 0.2]) {
        for (const sz of [-d / 2 + 0.2, d / 2 - 0.2]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, y, 6), steel);
          pole.position.set(x + sx, y / 2, z + sz); this.root.add(pole);
        }
      }
    };

    // --- ladder (climbable volume + mesh). `yaw` points INTO the wall. ---
    const ladder = (x, z, yaw, bottom, top) => {
      const g = new THREE.Group();
      const h = top - bottom;
      for (const side of [-0.24, 0.24]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), steelDark);
        rail.position.set(side, h / 2, 0); g.add(rail);
      }
      const rungs = Math.max(2, Math.floor(h / 0.34));
      for (let i = 1; i < rungs; i++) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.06, 0.06), steel);
        r.position.set(0, i * (h / rungs), 0); g.add(r);
      }
      g.position.set(x, bottom, z);
      g.rotation.y = yaw;
      this.root.add(g);
      this.ladders.push({ x, z, yaw, bottom, top });
    };
    this._ladder = ladder;

    // --- steps: a run of boxes the controller walks up automatically ---
    const steps = (x, z, w, count, rise = 0.38, run = 0.9, dir = 1, mat = concrete) => {
      for (let i = 0; i < count; i++) {
        solid(x, 0, z + dir * i * run, w, rise * (i + 1), run, mat, { vault: false });
      }
    };

    // ======================================================================
    // 1. Downtown construction site — the main parkour playground
    // ======================================================================
    const cx = -10, cz = 30;
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(26, 24), new THREE.MeshLambertMaterial({ color: 0x8e8b82 }));
    slab.rotation.x = -Math.PI / 2; slab.position.set(cx, 0.03, cz); slab.receiveShadow = true;
    this.root.add(slab);
    this._makeLabel('CONSTRUCTION SITE', cx, 6.4, cz - 11, '#ffb347');

    crate(cx - 9, cz - 6, 1.2);
    crate(cx - 7.6, cz - 6, 1.2, 0, L2);
    crate(cx - 9, cz - 6, 1.1, 1.2, L2);           // stacked: step up to the scaffold
    crate(cx - 7.0, cz - 7.6, 1.0);
    container(cx + 7, cz - 5, 6, 2.5, 0, 2.4, 0x40607a);
    container(cx + 7, cz - 5, 5.4, 2.3, 2.4, 2.3, 0x4a6f58);   // second storey

    platform(cx - 4, cz + 1, 10, 7, 2.45);          // first scaffold deck
    platform(cx - 6, cz + 4, 6, 4, 4.9);            // upper deck
    ladder(cx - 8.6, cz - 1.2, 0, 0, 2.45);         // ground → deck 1
    ladder(cx - 6.4, cz + 1.6, 0, 2.45, 4.9);       // deck 1 → deck 2

    lowWall(cx + 2, cz + 9, 14, 0.5, 1.05, concrete);   // site hoarding: vault it
    lowWall(cx - 10, cz + 6, 0.5, 8, 1.05, concrete);
    solid(cx + 11, 0, cz + 6, 2.2, 0.75, 2.2, steelDark);  // cable spool
    solid(cx - 2, 0, cz - 9, 3.0, 0.55, 1.2, plank);       // plank pile (vault)

    // ======================================================================
    // 2. Dockside container yard (gang turf) — climb to the warehouse roof
    // ======================================================================
    const dx0 = 96, dz0 = 118;
    container(dx0, dz0, 6, 2.6, 0, 2.4, 0x7a4040);
    container(dx0 + 7, dz0, 6, 2.6, 0, 2.4, 0x3f6b5c);
    container(dx0 + 3.5, dz0 - 3.2, 6, 2.6, 0, 2.4, 0x55607a);
    container(dx0 + 3.5, dz0, 5.6, 2.4, 2.4, 2.3, 0x6a6a3f);
    crate(dx0 - 4.2, dz0, 1.2);
    crate(dx0 - 4.2, dz0 - 1.5, 1.2, 0, L2);
    crate(dx0 - 4.2, dz0, 1.1, 1.2, L2);
    dumpster(dx0 + 12, dz0 - 2, 0x45566b);

    // ======================================================================
    // 3. Alleys: dumpsters and fire escapes
    // ======================================================================
    dumpster(LOCATIONS.alley_north.x - 2, LOCATIONS.alley_north.z + 2);
    dumpster(LOCATIONS.alley_north.x + 3, LOCATIONS.alley_north.z - 1, 0x4a4a5a);
    dumpster(LOCATIONS.alley_east.x, LOCATIONS.alley_east.z + 3);
    crate(LOCATIONS.alley_east.x + 2.4, LOCATIONS.alley_east.z + 1, 1.2);

    // ======================================================================
    // 4. Downtown square: planters and benches to vault
    // ======================================================================
    for (const [px, pz] of [[54, 20], [58, 24], [50, 24], [54, 28]]) {
      solid(px, 0, pz, 2.2, 0.85, 2.2, concrete, { label: 'planter' });
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshLambertMaterial({ color: 0x3f7a3a }));
      bush.position.set(px, 1.25, pz); bush.castShadow = true; this.root.add(bush);
    }
    lowWall(78, 14, 10, 0.5, 0.95);
    lowWall(46, 6, 0.5, 10, 0.95);

    // ======================================================================
    // 5. School: bleachers (step climbing) and a wall to vault
    // ======================================================================
    const bl = LOCATIONS.bleachers;
    steps(bl.x, bl.z - 4, 14, 5, 0.4, 1.0, 1, new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }));
    lowWall(LOCATIONS.school_gate.x + 10, LOCATIONS.school_gate.z + 2, 12, 0.5, 1.0);
    crate(LOCATIONS.quad.x + 6, LOCATIONS.quad.z + 4, 1.2);
    crate(LOCATIONS.quad.x + 7.4, LOCATIONS.quad.z + 4, 1.2, 0, L2);

    // ======================================================================
    // 6. Skate park obstacles get collision so they can be ridden/climbed
    // ======================================================================
    const sk = LOCATIONS.skatepark;
    for (let i = 0; i < 3; i++) this.addCollider(sk.x - 6 + i * 6, sk.z + (i % 2 ? 4 : -4), 6, 4, { height: 1.55, tall: false });
    solid(sk.x + 10, 0, sk.z - 2, 1.2, 0.5, 8, concrete);     // grind ledge

    // ======================================================================
    // 7. Roof access ladders on key buildings
    // ======================================================================
    const byId = {};
    for (const b of BUILDINGS) byId[b.id] = b;
    const roofLadder = (id, face) => {
      const b = byId[id]; if (!b) return;
      const top = b.h + 0.6;
      if (face === '+z') ladder(b.x + 3, b.z + b.d / 2 + 0.14, Math.PI, 0, top);
      else if (face === '-z') ladder(b.x - 3, b.z - b.d / 2 - 0.14, 0, 0, top);
      else if (face === '+x') ladder(b.x + b.w / 2 + 0.14, b.z + 2, -Math.PI / 2, 0, top);
      else ladder(b.x - b.w / 2 - 0.14, b.z + 2, Math.PI / 2, 0, top);
    };
    roofLadder('warehouse', '+z');
    roofLadder('depot', '-z');
    roofLadder('gym', '-x');
    roofLadder('store', '-z');
    roofLadder('arcade', '+x');
    roofLadder('home', '-x');
  }

  _interiors() {
    // Lay interiors in a far zone grid so they never touch the main map.
    const keys = Object.keys(INTERIORS);
    const baseX = 600, spacing = 70;
    keys.forEach((key, i) => {
      const ix = baseX + (i % 5) * spacing;
      const iz = Math.floor(i / 5) * spacing;
      this._buildInterior(key, ix, iz);
    });
  }

  _buildInterior(key, ix, iz) {
    const def = INTERIORS[key];
    this.interiorCenters[key] = { x: ix, z: iz };
    const g = new THREE.Group();
    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(def.w, def.d), new THREE.MeshLambertMaterial({ color: def.floor }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(ix, 0, iz); floor.receiveShadow = true;
    g.add(floor);
    // ceiling light
    const light = new THREE.PointLight(0xfff0d0, 0.8, 40); light.position.set(ix, 6, iz); g.add(light);
    // walls
    const wallMat = new THREE.MeshLambertMaterial({ color: def.wall });
    const h = 5;
    const mkWall = (x, z, w, d) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      wall.position.set(x, h / 2, z); wall.receiveShadow = true; g.add(wall);
      this.addCollider(x, z, w, d, { height: h, climb: false, vault: false });
    };
    mkWall(ix, iz - def.d / 2, def.w, 0.6);
    mkWall(ix, iz + def.d / 2, def.w, 0.6);
    mkWall(ix - def.w / 2, iz, 0.6, def.d);
    mkWall(ix + def.w / 2, iz, 0.6, def.d);

    // exit marker
    const exitPos = new THREE.Vector3(ix, 1, iz + def.d / 2 - 1.5);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.4, 18), new THREE.MeshBasicMaterial({ color: 0x06d6a0, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(exitPos.x, 0.05, exitPos.z); g.add(ring);
    this.doors.push({ pos: exitPos, kind: 'exit', exit: def.exit, name: 'Outside' });

    // shop counter
    if (def.shop) {
      const counter = new THREE.Mesh(new THREE.BoxGeometry(def.w - 6, 1.1, 2), new THREE.MeshLambertMaterial({ color: 0x5a4a3a }));
      counter.position.set(ix, 0.55, iz - def.d / 2 + 3); g.add(counter);
      this.addCollider(ix, iz - def.d / 2 + 3, def.w - 6, 2, { height: 1.1, tall: false });
      this.shopCounters.push({ pos: new THREE.Vector3(ix, 1, iz - def.d / 2 + 4.5), shop: def.shop, name: def.name });
      // shelves
      for (let s = 0; s < 3; s++) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(2, 3, def.d - 6), new THREE.MeshLambertMaterial({ color: 0x8a7a5a }));
        shelf.position.set(ix - def.w / 2 + 3 + s * 3, 1.5, iz + 2); g.add(shelf);
      }
    }
    // activity marker
    if (def.activity) {
      const ring2 = new THREE.Mesh(new THREE.RingGeometry(1, 1.4, 18), new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      ring2.rotation.x = -Math.PI / 2; ring2.position.set(ix, 0.05, iz - def.d / 2 + 3); g.add(ring2);
      this.activityMarkers.push({ pos: new THREE.Vector3(ix, 1, iz - def.d / 2 + 3), activity: def.activity, name: def.name });
    }
    this.root.add(g);
  }

  _collectibles() {
    // Hidden "Brackenridge Secrets" scattered around town.
    const spots = [
      ['sec1', 'Time Capsule', -70, -95], ['sec2', 'Old Mural', 62, -34], ['sec3', 'Lucky Coin', 0, 86],
      ['sec4', 'Hidden Stash', 118, 118], ['sec5', 'Class Ring', -96, 60], ['sec6', 'Founder Plaque', 24, 20],
      ['sec7', 'Graffiti Tag', 104, 28], ['sec8', 'Lost Locket', -22, 96], ['sec9', 'Rare Card', 84, 44],
      ['sec10', 'Old Photo', -120, 10], ['sec11', 'Trophy Shard', -22, -74], ['sec12', 'Buried Cash', 90, 118],
    ];
    const geo = new THREE.OctahedronGeometry(0.7, 0);
    for (const [id, name, x, z] of spots) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffca3a }));
      mesh.position.set(x, 1.4, z);
      this.root.add(mesh);
      this.collectibles.push({ id, name, mesh, pos: new THREE.Vector3(x, 1.4, z) });
    }
  }
}
