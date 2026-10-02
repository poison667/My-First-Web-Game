import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Drivable car with arcade handling: speed-sensitive steering, a handbrake,
// suspension lean, spinning/steering wheels and collision feedback.
// Also exposes the seat / door anchors the player controller uses to get in
// and out from the correct side.
// ---------------------------------------------------------------------------

export class Vehicle {
  constructor(scene, x, z, color = 0xcf3b3b) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);

    const paint = new THREE.MeshLambertMaterial({ color });
    const glass = new THREE.MeshLambertMaterial({ color: 0x24303f });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.72, 4.4), paint);
    chassis.position.y = 0.72; chassis.castShadow = true; chassis.receiveShadow = true;
    this.body.add(chassis);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.68, 2.1), glass);
    cabin.position.set(0, 1.4, -0.15); cabin.castShadow = true;
    this.body.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 1.9), paint);
    roof.position.set(0, 1.76, -0.15);
    this.body.add(roof);

    // lights
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
    this.headlights = [];
    for (const lx of [-0.72, 0.72]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), lightMat);
      l.position.set(lx, 0.78, 2.2);
      this.body.add(l);
      this.headlights.push(l);
    }
    const tailMat = new THREE.MeshBasicMaterial({ color: 0x8a2020 });
    this.taillights = [];
    for (const lx of [-0.72, 0.72]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.08), tailMat);
      l.position.set(lx, 0.78, -2.2);
      this.body.add(l);
      this.taillights.push(l);
    }

    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.34, 12);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x15151a });
    this.wheels = [];
    for (const [wx, wz, front] of [[-1.03, 1.42, true], [1.03, 1.42, true], [-1.03, -1.42, false], [1.03, -1.42, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 0.44, wz);
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.castShadow = true;
      pivot.add(w);
      this.body.add(pivot);
      this.wheels.push({ pivot, mesh: w, front });
    }

    scene.add(this.group);

    this.pos = new THREE.Vector3(x, 0, z);
    this.rot = 0;
    this.speed = 0;
    this.steer = 0;
    this.maxSpeed = 24;
    this.reverseSpeed = 9;
    this.occupied = false;
    this.health = 100;
    this.lightsOn = false;
    this.engineTick = 0;
    this.onImpact = null;
    this.halfWidth = 1.15;
    this.halfLength = 2.3;

    this.group.position.copy(this.pos);
  }

  /** Where the driver sits (world space). */
  seatPosition() {
    const f = { x: Math.sin(this.rot), z: Math.cos(this.rot) };
    const r = { x: -Math.cos(this.rot), z: Math.sin(this.rot) };
    return new THREE.Vector3(
      this.pos.x + f.x * -0.2 + r.x * -0.45,
      this.pos.y + 1.05,
      this.pos.z + f.z * -0.2 + r.z * -0.45,
    );
  }

  /** Candidate spots to stand when leaving, nearest side first. */
  exitSpots() {
    const r = { x: -Math.cos(this.rot), z: Math.sin(this.rot) };
    const f = { x: Math.sin(this.rot), z: Math.cos(this.rot) };
    return [
      new THREE.Vector3(this.pos.x - r.x * 1.9, this.pos.y, this.pos.z - r.z * 1.9),
      new THREE.Vector3(this.pos.x + r.x * 1.9, this.pos.y, this.pos.z + r.z * 1.9),
      new THREE.Vector3(this.pos.x - f.x * 3.2, this.pos.y, this.pos.z - f.z * 3.2),
      new THREE.Vector3(this.pos.x + f.x * 3.2, this.pos.y, this.pos.z + f.z * 3.2),
    ];
  }

  setLights(on) {
    if (this.lightsOn === on) return;
    this.lightsOn = on;
    for (const l of this.headlights) l.material = new THREE.MeshBasicMaterial({ color: on ? 0xfff0c0 : 0x8a8470 });
  }

  speedKmh() { return Math.abs(this.speed) * 3.6; }

  // -------------------------------------------------------------------------

  update(dt, input, world, opts = {}) {
    if (!this.occupied) { this._idleVisuals(dt); return; }
    const blocked = !!opts.blocked;

    // --- driver input (keyboard or analog stick) --------------------------
    let throttle = 0, steerInput = 0, handbrake = false;
    if (!blocked) {
      throttle = -(input.move?.z ?? 0);
      steerInput = -(input.move?.x ?? 0);
      handbrake = input.down('jump');
    }

    const accel = 26, brakeForce = 38, rollingDrag = 1.6, airDrag = 0.018;
    const forwardThrottle = Math.max(0, throttle);
    const reverseThrottle = Math.max(0, -throttle);

    if (forwardThrottle > 0.05) {
      if (this.speed < 0) this.speed += brakeForce * forwardThrottle * dt;      // braking from reverse
      else this.speed += accel * forwardThrottle * dt * (1 - Math.min(0.75, this.speed / this.maxSpeed));
    } else if (reverseThrottle > 0.05) {
      if (this.speed > 0.4) this.speed -= brakeForce * reverseThrottle * dt;    // braking
      else this.speed -= accel * 0.55 * reverseThrottle * dt;
    } else {
      const drag = rollingDrag * dt + airDrag * this.speed * Math.abs(this.speed) * dt;
      if (this.speed > 0) this.speed = Math.max(0, this.speed - drag);
      else this.speed = Math.min(0, this.speed + Math.abs(drag));
    }

    if (handbrake) {
      this.speed *= Math.max(0, 1 - 2.6 * dt);
      if (Math.abs(this.speed) < 0.4) this.speed = 0;
    }

    this.speed = Math.max(-this.reverseSpeed, Math.min(this.maxSpeed, this.speed));

    // --- steering: strong at low speed, tightened at high speed -----------
    const speedN = Math.min(1, Math.abs(this.speed) / this.maxSpeed);
    const steerLimit = 1.0 - 0.62 * speedN;
    const steerTarget = steerInput * steerLimit;
    this.steer += (steerTarget - this.steer) * Math.min(1, 9 * dt);
    const turnRate = 1.9 * (handbrake ? 1.45 : 1);
    if (Math.abs(this.speed) > 0.25) {
      this.rot += this.steer * turnRate * dt * Math.sign(this.speed) * (0.35 + speedN * 0.9);
    }

    // --- integrate & collide ----------------------------------------------
    const dx = Math.sin(this.rot) * this.speed * dt;
    const dz = Math.cos(this.rot) * this.speed * dt;
    const nx = this.pos.x + dx, nz = this.pos.z + dz;
    const hit = this._blocked(nx, nz, world);
    if (hit) {
      const impact = Math.abs(this.speed);
      this.speed *= -0.25;
      this.health = Math.max(0, this.health - impact * 0.8);
      if (impact > 4 && this.onImpact) this.onImpact(impact);
    } else {
      this.pos.x = nx; this.pos.z = nz;
    }

    // --- presentation ------------------------------------------------------
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.rot;
    const lean = -this.steer * speedN * 0.1;
    const pitch = -Math.max(-1, Math.min(1, (forwardThrottle - reverseThrottle - (handbrake ? 1 : 0)) * speedN)) * 0.03;
    this.body.rotation.z += (lean - this.body.rotation.z) * Math.min(1, 7 * dt);
    this.body.rotation.x += (pitch - this.body.rotation.x) * Math.min(1, 7 * dt);
    this._spinWheels(dt);

    for (const l of this.taillights) l.material.color.setHex(reverseThrottle > 0.05 || handbrake ? 0xff5a4a : 0x8a2020);
  }

  _spinWheels(dt) {
    const spin = (this.speed / 0.44) * dt;
    for (const w of this.wheels) {
      w.mesh.rotation.x += spin;
      if (w.front) w.pivot.rotation.y = this.steer * 0.45;
    }
  }

  _idleVisuals(dt) {
    if (Math.abs(this.speed) > 0.01) {
      this.speed *= Math.max(0, 1 - 3 * dt);
      this.pos.x += Math.sin(this.rot) * this.speed * dt;
      this.pos.z += Math.cos(this.rot) * this.speed * dt;
      this.group.position.copy(this.pos);
      this._spinWheels(dt);
    }
    this.body.rotation.z *= Math.max(0, 1 - 4 * dt);
    this.body.rotation.x *= Math.max(0, 1 - 4 * dt);
  }

  _blocked(nx, nz, world) {
    if (!world) return false;
    const r = Math.max(this.halfWidth, this.halfLength * 0.78);
    const boxes = world.query(nx - r, nz - r, nx + r, nz + r, []);
    for (const b of boxes) {
      if (b.maxY < 0.55) continue;              // kerbs and low props: drive over
      if (b.minY > 1.9) continue;               // overhead: pass under
      if (nx + this.halfWidth > b.minX && nx - this.halfWidth < b.maxX &&
          nz + this.halfLength > b.minZ && nz - this.halfLength < b.maxZ) return true;
    }
    return false;
  }

  remove() { this.scene.remove(this.group); }
}
