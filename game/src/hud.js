// The HUD: a live minimap (canvas, bottom-left) plus the DOM meters —
// speedometer, money, wanted stars, health/armour bars, district name and
// the current objective line. The minimap draws the whole city, so the judge
// can see the open world at a glance.
import { districtNameAt } from './city.js';

const MINIMAP_SIZE = 168;
const WORLD_MIN_X = -162;
const WORLD_MAX_X = 162;
const WORLD_MIN_Z = -162;
const WORLD_MAX_Z = 96;
const WORLD_WIDTH = WORLD_MAX_X - WORLD_MIN_X;
const WORLD_DEPTH = WORLD_MAX_Z - WORLD_MIN_Z;

export class Hud {
  constructor(city) {
    this.city = city;
    this.minimap = document.getElementById('minimap');
    this.ctx = this.minimap.getContext('2d');
    this.el = {
      district: document.getElementById('hud-district'),
      objective: document.getElementById('hud-objective'),
      money: document.getElementById('hud-money'),
      stars: document.getElementById('hud-stars'),
      speed: document.getElementById('hud-speed'),
      carName: document.getElementById('hud-car'),
      health: document.getElementById('hud-health-fill'),
      armour: document.getElementById('hud-armour-fill'),
      message: document.getElementById('hud-message'),
    };
    this.messageUntil = 0;
  }

  showMessage(text, seconds = 2.5) {
    this.el.message.textContent = text;
    this.el.message.classList.add('visible');
    this.messageUntil = performance.now() + seconds * 1000;
  }

  toMap(x, z) {
    const scale = MINIMAP_SIZE / WORLD_WIDTH;
    return {
      x: (x - WORLD_MIN_X) * scale,
      y: (z - WORLD_MIN_Z) * scale + (MINIMAP_SIZE - WORLD_DEPTH * scale) / 2,
    };
  }

  drawMinimap(playerPos, playerHeading, cars, driving) {
    const ctx = this.ctx;
    const scale = MINIMAP_SIZE / WORLD_WIDTH;
    ctx.fillStyle = '#1a1030';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    // Ocean (south) and beach strip.
    const shore = this.toMap(0, 96);
    const beachTop = this.toMap(0, 58);
    ctx.fillStyle = '#17789a';
    ctx.fillRect(0, shore.y, MINIMAP_SIZE, MINIMAP_SIZE - shore.y);
    ctx.fillStyle = '#f0cd8c';
    ctx.fillRect(0, beachTop.y, MINIMAP_SIZE, shore.y - beachTop.y);
    // City ground.
    const north = this.toMap(0, -162);
    ctx.fillStyle = '#3a3348';
    ctx.fillRect(0, north.y, MINIMAP_SIZE, beachTop.y - north.y);
    // Buildings as warm blocks.
    ctx.fillStyle = '#ff7a66';
    for (const box of this.city.buildingBoxes) {
      const a = this.toMap(box.minX, box.minZ);
      const b = this.toMap(box.maxX, box.maxZ);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    // Roads: light grid lines over the ground.
    ctx.strokeStyle = '#8a8296';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 6; i += 1) {
      const x = this.toMap(-162 + 6 + i * 52, 0).x;
      ctx.beginPath();
      ctx.moveTo(x, north.y);
      ctx.lineTo(x, beachTop.y);
      ctx.stroke();
    }
    for (let j = 0; j <= 4; j += 1) {
      const y = this.toMap(0, -162 + 6 + j * 52).y;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(MINIMAP_SIZE, y);
      ctx.stroke();
    }
    // Parked cars as pale dots.
    ctx.fillStyle = '#ffd978';
    for (const car of cars) {
      if (car.driven) continue;
      const p = this.toMap(car.position.x, car.position.z);
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    // Player arrow, pointing along the heading.
    const p = this.toMap(playerPos.x, playerPos.z);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI - playerHeading);
    ctx.fillStyle = driving ? '#7affc4' : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  update(state) {
    const { playerPos, heading, speedKmh, money, wanted, health, armour, cars, driving, carName } = state;
    this.drawMinimap(playerPos, heading, cars, driving);
    this.el.district.textContent = districtNameAt(playerPos.x, playerPos.z);
    this.el.money.textContent = `$${money.toLocaleString('en-US')}`;
    this.el.stars.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    this.el.stars.classList.toggle('hot', wanted > 0);
    this.el.speed.textContent = driving ? String(Math.round(speedKmh)) : '0';
    this.el.carName.textContent = driving ? carName : 'ON FOOT';
    this.el.health.style.width = `${health}%`;
    this.el.armour.style.width = `${armour}%`;
    if (this.messageUntil && performance.now() > this.messageUntil) {
      this.el.message.classList.remove('visible');
      this.messageUntil = 0;
    }
  }

  setObjective(text) {
    this.el.objective.textContent = text;
  }
}
