import { districtNameAt, roadLines, districtLabels } from './city.js';
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
    this.mapCtx = $('bigmap').getContext('2d');
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
      condition: $('hud-condition'),
      health: $('hud-health-fill'),
      armour: $('hud-armour-fill'),
      message: $('hud-message'),
      police: $('hud-police'),
      weapons: $('hud-weapons'),
      radio: $('hud-radio'),
      phone: $('phone-panel'),
      phoneFace: $('phone-face'),
      phoneGiver: $('phone-giver'),
      phoneText: $('phone-text'),
      missionScreen: $('mission-screen'),
      missionList: $('mission-list'),
      empireScreen: $('empire-screen'),
      empireList: $('empire-list'),
      crosshair: $('crosshair'),
      passedScreen: $('passed-screen'),
      passedTitle: $('passed-title'),
      passedMission: $('passed-mission'),
      passedRewards: $('passed-rewards'),
      mapScreen: $('map-screen'),
      garageScreen: $('garage-screen'),
      garageList: $('garage-list'),
    };
    this.dmgPool = null;
    this.dmgIndex = 0;
    this.passedUntil = 0;
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
  spawnDamageNumber(x, y, text) {
    if (!this.dmgPool) {
      this.dmgPool = [];
      const layer = $('dmg-layer');
      for (let i = 0; i < 8; i += 1) {
        const el = document.createElement('div');
        el.className = 'dmg-num';
        layer.appendChild(el);
        this.dmgPool.push(el);
      }
    }
    const el = this.dmgPool[this.dmgIndex];
    this.dmgIndex = (this.dmgIndex + 1) % this.dmgPool.length;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.classList.remove('play');
    void el.offsetWidth;
    el.classList.add('play');
  }
  toMap(x, z, w = MINIMAP_SIZE, h = MINIMAP_SIZE) {
    const scale = w / WORLD_WIDTH;
    return {
      x: (x - WORLD_MIN_X) * scale,
      y: (z - WORLD_MIN_Z) * scale + (h - WORLD_DEPTH * scale) / 2,
    };
  }
  paintMap(ctx, w, h, s) {
    const k = w / MINIMAP_SIZE;
    const band = (a, b, c) => { ctx.fillStyle = c; ctx.fillRect(0, a, w, b - a); };
    const dot = (x, z, size, color) => { const p = this.toMap(x, z, w, h); ctx.fillStyle = color; ctx.fillRect(p.x - (size * k) / 2, p.y - (size * k) / 2, size * k, size * k); };
    const diamond = (x, z, size, color) => {
      const p = this.toMap(x, z, w, h);
      const r = size * k;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.fill();
    };
    const circle = (x, z, r, color) => { const p = this.toMap(x, z, w, h); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, r * k, 0, Math.PI * 2); ctx.fill(); };
    ctx.fillStyle = '#1a1030';
    ctx.fillRect(0, 0, w, h);
    const shore = this.toMap(0, 96, w, h).y;
    const beachTop = this.toMap(0, 58, w, h).y;
    const north = this.toMap(0, -162, w, h).y;
    band(shore, h, '#17789a');
    band(beachTop, shore, '#f0cd8c');
    band(north, beachTop, '#3a3348');
    ctx.fillStyle = '#ff7a66';
    for (const box of this.city.buildingBoxes) {
      const a = this.toMap(box.minX, box.minZ, w, h);
      const b = this.toMap(box.maxX, box.maxZ, w, h);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    ctx.strokeStyle = '#8a8296';
    ctx.lineWidth = Math.max(2, 2 * k);
    for (const line of roadLines()) {
      ctx.beginPath();
      if (line.axis === 'z') { const x = this.toMap(line.at, 0, w, h).x; ctx.moveTo(x, north); ctx.lineTo(x, beachTop); }
      else { const y = this.toMap(0, line.at, w, h).y; ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    }
    for (const car of s.cars) if (!car.driven && !car.destroyed) dot(car.position.x, car.position.z, 3, '#ffd978');
    if (s.trafficBlips) for (const b of s.trafficBlips) dot(b.x, b.z, 2, '#c4bcd0');
    if (s.ammoCrates) for (const c of s.ammoCrates) if (c.available) dot(c.x, c.z, 4, '#7affc4');
    if (s.sprayPos) diamond(s.sprayPos.x, s.sprayPos.z, 5, '#2ad0c4');
    if (s.businessBlips) for (const b of s.businessBlips) diamond(b.x, b.z, 4, b.owned ? '#7affc4' : '#ffd978');
    if (s.missionTarget) diamond(s.missionTarget.x, s.missionTarget.z, 5 + Math.sin(s.timeSeconds * 4) * 1.5, '#ffd978');
    if (s.policeBlips) for (const b of s.policeBlips) circle(b.x, b.z, 3, Math.floor(s.timeSeconds * 2.8) % 2 === 0 ? '#ff2a3a' : '#2a6bff');
    if (s.sideJobTarget) diamond(s.sideJobTarget.x, s.sideJobTarget.z, 4 + Math.sin(s.timeSeconds * 4), '#7affc4');
    if (s.eventBlip) circle(s.eventBlip.x, s.eventBlip.z, 4, Math.floor(s.timeSeconds * 4) % 2 === 0 ? '#ff2a3a' : '#ff8a94');
    if (s.labels) {
      ctx.fillStyle = '#ffd978';
      ctx.font = `bold ${Math.round(13 * k)}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.shadowColor = '#1a1030';
      ctx.shadowBlur = 4;
      for (const d of districtLabels()) {
        const p = this.toMap(d.x, d.z, w, h);
        ctx.fillText(d.name, p.x, p.y);
      }
      ctx.shadowBlur = 0;
    }
    const p = this.toMap(s.playerPos.x, s.playerPos.z, w, h);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI - s.playerHeading);
    ctx.scale(k, k);
    ctx.fillStyle = s.driving ? '#7affc4' : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  drawMinimap(playerPos, playerHeading, cars, driving, missionTarget, policeBlips, timeSeconds, trafficBlips, ammoCrates, sideJobTarget, eventBlip, businessBlips) {
    this.paintMap(this.ctx, MINIMAP_SIZE, MINIMAP_SIZE, { playerPos, playerHeading, cars, driving, missionTarget, policeBlips, timeSeconds, trafficBlips, ammoCrates, sideJobTarget, eventBlip, businessBlips });
  }
  renderMapScreen(s) {
    this.paintMap(this.mapCtx, 560, 446, { ...s, labels: true });
  }
  showMapScreen() {
    this.el.mapScreen.classList.remove('hidden');
  }
  hideMapScreen() {
    this.el.mapScreen.classList.add('hidden');
  }
  renderGarageScreen(garage, money, car, wanted) {
    const fmt = (n) => n.toLocaleString('en-US');
    const needsRepair = car.hp < car.maxHp || wanted > 0;
    const repairAction =
      !needsRepair
        ? '<div class="mission-reward">CAR IS CLEAN — nothing to fix</div>'
        : money >= 200
          ? '<button class="menu-button mission-accept garage-buy" data-action="repair">REPAIR — $200</button>'
          : '<div class="mission-reward">REPAIR NEEDS $200</div>';
    const upgrades = [
      { id: 'engine', name: 'ENGINE TUNE', desc: '+15% top speed & acceleration — every car you drive', price: 4000 },
      { id: 'armour', name: 'ARMOUR PLATING', desc: '200 HP on every car you drive', price: 3000 },
      { id: 'nitro', name: 'NITRO', desc: 'Hold SHIFT while driving for a speed boost', price: 3000 },
    ];
    const rows = upgrades
      .map((u) => {
        const owned = garage[u.id];
        const action = owned
          ? '<div class="mission-reward">INSTALLED</div>'
          : money >= u.price
            ? `<button class="menu-button mission-accept garage-buy" data-action="${u.id}">BUY — $${fmt(u.price)}</button>`
            : `<div class="mission-reward">NEEDS $${fmt(u.price)}</div>`;
        return `<div class="mission-row ${owned ? 'active' : 'pending'}"><div class="mission-head"><span>${u.name}</span><span>$${fmt(u.price)}</span></div><div class="mission-reward">${u.desc}</div>${action}</div>`;
      })
      .join('');
    this.el.garageList.innerHTML =
      `<div class="mission-summary">${car.name} · CONDITION ${Math.round((100 * car.hp) / car.maxHp)}% · $${fmt(money)} in pocket</div>` +
      `<div class="mission-row ${needsRepair ? 'pending' : ''}"><div class="mission-head"><span>REPAIR + CLEAR HEAT</span><span>$200</span></div><div class="mission-reward">Full repair, fire out, wanted stars cleared</div>${repairAction}</div>` +
      rows;
  }
  showGarageScreen() {
    this.el.garageScreen.classList.remove('hidden');
  }
  hideGarageScreen() {
    this.el.garageScreen.classList.add('hidden');
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
    const key = mission.giver === 'Juno Reyes' ? 'juno' : mission.giver === 'Otto Kane' ? 'otto' : 'mara';
    this.el.phoneFace.setAttribute('href', `#${key}-portrait`);
    this.el.phoneGiver.textContent = `${mission.giver.toUpperCase()} CALLING · MISSION ${index + 1}/${MISSIONS_IN_STORY}`;
    this.el.phoneText.textContent = mission.briefing;
    this.el.phone.classList.remove('hidden');
  }
  hideBriefing() {
    this.el.phone.classList.add('hidden');
  }
  renderMissionList(entries, activeStageIndex = 0, pct = 0, playTime = '') {
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
      `<div class="mission-summary">${doneCount}/${MISSIONS_IN_STORY} jobs done · ${pct}% COMPLETE · ${playTime} · total story payout $${totalPayout.toLocaleString('en-US')}</div>` + rows;
  }
  showPassed(title, missionName, rewards) {
    this.el.passedTitle.textContent = title;
    this.el.passedMission.textContent = missionName;
    this.el.passedRewards.innerHTML = rewards.filter(Boolean).join('<br>');
    this.el.passedScreen.classList.remove('hidden');
    this.passedUntil = performance.now() + 4000;
  }
  showMissionScreen() {
    this.el.missionScreen.classList.remove('hidden');
  }
  hideMissionScreen() {
    this.el.missionScreen.classList.add('hidden');
  }
  renderEmpireScreen(biz, stats, achievements, unlocked, money, repLevel, pct = 0, playTime = '') {
    const fmt = (n) => n.toLocaleString('en-US');
    const rows = biz.defs
      .map((def, i) => {
        const st = biz.state[i];
        const income = biz.incomePerDay(i);
        let action = '';
        if (!st.owned) {
          const why = biz.canBuy(i, money, repLevel);
          action =
            why === 'ok'
              ? `<button class="menu-button mission-accept empire-buy" data-index="${i}">BUY — $${fmt(def.price)}</button>`
              : `<div class="mission-reward">${why === 'rep' ? `NEEDS REP ${def.repRequired}` : `NEEDS $${fmt(def.price)}`}</div>`;
        } else if (st.level < 2) {
          const cost = biz.upgradeCost(i);
          action =
            money >= cost
              ? `<button class="menu-button mission-accept empire-upgrade" data-index="${i}">UPGRADE — $${fmt(cost)} (+50% income)</button>`
              : `<div class="mission-reward">UPGRADE NEEDS $${fmt(cost)}</div>`;
        } else {
          action = '<div class="mission-reward">MAX LEVEL</div>';
        }
        const status = st.owned
          ? `OWNED · LV ${st.level} · $${fmt(income)}/day · $${fmt(Math.floor(st.pending))} waiting — drive there, press E to collect`
          : `FOR SALE · $${fmt(def.price)} · earns $${fmt(def.incomePerDay)}/day · needs REP ${def.repRequired}`;
        return `<div class="mission-row ${st.owned ? 'active' : 'pending'}"><div class="mission-head"><span>${def.name} — ${def.kind}</span><span>${def.district}</span></div><div class="mission-reward">${status}</div>${action}</div>`;
      })
      .join('');
    const statRows = [
      ['CARS STOLEN', stats.carsStolen],
      ['PEDESTRIANS DOWN', stats.pedsDown],
      ['MONEY EARNED (CAREER)', `$${fmt(Math.floor(stats.moneyEarned))}`],
      ['DISTANCE DRIVEN', `${stats.kmDriven.toFixed(1)} km`],
      ['5-STAR ESCAPES', stats.escapes5],
      ['HELICOPTERS DOWN', stats.helisDown],
      ['ROBBERIES STOPPED', stats.robberiesStopped],
      ['SIDE JOBS DONE', stats.jobsDone],
    ]
      .map(([label, value]) => `<div class="mission-row"><div class="mission-head"><span>${label}</span><span>${value}</span></div></div>`)
      .join('');
    const achRows = achievements
      .map((a) => {
        const done = unlocked.includes(a.id);
        return `<div class="mission-row ${done ? 'active' : ''}"><div class="mission-head"><span>${a.name}</span><span>${done ? '[DONE]' : `$${fmt(a.reward)}`}</span></div><div class="mission-reward">${a.desc}</div></div>`;
      })
      .join('');
    this.el.empireList.innerHTML =
      `<div class="mission-summary">${biz.ownedCount()}/3 businesses · $${fmt(biz.totalIncomePerDay())}/day income · $${fmt(Math.floor(biz.totalPending()))} waiting to collect · ${pct}% COMPLETE · ${playTime}</div>` +
      rows +
      `<div class="mission-summary">CAREER STATS</div>` +
      statRows +
      `<div class="mission-summary">ACHIEVEMENTS — ${unlocked.length}/${achievements.length}</div>` +
      achRows;
  }
  showEmpireScreen() {
    this.el.empireScreen.classList.remove('hidden');
  }
  hideEmpireScreen() {
    this.el.empireScreen.classList.add('hidden');
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
      businessBlips,
      weatherText,
      timeSeconds,
    } = state;
    const setText = (el, value) => { if (value !== undefined) el.textContent = value; };
    this.drawMinimap(playerPos, heading, cars, driving, missionTarget, policeBlips, timeSeconds || 0, trafficBlips, ammoCrates, sideJobTarget, eventBlip, businessBlips);
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
    this.el.condition.textContent = driving && state.carClass ? `${state.carClass} · CONDITION ${Math.max(0, Math.round((100 * state.carHp) / (state.carMaxHp || 100)))}%` : '';
    this.el.health.style.width = `${health}%`;
    this.el.armour.style.width = `${armour}%`;
    if (policeUnits) this.renderPolicePanel(policeUnits);
    if (weapons) this.renderWeaponSlots(weapons);
    const activeWeapon = weapons ? weapons.find((w) => w.active) : null;
    this.el.crosshair.classList.toggle('hidden', !activeWeapon || activeWeapon.name === 'FISTS' || activeWeapon.locked);
    setText(this.el.radio, radioStation);
    if (this.messageUntil && performance.now() > this.messageUntil) {
      this.el.message.classList.remove('visible');
      this.messageUntil = 0;
      this.messageSticky = false;
    }
    if (this.passedUntil && performance.now() > this.passedUntil) {
      this.el.passedScreen.classList.add('hidden');
      this.passedUntil = 0;
    }
  }
  setObjective(text) {
    this.el.objective.textContent = text;
  }
}