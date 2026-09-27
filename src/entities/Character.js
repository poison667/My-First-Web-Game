import * as THREE from 'three';

// Builds a simple original blocky humanoid from primitives (no external assets).
// Returns a group with references for walk/attack animation.
export function buildCharacter(opts = {}) {
  const skin = opts.skin ?? 0xe0b48a;
  const shirt = opts.color ?? 0x3f8fd0;
  const pants = opts.pants ?? 0x2a2f3a;
  const g = new THREE.Group();

  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });

  // torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), mat(shirt));
  torso.position.y = 1.15; torso.castShadow = true; g.add(torso);
  // head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(skin));
  head.position.y = 1.85; head.castShadow = true; g.add(head);
  // hair
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.18, 0.54), mat(opts.hair ?? 0x2a1f18));
  hair.position.y = 2.06; g.add(hair);

  // arms (pivoted at shoulder)
  const armGeo = new THREE.BoxGeometry(0.22, 0.8, 0.22);
  const leftArm = new THREE.Group(); const la = new THREE.Mesh(armGeo, mat(shirt));
  la.position.y = -0.4; la.castShadow = true; leftArm.add(la); leftArm.position.set(-0.46, 1.55, 0); g.add(leftArm);
  const rightArm = new THREE.Group(); const ra = new THREE.Mesh(armGeo, mat(shirt));
  ra.position.y = -0.4; ra.castShadow = true; rightArm.add(ra); rightArm.position.set(0.46, 1.55, 0); g.add(rightArm);

  // legs
  const legGeo = new THREE.BoxGeometry(0.26, 0.85, 0.26);
  const leftLeg = new THREE.Group(); const ll = new THREE.Mesh(legGeo, mat(pants));
  ll.position.y = -0.42; ll.castShadow = true; leftLeg.add(ll); leftLeg.position.set(-0.18, 0.85, 0); g.add(leftLeg);
  const rightLeg = new THREE.Group(); const rl = new THREE.Mesh(legGeo, mat(pants));
  rl.position.y = -0.42; rl.castShadow = true; rightLeg.add(rl); rightLeg.position.set(0.18, 0.85, 0); g.add(rightLeg);

  g.userData.parts = { torso, head, leftArm, rightArm, leftLeg, rightLeg };
  g.userData.walkPhase = 0;
  return g;
}

// Animate limbs for walking / idle. speed01: 0..1 of movement.
export function animateWalk(group, dt, speed01, attackT = 0) {
  const p = group.userData.parts;
  if (!p) return;
  group.userData.walkPhase += dt * (4 + speed01 * 8);
  const s = Math.sin(group.userData.walkPhase) * speed01 * 0.8;
  p.leftLeg.rotation.x = s; p.rightLeg.rotation.x = -s;
  p.leftArm.rotation.x = -s; p.rightArm.rotation.x = s;
  // attack overrides right arm
  if (attackT > 0) {
    p.rightArm.rotation.x = -Math.sin(attackT * Math.PI) * 2.2;
    p.rightArm.rotation.z = -Math.sin(attackT * Math.PI) * 0.6;
  } else {
    p.rightArm.rotation.z = 0;
  }
}
