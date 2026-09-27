import * as THREE from 'three';
import { BUILDINGS, INTERIORS, LOCATIONS } from '../data/world.js';
import { COLORS } from '../config.js';

// Builds the entire town + interiors as efficient Three.js geometry.
// Returns { root, colliders, doors, shopCounters, activityMarkers, collectibles, interiorCenters, labels }.
export class TownBuilder {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.colliders = [];        // {minX,maxX,minZ,maxZ, tall}
    this.doors = [];            // {pos:Vector3, kind:'enter'|'exit', interior, exit, name}
    this.shopCounters = [];     // {pos, shop, name}
    this.activityMarkers = [];  // {pos, activity, name}
    this.collectibles = [];     // {id, mesh, pos, name}
    this.interiorCenters = {};  // interiorId -> {x,z}
    this.labels = [];
  }

  addCollider(cx, cz, w, d, tall = true) {
    this.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, tall });
  }

  build() {
    this._ground();
    this._roads();
    this._buildings();
    this._park();
    this._props();
    this._clocktower();
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

      this.addCollider(b.x, b.z, b.w, b.d);

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
      this.addCollider(s[0], s[1], 1.2, 1.2);
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
      const b = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 1), new THREE.MeshLambertMaterial({ color: 0x7a5a3a }));
      b.position.set(p.x + (i - 1.5) * 8, 0.5, p.z - 16); this.root.add(b);
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
    this.addCollider(t.x, t.z, 8, 8);
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
      this.addCollider(x, z, w, d);
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
      this.addCollider(ix, iz - def.d / 2 + 3, def.w - 6, 2, false);
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
