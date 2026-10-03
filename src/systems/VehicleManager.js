import * as THREE from 'three';
import { Vehicle } from '../entities/Vehicle.js';
import { VEHICLES, VEHICLE_SPAWNS, FUEL_STATIONS } from '../data/vehicles.js';
import { LOCATIONS } from '../data/world.js';

// ---------------------------------------------------------------------------
// The town's fleet.
//
// Owns every vehicle: parks them at sensible spots, keeps the simulation cost
// bounded by only fully simulating what is near the player, pairs up vehicles
// that might collide with each other, and runs the fuel stations.
// ---------------------------------------------------------------------------

const SIM_RADIUS = 140;      // beyond this a parked vehicle is left frozen
const PAIR_RADIUS = 14;      // vehicles closer than this are collision-tested

export class VehicleManager {
  constructor(scene, world, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.vehicles = [];
    this.stations = [];
    this.onEvent = opts.onEvent || null;       // (name, data, vehicle) => void
    this.onImpact = opts.onImpact || null;     // (force, vehicle) => void
    this._scratch = [];
  }

  /** Build the whole fleet plus the fuel stations. */
  spawnAll(plan = VEHICLE_SPAWNS) {
    for (const entry of plan) {
      const loc = LOCATIONS[entry.at];
      if (!loc) continue;
      this.spawn(entry.type, loc.x + (entry.dx || 0), loc.z + (entry.dz || 0), entry.rot || 0, entry);
    }
    for (const s of FUEL_STATIONS) {
      const loc = LOCATIONS[s.at];
      if (!loc) continue;
      this.stations.push({
        ...s,
        pos: new THREE.Vector3(loc.x + (s.dx || 0), 0, loc.z + (s.dz || 0)),
      });
    }
    return this.vehicles;
  }

  spawn(type, x, z, rot = 0, opts = {}) {
    const def = VEHICLES[type];
    if (!def) return null;
    const spot = this._findClearSpot(def, x, z, rot);
    const v = new Vehicle(this.scene, spot.x, spot.z, type, { ...opts, rot });
    v.onImpact = (force, veh) => { if (this.onImpact) this.onImpact(force, veh); };
    v.onEvent = (name, data, veh) => { if (this.onEvent) this.onEvent(name, data, veh); };
    this.vehicles.push(v);
    return v;
  }

  /**
   * Nudge a spawn out of whatever it was parked inside. Buildings get built
   * from data, so a hand-written offset can easily end up in a wall.
   */
  _findClearSpot(def, x, z, rot) {
    if (!this.world) return { x, z };
    const probe = {
      pos: new THREE.Vector3(x, 0, z), rot,
      halfLength: def.length / 2, halfWidth: def.width / 2,
      forward: () => ({ x: Math.sin(rot), z: Math.cos(rot) }),
      right: () => ({ x: -Math.cos(rot), z: Math.sin(rot) }),
      def,
    };
    const blocked = (px, pz) => {
      probe.pos.x = px; probe.pos.z = pz;
      const reach = Math.max(probe.halfLength, probe.halfWidth) + 0.4;
      const boxes = this.world.query(px - reach, pz - reach, px + reach, pz + reach, this._scratch);
      for (const b of boxes) {
        if (b.maxY < def.wheelRadius * 0.85) continue;
        if (b.minY > def.wheelRadius + def.height) continue;
        if (overlapsAabb(probe, b)) return true;
      }
      return false;
    };
    if (!blocked(x, z)) return { x, z };
    // spiral outward for somewhere it fits
    for (let ring = 1; ring <= 8; ring++) {
      const r = ring * 2.2;
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
        if (!blocked(px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  // ---------------------------------------------------------------- queries

  /** Closest vehicle to a point, optionally within `maxDist`. */
  nearest(pos, maxDist = Infinity, filter = null) {
    let best = null, bestD = maxDist * maxDist;
    for (const v of this.vehicles) {
      if (filter && !filter(v)) continue;
      const dx = v.pos.x - pos.x, dz = v.pos.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  /** Every vehicle within `radius` of a point. */
  within(pos, radius) {
    const out = [];
    const r2 = radius * radius;
    for (const v of this.vehicles) {
      const dx = v.pos.x - pos.x, dz = v.pos.z - pos.z;
      if (dx * dx + dz * dz <= r2) out.push(v);
    }
    return out;
  }

  /** Nearest fuel station that sells what this vehicle drinks. */
  nearestStation(pos, vehicle = null, maxDist = Infinity) {
    let best = null, bestD = maxDist * maxDist;
    for (const s of this.stations) {
      if (vehicle && !s.kinds.includes(vehicle.def.fuelType)) continue;
      const dx = s.pos.x - pos.x, dz = s.pos.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /**
   * Fill a vehicle up at a station, limited by the money available.
   * @returns {{litres:number, cost:number, full:boolean}}
   */
  refuel(vehicle, station, money) {
    const needed = vehicle.fuelCapacity - vehicle.fuel;
    if (needed <= 0.05) return { litres: 0, cost: 0, full: true };
    const affordable = Math.min(needed, money / station.price);
    const litres = Math.max(0, affordable);
    if (litres <= 0.01) return { litres: 0, cost: 0, full: false };
    vehicle.refuel(litres);
    return { litres, cost: litres * station.price, full: vehicle.fuel >= vehicle.fuelCapacity - 0.05 };
  }

  // ----------------------------------------------------------------- update

  update(dt, playerPos, input, opts = {}) {
    const near = [];
    for (const v of this.vehicles) {
      const dx = v.pos.x - playerPos.x, dz = v.pos.z - playerPos.z;
      v._distToPlayer = Math.hypot(dx, dz);
      if (v.occupied || v._distToPlayer < SIM_RADIUS) near.push(v);
      else if (v.group.visible) v.group.visible = false;
    }
    for (const v of near) {
      if (!v.group.visible) v.group.visible = true;
      const others = this._collisionPartners(v, near);
      v.update(dt, v.occupied ? input : null, this.world, {
        blocked: v.occupied ? opts.blocked : false,
        others,
      });
    }
  }

  _collisionPartners(v, near) {
    // Only moving vehicles need pairing; two parked cars cannot drift together.
    if (Math.abs(v.speed) < 0.05 && Math.abs(v.lateralSpeed) < 0.05) return null;
    const out = [];
    for (const o of near) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const reach = PAIR_RADIUS + v.halfLength + o.halfLength;
      if (dx * dx + dz * dz < reach * reach) out.push(o);
    }
    return out.length ? out : null;
  }

  /** Headlights on at night, off during the day — for every parked car too. */
  setNightLights(on) {
    for (const v of this.vehicles) {
      if (!v.occupied) v.setLights(on && !v.destroyed);
    }
  }

  // ------------------------------------------------------------- save/load

  snapshot() { return this.vehicles.map((v) => v.snapshot()); }

  restore(list) {
    if (!Array.isArray(list)) return;
    const byId = new Map(this.vehicles.map((v) => [v.id, v]));
    for (const s of list) {
      const v = byId.get(s.id);
      if (v) v.restore(s);
    }
  }

  dispose() {
    for (const v of this.vehicles) v.remove();
    this.vehicles.length = 0;
  }
}

/** Footprint overlap test used while placing spawns. */
function overlapsAabb(probe, b) {
  const f = probe.forward(), r = probe.right();
  const hl = probe.halfLength, hw = probe.halfWidth;
  const cx = probe.pos.x, cz = probe.pos.z;
  const bcx = (b.minX + b.maxX) / 2, bcz = (b.minZ + b.maxZ) / 2;
  const bhx = (b.maxX - b.minX) / 2, bhz = (b.maxZ - b.minZ) / 2;
  const axes = [f, r, { x: 1, z: 0 }, { x: 0, z: 1 }];
  for (const ax of axes) {
    const centre = cx * ax.x + cz * ax.z;
    const radius = Math.abs(f.x * ax.x + f.z * ax.z) * hl + Math.abs(r.x * ax.x + r.z * ax.z) * hw;
    const bCentre = bcx * ax.x + bcz * ax.z;
    const bRadius = Math.abs(ax.x) * bhx + Math.abs(ax.z) * bhz;
    if (centre + radius <= bCentre - bRadius || bCentre + bRadius <= centre - radius) return false;
  }
  return true;
}
