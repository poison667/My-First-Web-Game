// ---------------------------------------------------------------------------
// Collision world for the player controller.
//
// The town is built from axis-aligned boxes, so collision is a broad-phase
// spatial hash + cheap AABB tests. The controller treats the player as a
// vertical cylinder (radius + height) which gives stable wall sliding, step-ups
// and ledge probing without a physics engine.
//
// Deliberately free of Three.js imports so it can be unit-tested in Node.
// ---------------------------------------------------------------------------

const EPS = 1e-4;

export function makeBox(cx, cz, w, d, opts = {}) {
  const minY = opts.minY ?? 0;
  const maxY = opts.maxY ?? (opts.height ?? 20);
  return {
    minX: cx - w / 2, maxX: cx + w / 2,
    minZ: cz - d / 2, maxZ: cz + d / 2,
    minY, maxY,
    tall: opts.tall ?? (maxY - minY > 2.5),
    type: opts.type || 'solid',
    climb: opts.climb !== false,      // can the player mantle onto it?
    vault: opts.vault !== false,      // can the player vault over it?
    vehicleSolid: opts.vehicleSolid ?? (maxY > 1.0),
    label: opts.label || '',
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class CollisionWorld {
  constructor(boxes = [], cellSize = 12) {
    this.boxes = boxes;
    this.cellSize = cellSize;
    this.grid = new Map();
    this.ladders = [];      // {x, z, yaw, bottom, top, width, depth}
    this._queryId = 0;
    this._stamp = new WeakMap();
    this.rebuild();
  }

  add(box) { this.boxes.push(box); this._insert(box); return box; }

  addLadder(l) { this.ladders.push(l); return l; }

  rebuild() {
    this.grid.clear();
    for (const b of this.boxes) this._insert(b);
  }

  _insert(b) {
    const cs = this.cellSize;
    const x0 = Math.floor(b.minX / cs), x1 = Math.floor(b.maxX / cs);
    const z0 = Math.floor(b.minZ / cs), z1 = Math.floor(b.maxZ / cs);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const key = x + ',' + z;
        let cell = this.grid.get(key);
        if (!cell) { cell = []; this.grid.set(key, cell); }
        cell.push(b);
      }
    }
  }

  /** Candidate boxes overlapping an XZ rectangle (deduplicated). */
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs), z1 = Math.floor(maxZ / cs);
    const id = ++this._queryId;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const cell = this.grid.get(x + ',' + z);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const b = cell[i];
          if (b._q === id) continue;
          b._q = id;
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Volume tests
  // -------------------------------------------------------------------------

  /** True when a cylinder (feet at y) fits without intersecting geometry. */
  isFree(x, y, z, radius, height, skin = 0.08) {
    const lo = y + skin, hi = y + height - skin;
    const cand = this.query(x - radius, z - radius, x + radius, z + radius, this._tmpA || (this._tmpA = []));
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (b.maxY <= lo || b.minY >= hi) continue;
      if (this._overlapsXZ(b, x, z, radius)) return false;
    }
    return true;
  }

  /** The box a cylinder would intersect at this position, or null. */
  blockerAt(x, y, z, radius, height, skin = 0.08) {
    const lo = y + skin, hi = y + height - skin;
    const cand = this.query(x - radius, z - radius, x + radius, z + radius, this._tmpB || (this._tmpB = []));
    let best = null, bestTop = -Infinity;
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (b.maxY <= lo || b.minY >= hi) continue;
      if (!this._overlapsXZ(b, x, z, radius)) continue;
      if (b.maxY > bestTop) { bestTop = b.maxY; best = b; }
    }
    return best;
  }

  _overlapsXZ(b, x, z, radius) {
    // Circle vs AABB (XZ plane)
    const cx = clamp(x, b.minX, b.maxX);
    const cz = clamp(z, b.minZ, b.maxZ);
    const dx = x - cx, dz = z - cz;
    return dx * dx + dz * dz < radius * radius - EPS;
  }

  /**
   * Highest supporting surface under the feet, including the world ground plane.
   * `maxStep` allows surfaces slightly above the feet (stairs / kerbs).
   */
  groundAt(x, z, y, radius, maxStep = 0.5, groundY = 0) {
    let topY = groundY, box = null;
    const cand = this.query(x - radius, z - radius, x + radius, z + radius, this._tmpC || (this._tmpC = []));
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (b.maxY > y + maxStep + EPS) continue;       // too high to stand on
      if (b.maxY < topY) continue;
      if (!this._overlapsXZ(b, x, z, radius)) continue;
      topY = b.maxY; box = b;
    }
    return { y: topY, box };
  }

  /** Lowest ceiling above `y` within the cylinder footprint (Infinity if open). */
  ceilingAt(x, z, y, radius) {
    let lowest = Infinity;
    const cand = this.query(x - radius, z - radius, x + radius, z + radius, this._tmpD || (this._tmpD = []));
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (b.minY < y + EPS) continue;
      if (!this._overlapsXZ(b, x, z, radius)) continue;
      if (b.minY < lowest) lowest = b.minY;
    }
    return lowest;
  }

  /** Push a cylinder out of any geometry it is intersecting (anti-tunneling). */
  depenetrate(pos, radius, height) {
    for (let pass = 0; pass < 3; pass++) {
      const b = this.blockerAt(pos.x, pos.y, pos.z, radius, height);
      if (!b) return pass > 0;
      const pLeft = pos.x + radius - b.minX;
      const pRight = b.maxX - (pos.x - radius);
      const pBack = pos.z + radius - b.minZ;
      const pFront = b.maxZ - (pos.z - radius);
      const m = Math.min(pLeft, pRight, pBack, pFront);
      if (m === pLeft) pos.x = b.minX - radius - EPS;
      else if (m === pRight) pos.x = b.maxX + radius + EPS;
      else if (m === pBack) pos.z = b.minZ - radius - EPS;
      else pos.z = b.maxZ + radius + EPS;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  /**
   * Slide a cylinder horizontally, resolving walls axis-by-axis and stepping up
   * small ledges. Mutates `pos`. Returns collision feedback for the controller
   * (used to trigger vaults / mantles).
   */
  moveXZ(pos, dx, dz, radius, height, stepHeight = 0.4) {
    const res = { hit: false, box: null, stepped: false, nx: 0, nz: 0, moved: 0 };
    const dist = Math.hypot(dx, dz);
    if (dist < EPS) return res;
    const maxStepLen = radius * 0.6;
    const steps = Math.min(8, Math.max(1, Math.ceil(dist / maxStepLen)));
    const sx = dx / steps, sz = dz / steps;
    const startX = pos.x, startZ = pos.z;

    for (let i = 0; i < steps; i++) {
      if (sx !== 0) {
        const nx = pos.x + sx;
        if (this.isFree(nx, pos.y, pos.z, radius, height)) {
          pos.x = nx;
        } else {
          const b = this.blockerAt(nx, pos.y, pos.z, radius, height);
          if (b && b.maxY - pos.y <= stepHeight + EPS && b.maxY > pos.y &&
              this.isFree(nx, b.maxY + 0.02, pos.z, radius, height)) {
            pos.x = nx; pos.y = b.maxY; res.stepped = true;
          } else {
            res.hit = true; res.box = b || res.box; res.nx = sx > 0 ? -1 : 1;
          }
        }
      }
      if (sz !== 0) {
        const nz = pos.z + sz;
        if (this.isFree(pos.x, pos.y, nz, radius, height)) {
          pos.z = nz;
        } else {
          const b = this.blockerAt(pos.x, pos.y, nz, radius, height);
          if (b && b.maxY - pos.y <= stepHeight + EPS && b.maxY > pos.y &&
              this.isFree(pos.x, b.maxY + 0.02, nz, radius, height)) {
            pos.z = nz; pos.y = b.maxY; res.stepped = true;
          } else {
            res.hit = true; res.box = b || res.box; res.nz = sz > 0 ? -1 : 1;
          }
        }
      }
    }
    res.moved = Math.hypot(pos.x - startX, pos.z - startZ);
    return res;
  }

  // -------------------------------------------------------------------------
  // Parkour probes
  // -------------------------------------------------------------------------

  /**
   * Closest obstacle in front of the player along (dx,dz).
   * Returns { box, dist, top, depth } where `depth` is how thick the obstacle is
   * along the travel direction (used to choose vault vs mantle).
   */
  probeAhead(pos, dx, dz, radius, height, reach) {
    const ex = pos.x + dx * reach, ez = pos.z + dz * reach;
    const minX = Math.min(pos.x, ex) - radius - 0.1, maxX = Math.max(pos.x, ex) + radius + 0.1;
    const minZ = Math.min(pos.z, ez) - radius - 0.1, maxZ = Math.max(pos.z, ez) + radius + 0.1;
    const cand = this.query(minX, minZ, maxX, maxZ, this._tmpE || (this._tmpE = []));
    let best = null;
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (b.maxY <= pos.y + 0.12) continue;             // low enough to walk over
      if (b.minY > pos.y + height) continue;            // passes overhead
      const cx = clamp(pos.x, b.minX, b.maxX);
      const cz = clamp(pos.z, b.minZ, b.maxZ);
      const toX = cx - pos.x, toZ = cz - pos.z;
      const along = toX * dx + toZ * dz;
      if (along > reach + radius) continue;
      const lateral = Math.abs(-toX * dz + toZ * dx);
      if (lateral > radius + 0.3) continue;
      const dist = Math.max(0, along - radius);
      if (!best || dist < best.dist) {
        best = { box: b, dist, top: b.maxY, depth: this.depthAlong(b, pos, dx, dz) - Math.max(0, along) };
      }
    }
    return best;
  }

  /** Distance from `from` to the far side of the box along direction (dx,dz). */
  depthAlong(b, from, dx, dz) {
    let far = -Infinity;
    const xs = [b.minX, b.maxX], zs = [b.minZ, b.maxZ];
    for (const x of xs) for (const z of zs) {
      const a = (x - from.x) * dx + (z - from.z) * dz;
      if (a > far) far = a;
    }
    return far;
  }

  // -------------------------------------------------------------------------
  // Rays & sweeps (camera collision, hitscan weapons)
  // -------------------------------------------------------------------------

  /** Ray vs box slab test; returns distance or -1. */
  _rayBox(ox, oy, oz, dx, dy, dz, b, maxDist, inflate = 0) {
    const minX = b.minX - inflate, maxX = b.maxX + inflate;
    const minY = b.minY - inflate, maxY = b.maxY + inflate;
    const minZ = b.minZ - inflate, maxZ = b.maxZ + inflate;
    let tmin = 0, tmax = maxDist;
    // X
    if (Math.abs(dx) < EPS) { if (ox < minX || ox > maxX) return -1; }
    else {
      let t1 = (minX - ox) / dx, t2 = (maxX - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    // Y
    if (Math.abs(dy) < EPS) { if (oy < minY || oy > maxY) return -1; }
    else {
      let t1 = (minY - oy) / dy, t2 = (maxY - oy) / dy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    // Z
    if (Math.abs(dz) < EPS) { if (oz < minZ || oz > maxZ) return -1; }
    else {
      let t1 = (minZ - oz) / dz, t2 = (maxZ - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  /**
   * Sphere sweep from A to B (approximated by an inflated-box ray test).
   * Returns the fraction of the path that is clear, 0..1.
   */
  sweepSphere(from, to, radius) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < EPS) return 1;
    const nx = dx / len, ny = dy / len, nz = dz / len;
    const minX = Math.min(from.x, to.x) - radius, maxX = Math.max(from.x, to.x) + radius;
    const minZ = Math.min(from.z, to.z) - radius, maxZ = Math.max(from.z, to.z) + radius;
    const cand = this.query(minX, minZ, maxX, maxZ, this._tmpF || (this._tmpF = []));
    let best = len;
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (b.type === 'noCamera') continue;
      const t = this._rayBox(from.x, from.y, from.z, nx, ny, nz, b, len, radius);
      if (t >= 0 && t < best) best = t;
    }
    return clamp(best / len, 0, 1);
  }

  /** World hitscan. Returns { dist, x, y, z, box } or null. */
  raycast(origin, dir, maxDist) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const nx = dir.x / len, ny = dir.y / len, nz = dir.z / len;
    const ex = origin.x + nx * maxDist, ez = origin.z + nz * maxDist;
    const cand = this.query(
      Math.min(origin.x, ex) - 1, Math.min(origin.z, ez) - 1,
      Math.max(origin.x, ex) + 1, Math.max(origin.z, ez) + 1,
      this._tmpG || (this._tmpG = []));
    let bestT = maxDist, bestBox = null;
    for (let i = 0; i < cand.length; i++) {
      const t = this._rayBox(origin.x, origin.y, origin.z, nx, ny, nz, cand[i], maxDist, 0);
      if (t >= 0 && t < bestT) { bestT = t; bestBox = cand[i]; }
    }
    // ground plane
    if (ny < -EPS) {
      const tg = -origin.y / ny;
      if (tg >= 0 && tg < bestT) { bestT = tg; bestBox = null; }
    }
    if (bestT >= maxDist) return null;
    return { dist: bestT, x: origin.x + nx * bestT, y: origin.y + ny * bestT, z: origin.z + nz * bestT, box: bestBox };
  }

  // -------------------------------------------------------------------------
  // Ladders
  // -------------------------------------------------------------------------

  /** Closest ladder the player is standing in front of, or null. */
  nearestLadder(pos, maxDist = 1.5) {
    let best = null, bestD = maxDist;
    for (const l of this.ladders) {
      if (pos.y < l.bottom - 1.2 || pos.y > l.top + 0.5) continue;
      const d = Math.hypot(l.x - pos.x, l.z - pos.z);
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }
}
