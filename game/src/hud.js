import { districtNameAt, roadLines, districtLabels, CITY_EDGE, SHORELINE, MAP_EXTENT, waterDepthAt } from './city.js';
import { MISSIONS_IN_STORY } from './missions.js';
import { GANGS } from './gangs.js';
const $ = (id) => document.getElementById(id);
const MINIMAP_SIZE = 168;
const MINIMAP_W = 260, MINIMAP_H = 220;
// GTA-style minimap zoom: the local streets around the player, not the
// whole island squeezed unreadably small. 3.5x shows ~240m across.
const MINIMAP_ZOOM = 3.5;
// Street names from the grid: 13 north-south avenues (west to east) and 13
// east-west streets (north to south), roads at -312 + 52i.
const ord = (n) => (n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`);
function streetNameAt(x, z) {
  if (waterDepthAt(x, z) > 0) return 'OPEN WATER';
  if (Math.abs(x) > CITY_EDGE || Math.abs(z) > CITY_EDGE) return 'SHORELINE';
  const ave = Math.min(13, Math.max(1, Math.round((x + 312) / 52) + 1));
  const st = Math.min(13, Math.max(1, Math.round((z + 312) / 52) + 1));
  return `${ord(ave)} AVE · ${ord(st)} ST`;
}
// The map covers the whole island plus a ring of open sea (MAP_EXTENT =
// 420: the 636m city + 38m of beach + ~64m of water on every side).
const WORLD_MIN_X = -MAP_EXTENT, WORLD_MAX_X = MAP_EXTENT, WORLD_MIN_Z = -MAP_EXTENT, WORLD_MAX_Z = MAP_EXTENT;
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
      money: $('hud-money'),
      stars: $('hud-stars'),
      rep: $('hud-rep'),
      hiding: $('hud-hiding'),
      speed: $('hud-speed'),
      speedRow: $('hud-speed-row'),
      carName: $('hud-car'),
      condition: $('hud-condition'),
      health: $('hud-health-fill'),
      armour: $('hud-armour-fill'),
      healthNum: $('hud-health-num'),
      armourNum: $('hud-armour-num'),
      staminaNum: $('hud-stamina-num'),
      street: $('hud-street'),
      repbarFill: $('hud-repbar-fill'),
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
      stamina: $('hud-stamina'),
      staminaFill: $('hud-stamina-fill'),
      menuTabs: $('menu-tabs'),
      statsScreen: $('stats-screen'),
      statsList: $('stats-list'),
      saveScreen: $('save-screen'),
      saveList: $('save-list'),
      mapNext: $('map-next-mission'),
      mapDistricts: $('map-districts'),
      mapWaypoint: $('map-waypoint'),
      loadScreen: $('load-screen'),
      loadList: $('load-list'),
      missionStage: $('hud-stage'),
      missionProgress: $('hud-mission-progress'),
      missionProgressFill: $('hud-mission-progress-fill'),
      topLeft: $('hud-top-left'),
      topRight: $('hud-top-right'),
      speedo: $('hud-speedo'),
      minimapWrap: $('hud-minimap'),
      bars: $('hud-bars'),
      vitals: $('hud-vitals'),
      repbar: $('hud-repbar'),
      repstatus: $('hud-repstatus'),
    };
    this.dmgPool = null;
    this.dmgIndex = 0;
    this.passedUntil = 0;
    this.messageUntil = 0;
    this.messageSticky = false;
    this.promptKind = null;
    this.pendingMessages = [];
    this.lastPoliceSig = '';
    this.lastWeaponSig = '';
    // Full-map view: zoom + the world point at the canvas centre. The
    // minimap always shows the whole island (no view).
    this.mapView = { zoom: 1, cx: 0, cz: 0 };
    this.lastMapState = null;
    this.onWaypoint = null;
    this.lastDockSig = '';
    this.bindMapInteractions();
    this.renderStaticPanels();
    this.injectLayoutCss();
    this.restructureHud();
  }
  // The map legend + the controls list are static content rendered once from
  // compact data (smaller in the dossier than the equivalent HTML).
  renderStaticPanels() {
    const legend = [['#fff', 'Mission', 'dia'], ['#ffd978', 'Business', 'dia'], ['#7affc4', 'Side job / Ammo', 'dia'], ['#2ad0c4', "Pay'n'Spray", 'dia'], ['#ff5aa8', 'Barbershop', 'dia'], ['#ff2a3a', 'Police', 'dot'], ['#ffd978', 'Parked car', ''], ['#c4bcd0', 'Traffic', ''], ['#c47aff', 'Waypoint', 'dia'], ...GANGS.map((g) => [`#${g.colour.toString(16).padStart(6, '0')}`, `${g.name} turf`, ''])];
    $('map-legend').innerHTML = `<div class="map-panel-title">LEGEND</div><div class="legend-grid">${legend.map(([c, l, s]) => `<span><i${s ? ` class="${s}"` : ''} style="background:${c}"></i>${l}</span>`).join('')}</div><div class="legend-hint">Click: waypoint · wheel: zoom · drag: pan</div>`;
    const controls = [['MOVE', 'W / S'], ['TURN', 'A / D'], ['RUN / NITRO BOOST', 'SHIFT'], ['JUMP / HANDBRAKE', 'SPACE'], ['ENTER CAR / CARJACK', 'F'], ['PUNCH / SHOOT', 'CLICK'], ['INTERACT', 'E'], ['CHANGE WEAPON', '1–4 / WHEEL'], ['HORN', 'H'], ['MISSIONS', 'M'], ['BUSINESSES', 'B'], ['MAP', 'N'], ['RADIO', 'R'], ['PAUSE', 'ESC'], ['START / ACCEPT', 'ENTER']];
    // Two columns (8 + 7): the 15 rows fit the panel without scrolling.
    const col = (rows) => `<div class="controls-col">${rows.map(([l, k]) => `<div class="controls-row"><span>${l}</span><span class="key-chip">${k}</span></div>`).join('')}</div>`;
    $('controls-tab-panel').innerHTML = col(controls.slice(0, 8)) + col(controls.slice(8));
  }
  bindMapInteractions() {
    const canvas = $('bigmap');
    let dragging = false, moved = 0, lastX = 0, lastY = 0;
    const toCanvas = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) };
    };
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = toCanvas(e);
      // Zoom toward the cursor: the world point under it stays put.
      const before = this.fromMap(p.x, p.y, canvas.width, canvas.height, this.mapView);
      this.mapView.zoom = Math.max(1, Math.min(4, this.mapView.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      const after = this.fromMap(p.x, p.y, canvas.width, canvas.height, this.mapView);
      this.mapView.cx += before.x - after.x;
      this.mapView.cz += before.z - after.z;
      this.clampMapView();
      this.redrawMap();
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = canvas.getBoundingClientRect();
      const dx = (e.clientX - lastX) * (canvas.width / rect.width);
      const dy = (e.clientY - lastY) * (canvas.height / rect.height);
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX;
      lastY = e.clientY;
      const scale = Math.min(canvas.width / WORLD_WIDTH, canvas.height / WORLD_DEPTH) * this.mapView.zoom;
      this.mapView.cx -= dx / scale;
      this.mapView.cz -= dy / scale;
      this.clampMapView();
      this.redrawMap();
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      // A click (not a drag) sets the waypoint.
      if (moved > 5 || !this.onWaypoint) return;
      const p = toCanvas(e);
      const world = this.fromMap(p.x, p.y, canvas.width, canvas.height, this.mapView);
      this.onWaypoint(
        Math.max(-MAP_EXTENT, Math.min(MAP_EXTENT, world.x)),
        Math.max(-MAP_EXTENT, Math.min(MAP_EXTENT, world.z)),
      );
    });
  }
  clampMapView() {
    // The view centre stays within the island so the map never pans into
    // empty ocean; at zoom 1 the centre is locked (the whole island shows).
    const half = MAP_EXTENT / this.mapView.zoom;
    this.mapView.cx = Math.max(-MAP_EXTENT + half, Math.min(MAP_EXTENT - half, this.mapView.cx));
    this.mapView.cz = Math.max(-MAP_EXTENT + half, Math.min(MAP_EXTENT - half, this.mapView.cz));
  }
  resetMapView() {
    this.mapView = { zoom: 1, cx: 0, cz: 0 };
  }
  redrawMap() {
    if (this.lastMapState) this.paintMap(this.mapCtx, 1024, 816, { ...this.lastMapState, labels: true, fullMap: true });
  }
  showMessage(text, seconds = 3.5, sticky = false) {
    // FIFO queue: a message arriving while another is up waits its turn
    // instead of clobbering it (or being dropped). Without this the FIRST
    // WHEELS achievement, fired the same frame as a first steal, erased
    // the VEHICLE STOLEN / witness message before it ever showed. A repeat
    // of the queued tail is skipped, so a per-frame toast (arrest warning)
    // cannot flood the queue. Sticky-over-sticky still overwrites at once.
    const showing = this.messageUntil && performance.now() < this.messageUntil;
    if (showing && (!sticky || !this.messageSticky)) {
      const q = this.pendingMessages;
      if (!q.length || q[q.length - 1].text !== text) q.push({ text, seconds, sticky });
      return;
    }
    this.el.message.textContent = text;
    this.el.message.classList.add('visible');
    this.messageUntil = performance.now() + seconds * 1000;
    this.messageSticky = sticky;
    this.promptKind = null;
  }
  // Transient per-frame prompt (carjack / garage / collect): never queued,
  // and clearPrompt hides it the frame its condition ends — so the line
  // never shows a stale prompt after the car drove off or the player
  // walked away. A toast owns the line while it shows; the prompt simply
  // waits for the next free 0.6s slot, like before.
  showPrompt(kind, text) {
    if (this.messageUntil && performance.now() < this.messageUntil) return;
    this.promptKind = kind;
    this.el.message.textContent = text;
    this.el.message.classList.add('visible');
    this.messageUntil = performance.now() + 600;
    this.messageSticky = false;
  }
  clearPrompt(kind) {
    if (this.promptKind !== kind) return;
    this.promptKind = null;
    this.el.message.classList.remove('visible');
    // Past timestamp: the drain shifts the next queued toast on its tick.
    this.messageUntil = 1;
  }
  // Dismiss the toast (and any queued ones) when an overlay opens, so it
  // never shows through a translucent overlay over menu rows.
  hideMessage() {
    this.promptKind = null;
    this.el.message.classList.remove('visible');
    this.messageUntil = 1;
    this.messageSticky = false;
    this.pendingMessages.length = 0;
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
  toMap(x, z, w = MINIMAP_W, h = MINIMAP_H, view = null) {
    // One scale for both axes (the island is square, the full map is not),
    // centred, so the 1024x816 canvas never overflows vertically.
    const scale = Math.min(w / WORLD_WIDTH, h / WORLD_DEPTH);
    const v = view || { zoom: 1, cx: 0, cz: 0 };
    const s = scale * v.zoom;
    return { x: w / 2 + (x - v.cx) * s, y: h / 2 + (z - v.cz) * s };
  }
  fromMap(sx, sy, w, h, view = null) {
    const scale = Math.min(w / WORLD_WIDTH, h / WORLD_DEPTH);
    const v = view || { zoom: 1, cx: 0, cz: 0 };
    const s = scale * v.zoom;
    return { x: v.cx + (sx - w / 2) / s, z: v.cz + (sy - h / 2) / s };
  }
  paintMap(ctx, w, h, s) {
    const k = w / MINIMAP_SIZE;
    // Markers scale with sqrt(k): on the 168px minimap m = 1 (unchanged),
    // on the 1024px map they stay in one consistent family instead of
    // blowing up 6x (the mission diamond was 86px across).
    const m = Math.sqrt(k);
    const view = s.fullMap ? this.mapView : s.view || null;
    const toMap = (x, z) => this.toMap(x, z, w, h, view);
    const dot = (x, z, size, color) => { const p = toMap(x, z); ctx.fillStyle = color; ctx.fillRect(p.x - (size * m) / 2, p.y - (size * m) / 2, size * m, size * m); };
    const diamond = (x, z, size, color) => {
      const p = toMap(x, z);
      const r = size * m;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.fill();
    };
    const circle = (x, z, r, color) => { const p = toMap(x, z); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, r * m, 0, Math.PI * 2); ctx.fill(); };
    // Ocean everywhere, then the sand ring, then the land: the island.
    // Brown land + blue water: the old red blocks read as alarm, not map.
    ctx.fillStyle = '#207ea6';
    ctx.fillRect(0, 0, w, h);
    const sandA = toMap(-SHORELINE, -SHORELINE);
    const sandB = toMap(SHORELINE, SHORELINE);
    ctx.fillStyle = '#f0cd8c';
    ctx.fillRect(sandA.x, sandA.y, sandB.x - sandA.x, sandB.y - sandA.y);
    const landA = toMap(-CITY_EDGE, -CITY_EDGE);
    const landB = toMap(CITY_EDGE, CITY_EDGE);
    ctx.fillStyle = '#6b5136';
    ctx.fillRect(landA.x, landA.y, landB.x - landA.x, landB.y - landA.y);
    // Gang turf: a translucent tint per crew, under the roads (full map only).
    if (s.fullMap) {
      for (const gang of GANGS) {
        const a = toMap(gang.x0, gang.z0), b = toMap(gang.x1, gang.z1);
        ctx.fillStyle = `#${gang.colour.toString(16).padStart(6, '0')}`;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      ctx.globalAlpha = 1;
    }
    // Roads read as roads: full-width asphalt bands with a dashed centre
    // line, over the darker block ground. Buildings sit inset inside their
    // blocks with a sidewalk margin, so the road grid is the structure.
    const scale = Math.min(w / WORLD_WIDTH, h / WORLD_DEPTH) * (view ? view.zoom : 1);
    const rw = 12 * scale;
    ctx.fillStyle = '#4a3823';
    ctx.strokeStyle = '#d9c48f';
    ctx.lineWidth = Math.max(1, m);
    ctx.setLineDash([6 * scale, 6 * scale]);
    for (const line of roadLines()) {
      if (line.axis === 'z') {
        const x = toMap(line.at, 0).x;
        ctx.fillRect(x - rw / 2, landA.y, rw, landB.y - landA.y);
        ctx.beginPath(); ctx.moveTo(x, landA.y); ctx.lineTo(x, landB.y); ctx.stroke();
      } else {
        const y = toMap(0, line.at).y;
        ctx.fillRect(landA.x, y - rw / 2, landB.x - landA.x, rw);
        ctx.beginPath(); ctx.moveTo(landA.x, y); ctx.lineTo(landB.x, y); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#c89a5a';
    for (const box of this.city.buildingBoxes) {
      const a = toMap(box.minX, box.minZ);
      const b = toMap(box.maxX, box.maxZ);
      const bw = b.x - a.x, bh = b.y - a.y;
      ctx.fillRect(a.x + bw * 0.08, a.y + bh * 0.08, bw * 0.84, bh * 0.84);
    }
    for (const car of s.cars) if (!car.driven && !car.destroyed) dot(car.position.x, car.position.z, 4, '#ffd978');
    if (s.trafficBlips) for (const b of s.trafficBlips) dot(b.x, b.z, 3, '#c4bcd0');
    if (s.ammoCrates) for (const c of s.ammoCrates) if (c.available) diamond(c.x, c.z, 5, '#7affc4');
    if (s.sprayPos) diamond(s.sprayPos.x, s.sprayPos.z, 5, '#2ad0c4');
    if (s.shopPos) diamond(s.shopPos.x, s.shopPos.z, 5, '#ff5aa8');
    if (s.businessBlips) for (const b of s.businessBlips) diamond(b.x, b.z, 5, b.owned ? '#7affc4' : '#ffd978');
    // One icon scale for every destination marker (radius 5, ammo crates
    // included); the mission diamond is only slightly larger (6) with a
    // small pulse. Cars and traffic stay small dots: ambient blips, not
    // destinations.
    if (s.missionTarget) diamond(s.missionTarget.x, s.missionTarget.z, 6 + Math.sin(s.timeSeconds * 4) * 0.5, '#ffffff');
    // Waypoint route: walk to the nearest avenue, follow it to the
    // waypoint's street, follow that street to the waypoint — a street
    // route, not a straight line across blocks. Drawn under the markers.
    if (s.waypoint) {
      // roadLines() builds a fresh array every call; cache the two
      // coordinate lists once (the grid never changes mid-game).
      if (!this._avenues) {
        const lines = roadLines();
        this._avenues = lines.filter((l) => l.axis === 'z').map((l) => l.at);
        this._streets = lines.filter((l) => l.axis === 'x').map((l) => l.at);
      }
      const avenues = this._avenues;
      const streets = this._streets;
      const nearest = (list, v) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), list[0]);
      const ax = nearest(avenues, s.playerPos.x);
      const wz = nearest(streets, s.waypoint.z);
      const pts = [s.playerPos, { x: ax, z: s.playerPos.z }, { x: ax, z: wz }, { x: s.waypoint.x, z: wz }, s.waypoint]
        .filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.z - a[i - 1].z) > 0.5);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const trace = (width, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach((p, i) => { const q = toMap(p.x, p.z); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
        ctx.stroke();
      };
      trace(5 * m, 'rgba(26,16,48,0.9)');
      trace(2.5 * m, '#c47aff');
      ctx.restore();
      diamond(s.waypoint.x, s.waypoint.z, 5, '#c47aff');
    }
    if (s.policeBlips) for (const b of s.policeBlips) circle(b.x, b.z, 3, Math.floor(s.timeSeconds * 2.8) % 2 === 0 ? '#ff2a3a' : '#2a6bff');
    if (s.sideJobTarget) diamond(s.sideJobTarget.x, s.sideJobTarget.z, 5, '#7affc4');
    if (s.eventBlip) circle(s.eventBlip.x, s.eventBlip.z, 4, Math.floor(s.timeSeconds * 4) % 2 === 0 ? '#ff2a3a' : '#ff8a94');
    if (s.labels) {
      // Small outlined labels, clamped inside the canvas so no name is cut
      // off at an edge or runs into its neighbour. Floor at a readable
      // SCREEN size: on a small displayed map the canvas px shrink, so
      // divide by the canvas-to-screen scale (audit 2026-11-21).
      const shown = ctx.canvas.clientWidth > 0 ? ctx.canvas.clientWidth / w : 1;
      // On a small displayed map the 14px labels would print over each
      // other in the dense centre: skip a label whose box hits one already
      // placed (only when the map is small; desktop keeps every label).
      // POIs claim their spots first (they are the actionable labels);
      // districts fill the gaps that are left.
      const placed = [];
      const collides = (x0, x1, y0, y1) => placed.some((b) => x0 < b.x1 && b.x0 < x1 && y0 < b.y1 && b.y0 < y1);
      const smallMap = shown < 0.45;
      // POI labels (full map only): businesses, Pay'n'Spray, the shop,
      // the safehouse and the mission givers. Stacked entries share a
      // point with a vertical offset so they read as a list, not a blob.
      const pfs = Math.max(Math.round(7 * m), Math.ceil(14 / shown));
      ctx.font = `bold ${pfs}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.lineWidth = Math.round(pfs / 6);
      ctx.strokeStyle = '#1a1030';
      // Stacked POI offsets scale with the font, so OTTO KANE / SAFEHOUSE
      // stay a readable list instead of printing on top of each other.
      const dyScale = pfs / 17;
      // Order is priority on a small map: the givers and the safehouse
      // claim their spots first, then services, then businesses.
      const pois = [];
      pois.push({ x: 52, z: 0, text: 'MARA SOLIS', color: '#ffffff', dy: 14 });
      pois.push({ x: -52, z: 330, text: 'JUNO REYES', color: '#ffffff', dy: 0 });
      pois.push({ x: 104, z: -104, text: 'OTTO KANE', color: '#ffffff', dy: 16 });
      pois.push({ x: 104, z: -104, text: 'SAFEHOUSE', color: '#ffffff', dy: 32 });
      if (s.sprayPos) pois.push({ x: s.sprayPos.x, z: s.sprayPos.z, text: "PAY'N'SPRAY", color: '#2ad0c4', dy: 0 });
      if (s.shopPos) pois.push({ x: s.shopPos.x, z: s.shopPos.z, text: 'VICE CUTS', color: '#ff5aa8', dy: -14 });
      if (s.businessBlips) for (const b of s.businessBlips) pois.push({ x: b.x, z: b.z, text: b.name, color: b.owned ? '#7affc4' : '#ffd978', dy: -14 });
      for (const poi of pois) {
        const p = toMap(poi.x, poi.z);
        ctx.fillStyle = poi.color;
        const tw = ctx.measureText(poi.text).width;
        const x = Math.min(Math.max(p.x, tw / 2 + 4), w - tw / 2 - 4);
        const y = Math.min(Math.max(p.y + poi.dy * dyScale, pfs + 2), h - 4);
        const box = { x0: x - tw / 2 - 12, x1: x + tw / 2 + 12, y0: y - pfs * 0.8, y1: y + 2 };
        if (smallMap && collides(box.x0, box.x1, box.y0, box.y1)) continue;
        placed.push(box);
        ctx.strokeText(poi.text, x, y);
        ctx.fillText(poi.text, x, y);
      }
      const fs = Math.max(Math.round(9 * m), Math.ceil(14 / shown));
      ctx.font = `bold ${fs}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.lineWidth = Math.round(fs / 6);
      ctx.strokeStyle = '#1a1030';
      ctx.fillStyle = '#ffffff';
      for (const d of districtLabels()) {
        const p = toMap(d.x, d.z);
        const tw = ctx.measureText(d.name).width;
        const x = Math.min(Math.max(p.x, tw / 2 + 8), w - tw / 2 - 8);
        const y = Math.min(Math.max(p.y, fs + 4), h - 6);
        const box = { x0: x - tw / 2 - 12, x1: x + tw / 2 + 12, y0: y - fs * 0.8, y1: y + 2 };
        if (smallMap && collides(box.x0, box.x1, box.y0, box.y1)) continue;
        placed.push(box);
        ctx.strokeText(d.name, x, y);
        ctx.fillText(d.name, x, y);
      }
    }
    const p = toMap(s.playerPos.x, s.playerPos.z);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI - s.playerHeading);
    ctx.scale(m, m);
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
  drawMinimap(playerPos, playerHeading, cars, driving, missionTarget, policeBlips, timeSeconds, trafficBlips, ammoCrates, sideJobTarget, eventBlip, businessBlips, sprayPos, shopPos, waypoint) {
    // Throttled to 10fps: a full canvas repaint every frame is wasted
    // work — the minimap is a 260x220 overview, and blips moving at 10Hz
    // read exactly as smooth as 60Hz at that size.
    const now = performance.now();
    if (now - (this.lastMinimapTime || 0) < 200) return;
    this.lastMinimapTime = now;
    // Zoomed local view, centred on the player and clamped so the frame
    // never slides past the island edge (same clamp as the full map).
    const half = MAP_EXTENT / MINIMAP_ZOOM;
    const view = {
      zoom: MINIMAP_ZOOM,
      cx: Math.max(-MAP_EXTENT + half, Math.min(MAP_EXTENT - half, playerPos.x)),
      cz: Math.max(-MAP_EXTENT + half, Math.min(MAP_EXTENT - half, playerPos.z)),
    };
    this.paintMap(this.ctx, MINIMAP_W, MINIMAP_H, { playerPos, playerHeading, cars, driving, missionTarget, policeBlips, timeSeconds, trafficBlips, ammoCrates, sideJobTarget, eventBlip, businessBlips, sprayPos, shopPos, waypoint, view });
  }
  renderMapScreen(s) {
    this.lastMapState = s;
    this.paintMap(this.mapCtx, 1024, 816, { ...s, labels: true, fullMap: true });
    if (s.nextMission) {
      const nm = s.nextMission;
      this.el.mapNext.innerHTML =
        `<div class="map-panel-title">NEXT MISSION</div><div class="map-next-name">${nm.name}</div><div class="map-next-obj">${nm.objective}</div><div class="map-next-dist">${nm.distanceKm}</div>`;
    }
    if (s.districts) {
      this.el.mapDistricts.innerHTML =
        '<div class="map-panel-title">DISTRICT STANDING</div>' +
        s.districts
          .map(
            (d) =>
              `<div class="district-row"><span class="district-chip" style="background:${d.colour}"></span><span class="district-name">${d.name}</span><span class="district-bar"><i style="width:${Math.min(100, d.crimes * 20)}%"></i></span><b class="district-status ${d.status.toLowerCase()}">${d.status}</b></div>`,
          )
          .join('');
    }
    // Waypoint distance lives on the map, not just the HUD line: the
    // panel shows while a waypoint is set and hides when it is cleared.
    if (s.waypoint && s.waypointInfo) {
      this.el.mapWaypoint.classList.remove('hidden');
      this.el.mapWaypoint.innerHTML =
        `<div class="map-panel-title">WAYPOINT</div><div class="map-next-name">${s.waypointInfo}</div><div class="map-next-obj">Purple route on the map.</div>`;
    } else {
      this.el.mapWaypoint.classList.add('hidden');
    }
  }
  saveSlotsHtml(slots) {
    return slots
      .map((slot) => {
        const summary = slot.empty ? 'Empty slot' : `$${slot.money.toLocaleString('en-US')} · ${slot.missionsDone}/8 jobs`;
        return `<div class="save-row"><div><div class="save-slot">SLOT ${slot.slot}</div><div class="save-summary">${summary}</div></div><button class="menu-button compact save-btn" data-save-slot="${slot.slot}">SAVE</button></div>`;
      })
      .join('');
  }
  renderStatsScreen(stats, extra) {
    const fmt = (n) => n.toLocaleString('en-US');
    const rows = [
      ['JOBS DONE', `${stats.jobsDone}/${MISSIONS_IN_STORY}`],
      ['MONEY EARNED (CAREER)', `$${fmt(Math.floor(stats.moneyEarned))}`],
      ['CARS STOLEN', stats.carsStolen],
      ['DISTANCE DRIVEN', stats.kmDriven < 1 ? `${Math.round(stats.kmDriven * 1000)} m` : `${stats.kmDriven.toFixed(1)} km`],
      ['BUSINESSES OWNED', `${stats.businessesOwned}/3`],
      ['5-STAR ESCAPES', stats.escapes5],
      ['HELICOPTERS DOWN', stats.helisDown],
      ['ROBBERIES STOPPED', stats.robberiesStopped],
      ['PEDESTRIANS DOWN', stats.pedsDown],
      ['TAPES FOUND', extra.tapes],
      ['PLAY TIME', extra.playTime],
      ['COMPLETION', `${extra.pct}%`],
    ]
      .map(([label, value]) => `<div class="mission-row"><div class="mission-head"><span>${label}</span><span>${value}</span></div></div>`)
      .join('');
    this.el.statsList.innerHTML = '<div class="mission-summary">CAREER STATS</div>' + rows;
  }
  showStatsScreen() {
    this.el.statsScreen.classList.remove('hidden');
  }
  hideStatsScreen() {
    this.el.statsScreen.classList.add('hidden');
  }
  renderSaveScreen(slots) {
    this.el.saveList.innerHTML = '<div class="mission-summary">SAVE GAME — progress is saved to the slot you pick</div>' + this.saveSlotsHtml(slots);
  }
  loadSlotsHtml(slots) {
    return slots
      .map((slot) => {
        const summary = slot.empty ? 'Empty slot' : `$${slot.money.toLocaleString('en-US')} · ${slot.missionsDone}/8 jobs`;
        const action = slot.empty
          ? '<div class="mission-reward">EMPTY</div>'
          : `<button class="menu-button compact save-btn" data-load-slot="${slot.slot}">LOAD</button>`;
        return `<div class="save-row"><div><div class="save-slot">SLOT ${slot.slot}</div><div class="save-summary">${summary}</div></div>${action}</div>`;
      })
      .join('');
  }
  renderLoadScreen(slots) {
    this.el.loadList.innerHTML = '<div class="mission-summary">LOAD GAME — pick a save slot to resume</div>' + this.loadSlotsHtml(slots);
  }
  showLoadScreen() {
    this.el.loadScreen.classList.remove('hidden');
  }
  hideLoadScreen() {
    this.el.loadScreen.classList.add('hidden');
  }
  showSaveScreen() {
    this.el.saveScreen.classList.remove('hidden');
  }
  hideSaveScreen() {
    this.el.saveScreen.classList.add('hidden');
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
          : '';
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
            : '';
        return `<div class="mission-row ${owned ? 'active' : 'pending'}"><div class="mission-head"><span>${u.name}</span><span>$${fmt(u.price)}</span></div><div class="mission-reward">${u.desc}</div>${action}</div>`;
      })
      .join('');
    this.el.garageList.innerHTML =
      `<div class="mission-summary">${car.name} · CONDITION ${Math.round((100 * car.hp) / car.maxHp)}% · $${fmt(money)} in pocket</div>` +
      `<div class="mission-row ${needsRepair ? 'pending' : ''}"><div class="mission-head"><span>REPAIR + CLEAR HEAT</span><span>$200</span></div><div class="mission-reward">Full repair, fire out, wanted stars cleared</div>${repairAction}</div>` +
      rows;
  }
  showGarageScreen() {
    this.hideMessage();
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
    // HELI-1 first (police.units appends it last), then the ground units
    // in arrival order. Six rows max: a 5-star chase fields ~13 units and
    // the full list ran down over the weapon slots — the rest collapse
    // into a "+N more" footer.
    const ordered = [...units].sort((a, b) => (b.callsign === 'HELI-1') - (a.callsign === 'HELI-1'));
    const shown = ordered.slice(0, 6);
    const extra = ordered.length - shown.length;
    this.el.police.innerHTML =
      `<div class="police-title"><span>VRPD RESPONSE</span><span>${shown.length} UNITS</span></div>` +
      shown.map((unit) => {
        const heli = unit.callsign === 'HELI-1';
        return `<div class="police-row${heli ? ' heli' : ''}"><span class="pr-icon">${heli ? '▲' : '■'}</span><span class="pr-call">${unit.callsign}</span><span class="pr-meta"><span class="pr-status st-${unit.status.toLowerCase()}">${unit.status}</span><span class="pr-dist">${unit.distanceMetres}m</span></span></div>`;
      }).join('') +
      (extra > 0 ? `<div class="police-more">+${extra} more units responding</div>` : '');
  }
  // HUD v2 layout (approved mockup, 23/11): the stylesheet in index.html
  // puts the VRPD panel on the right, where a long unit list ran over
  // the weapon slots. This style block — appended after the page
  // stylesheet, so it wins same-specificity ties — compacts the mission
  // panel to 340px, restyles the VRPD rows, and badges the stage count.
  // The panel POSITIONS are set inline by dockPanels(), which beats the
  // short-screen media rules too.
  injectLayoutCss() {
    const css = `
#hud-top-left{width:340px;max-width:calc(100vw - 36px);padding:10px 14px}
#hud-mission{font-size:20px;letter-spacing:1px}
#hud-objective{font-size:16px;margin-top:4px;max-width:none}
#hud-next{font-size:14px;max-width:none}
#hud-stage{display:inline-block;background:#ffd978;color:#1a1030;font-size:13px;letter-spacing:2px;padding:2px 8px;border-radius:3px;margin-top:6px}
#hud-mission-progress{margin-top:6px}
#hud-police{width:340px;max-width:calc(100vw - 36px);padding:8px 12px;font-size:14px;background:rgba(26,16,48,.88);border:none;border-radius:8px}
.police-title{display:flex;justify-content:space-between;letter-spacing:2px;color:#ff8a94;margin-bottom:4px}
.police-row{display:flex;align-items:baseline;gap:8px;line-height:1.7;color:#fff}
.police-row .pr-icon{color:#ff8a94;font-size:11px}
.police-row.heli .pr-icon{color:#ff5aa8}
.police-row .pr-call{font-weight:700}
.police-row .pr-status{font-weight:700}
.police-row .pr-dist{margin-left:auto;color:#c4bcd0}
.police-row .pr-meta{display:contents}
.st-spotlight{color:#ff5aa8}
.st-ramming,.st-pursuit,.st-roadblock,.st-shooting{color:#ff4d5e}
.st-flanking{color:#2ad0c4}
.st-patrol{color:#ffd978}
.st-escort{color:#ff9a3c}
.police-more{color:#c4bcd0;font-size:13px;margin-top:2px}
#hud-bars.chase-compact #hud-district{font-size:28px}
#hud-minimap.chase-compact #minimap{width:180px;height:140px}
#hud-vitals.chase-compact{width:180px}
@media (min-height:500px){
#hud-speedo{max-width:320px}
#hud-radio{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
}
@media (max-width:880px){
#hud-top-left,#hud-police{width:300px}
#hud-mission{font-size:19px}
#hud-objective{font-size:15px}
}
@media (max-width:560px){
#hud-top-left,#hud-police{width:190px}
#hud-mission{font-size:17px}
#hud-objective{font-size:14px}
#hud-next{font-size:13px}
#hud-stage{font-size:12px}
#hud-police{font-size:13px}
.police-row{flex-wrap:wrap;justify-content:flex-start;line-height:1.4;row-gap:2px}
.police-row .pr-meta{display:flex;gap:8px;flex-basis:100%}
.police-row .pr-call,.police-row .pr-status,.police-row .pr-dist{white-space:nowrap}
#hud-speedo{max-width:260px}
#hud-radio{max-width:220px}
}
@media (max-height:499px){
#hud-police{font-size:12px}
.police-row{flex-wrap:nowrap;line-height:1.3;gap:6px}
.police-row .pr-meta{display:contents}
.police-more{font-size:11px}
}`;
    const style = document.createElement('style');
    style.id = 'hud-layout-v2';
    style.textContent = css;
    document.head.appendChild(style);
  }
  // The weapon row moves out of the speedo and docks under the top-right
  // stats (mockup); the speedo stacks speed-first (speed, car, condition,
  // radio). appendChild reorders in place — no markup changes.
  restructureHud() {
    const weapons = this.el.weapons;
    weapons.classList.add('hud');
    document.body.appendChild(weapons);
    const speedo = this.el.speedo;
    speedo.appendChild(this.el.speedRow);
    speedo.appendChild(this.el.carName);
    speedo.appendChild(this.el.condition);
    speedo.appendChild(this.el.radio);
  }
  // The VRPD panel docks under the mission panel and the weapon row under
  // the top-right stats, measured live so the gap stays 8px whatever the
  // mission text wraps to. On short screens (<500px tall) the VRPD panel
  // keeps its old dock beside the minimap and the weapons ride in the
  // speedo again — the viewport is too short for separate docks (the
  // weapon row would land on the speedo). While the VRPD panel is up on a
  // tall screen, the whole bottom-left column re-docks under it —
  // district block, then the (shrunk) minimap, then the vitals — so the
  // mockup layout holds during a chase too (see setChaseCompact).
  // Writes only when a rect moved. Throttled to 4x/s: getBoundingClientRect
  // forces a synchronous layout, and 3 of them every frame cost 3-15ms on
  // a weak laptop. Panel positions only change when the mission text
  // rewraps, the window resizes, or the VRPD panel appears — none of
  // those needs a per-frame check.
  dockPanels() {
    const now = performance.now();
    if (now - (this.lastDockTime || 0) < 250) return;
    this.lastDockTime = now;
    const ml = this.el.topLeft.getBoundingClientRect();
    const tr = this.el.topRight.getBoundingClientRect();
    const policeVisible = !this.el.police.classList.contains('hidden');
    const pb = policeVisible ? Math.round(this.el.police.getBoundingClientRect().bottom) : 0;
    const sig = `${ml.left}|${ml.bottom}|${ml.width}|${tr.bottom}|${tr.right}|${window.innerWidth}|${window.innerHeight}|${policeVisible}|${pb}`;
    if (sig === this.lastDockSig) return;
    this.lastDockSig = sig;
    const police = this.el.police;
    const weapons = this.el.weapons;
    if (window.innerHeight < 500) {
      const map = this.el.minimapWrap.getBoundingClientRect();
      police.style.top = 'auto';
      police.style.bottom = '30px';
      police.style.left = `${Math.round(map.right) + 10}px`;
      police.style.right = 'auto';
      police.style.width = '230px';
      if (weapons.parentElement !== this.el.speedo) {
        weapons.classList.remove('hud');
        weapons.style.top = '';
        weapons.style.right = '';
        this.el.speedo.prepend(weapons);
      }
      this.setChaseCompact(false);
    } else {
      police.style.top = `${Math.round(ml.bottom) + 8}px`;
      police.style.bottom = 'auto';
      police.style.left = `${Math.round(ml.left)}px`;
      police.style.right = 'auto';
      police.style.width = `${Math.round(ml.width)}px`;
      if (weapons.parentElement !== document.body) {
        weapons.classList.add('hud');
        document.body.appendChild(weapons);
      }
      weapons.style.top = `${Math.round(tr.bottom) + 8}px`;
      weapons.style.right = `${Math.round(window.innerWidth - tr.right)}px`;
      this.setChaseCompact(policeVisible);
      if (policeVisible) {
        // Chain the bottom-left column under the VRPD panel, top to
        // bottom: district block, minimap, vitals. Each rect is read
        // after its own write (getBoundingClientRect forces reflow),
        // so the chain lands in one frame.
        const pbFresh = Math.round(police.getBoundingClientRect().bottom);
        const bars = this.el.bars;
        bars.style.top = `${pbFresh + 8}px`;
        bars.style.bottom = 'auto';
        bars.style.left = `${Math.round(ml.left)}px`;
        bars.style.right = 'auto';
        bars.style.width = `${Math.round(ml.width)}px`;
        const minimap = this.el.minimapWrap;
        minimap.style.top = `${Math.round(bars.getBoundingClientRect().bottom) + 8}px`;
        minimap.style.bottom = 'auto';
        const vitals = this.el.vitals;
        vitals.style.top = `${Math.round(minimap.getBoundingClientRect().bottom) + 8}px`;
        vitals.style.bottom = 'auto';
        vitals.style.left = `${Math.round(ml.left)}px`;
        vitals.style.right = 'auto';
      }
    }
  }
  // Chase-compact: while the VRPD panel is up, the district font shrinks
  // a step and the minimap shrinks to its chase size so the full column
  // (mission + VRPD + district + minimap + vitals) fits 720px — nothing
  // hides, the mockup shows the whole column during a chase. Everything
  // restores the moment the panel hides.
  setChaseCompact(on) {
    const bars = this.el.bars;
    if (on === bars.classList.contains('chase-compact')) return;
    bars.classList.toggle('chase-compact', on);
    this.el.minimapWrap.classList.toggle('chase-compact', on);
    this.el.vitals.classList.toggle('chase-compact', on);
    if (!on) {
      for (const el of [bars, this.el.minimapWrap, this.el.vitals]) {
        el.style.top = '';
        el.style.bottom = '';
        el.style.left = '';
        el.style.right = '';
        el.style.width = '';
      }
    }
  }
  // The compact panel has no room for the full progress line
  // ("MISSION 1/8 — FIRST FARE · STAGE 1/3 · 4:32"): the stage already
  // has its own badge below, so drop it from the header. Free-roam and
  // side-job lines pass through unchanged.
  formatMissionLine(line) {
    const m = line.match(/^MISSION (\d+)\/\d+ — (.+)$/);
    if (!m) return line;
    const parts = m[2].split(' · ').filter((p) => !p.startsWith('STAGE '));
    return `MISSION ${m[1]} · ${parts.join(' · ')}`;
  }
  renderWeaponSlots(weapons) {
    const signature = weapons.map((w) => `${w.name}:${w.mag}:${w.reserve}:${w.active}:${w.locked}:${w.reloading}`).join('|');
    if (signature === this.lastWeaponSig) return;
    this.lastWeaponSig = signature;
    this.el.weapons.innerHTML = weapons
      .map((weapon, index) => {
        const label = weapon.locked ? 'LOCKED' : weapon.reloading ? 'RELOADING' : weapon.name === 'FISTS' ? 'MELEE' : `${weapon.mag}/${weapon.reserve}`;
        return `<div class="weapon-slot${weapon.active ? ' active' : ''}${weapon.locked ? ' locked' : ''}"><div class="ws-num">${index + 1}</div><div class="ws-name">${weapon.name}</div><div class="ws-ammo">${label}</div></div>`;
      })
      .join('');
  }
  showBriefing(mission, index) {
    const key = mission.giver === 'Juno Reyes' ? 'juno' : mission.giver === 'Otto Kane' ? 'otto' : 'mara';
    this.el.phoneFace.src = `assets/portraits/${key}.jpg`;
    this.el.phoneGiver.textContent = `${mission.giver.toUpperCase()} · MISSION ${index + 1}/${MISSIONS_IN_STORY}`;
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
        const hint = e.status === 'pending' ? '<div class="mission-briefing">Head to the marker on the map to start this job.</div>' : '';
        const briefing = e.status === 'active' || e.status === 'pending' ? `<div class="mission-briefing">${e.briefing}</div>` : '';
        return `<div class="mission-row ${e.status}"><div class="mission-head"><span>MISSION ${e.number}/${MISSIONS_IN_STORY} — ${e.name}${finale}</span><span>${tag}${stage}</span></div><div class="mission-reward">Reward $${e.rewardMoney.toLocaleString('en-US')} · ${e.rewardRep} REP · from ${e.giver}</div>${briefing}${hint}</div>`;
      })
      .join('');
    this.el.missionList.innerHTML =
      `<div class="mission-summary">${doneCount}/${MISSIONS_IN_STORY} jobs done · ${pct}% COMPLETE · ${playTime} · payout $${totalPayout.toLocaleString('en-US')}</div>` + rows;
  }
  showPassed(title, missionName, rewards) {
    this.hideMessage();
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
  renderEmpireScreen(biz, stats, achievements, unlocked, money, repLevel, pct = 0) {
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
              : '';
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
      ['DISTANCE DRIVEN', stats.kmDriven < 1 ? `${Math.round(stats.kmDriven * 1000)} m` : `${stats.kmDriven.toFixed(1)} km`],
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
      `<div class="mission-summary">${biz.ownedCount()}/3 businesses · $${fmt(biz.totalIncomePerDay())}/day · $${fmt(Math.floor(biz.totalPending()))} waiting · ${pct}% COMPLETE</div>` +
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
      sprayPos,
      shopPos,
      weatherText,
      timeSeconds,
    } = state;
    const setText = (el, value) => { if (value !== undefined) el.textContent = value; };
    this.dockPanels();
    this.drawMinimap(playerPos, heading, cars, driving, missionTarget, policeBlips, timeSeconds || 0, trafficBlips, ammoCrates, sideJobTarget, eventBlip, businessBlips, sprayPos, shopPos, state.waypoint);
    this.el.district.textContent = districtNameAt(playerPos.x, playerPos.z);
    this.el.street.textContent = streetNameAt(playerPos.x, playerPos.z);
    if (missionLine !== undefined) this.el.mission.textContent = this.formatMissionLine(missionLine);
    setText(this.el.objective, objective);
    // Mission stage count + progress bar: shown only while a story job
    // is active (free roam has no stages to count).
    if (state.missionStage) {
      this.el.missionStage.textContent = state.missionStage;
      this.el.missionStage.classList.remove('hidden');
      this.el.missionProgress.classList.remove('hidden');
      this.el.missionProgressFill.style.width = `${Math.round((state.missionProgress || 0) * 100)}%`;
    } else {
      this.el.missionStage.classList.add('hidden');
      this.el.missionProgress.classList.add('hidden');
    }
    if (nextLine !== undefined) this.el.next.textContent = nextLine ? `NEXT — ${nextLine}` : '';
    if (clockText !== undefined) this.el.clock.textContent = weatherText ? `${clockText} · ${weatherText}` : clockText;
    this.el.money.textContent = `$${money.toLocaleString('en-US')}`;
    this.el.stars.textContent = '★'.repeat(wanted) + '☆'.repeat(5 - wanted);
    this.el.stars.classList.toggle('hot', wanted > 0);
    if (repText !== undefined) this.el.rep.textContent = tapes !== undefined ? `${repText} · TAPES ${tapes}` : repText;
    if (hiding !== undefined) {
      this.el.hiding.classList.toggle('hidden', !hiding);
      if (hiding && hideProgress !== undefined) {
        this.el.hiding.textContent = `HIDING… heat cooling ${Math.round(hideProgress * 100)}%`;
      }
    }
    this.el.speed.textContent = driving ? String(Math.round(speedKmh)) : '0';
    this.el.speedRow.classList.toggle('hidden', !driving);
    this.el.carName.textContent = driving ? carName : 'ON FOOT';
    this.el.condition.textContent = driving && state.carClass ? `${state.carClass} · CONDITION ${Math.max(0, Math.round((100 * state.carHp) / (state.carMaxHp || 100)))}%` : '';
    this.el.health.style.width = `${health}%`;
    this.el.armour.style.width = `${armour}%`;
    this.el.healthNum.textContent = String(Math.round(health));
    this.el.armourNum.textContent = String(Math.round(armour));
    if (state.repFrac !== undefined) this.el.repbarFill.style.width = `${Math.round(state.repFrac * 100)}%`;
    if (state.repStatus !== undefined) this.el.repstatus.textContent = state.repStatus;
    // Stamina shows while swimming, or while it is still refilling.
    const showStamina = state.swimming || (state.stamina !== undefined && state.stamina < 100);
    this.el.stamina.classList.toggle('hidden', !showStamina);
    if (state.stamina !== undefined) {
      this.el.staminaFill.style.width = `${state.stamina}%`;
      this.el.staminaNum.textContent = String(Math.round(state.stamina));
    }
    if (policeUnits) this.renderPolicePanel(policeUnits);
    if (weapons) this.renderWeaponSlots(weapons);
    const activeWeapon = weapons ? weapons.find((w) => w.active) : null;
    this.el.crosshair.classList.toggle('hidden', driving || state.swimming || !activeWeapon || activeWeapon.name === 'FISTS' || activeWeapon.locked);
    setText(this.el.radio, radioStation);
    if (this.messageUntil && performance.now() > this.messageUntil) {
      this.el.message.classList.remove('visible');
      this.messageUntil = 0;
      this.messageSticky = false;
      this.promptKind = null;
      const p = this.pendingMessages.shift();
      if (p) this.showMessage(p.text, p.seconds, p.sticky);
    }
    if (this.passedUntil && performance.now() > this.passedUntil) {
      this.el.passedScreen.classList.add('hidden');
      this.passedUntil = 0;
    }
  }
  setObjective(text) {
    this.el.objective.textContent = text;
  }
  showMenuTabs() {
    this.hideMessage();
    this.el.menuTabs.classList.remove('hidden');
  }
  hideMenuTabs() {
    this.el.menuTabs.classList.add('hidden');
  }
  setActiveMenuTab(tab) {
    this.el.menuTabs.querySelectorAll('.menu-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  }
}