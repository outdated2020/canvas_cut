// Generate white-model-video params: one person dancing on a small stage.
// Usage: node gen-dance-white-model.mjs <out.json>
import { writeFileSync } from 'node:fs';
import * as THREE from 'file:///C:/Users/liqijun/Desktop/canvas_cut/apps/desktop/node_modules/three/build/three.module.js';

const OUT = process.argv[2] ?? 'dance-params.json';

const DEG = 180 / Math.PI;
const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const unit = (a) => v(a).normalize();

/** Rotation (Euler XYZ degrees, same order white-model-scene.ts uses) that points local +Y along dir. */
function rotFromDir(dir, yawDeg = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit(dir));
  if (yawDeg) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawDeg / DEG));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const r = [e.x * DEG, e.y * DEG, e.z * DEG].map((n) => Math.round(n * 1000) / 1000);
  return r;
}

const STAGE_TOP = 0.12;

/* ------------------------------------------------------------------ poses */
// Each pose returns a map of part -> { pos, dir } or { pos } for spheres.
function buildPose(p) {
  const parts = {};
  const put = (name, pos, dir, op = {}) => { parts[name] = { pos, dir, ...op }; };

  // pelvis + spine chain
  const torsoJoint = p.torsoJoint;
  const torsoDir = unit(p.torsoDir);
  const shoulderLine = v(torsoJoint).clone().addScaledVector(torsoDir, p.torsoLen);

  put('pelvis', p.pelvis, p.pelvisDir);
  put('torso', v(torsoJoint).clone().addScaledVector(torsoDir, p.torsoLen / 2), torsoDir);
  put('neck', shoulderLine.clone().addScaledVector(torsoDir, 0.045), torsoDir);
  put('head', shoulderLine.clone().addScaledVector(torsoDir, 0.235), torsoDir);

  // shoulders: rotate the ±X offset with the torso lean
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), torsoDir)
  ).setY(0).normalize();
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  const shR = shoulderLine.clone().addScaledVector(side, p.shoulderWidth);
  const shL = shoulderLine.clone().addScaledVector(side, -p.shoulderWidth);

  for (const [tag, sh, armSpec] of [['R', shR, p.armR], ['L', shL, p.armL]]) {
    const up = unit(armSpec.upper);
    const elbow = sh.clone().addScaledVector(up, p.upperArmLen);
    const fo = unit(armSpec.fore);
    const wrist = elbow.clone().addScaledVector(fo, p.foreArmLen);
    put(`upperArm${tag}`, sh.clone().addScaledVector(up, p.upperArmLen / 2), armSpec.upper);
    put(`foreArm${tag}`, elbow.clone().addScaledVector(fo, p.foreArmLen / 2), armSpec.fore);
    put(`hand${tag}`, wrist.clone().addScaledVector(fo, 0.05), armSpec.fore);
  }

  for (const [tag, hip, legSpec] of [['R', p.hipR, p.legR], ['L', p.hipL, p.legL]]) {
    const th = unit(legSpec.thigh);
    const knee = v(hip).clone().addScaledVector(th, p.thighLen);
    const sh = unit(legSpec.shin);
    const ankle = knee.clone().addScaledVector(sh, p.shinLen);
    put(`thigh${tag}`, v(hip).clone().addScaledVector(th, p.thighLen / 2), legSpec.thigh);
    put(`shin${tag}`, knee.clone().addScaledVector(sh, p.shinLen / 2), legSpec.shin);
    put(`foot${tag}`, ankle.clone().addScaledVector(unit(legSpec.foot), 0.11), legSpec.foot);
  }
  return parts;
}

const shared = {
  torsoLen: 0.46, shoulderWidth: 0.20,
  upperArmLen: 0.30, foreArmLen: 0.28,
  thighLen: 0.44, shinLen: 0.42,
};

// Pose A - 开场起势：站定，双臂张开上扬，上身微仰
const poseA = buildPose({
  ...shared,
  pelvis: [0, 1.10, 0], pelvisDir: [0, 1, 0],
  torsoJoint: [0, 1.19, 0], torsoDir: [0, 1, 0.03],
  hipR: [0.10, 1.055, 0], hipL: [-0.10, 1.055, 0],
  armR: { upper: [0.78, 0.62, 0.06], fore: [0.55, 0.83, 0.10] },
  armL: { upper: [-0.78, 0.62, 0.06], fore: [-0.55, 0.83, 0.10] },
  legR: { thigh: [0.10, -0.99, 0.02], shin: [0.02, -1, 0.03], foot: [0, -0.35, 0.94] },
  legL: { thigh: [-0.10, -0.99, 0.02], shin: [-0.02, -1, 0.03], foot: [0, -0.35, 0.94] },
});

// Pose B - 舞动定格：重心移向右侧，上身右倾并拧转，右臂上举过顶，左臂下摆，左脚离地前踢
const poseB = buildPose({
  ...shared,
  pelvis: [0.05, 1.09, 0.01], pelvisDir: [0.14, 0.99, 0.02],
  torsoJoint: [0.07, 1.18, 0.01], torsoDir: [0.19, 0.97, 0.08],
  hipR: [0.15, 1.05, -0.01], hipL: [-0.13, 1.03, 0.03],
  armR: { upper: [0.30, 0.95, 0.06], fore: [-0.18, 0.98, 0.10] },
  armL: { upper: [-0.72, -0.62, -0.28], fore: [-0.50, -0.82, -0.22] },
  legR: { thigh: [0.06, -0.998, 0.01], shin: [0.0, -1, 0.05], foot: [0, -0.25, 0.97] },
  legL: { thigh: [-0.28, -0.86, 0.42], shin: [-0.10, -0.90, -0.42], foot: [0, -0.75, 0.66] },
});

/* --------------------------------------------------------------- geometry */
// size per part: cylinder -> [diameter, length, diameter]; box -> [w, h, d]; sphere -> [dx, dy, dz]
const sizes = {
  pelvis: { shape: 'box', size: [0.34, 0.22, 0.22] },
  torso: { shape: 'box', size: [0.36, shared.torsoLen + 0.04, 0.24] },
  neck: { shape: 'cylinder', size: [0.12, 0.12, 0.12] },
  head: { shape: 'sphere', size: [0.25, 0.29, 0.25] },
  upperArmR: { shape: 'cylinder', size: [0.125, shared.upperArmLen, 0.125] },
  upperArmL: { shape: 'cylinder', size: [0.125, shared.upperArmLen, 0.125] },
  foreArmR: { shape: 'cylinder', size: [0.105, shared.foreArmLen, 0.105] },
  foreArmL: { shape: 'cylinder', size: [0.105, shared.foreArmLen, 0.105] },
  handR: { shape: 'sphere', size: [0.13, 0.14, 0.13] },
  handL: { shape: 'sphere', size: [0.13, 0.14, 0.13] },
  thighR: { shape: 'cylinder', size: [0.175, shared.thighLen, 0.175] },
  thighL: { shape: 'cylinder', size: [0.175, shared.thighLen, 0.175] },
  shinR: { shape: 'cylinder', size: [0.15, shared.shinLen, 0.15] },
  shinL: { shape: 'cylinder', size: [0.15, shared.shinLen, 0.15] },
  footR: { shape: 'box', size: [0.14, 0.09, 0.22] },
  footL: { shape: 'box', size: [0.14, 0.09, 0.22] },
};

const r3 = (n) => Math.round(n * 1000) / 1000;
const round = (arr) => arr.map(r3);

const objects = [];
for (const name of Object.keys(sizes)) {
  const a = poseA[name];
  const b = poseB[name];
  if (!a || !b) throw new Error(`missing pose part: ${name}`);
  objects.push({
    shape: sizes[name].shape,
    position: round(a.pos.toArray()),
    size: sizes[name].size,
    rotation: rotFromDir(a.dir),
    endPosition: round(b.pos.toArray()),
    endRotation: rotFromDir(b.dir),
  });
}

// static stage + two speakers behind the dancer
objects.push(
  { shape: 'cylinder', position: [0, STAGE_TOP / 2, 0], size: [3.4, STAGE_TOP, 3.4], rotation: [0, 0, 0] },
  { shape: 'box', position: [-1.75, 0.85, -1.15], size: [0.7, 1.5, 0.6], rotation: [0, 18, 0] },
  { shape: 'box', position: [1.85, 0.72, -1.30], size: [0.7, 1.25, 0.6], rotation: [0, -22, 0] },
);

const params = {
  width: 1280,
  height: 720,
  fps: 30,
  durationMs: 5000,
  objects,
  camera: { start: [2.9, 1.72, 4.3], end: [-1.5, 2.05, 4.6], target: [0.05, 1.15, 0], fov: 40 },
  background: '#dfe3e8',
  ground: true,
  lightIntensity: 3,
};

writeFileSync(OUT, JSON.stringify(params, null, 2), 'utf8');

// sanity report
const ankleA = poseA.footR.pos.toArray().map(r3);
const ankleB = poseB.footL.pos.toArray().map(r3);
console.log(`objects=${objects.length} (body=${objects.length - 3}, props=3)`);
console.log(`poseA footR center=${ankleA}  poseB footL center=${ankleB}`);
console.log(`poseA shoulderLine/pelvis y: pelvis=${poseA.pelvis.pos.y} head=${poseA.head.pos.y.toFixed(3)}`);
console.log(`poseB head=${poseB.head.pos.toArray().map(r3)}`);
console.log(`wrote ${OUT}`);
