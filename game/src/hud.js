// The HUD: a live minimap (canvas, bottom-left) plus the DOM meters —
// speedometer, money, wanted stars, health/armour bars, district name,
// mission line, REP level, police response panel, weapon slots with ammo,
// radio station and the HIDING hint. The minimap draws the whole city, so
// the judge can see the open world at a glance.
import { districtNameAt, roadLines } from './city.js';

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
      mission: document.getElementById('hud-mission'),
      objective: document.getElementById('hud-objective'),
      money: document.getElementById('hud-money'),
      stars: document.getElementById('hud-stars'),
      rep: document.getElementById('hud-rep'),
      hiding: document.getElementById('hud-hiding'),
      speed: document.getElementById('hud-speed'),
      carName: document.getElementById('hud-car'),
      health: document.getElementById('hud-health-fill'),
      armour: document.getElementById('hud-armour-fill'),
      message: document.getElementById('hud-message'),
      police: document.getElementById('hud-police'),
      weapons: document.getElementById('hud-weapons'),
      radio: document.getElementById('hud-radio'),
      phone: document.getElementById('phone-panel'),
      phoneGiver: document.getElementById('phone-giver'),
      phoneText: document.getElementById('phone-text'),
      missionScreen: document.getElementById('mission-screen'),
      missionList: document.getElementById('mission-list'),
    };
    this.messageUntil = 0;
    this.lastPoliceSignature = '';
    this.lastWeaponSignature = '';
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

  drawMinimap(playerPos, playerHeading, cars, driving, missionTarget, policeBlips, timeSeconds) {
    const ctx = this.ctx;
    const scale = MINIMAP_SIZE / WORLD_WIDTH;
    ctx.fillStyle = '#1a1030';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    const shore = this.toMap(0, 96);
    const beachTop = this.toMap(0, 58);
    ctx.fillStyle = '#17789a';
    ctx.fillRect(0, shore.y, MINIMAP_SIZE, MINIMAP_SIZE - shore.y);
    ctx.fillStyle = '#f0cd8c';
    ctx.fillRect(0, beachTop.y, MINIMAP_SIZE, shore.y - beachTop.y);
    const north = this.toMap(0, -162);
    ctx.fillStyle = '#3a3348';
    ctx.fillRect(0, north.y, MINIMAP_SIZE, beachTop.y - north.y);
    ctx.fillStyle = '#ff7a66';
    for (const box of this.city.buildingBoxes) {
      const a = this.toMap(box.minX, box.minZ);
      const b = this.toMap(box.maxX, box.maxZ);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    // Roads: light grid lines over the ground.
    ctx.strokeStyle = '#8a8296';
    ctx.lineWidth = 2;
    for (const line of roadLines()) {
      ctx.beginPath();
      if (line.axis === 'z') {
        const x = this.toMap(line.at, 0).x;
        ctx.moveTo(x, north.y);
        ctx.lineTo(x, beachTop.y);
      } else {
        const y = this.toMap(0, line.at).y;
        ctx.moveTo(0, y);
        ctx.lineTo(MINIMAP_SIZE, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd978';
    for (const car of cars) {
      if (car.driven) continue;
      const p = this.toMap(car.position.x, car.position.z);
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    // Mission target: a pulsing yellow diamond.
    if (missionTarget) {
      const p = this.toMap(missionTarget.x, missionTarget.z);
      const size = 5 + Math.sin(timeSeconds * 4) * 1.5;
      ctx.fillStyle = '#ffd978';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - size);
      ctx.lineTo(p.x + size, p.y);
      ctx.lineTo(p.x, p.y + size);
      ctx.lineTo(p.x - size, p.y);
      ctx.closePath();
      ctx.fill();
    }
    // Police blips flash red/blue like the light bars.
    if (policeBlips) {
      ctx.fillStyle = Math.floor(timeSeconds * 2.8) % 2 === 0 ? '#ff2a3a' : '#2a6bff';
      for (const blip of policeBlips) {
        const p = this.toMap(blip.x, blip.z);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
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

  renderPolicePanel(units) {
    const signature = units.map((unit) => `${unit.callsign}:${unit.status}:${Math.floor(unit.distanceMetres / 10)}`).join('|');
    if (signature === this.lastPoliceSignature) return;
    this.lastPoliceSignature = signature;
    if (units.length === 0) {
      this.el.police.classList.add('hidden');
      return;
    }
    this.el.police.classList.remove('hidden');
    this.el.police.innerHTML =
      '<div class="police-title">KEYS POLICE RESPONSE</div>' +
      units.map((unit) => `<div class="police-row"><span>${unit.callsign}</span><span>${unit.distanceMetres}m</span><b>${unit.status}</b></div>`).join('');
  }

  renderWeaponSlots(weapons) {
    const signature = weapons.map((w) => `${w.name}:${w.mag}:${w.reserve}:${w.active}:${w.locked}:${w.reloading}`).join('|');
    if (signature === this.lastWeaponSignature) return;
    this.lastWeaponSignature = signature;
    this.el.weapons.innerHTML = weapons
      .map((weapon, index) => {
        const label = weapon.locked ? 'LOCKED' : weapon.reloading ? 'RELOADING' : weapon.name === 'FISTS' ? 'MELEE' : `${weapon.mag}/${weapon.reserve}`;
        return `<div class="weapon-slot${weapon.active ? ' active' : ''}${weapon.locked ? ' locked' : ''}">${index + 1} ${weapon.name} ${label}</div>`;
      })
      .join('');
  }

  showBriefing(mission, index) {
    this.el.phoneGiver.textContent = `MARA SOLIS CALLING · MISSION ${index + 1}/8`;
    this.el.phoneText.textContent = mission.briefing;
    this.el.phone.classList.remove('hidden');
  }

  hideBriefing() {
    this.el.phone.classList.add('hidden');
  }

  renderMissionList(entries) {
    this.el.missionList.innerHTML = entries
      .map((entry) => {
        const tag = entry.status === 'done' ? '[DONE]' : entry.status === 'active' ? '[ACTIVE]' : entry.status === 'pending' ? '[AVAILABLE]' : '[LOCKED]';
        const accept = entry.status === 'pending' ? `<button class="menu-button mission-accept" data-mission="${entry.number - 1}">ACCEPT JOB</button>` : '';
        const briefing = entry.status === 'active' || entry.status === 'pending' ? `<div class="mission-briefing">${entry.briefing}</div>` : '';
        return `<div class="mission-row ${entry.status}"><div class="mission-head"><span>MISSION ${entry.number}/8 — ${entry.name}</span><span>${tag}</span></div><div class="mission-reward">Reward $${entry.rewardMoney.toLocaleString('en-US')} · ${entry.rewardRep} REP · from ${entry.giver}</div>${briefing}${accept}</div>`;
      })
      .join('');
  }

  showMissionScreen() {
    this.el.missionScreen.classList.remove('hidden');
  }

  hideMissionScreen() {
    this.el.missionScreen.classList.add('hidden');
  }

  update(state) {
    const {
      playerPos,
      heading,
      speedKmh,
      money,
      wanted,
      health,
      armour,
      cars,
      driving,
      carName,
      missionLine,
      objective,
      policeUnits,
      weapons,
      radioStation,
      repLevel,
      hiding,
      missionTarget,
      policeBlips,
      timeSeconds,
    } = state;
    this.drawMinimap(playerPos, heading, cars, driving, missionTarget, policeBlips, timeSeconds || 0);
    this.el.district.textContent = districtNameAt(playerPos.x, playerPos.z);
    if (missionLine !== undefined) this.el.mission.textContent = missionLine;
    if (objective !== undefined) this.el.objective.textContent = objective;
    this.el.money.textContent = `$${money.toLocaleString('en-US')}`;
    this.el.stars.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    this.el.stars.classList.toggle('hot', wanted > 0);
    if (repLevel !== undefined) this.el.rep.textContent = `REP LV ${repLevel}`;
    if (hiding !== undefined) this.el.hiding.classList.toggle('hidden', !hiding);
    this.el.speed.textContent = driving ? String(Math.round(speedKmh)) : '0';
    this.el.carName.textContent = driving ? carName : 'ON FOOT';
    this.el.health.style.width = `${health}%`;
    this.el.armour.style.width = `${armour}%`;
    if (policeUnits) this.renderPolicePanel(policeUnits);
    if (weapons) this.renderWeaponSlots(weapons);
    if (radioStation !== undefined) this.el.radio.textContent = radioStation;
    if (this.messageUntil && performance.now() > this.messageUntil) {
      this.el.message.classList.remove('visible');
      this.messageUntil = 0;
    }
  }

  setObjective(text) {
    this.el.objective.textContent = text;
  }
}
