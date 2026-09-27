import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Third-person orbit camera with mouse-look (pointer lock) and zoom.
export class CameraController {
  constructor(camera, settings) {
    this.camera = camera;
    this.settings = settings;
    this.yaw = 0;
    this.pitch = -0.2;
    this.distance = CONFIG.camera.distance;
    this.target = new THREE.Vector3();
  }

  handleMouse(m) {
    const sens = CONFIG.camera.sensitivity * (this.settings.sensitivity || 1);
    this.yaw -= m.dx * sens;
    this.pitch -= m.dy * sens * (this.settings.invertY ? -1 : 1);
    this.pitch = Math.max(CONFIG.camera.minPitch, Math.min(CONFIG.camera.maxPitch, this.pitch));
    if (m.wheel) {
      this.distance = Math.max(CONFIG.camera.minDistance, Math.min(CONFIG.camera.maxDistance, this.distance + m.wheel * 0.8));
    }
  }

  // returns the yaw so movement can be made camera-relative
  update(targetPos, colliders) {
    this.target.set(targetPos.x, targetPos.y + CONFIG.camera.height, targetPos.z);
    const cosP = Math.cos(this.pitch);
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * cosP,
      Math.sin(-this.pitch),
      Math.cos(this.yaw) * cosP
    ).multiplyScalar(this.distance);

    let desired = this.target.clone().add(offset);
    // basic camera collision: pull in if inside a building box
    if (colliders) {
      for (const c of colliders) {
        if (desired.x > c.minX && desired.x < c.maxX && desired.z > c.minZ && desired.z < c.maxZ && c.tall) {
          desired.copy(this.target).add(offset.clone().multiplyScalar(0.5));
          break;
        }
      }
    }
    this.camera.position.lerp(desired, 0.4);
    this.camera.lookAt(this.target);
    return this.yaw;
  }

  // move vector relative to camera yaw
  moveRelative(mv) {
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    return { x: mv.x * cos - mv.z * sin, z: mv.x * sin + mv.z * cos };
  }
}
