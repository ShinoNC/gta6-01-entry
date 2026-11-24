// On-foot walkers: people ejected from a car the player steals. A
// carjacked driver or rider flees on foot (sometimes shouting), and an
// officer pulled from a stolen police car chases the player instead.
// Walkers despawn after a few seconds; chasers run for twelve.
import * as THREE from 'three';
import { G } from './context.js';

function makeSpeechBubble(text) {
  const bubbleCanvas = document.createElement('canvas');
  bubbleCanvas.width = 512;
  bubbleCanvas.height = 128;
  const ctx = bubbleCanvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(6, 6, 500, 100, 24);
    ctx.fill();
  } else {
    ctx.fillRect(6, 6, 500, 100);
  }
  ctx.fillStyle = '#1a1030';
  ctx.font = 'bold 44px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 58);
  const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(bubbleCanvas), transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.4, 0.85, 1);
  sprite.position.y = 2.6;
  return sprite;
}

function addWalker(group, mode, text, walker) {
  const from = G.player ? G.player.position : { x: 0, z: 0 };
  const dx = group.position.x - from.x;
  const dz = group.position.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  if (text) group.add(makeSpeechBubble(text));
  G.walkers.push({ group, walker: walker || null, mode, timer: mode === 'chase' ? 12 : 6, walkPhase: 0, dx: dx / len, dz: dz / len });
}

function updateWalkers(dt) {
  for (let i = G.walkers.length - 1; i >= 0; i -= 1) {
    const w = G.walkers[i];
    w.timer -= dt;
    if (w.timer <= 0) {
      G.scene.remove(w.group);
      G.walkers.splice(i, 1);
      continue;
    }
    const pos = w.group.position;
    let mx = w.dx, mz = w.dz, speed = 6.5;
    if (w.mode === 'chase') {
      const dx = G.player.position.x - pos.x;
      const dz = G.player.position.z - pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      if (dist < 1) continue;
      mx = dx / dist;
      mz = dz / dist;
      speed = 5;
    }
    pos.x += mx * speed * dt;
    pos.z += mz * speed * dt;
    G.city.resolveCircle(pos, 0.5);
    w.group.rotation.y = Math.atan2(mx, mz);
    w.walkPhase += dt * 9;
    const swing = Math.sin(w.walkPhase) * 0.5;
    if (w.walker) {
      w.walker.legLeft.rotation.x = swing;
      w.walker.legRight.rotation.x = -swing;
      w.walker.armLeft.rotation.x = -swing;
      w.walker.armRight.rotation.x = swing;
    } else {
      w.group.position.y = Math.abs(Math.sin(w.walkPhase)) * 0.06;
    }
  }
}

export { addWalker, updateWalkers };
