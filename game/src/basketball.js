// Streetball on the south beach: a painted court with a hoop at each
// end and one loose ball. Walk up and grab it (E), then shoot (E) — the
// shot is auto-aimed at the nearer rim along a parabolic arc, with a
// little random spread that grows with distance. The ball only counts
// when it drops through the rim on the way down.
import * as THREE from 'three';

// Court placement and size, rim height, gravity, ball radius.
const COURT_X = -100;
const COURT_Z = 286;
const COURT_W = 28;
const COURT_D = 15;
const RIM_Y = 3.05;
const GRAVITY = 12;
const BALL_R = 0.32;

// Paint the court markings onto a canvas: asphalt, boundary, halfway
// line, centre circle, and the key at each end.
function paintCourtTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#3a3f4a';
  x.fillRect(0, 0, 256, 128);
  x.strokeStyle = '#f2f0e8';
  x.lineWidth = 3;
  x.strokeRect(4, 4, 248, 120);
  x.beginPath();
  x.moveTo(128, 4);
  x.lineTo(128, 124);
  x.stroke();
  x.beginPath();
  x.arc(128, 64, 16, 0, Math.PI * 2);
  x.stroke();
  const ends = [
    { edge: 4, box: 4, flip: false },
    { edge: 252, box: 216, flip: true },
  ];
  for (const end of ends) {
    x.beginPath();
    x.arc(end.edge, 64, 34, -Math.PI / 2.4, Math.PI / 2.4, end.flip);
    x.stroke();
    x.strokeRect(end.box, 44, 36, 40);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Basketball {
  constructor(scene, rng, onScore) {
    this.scene = scene;
    this.rng = rng;
    this.onScore = onScore;
    this.state = 'idle';
    this.score = 0;
    this.vel = new THREE.Vector3();
    this.prevY = 0;
    this.shotRim = null;
    this.rims = [];
    this.poles = [];
    this.layCourt(scene);
    this.raiseHoops(scene);
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xff7a3d }),
    );
    this.ball.castShadow = true;
    this.resetBall();
    scene.add(this.ball);
  }

  layCourt(scene) {
    const court = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT_W, COURT_D),
      new THREE.MeshLambertMaterial({ map: paintCourtTexture() }),
    );
    court.rotation.x = -Math.PI / 2;
    court.position.set(COURT_X, 0.05, COURT_Z);
    court.receiveShadow = true;
    scene.add(court);
  }

  raiseHoops(scene) {
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3a44 });
    const boardMat = new THREE.MeshLambertMaterial({ color: 0xf2f0e8 });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xff7a3d });
    const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.6 });
    const mats = { poleMat, boardMat, rimMat, netMat };
    this.buildHoop(scene, mats, -1);
    this.buildHoop(scene, mats, 1);
  }

  // One end of the court: pole, backboard, rim and net. The rim's x is
  // kept for the shooting maths, the pole's for collision boxes.
  buildHoop(scene, mats, side) {
    const poleX = COURT_X + side * (COURT_W / 2 - 0.6);
    const boardX = poleX - side * 0.5;
    const rimX = poleX - side * 0.95;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.6, 6), mats.poleMat);
    pole.position.set(poleX, 1.8, COURT_Z);
    scene.add(pole);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, 1.8), mats.boardMat);
    board.position.set(boardX, 3.4, COURT_Z);
    scene.add(board);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 6, 16), mats.rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(rimX, RIM_Y, COURT_Z);
    scene.add(rim);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.32, 0.5, 8, 1, true), mats.netMat);
    net.position.set(rimX, RIM_Y - 0.25, COURT_Z);
    scene.add(net);
    this.rims.push({ x: rimX, z: COURT_Z });
    this.poles.push({ x: poleX, z: COURT_Z });
  }

  colliders() {
    const boxes = [];
    for (let i = 0; i < this.poles.length; i++) {
      const p = this.poles[i];
      boxes.push({ minX: p.x - 0.5, maxX: p.x + 0.5, minZ: p.z - 0.5, maxZ: p.z + 0.5 });
    }
    return boxes;
  }

  resetBall() {
    this.ball.position.set(COURT_X, BALL_R, COURT_Z);
    this.vel.set(0, 0, 0);
    this.state = 'idle';
  }

  nearBall(pos) {
    if (this.state !== 'idle') return false;
    return Math.hypot(pos.x - this.ball.position.x, pos.z - this.ball.position.z) < 2;
  }

  pickup() {
    if (this.state === 'idle') this.state = 'held';
  }

  nearestRim(p) {
    let best = this.rims[0];
    let bestDist = Math.hypot(p.x - best.x, p.z - best.z);
    for (let i = 1; i < this.rims.length; i++) {
      const d = Math.hypot(p.x - this.rims[i].x, p.z - this.rims[i].z);
      if (d < bestDist) {
        bestDist = d;
        best = this.rims[i];
      }
    }
    return { rim: best, dist: bestDist };
  }

  shoot() {
    if (this.state !== 'held') return;
    const p = this.ball.position;
    const { rim, dist } = this.nearestRim(p);
    const flight = Math.max(0.7, Math.min(1.5, dist / 9));
    // Long shots spray more: the aim point jitters around the rim, wider
    // the further the shooter stands.
    const spread = 0.35 * (dist / 15);
    const aimX = rim.x + (this.rng() * 2 - 1) * spread;
    const aimZ = rim.z + (this.rng() * 2 - 1) * spread;
    const rise = RIM_Y - p.y + 0.5 * GRAVITY * flight * flight;
    this.vel.set((aimX - p.x) / flight, rise / flight, (aimZ - p.z) / flight);
    this.state = 'flying';
    this.prevY = p.y;
    this.shotRim = rim;
  }

  update(dt, playerPos) {
    if (this.state === 'held') {
      this.ball.position.set(playerPos.x, 1.7, playerPos.z);
      return;
    }
    if (this.state !== 'flying') return;
    this.stepFlight(dt);
    this.checkScore();
    this.checkBounce();
    const p = this.ball.position;
    if (p.y < -0.5 || Math.abs(p.x) > 400 || Math.abs(p.z) > 400) this.resetBall();
  }

  stepFlight(dt) {
    const p = this.ball.position;
    this.prevY = p.y;
    this.vel.y -= GRAVITY * dt;
    p.x += this.vel.x * dt;
    p.y += this.vel.y * dt;
    p.z += this.vel.z * dt;
  }

  // A basket counts when the ball crosses the rim plane on the way down
  // while inside the ring.
  checkScore() {
    const p = this.ball.position;
    if (this.prevY <= RIM_Y || p.y > RIM_Y || this.vel.y >= 0) return;
    if (Math.hypot(p.x - this.shotRim.x, p.z - this.shotRim.z) >= 0.42) return;
    this.score += 1;
    if (this.onScore) this.onScore(this.score);
  }

  checkBounce() {
    const p = this.ball.position;
    if (p.y >= BALL_R) return;
    p.y = BALL_R;
    this.vel.y = -this.vel.y * 0.55;
    this.vel.x *= 0.6;
    this.vel.z *= 0.6;
    if (Math.abs(this.vel.y) >= 0.8) return;
    this.vel.set(0, 0, 0);
    this.state = 'idle';
  }
}
