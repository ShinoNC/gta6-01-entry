import { districtNameAt, roadLines } from './city.js';
import { MISSIONS_IN_STORY } from './missions.js';
const $ = (id) => document.getElementById(id);
const MINIMAP_SIZE = 168;
const WORLD_MIN_X = -162, WORLD_MAX_X = 162, WORLD_MIN_Z = -162, WORLD_MAX_Z = 96;
const WORLD_WIDTH = WORLD_MAX_X - WORLD_MIN_X, WORLD_DEPTH = WORLD_MAX_Z - WORLD_MIN_Z;
export class Hud {
  constructor(city) {
    this.city = city;
    this.minimap = $('minimap');
    this.ctx = this.minimap.getContext('2d');
    this.el = {
      district: $('hud-district'),
      mission: $('hud-mission'),
      objective: $('hud-objective'),
      next: $('hud-next'),
      clock: $('hud-clock'),
      weather: $('hud-weather'),
      money: $('hud-money'),
      stars: $('hud-stars'),
      rep: $('hud-rep'),
      tapes: $('hud-tapes'),
      hiding: $('hud-hiding'),
      speed: $('hud-speed'),
      carName: $('hud-car'),
      health: $('hud-health-fill'),
      armour: $('hud-armour-fill'),
      message: $('hud-message'),
      police: $('hud-police'),
      weapons: $('hud-weapons'),
      radio: $('hud-radio'),
      phone: $('phone-panel'),
      phoneGiver: $('phone-giver'),
      phoneText: $('phone-text'),
      missionScreen: $('mission-screen'),
      missionList: $('mission-list'),
    };
    this.messageUntil = 0;
    this.messageSticky = false;
    this.lastPoliceSig = '';
    this.lastWeaponSig = '';
  }
  showMessage(text, seconds = 2.5, sticky = false) {
    if (this.messageSticky && performance.now() < this.messageUntil && !sticky) return;
    this.el.message.textContent = text;
    this.el.message.classList.add('visible');
    this.messageUntil = performance.now() + seconds * 1000;
    this.messageSticky = sticky;
  }
  toMap(x, z) {
    const scale = MINIMAP_SIZE / WORLD_WIDTH;
    return {
      x: (x - WORLD_MIN_X) * scale,
      y: (z - WORLD_MIN_Z) * scale + (MINIMAP_SIZE - WORLD_DEPTH * scale) / 2,
    };
  }
  drawMinimap(playerPos, playerHeading, cars, driving, missionTarget, policeBlips, timeSeconds, trafficBlips, ammoCrates, sideJobTarget, eventBlip) {
    const ctx = this.ctx;
    const band = (a, b, c) => { ctx.fillStyle = c; ctx.fillRect(0, a, MINIMAP_SIZE, b - a); };
    const dot = (x, z, size, color) => { const p = this.toMap(x, z); ctx.fillStyle = color; ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size); };
    const diamond = (x, z, size, color) => {
      const p = this.toMap(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - size);
      ctx.lineTo(p.x + size, p.y);
      ctx.lineTo(p.x, p.y + size);
      ctx.lineTo(p.x - size, p.y);
      ctx.closePath();
      ctx.fill();
    };
    const circle = (x, z, r, color) => { const p = this.toMap(x, z); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); };
    ctx.fillStyle = '#1a1030';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    const shore = this.toMap(0, 96).y;
    const beachTop = this.toMap(0, 58).y;
    const north = this.toMap(0, -162).y;
    band(shore, MINIMAP_SIZE, '#17789a');
    band(beachTop, shore, '#f0cd8c');
    band(north, beachTop, '#3a3348');
    ctx.fillStyle = '#ff7a66';
    for (const box of this.city.buildingBoxes) {
      const a = this.toMap(box.minX, box.minZ);
      const b = this.toMap(box.maxX, box.maxZ);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    ctx.strokeStyle = '#8a8296';
    ctx.lineWidth = 2;
    for (const line of roadLines()) {
      ctx.beginPath();
      if (line.axis === 'z') { const x = this.toMap(line.at, 0).x; ctx.moveTo(x, north); ctx.lineTo(x, beachTop); }
      else { const y = this.toMap(0, line.at).y; ctx.moveTo(0, y); ctx.lineTo(MINIMAP_SIZE, y); }
      ctx.stroke();
    }
    for (const car of cars) if (!car.driven && !car.destroyed) dot(car.position.x, car.position.z, 3, '#ffd978');
    if (trafficBlips) for (const b of trafficBlips) dot(b.x, b.z, 2, '#c4bcd0');
    if (ammoCrates) for (const c of ammoCrates) if (c.available) dot(c.x, c.z, 4, '#7affc4');
    if (missionTarget) diamond(missionTarget.x, missionTarget.z, 5 + Math.sin(timeSeconds * 4) * 1.5, '#ffd978');
    if (policeBlips) for (const b of policeBlips) circle(b.x, b.z, 3, Math.floor(timeSeconds * 2.8) % 2 === 0 ? '#ff2a3a' : '#2a6bff');
    if (sideJobTarget) diamond(sideJobTarget.x, sideJobTarget.z, 4 + Math.sin(timeSeconds * 4), '#7affc4');
    if (eventBlip) circle(eventBlip.x, eventBlip.z, 4, Math.floor(timeSeconds * 4) % 2 === 0 ? '#ff2a3a' : '#ff8a94');
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
    if (signature === this.lastPoliceSig) return;
    this.lastPoliceSig = signature;
    if (units.length === 0) {
      this.el.police.classList.add('hidden');
      return;
    }
    this.el.police.classList.remove('hidden');
    this.el.police.innerHTML =
      `<div class="police-title">KEYS POLICE · ${units.length} UNITS</div>` +
      units.map((unit) => `<div class="police-row"><span>${unit.callsign}</span><span>${unit.distanceMetres}m</span><b>${unit.status}</b></div>`).join('');
  }
  renderWeaponSlots(weapons) {
    const signature = weapons.map((w) => `${w.name}:${w.mag}:${w.reserve}:${w.active}:${w.locked}:${w.reloading}`).join('|');
    if (signature === this.lastWeaponSig) return;
    this.lastWeaponSig = signature;
    this.el.weapons.innerHTML = weapons
      .map((weapon, index) => {
        const label = weapon.locked ? 'LOCKED' : weapon.reloading ? 'RELOADING' : weapon.name === 'FISTS' ? 'MELEE' : `${weapon.mag}/${weapon.reserve}`;
        return `<div class="weapon-slot${weapon.active ? ' active' : ''}${weapon.locked ? ' locked' : ''}">${index + 1} ${weapon.name} ${label}</div>`;
      })
      .join('');
  }
  showBriefing(mission, index) {
    this.el.phoneGiver.textContent = `MARA SOLIS CALLING · MISSION ${index + 1}/${MISSIONS_IN_STORY}`;
    this.el.phoneText.textContent = mission.briefing;
    this.el.phone.classList.remove('hidden');
  }
  hideBriefing() {
    this.el.phone.classList.add('hidden');
  }
  renderMissionList(entries, activeStageIndex = 0) {
    const totalPayout = entries.reduce((sum, e) => sum + e.rewardMoney, 0);
    const doneCount = entries.filter((e) => e.status === 'done').length;
    const rows = entries
      .map((e) => {
        const tag = e.status === 'done' ? '[DONE]' : e.status === 'active' ? '[ACTIVE]' : e.status === 'pending' ? '[AVAILABLE]' : '[LOCKED]';
        const stage = e.status === 'active' ? ` · STAGE ${activeStageIndex + 1}/${e.objectiveCount}` : '';
        const finale = e.finale ? ' · ★ FINALE' : '';
        const accept = e.status === 'pending' ? `<button class="menu-button mission-accept" data-mission="${e.number - 1}">ACCEPT JOB</button>` : '';
        const briefing = e.status === 'active' || e.status === 'pending' ? `<div class="mission-briefing">${e.briefing}</div>` : '';
        return `<div class="mission-row ${e.status}"><div class="mission-head"><span>MISSION ${e.number}/${MISSIONS_IN_STORY} — ${e.name}${finale}</span><span>${tag}${stage}</span></div><div class="mission-reward">Reward $${e.rewardMoney.toLocaleString('en-US')} · ${e.rewardRep} REP · from ${e.giver}</div>${briefing}${accept}</div>`;
      })
      .join('');
    this.el.missionList.innerHTML =
      `<div class="mission-summary">${doneCount}/${MISSIONS_IN_STORY} jobs done · total story payout $${totalPayout.toLocaleString('en-US')}</div>` + rows;
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
      nextLine,
      clockText,
      tapes,
      policeUnits,
      weapons,
      radioStation,
      repText,
      hiding,
      hideProgress,
      missionTarget,
      policeBlips,
      trafficBlips,
      ammoCrates,
      sideJobTarget,
      eventBlip,
      weatherText,
      timeSeconds,
    } = state;
    const setText = (el, value) => { if (value !== undefined) el.textContent = value; };
    this.drawMinimap(playerPos, heading, cars, driving, missionTarget, policeBlips, timeSeconds || 0, trafficBlips, ammoCrates, sideJobTarget, eventBlip);
    this.el.district.textContent = districtNameAt(playerPos.x, playerPos.z);
    setText(this.el.mission, missionLine);
    setText(this.el.objective, objective);
    if (nextLine !== undefined) this.el.next.textContent = nextLine ? `NEXT — ${nextLine}` : '';
    setText(this.el.clock, clockText);
    setText(this.el.weather, weatherText);
    if (tapes !== undefined) this.el.tapes.textContent = `TAPES ${tapes}`;
    this.el.money.textContent = `$${money.toLocaleString('en-US')}`;
    this.el.stars.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    this.el.stars.classList.toggle('hot', wanted > 0);
    setText(this.el.rep, repText);
    if (hiding !== undefined) {
      this.el.hiding.classList.toggle('hidden', !hiding);
      if (hiding && hideProgress !== undefined) {
        this.el.hiding.textContent = `HIDING… heat cooling ${Math.round(hideProgress * 100)}%`;
      }
    }
    this.el.speed.textContent = driving ? String(Math.round(speedKmh)) : '0';
    this.el.carName.textContent = driving ? carName : 'ON FOOT';
    this.el.health.style.width = `${health}%`;
    this.el.armour.style.width = `${armour}%`;
    if (policeUnits) this.renderPolicePanel(policeUnits);
    if (weapons) this.renderWeaponSlots(weapons);
    setText(this.el.radio, radioStation);
    if (this.messageUntil && performance.now() > this.messageUntil) {
      this.el.message.classList.remove('visible');
      this.messageUntil = 0;
      this.messageSticky = false;
    }
  }
  setObjective(text) {
    this.el.objective.textContent = text;
  }
}