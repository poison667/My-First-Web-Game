import * as THREE from 'three';

// Simple drivable car built from primitives. Arcade steering.
export class Vehicle {
  constructor(scene, x, z, color = 0xcf3b3b) {
    this.group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 4.4), new THREE.MeshLambertMaterial({ color }));
    body.position.y = 0.7; body.castShadow = true; this.group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 2.2), new THREE.MeshLambertMaterial({ color: 0x223 }));
    cabin.position.set(0, 1.35, -0.2); this.group.add(cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 10);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111 });
    for (const [wx, wz] of [[-1.05, 1.4], [1.05, 1.4], [-1.05, -1.4], [1.05, -1.4]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2; w.position.set(wx, 0.45, wz); this.group.add(w);
    }
    scene.add(this.group);
    this.pos = new THREE.Vector3(x, 0, z);
    this.rot = 0;
    this.speed = 0;
    this.maxSpeed = 22;
    this.occupied = false;
    this.group.position.copy(this.pos);
  }

  update(dt, input, colliders) {
    if (!this.occupied) return;
    const accel = 26, brake = 40, friction = 10, turn = 1.8;
    const fwd = input.down('KeyW') || input.down('ArrowUp');
    const back = input.down('KeyS') || input.down('ArrowDown');
    if (fwd) this.speed += accel * dt;
    else if (back) this.speed -= brake * dt;
    else { // friction
      if (this.speed > 0) this.speed = Math.max(0, this.speed - friction * dt);
      else this.speed = Math.min(0, this.speed + friction * dt);
    }
    this.speed = Math.max(-8, Math.min(this.maxSpeed, this.speed));
    const steer = (input.down('KeyA') || input.down('ArrowLeft')) ? 1 : (input.down('KeyD') || input.down('ArrowRight')) ? -1 : 0;
    this.rot += steer * turn * dt * (this.speed / this.maxSpeed);

    const dx = Math.sin(this.rot) * this.speed * dt;
    const dz = Math.cos(this.rot) * this.speed * dt;
    const nx = this.pos.x + dx, nz = this.pos.z + dz;
    let blocked = false;
    for (const c of colliders) {
      if (nx + 1.5 > c.minX && nx - 1.5 < c.maxX && nz + 1.5 > c.minZ && nz - 1.5 < c.maxZ) { blocked = true; break; }
    }
    if (blocked) { this.speed *= -0.3; }
    else { this.pos.x = nx; this.pos.z = nz; }

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.rot;
  }
}
