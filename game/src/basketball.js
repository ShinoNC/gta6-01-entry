import * as THREE from 'three';
// Playable basketball on the south beach: painted court, two hoops, a
// ball with gravity + bounce. Pick it up (E), shoot (E) — an auto-aimed
// parabolic arc at the nearest rim, scored when the ball drops through.
const COURT = { x: -100, z: 286, w: 28, d: 15 };
const RIM_Y = 3.05, GRAVITY = 12, BALL_R = 0.32;
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
    const courtTex = (() => {
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
      for (const s of [0, 1]) {
        const cx = s ? 252 : 4;
        x.beginPath();
        x.arc(cx, 64, 34, -Math.PI / 2.4, Math.PI / 2.4, s === 1);
        x.stroke();
        x.strokeRect(s ? 216 : 4, 44, 36, 40);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const court = new THREE.Mesh(new THREE.PlaneGeometry(COURT.w, COURT.d), new THREE.MeshLambertMaterial({ map: courtTex }));
    court.rotation.x = -Math.PI / 2;
    court.position.set(COURT.x, 0.05, COURT.z);
    court.receiveShadow = true;
    scene.add(court);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3a44 });
    const boardMat = new THREE.MeshLambertMaterial({ color: 0xf2f0e8 });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xff7a3d });
    const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.6 });
    for (const s of [-1, 1]) {
      const hx = COURT.x + s * (COURT.w / 2 - 0.6);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.6, 6), poleMat);
      pole.position.set(hx, 1.8, COURT.z);
      scene.add(pole);
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, 1.8), boardMat);
      board.position.set(hx - s * 0.5, 3.4, COURT.z);
      scene.add(board);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 6, 16), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(hx - s * 0.95, RIM_Y, COURT.z);
      scene.add(rim);
      const net = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.32, 0.5, 8, 1, true), netMat);
      net.position.set(hx - s * 0.95, RIM_Y - 0.25, COURT.z);
      scene.add(net);
      this.rims.push({ x: hx - s * 0.95, z: COURT.z });
      this.poles.push({ x: hx, z: COURT.z });
    }
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 12, 10), new THREE.MeshLambertMaterial({ color: 0xff7a3d }));
    this.ball.castShadow = true;
    this.resetBall();
    scene.add(this.ball);
  }
  colliders() {
    return this.poles.map((p) => ({ minX: p.x - 0.5, maxX: p.x + 0.5, minZ: p.z - 0.5, maxZ: p.z + 0.5 }));
  }
  resetBall() {
    this.ball.position.set(COURT.x, BALL_R, COURT.z);
    this.vel.set(0, 0, 0);
    this.state = 'idle';
  }
  nearBall(pos) {
    return this.state === 'idle' && Math.hypot(pos.x - this.ball.position.x, pos.z - this.ball.position.z) < 2;
  }
  pickup() {
    if (this.state === 'idle') this.state = 'held';
  }
  shoot() {
    if (this.state !== 'held') return;
    const p = this.ball.position;
    const rim = this.rims.reduce((a, b) => (Math.hypot(p.x - a.x, p.z - a.z) < Math.hypot(p.x - b.x, p.z - b.z) ? a : b));
    const dist = Math.hypot(rim.x - p.x, rim.z - p.z);
    const t = Math.max(0.7, Math.min(1.5, dist / 9));
    // Longer shots miss more: a random offset around the rim, wider with distance.
    const err = 0.35 * (dist / 15);
    const tx = rim.x + (this.rng() * 2 - 1) * err;
    const tz = rim.z + (this.rng() * 2 - 1) * err;
    this.vel.set((tx - p.x) / t, (RIM_Y - p.y + 0.5 * GRAVITY * t * t) / t, (tz - p.z) / t);
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
    const p = this.ball.position;
    this.prevY = p.y;
    this.vel.y -= GRAVITY * dt;
    p.x += this.vel.x * dt;
    p.y += this.vel.y * dt;
    p.z += this.vel.z * dt;
    // Score: crossing the rim plane downward inside the rim.
    if (this.prevY > RIM_Y && p.y <= RIM_Y && this.vel.y < 0) {
      if (Math.hypot(p.x - this.shotRim.x, p.z - this.shotRim.z) < 0.42) {
        this.score += 1;
        if (this.onScore) this.onScore(this.score);
      }
    }
    if (p.y < BALL_R) {
      p.y = BALL_R;
      this.vel.y = -this.vel.y * 0.55;
      this.vel.x *= 0.6;
      this.vel.z *= 0.6;
      if (Math.abs(this.vel.y) < 0.8) {
        this.vel.set(0, 0, 0);
        this.state = 'idle';
      }
    }
    if (p.y < -0.5 || Math.abs(p.x) > 400 || Math.abs(p.z) > 400) this.resetBall();
  }
}
