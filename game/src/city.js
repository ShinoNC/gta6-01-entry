import * as THREE from 'three';
import { intBetween, makeRng } from './random.js';
import { loadProp, loadGLB, MODEL_PATHS } from './models_loader.js';
// Facades dominate the frame, and on phone GPUs a standard material
// with an environment map renders 2-3x slower per pixel than Lambert.
// Touch devices get Lambert facades — same texture, same night windows,
// just no PBR reflections. Desktops keep the shiny standard glass.
const COARSE_POINTER = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent));
const facadeMat = (map, emissiveMap) => (COARSE_POINTER
  ? new THREE.MeshLambertMaterial({ map, emissive: 0xffffff, emissiveMap, emissiveIntensity: 0 })
  : new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap, emissiveIntensity: 0, metalness: 0.85, roughness: 0.15, envMapIntensity: 1.3 }));
// Zoning gives every area its own look: downtown glass towers, a
// mid-rise commercial ring around them, residential streets further out,
// beachfront villas on the outer ring. Height, style and colour shift
// per zone rather than repeating one glass box on every block.
// Adding a Vinish house GLB takes three steps: drop the file in
// assets/models/, add its measurements to HOUSE_SPECS, and list its
// name in one zone list below — the zone rotation picks it up.
const HOUSE_SPECS = {
  // Each entry: footprint and height in metres, plus the bbox centre
  // offset (cx, cz) measured from the GLB via gltf-transform inspect.
  // The models are not centred on their origin, so the offset matters.
  'modern-house': {
    w: 12.8, d: 11.0, h: 6.97, cx: -0.1, cz: 1.45,
  },
  'beach-house': {
    w: 12.89, d: 13.79, h: 7.42, cx: 0.75, cz: 2.2,
  },
  'container-home': {
    w: 14.82, d: 6.49, h: 5.5, cx: 1.3, cz: 0.93,
  },
  bungalow: {
    w: 16.39, d: 12.21, h: 6.64, cx: 0, cz: 0.9,
  },
  'family-house': {
    w: 14.2, d: 11.0, h: 10.14, cx: 1.95, cz: 0.94,
  },
  'a-frame-cabin': {
    w: 8.0, d: 13.5, h: 7.45, cx: 0, cz: 1.65,
  },
  'tiny-house': {
    w: 9.1, d: 3.2, h: 4.3, cx: -0.7, cz: 0.1,
  },
  supermarket: {
    w: 36.0, d: 38.07, h: 9.6, cx: 0, cz: 6.97,
  },
  'corner-cafe': {
    w: 14.5, d: 14.5, h: 9.88, cx: 2.25, cz: 2.25,
  },
  'office-tower': {
    w: 30.2, d: 30.9, h: 69.74, cx: 0, cz: 4.35,
  },
};
const ZONE_HOUSES = {
  residential: [
    'family-house', 'bungalow', 'container-home',
    'tiny-house', 'a-frame-cabin', 'modern-house',
  ],
  beachfront: ['beach-house', 'bungalow', 'family-house'],
};
const blockZone = (col, row) => {
  const downtown = col >= 4 && col <= 7 && row >= 4 && row <= 7;
  if (downtown) return 'downtown';
  const commercial = col >= 3 && col <= 8 && row >= 3 && row <= 8;
  if (commercial) return 'commercial';
  const edge = col === 0 || col === 11 || row === 0 || row === 11;
  if (edge) return 'beachfront';
  return 'residential';
};
// The beach-facing front rows (rows 8-9, columns 4-7) face the title
// camera: their buildings are white arena-style mid-rises instead of
// houses or checkered facades. The SUNSET TOWER block (5,9) and the
// park block (7,9) are reserved and never reach this test.
const isWhiteFront = (col, row) => row >= 8 && row <= 9 && col >= 4 && col <= 7;
// Models registered in models_loader.js load via loadProp. The newer
// house and town models use the shared cached loadGLB path instead:
// static props need no skeleton re-bind, so a deep clone is enough and
// every instance shares the source materials.
const loadHouse = (name) => {
  if (MODEL_PATHS[name]) return loadProp(name);
  return loadGLB(`assets/models/${name}.glb`).then((g) => g.scene.clone(true));
};
// Start the office tower GLB at import time. It is the tallest and most
// visible building, and its glass-box placeholder shows until the 1.7 MB
// model arrives — preloading means swapGlb finds it cached already.
loadHouse('office-tower').catch(() => {});
// SUNSET ROYALE is an island: a 10x10 block city grid ringed by beach,
// with open sea on all four sides. The 52m pitch is kept so every
// existing coordinate (missions, businesses, shop, spray, parked cars)
// stays valid — the old 6x4 city is the centre of the new grid, and the
// new blocks fill the ring around it.
const GRID_W = 10;
const GRID_H = 10;
const BLOCK = 40;
const ROAD_W = 12;
const PITCH = BLOCK + ROAD_W;
const HALF = (GRID_W * PITCH + ROAD_W) / 2;
const NORTH = -HALF;
export const CITY_EDGE = HALF;
const BEACH_W = 38;
export const SHORELINE = HALF + BEACH_W;
// Hospital entrance: the starting spawn and the WASTED respawn point.
export const HOSPITAL_SPAWN = { x: 8, z: -26 };
const DEPTH_RATE = 0.2;
const SEA_FAR = 1500;
export const MAP_EXTENT = 420;
const DISTRICT_DEFS = [
  {
    name: 'NORTHGATE', west: true, band: -1,
    lx: -159, lz: -263, colour: '#8a7bd8',
  },
  {
    name: 'FOG HARBOR', west: false, band: -1,
    lx: 159, lz: -263, colour: '#7ac4ff',
  },
  {
    name: 'OLD PORT', west: true, band: 0,
    lx: -107, lz: -135, colour: '#c98a5a',
  },
  {
    name: 'HARBOR LIGHTS', west: false, band: 0,
    lx: 107, lz: -135, colour: '#ffd978',
  },
  {
    name: 'LANTERN ROW', west: true, band: 1,
    lx: -107, lz: -13, colour: '#ff5aa8',
  },
  {
    name: 'MARINA DEL SOL', west: false, band: 1,
    lx: 107, lz: -13, colour: '#2ad0c4',
  },
  {
    name: 'PALM ROW', west: true, band: 2,
    lx: -107, lz: 42, colour: '#7affc4',
  },
  {
    name: 'PELICAN BAY', west: false, band: 2,
    lx: 107, lz: 42, colour: '#9fd4e8',
  },
  {
    name: 'SUNSET KEYS', west: true, band: 3,
    lx: -159, lz: 107, colour: '#ff7a3d',
  },
  {
    name: 'GULL HARBOR', west: false, band: 3,
    lx: 159, lz: 107, colour: '#ff8a94',
  },
  {
    name: 'SOUTH POINT', west: true, band: 4,
    lx: -159, lz: 237, colour: '#3da86b',
  },
  {
    name: 'BEACON KEY', west: false, band: 4,
    lx: 159, lz: 237, colour: '#e8a33d',
  },
];
// All named places on the island — the twelve city districts plus the
// two beach names the shoreline returns — for the map's District
// Standing panel.
export function districtList() {
  const city = DISTRICT_DEFS.map((d) => ({ name: d.name, colour: d.colour }));
  return [
    ...city,
    { name: 'CORAL STRAND', colour: '#f0cd8c' },
    { name: 'SUNSET BLUFF', colour: '#e8b07a' },
  ];
}
export function districtNameAt(x, z) {
  const outside = Math.abs(x) > CITY_EDGE || Math.abs(z) > CITY_EDGE;
  if (outside) return x < 0 ? 'CORAL STRAND' : 'SUNSET BLUFF';
  const band = z < -208 ? -1 : z <= -PITCH ? 0 : z < 26 ? 1 : z < 58 ? 2 : z < 156 ? 3 : 4;
  const west = x < 0;
  return DISTRICT_DEFS.find((d) => d.west === west && d.band === band).name;
}
export function districtLabels() {
  const city = DISTRICT_DEFS.map((d) => ({ name: d.name, x: d.lx, z: d.lz }));
  return [
    ...city,
    { name: 'CORAL STRAND', x: -159, z: 337 },
    { name: 'SUNSET BLUFF', x: 159, z: 337 },
  ];
}
// Street density by time of day, GTA-style: near-empty at 3am, moderate
// in the evening, full at daytime. Keyframes are in game minutes with
// linear interpolation between them. Nightlife districts stay busier
// after dark than the rest of the city.
export const NIGHTLIFE_DISTRICTS = ['LANTERN ROW', 'MARINA DEL SOL'];
const NIGHT_FLOOR = 0.7;
const DENSITY_TABLE = [
  [0, 0.6], [60, 0.6], [120, 0.22], [360, 0.22],
  [420, 1], [1320, 1], [1380, 0.6], [1440, 0.6],
];
export function densityForMinute(minutes) {
  const t = ((minutes % 1440) + 1440) % 1440;
  for (let i = 0; i < DENSITY_TABLE.length - 1; i += 1) {
    const [t0, d0] = DENSITY_TABLE[i];
    const [t1, d1] = DENSITY_TABLE[i + 1];
    if (t < t0 || t > t1) continue;
    if (t1 === t0) return d0;
    return d0 + ((d1 - d0) * (t - t0)) / (t1 - t0);
  }
  return 0.6;
}
export function averageDensity(minutes) {
  const base = densityForMinute(minutes);
  const night = Math.max(base, NIGHT_FLOOR);
  return (10 * base + 2 * night) / 12;
}
const blockX = (c) => -HALF + ROAD_W + BLOCK / 2 + c * PITCH;
const blockZ = (r) => NORTH + ROAD_W + BLOCK / 2 + r * PITCH;
const roadX = (i) => -HALF + ROAD_W / 2 + i * PITCH;
const roadZ = (i) => NORTH + ROAD_W / 2 + i * PITCH;
export function roadLines() {
  const lines = [];
  for (let i = 0; i <= GRID_W; i += 1) {
    lines.push({ axis: 'z', at: roadX(i), from: NORTH, to: HALF });
  }
  for (let j = 0; j <= GRID_H; j += 1) {
    lines.push({ axis: 'x', at: roadZ(j), from: -HALF, to: HALF });
  }
  return lines;
}
// Compass heading for driving along a road line in a given direction.
export function headingFor(axis, direction) {
  if (axis === 'z') return direction > 0 ? 0 : Math.PI;
  return direction > 0 ? Math.PI / 2 : -Math.PI / 2;
}
// Water depth in metres: zero on land, then 1m deeper per 5m past the
// shoreline. The gradient itself is the boundary — there is no invisible
// wall at the shore. Cars stall near 1.4m; the player starts swimming
// near 1m.
export function waterDepthAt(x, z) {
  const dx = Math.max(0, Math.abs(x) - SHORELINE);
  const dz = Math.max(0, Math.abs(z) - SHORELINE);
  return Math.hypot(dx, dz) * DEPTH_RATE;
}
export function shoreOutward(x, z) {
  const cx = Math.max(-SHORELINE, Math.min(SHORELINE, x));
  const cz = Math.max(-SHORELINE, Math.min(SHORELINE, z));
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d <= 0.001) return null;
  return { x: dx / d, z: dz / d };
}
// Day and dusk sky gradients: same 4 offsets, so the dusk sky is a
// straight per-stop lerp of the day sky. Dusk is a GTA VI-style Miami
// sunset: indigo top, magenta, coral, gold horizon.
const SKY_DAY_STOPS = [[0, '#3a7bd5'], [0.4, '#6db3e8'], [0.7, '#a8d8f0'], [1, '#d4eefc']];
const SKY_DUSK_STOPS = [[0, '#2a1a5e'], [0.4, '#a83a7a'], [0.7, '#ff6b5a'], [1, '#ffc94d']];
function drawSkyGradient(ctx, stops) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [o, c] of stops) gradient.addColorStop(o, c);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
}
function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  drawSkyGradient(ctx, SKY_DAY_STOPS);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, ctx };
}
function pushOutOfBoxes(position, radius, boxes) {
  for (const box of boxes) {
    const nearestX = Math.max(box.minX, Math.min(position.x, box.maxX));
    const nearestZ = Math.max(box.minZ, Math.min(position.z, box.maxZ));
    const dx = position.x - nearestX;
    const dz = position.z - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    if (distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      position.x = nearestX + (dx / dist) * radius;
      position.z = nearestZ + (dz / dist) * radius;
      continue;
    }
    const push = [
      position.x - box.minX + radius,
      box.maxX - position.x + radius,
      position.z - box.minZ + radius,
      box.maxZ - position.z + radius,
    ];
    const m = Math.min(...push);
    if (m === push[0]) position.x = box.minX - radius;
    else if (m === push[1]) position.x = box.maxX + radius;
    else if (m === push[2]) position.z = box.minZ - radius;
    else position.z = box.maxZ + radius;
  }
}
// Window cells in a facade texture: connected components of the two
// window colours (dark slate for unlit windows, warm yellow for
// lit-by-day ones). Every facade shares those two colours, so a single
// detector covers all of them.
function findWindows(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const isWindow = (x, y) => {
    const i = (y * canvas.width + x) * 4;
    const slate = pixels[i] === 88 && pixels[i + 1] === 110 && pixels[i + 2] === 150;
    const warm = pixels[i] === 255 && pixels[i + 1] === 214 && pixels[i + 2] === 120;
    return slate || warm;
  };
  const seen = new Uint8Array(canvas.width * canvas.height);
  const cells = [];
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (!isWindow(x, y) || seen[y * canvas.width + x]) continue;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0;
      const stack = [[x, y]];
      seen[y * canvas.width + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        area += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [ox, oy] of neighbours) {
          const nx = cx + ox, ny = cy + oy;
          const inside = nx >= 0 && ny >= 0 && nx < canvas.width && ny < canvas.height;
          if (!inside) continue;
          if (seen[ny * canvas.width + nx] || !isWindow(nx, ny)) continue;
          seen[ny * canvas.width + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (area >= 12) cells.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    }
  }
  return cells;
}
// Night emissive map for one building: black everywhere except a random
// ~60% of its windows, glowing warm yellow. The roll is per building,
// so no two buildings share a lit pattern.
function nightWindowsTex(cells, rand) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 64, 64);
  const shades = ['#ffd978', '#ffce6b', '#ffe6a8'];
  for (const cell of cells) {
    if (rand() >= 0.6) continue;
    const shade = shades[Math.floor(rand() * shades.length)];
    ctx.fillStyle = shade;
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
// Building name signs use fictional GTA-style names, with one shared
// canvas texture per name. White bold text on a dark panel with a gold
// border (white on #141030 is ~16:1 contrast) reads from street level,
// and the emissive map makes signs glow at night like lit windows.
const SHOP_NAMES = [
  'PALM HOTEL', 'SUNSET DINER', 'NEON MART', 'CORAL CAFE',
  'SUNSET BAR', 'KEYS BAKERY', 'MARINA MOTEL', 'LANTERN LOUNGE',
  'HARBOR GYM', 'OLD PORT TAVERN', 'PELICAN PIZZA', 'SOLARIS SUSHI',
  'BLUFF BOOKS', 'GULL GROCERY', 'EMBER GRILL', 'TIDE TATTOO',
  'COCONUT CLUB', 'STARFISH SPA', 'ANCHOR ARMS', 'RIPTIDE RECORDS',
  'OCEAN DRIVE INN', 'NEON PALMS HOTEL', 'CORAL BAY RESORT', 'SUNSET STRIP CAFE',
  'SUNSET TACOS', 'PALM COURT HOTEL', 'BAYSIDE BISTRO', 'TROPICANA LOUNGE',
  'SEASIDE STEAKHOUSE', 'SUNSET BAR', 'CORAL GABLES INN', 'OCEAN BREEZE SPA',
  'PALM BEACH GRILL', 'SUNSET COVE HOTEL', 'SUNSET ROYALE CASINO', 'TROPICAL SMOOTHIES',
  'BEACHFRONT BAKERY', 'MARINA BAY HOTEL', 'COCONUT GROVE CAFE', 'STARFISH INN',
];
const signTexCache = new Map();
function buildSignTexture(text) {
  const cached = signTexCache.get(text);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#141030';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#ffc828';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 56px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68, 470);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  signTexCache.set(text, texture);
  return texture;
}
const signMatCache = new Map();
export function signMaterialFor(text) {
  const cached = signMatCache.get(text);
  if (cached) return cached;
  const tex = buildSignTexture(text);
  const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
  signMatCache.set(text, mat);
  return mat;
}
// Which facade of a box faces a target point — a road or a named place.
function nearestFace(box, tx, tz) {
  const faces = [
    ['S', Math.abs(tz - box.maxZ)],
    ['N', Math.abs(tz - box.minZ)],
    ['E', Math.abs(tx - box.maxX)],
    ['W', Math.abs(tx - box.minX)],
  ];
  faces.sort((a, b) => a[1] - b[1]);
  return faces[0][0];
}
const SIGN_WIDTH = 8, SIGN_HEIGHT = 2, SIGN_ELEV = 4.5;
function signSpot(box, facing) {
  const midX = (box.minX + box.maxX) / 2;
  const midZ = (box.minZ + box.maxZ) / 2;
  if (facing === 'S') return { x: midX, z: box.maxZ + 0.12, rotY: 0, nx: 0, nz: 1 };
  if (facing === 'N') return { x: midX, z: box.minZ - 0.12, rotY: Math.PI, nx: 0, nz: -1 };
  if (facing === 'E') return { x: box.maxX + 0.12, z: midZ, rotY: Math.PI / 2, nx: 1, nz: 0 };
  return { x: box.minX - 0.12, z: midZ, rotY: -Math.PI / 2, nx: -1, nz: 0 };
}
export function buildCity(scene, textures, rand) {
  const root = new THREE.Group();
  const colliders = [];
  const glowMats = [];
  const neonMats = [];
  const signList = [];
  const sky = skyTexture();
  const daySky = sky.texture;
  // Dusk sky: lerp the sky gradient from day blue to Miami sunset as
  // f goes 0 -> 0.5, so the title screen's fixed f=0.4 already shows
  // vivid dusk colours. Redraws are cached: setNight runs every
  // frame, but the 4x256 gradient only repaints when f moved by 0.01.
  const skyDayColors = SKY_DAY_STOPS.map(([, c]) => new THREE.Color(c));
  const skyDuskColors = SKY_DUSK_STOPS.map(([, c]) => new THREE.Color(c));
  const skyLerpColor = new THREE.Color();
  let skyLastF = -1;
  function updateSky(f) {
    if (Math.abs(f - skyLastF) < 0.01) return;
    skyLastF = f;
    const t = Math.min(1, f / 0.5);
    const stops = SKY_DAY_STOPS.map(([o], i) => {
      skyLerpColor.lerpColors(skyDayColors[i], skyDuskColors[i], t);
      return [o, `#${skyLerpColor.getHexString()}`];
    });
    drawSkyGradient(sky.ctx, stops);
    daySky.needsUpdate = true;
  }
  const darkSky = new THREE.Color(0x14102a);
  const sunDay = new THREE.Color(0xfff2d0);
  const sunNight = new THREE.Color(0x8090c8);
  // At dusk and dawn the light passes through orange (f≈0.5) rather
  // than lerping straight from warm white to blue.
  const sunDusk = new THREE.Color(0xff9a3c);
  const fogDusk = new THREE.Color(0xe89a5a);
  const fogNight = new THREE.Color(0x14102a);
  const fogDay = new THREE.Color(0xbfd9e8);
  const discDay = new THREE.Color(0xffe9a8);
  const discDusk = new THREE.Color(0xff7a2a);
  scene.background = daySky;
  // The glass towers need a sky environment: an equirect gradient
  // (deep blue zenith, bright horizon, warm ground) with a sun-glare
  // patch toward the sun, so MeshStandardMaterial glass reflects the
  // island sky instead of rendering black. Lambert materials ignore
  // scene.environment, so nothing else in the scene changes.
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 64;
  envCanvas.height = 32;
  const envCtx = envCanvas.getContext('2d');
  const envGrad = envCtx.createLinearGradient(0, 0, 0, 32);
  const envStops = [
    [0, '#2f6fc4'], [0.42, '#7fb8e8'], [0.5, '#eef7ff'],
    [0.56, '#c8d8c0'], [1, '#8a7a5a'],
  ];
  for (const [o, c] of envStops) envGrad.addColorStop(o, c);
  envCtx.fillStyle = envGrad;
  envCtx.fillRect(0, 0, 64, 32);
  envCtx.fillStyle = 'rgba(255,242,205,0.95)';
  envCtx.fillRect(50, 11, 9, 4);
  envCtx.fillStyle = 'rgba(255,242,205,0.5)';
  envCtx.fillRect(47, 9, 15, 8);
  const envTexture = new THREE.CanvasTexture(envCanvas);
  envTexture.mapping = THREE.EquirectangularReflectionMapping;
  envTexture.colorSpace = THREE.SRGBColorSpace;
  scene.environment = envTexture;
  scene.fog = new THREE.Fog(0xbfd9e8, 120, 900);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(26, 24), new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
  sunDisc.position.set(-180, 42, 420);
  sunDisc.lookAt(0, 20, 0);
  root.add(sunDisc);
  // A pale moon disc in the north-east sky, visible only at night —
  // the sun hides past f > 0.5, and without a moon the night sky was
  // empty. It sits high so it reads from the beach and the title shot.
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(18, 24), new THREE.MeshBasicMaterial({ color: 0xe8ecf5, fog: false }));
  moonDisc.position.set(180, 80, -320);
  moonDisc.lookAt(0, 20, 0);
  moonDisc.visible = false;
  root.add(moonDisc);
  // Flat-colour ground plane: same rotated plane as the old textured
  // layFlat, but a solid colour instead of a speckled 64x64 tile, so
  // roads, sea, sand and sidewalk read clean like real surfaces.
  // The colours are the averages of the textures they replace.
  const layFlatColor = (color, w, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  // Island stack, bottom to top: a wide ocean sheet, a sand sheet for
  // the beach ring, then the city ground — the sand shows as a 38m ring
  // around all four sides. Road strips sit above the ground.
  layFlatColor(0x43adcd, SEA_FAR * 2, SEA_FAR * 2, 0, -0.15, 0);
  layFlatColor(0xf6dfae, SHORELINE * 2, SHORELINE * 2, 0, 0.01, 0);
  const cityFloor = layFlatColor(0xccc1b2, HALF * 2, HALF * 2, 0, 0.02, 0);
  cityFloor.receiveShadow = true;
  // Road strips stop at the city edge (+/-266): the old 544m strips
  // poked 6m onto the sand at both ends.
  for (let i = 0; i <= GRID_W; i += 1) {
    layFlatColor(0x424345, ROAD_W, HALF * 2, roadX(i), 0.03, 0);
  }
  for (let j = 0; j <= GRID_H; j += 1) {
    const stripGeometry = new THREE.PlaneGeometry(ROAD_W, HALF * 2);
    stripGeometry.rotateX(-Math.PI / 2);
    stripGeometry.rotateY(Math.PI / 2);
    const strip = new THREE.Mesh(stripGeometry, new THREE.MeshLambertMaterial({ color: 0x424345 }));
    strip.position.set(0, 0.04, roadZ(j));
    root.add(strip);
  }
  // Dashed white centre lines on every road: the dark asphalt swallows
  // dark cars, and a real road has markings. One merged geometry per
  // axis (a mesh per dash would be ~2000 draw calls); the two axes sit
  // 1mm apart so crossing dashes never z-fight. Basic material stays
  // bright at dusk and night.
  const dashGeo = new THREE.PlaneGeometry(0.3, 3);
  dashGeo.rotateX(-Math.PI / 2);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
  for (const [dashAxis, dashY] of [['z', 0.045], ['x', 0.046]]) {
    const dashParts = [];
    for (const line of roadLines()) {
      if (line.axis !== dashAxis) continue;
      const count = Math.floor((line.to - line.from) / 6);
      for (let k = 0; k < count; k += 1) {
        const s = line.from + 3 + k * 6;
        const m = new THREE.Matrix4();
        if (dashAxis === 'z') m.makeTranslation(line.at, dashY, s);
        else m.makeRotationY(Math.PI / 2).setPosition(s, dashY, line.at);
        dashParts.push([dashGeo, m]);
      }
    }
    root.add(new THREE.Mesh(mergeParts(dashParts), dashMat));
  }
  const faceTexs = [textures.facadeA, textures.facadeB, textures.facadeC, textures.facadeD, textures.facadeE, textures.facadeF];
  const faceWins = faceTexs.map((facade) => findWindows(facade.image));
  const roofMat = new THREE.MeshLambertMaterial({ map: textures.roof });
  // White arena-style front for the beach-facing rows: bright white
  // walls (pure white + a strong emissive lift, the same recipe as
  // the SUNSET ARENA, so the shaded side stays white instead of
  // going grey-beige), a dark window band just under the roofline
  // and a gold trim at the roofline. One shared material each for
  // every white-front building. The wall material has no emissive
  // map, so it never joins glowMats.
  const whiteFrontMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9a9a9a });
  const whiteFrontBandMat = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });
  const whiteFrontGoldMat = new THREE.MeshLambertMaterial({ color: 0xffb703 });
  // Rooftop features for the white-front buildings: one per building,
  // chosen by block position. Pool water, helipad darktop + white
  // markings, and lawn green — one shared material each, plus a unit
  // helipad disc scaled per building. The mast and shrubs reuse the
  // existing rooftop-dressing geometries (mastCyl/tipBall/shrubBall).
  const whiteFrontPoolMat = new THREE.MeshLambertMaterial({ color: 0x2a9fd8 });
  const whiteFrontPadMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4a });
  const whiteFrontMarkMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const whiteFrontLawnMat = new THREE.MeshLambertMaterial({ color: 0x4a9a4a });
  const whiteFrontPadGeo = new THREE.CylinderGeometry(1, 1, 0.12, 20);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const signPlane = new THREE.PlaneGeometry(SIGN_WIDTH, SIGN_HEIGHT);
  // A single radial glow texture serves sign halos, streetlight glow
  // sprites and the light pools on the ground.
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  // Sign halos share one additive material: a 12x4 plane sits just
  // behind each sign so the rim glows around the panel at night.
  const haloPlane = new THREE.PlaneGeometry(12, 4);
  const haloMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffd978, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  // Ground-floor lobby texture, shared by every shop: dark glass
  // entrance with gold trim, display windows and planter boxes.
  const shopTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 112;
    const x = c.getContext('2d');
    x.fillStyle = '#2a2f3a';
    x.fillRect(0, 0, 256, 112);
    // Gold trim band along the top edge.
    x.fillStyle = '#c8a85c';
    x.fillRect(0, 0, 256, 5);
    x.fillRect(0, 24, 256, 2);
    // Display windows: dark glass with a diagonal sky reflection.
    for (const wx of [10, 184]) {
      x.fillStyle = '#5a7a9a';
      x.fillRect(wx, 34, 62, 58);
      x.fillStyle = '#9fd4e8';
      x.beginPath();
      x.moveTo(wx, 92);
      x.lineTo(wx + 24, 34);
      x.lineTo(wx + 40, 34);
      x.lineTo(wx + 16, 92);
      x.closePath();
      x.fill();
    }
    // Centre entrance: glass door with a gold frame and handle.
    x.fillStyle = '#c8a85c';
    x.fillRect(96, 34, 64, 68);
    x.fillStyle = '#7aa8c8';
    x.fillRect(100, 38, 56, 64);
    x.fillStyle = '#e8f4ff';
    x.beginPath();
    x.moveTo(100, 102);
    x.lineTo(122, 38);
    x.lineTo(132, 38);
    x.lineTo(110, 102);
    x.closePath();
    x.fill();
    x.fillStyle = '#c8a85c';
    x.fillRect(148, 62, 4, 18);
    // Planter boxes with green shrubs at both ends.
    for (const px of [14, 208]) {
      x.fillStyle = '#4a4238';
      x.fillRect(px, 92, 34, 10);
      x.fillStyle = '#2fd35e';
      x.beginPath();
      x.arc(px + 8, 90, 7, 0, Math.PI * 2);
      x.arc(px + 17, 87, 8, 0, Math.PI * 2);
      x.arc(px + 26, 90, 7, 0, Math.PI * 2);
      x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const shopPlane = new THREE.PlaneGeometry(8, 3.5);
  const shopMat = new THREE.MeshLambertMaterial({ map: shopTex });
  // Shared rooftop and facade dressing: AC units, water towers (tank +
  // cone roof + leg), antenna masts, 3D awnings in four colours, and a
  // merged balcony unit (slab + railing in one mesh).
  const acBox = new THREE.BoxGeometry(1.2, 0.8, 1.2);
  const acMtl = new THREE.MeshLambertMaterial({ color: 0xb8b8c2 });
  const tankCyl = new THREE.CylinderGeometry(1.2, 1.2, 2, 8);
  const tankCone = new THREE.ConeGeometry(1.5, 1, 8);
  const tankLeg = new THREE.BoxGeometry(0.4, 2, 0.4);
  const tankMtl = new THREE.MeshLambertMaterial({ color: 0xa87858 });
  const mastCyl = new THREE.CylinderGeometry(0.06, 0.06, 5, 4);
  const mastMtl = new THREE.MeshLambertMaterial({ color: 0x70707c });
  const tipBall = new THREE.SphereGeometry(0.15, 6, 5);
  const tipMtl = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
  const shadeBox = new THREE.BoxGeometry(6, 0.12, 1.6);
  const shadeMtls = [0x3a3f4a, 0x8a6f3a, 0x2a4a5a, 0x5a5a6a].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const balcGeo = mergeParts([
    [new THREE.BoxGeometry(2.4, 0.15, 0.9), new THREE.Matrix4().makeTranslation(0, 0, 0)],
    [new THREE.BoxGeometry(2.4, 0.5, 0.06), new THREE.Matrix4().makeTranslation(0, 0.32, 0.42)],
  ]);
  const balcMtl = new THREE.MeshLambertMaterial({ color: 0x9fb8cc });
  // Vent pipes (stack + cap disc), rooftop gardens (planter + bushes),
  // and the parapet rim material — a real rim of four thin walls, not
  // the old solid slab that capped roofs in flat grey.
  const ventPipe = new THREE.CylinderGeometry(0.28, 0.28, 1.4, 6);
  const ventLid = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 6);
  const ventMtl = new THREE.MeshLambertMaterial({ color: 0x8a8a96 });
  const potBox = new THREE.BoxGeometry(3.2, 0.7, 1.6);
  const potMtl = new THREE.MeshLambertMaterial({ color: 0x9a8a76 });
  const shrubBall = new THREE.SphereGeometry(0.9, 7, 6);
  const shrubMtl = new THREE.MeshLambertMaterial({ color: 0x3da86b });
  const rimMtl = new THREE.MeshLambertMaterial({ color: 0xcfc8ba });
  // House dressing for the residential and beachfront zones: pastel wall
  // palettes, roof colours, a unit pyramid roof (its base is a square of
  // side sqrt(2) after the 45-degree turn, so scale by w/1.414), and a
  // door + window set so a box house reads as a house, not a crate.
  const pyrGeo = new THREE.ConeGeometry(1, 1, 4);
  pyrGeo.rotateY(Math.PI / 4);
  const wallMtls = [0xf2e6d0, 0xe8c9a0, 0xd0e0c0, 0xc0d8e8, 0xe8b8a0, 0xd8c8e8, 0xf0d8b0, 0xc8d8c8].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const villaMtls = [0xfff6e8, 0xf0e8d8, 0xd8f0e8, 0xffe8d0, 0xe8f0f8].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const roofMtls = [0xa85a3a, 0x8a4a3a, 0x5a5a6a, 0x7a5a3a, 0x9a3a3a].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const doorMtl = new THREE.MeshLambertMaterial({ color: 0x6a4a2a });
  const winMtl = new THREE.MeshLambertMaterial({ color: 0x9fc8d8 });
  const doorBox = new THREE.BoxGeometry(0.9, 2.1, 0.12);
  const winBox = new THREE.BoxGeometry(1.2, 1.2, 0.12);
  const chooseMat = (mats) => mats[Math.floor(rand() * mats.length)];
  // Night factor and clock, plus the landmark night-animation handles
  // (lighthouse beam, ferris wheel).
  let nightAmt = 0, nightTime = 0;
  const landmarks = { beam: null, beamMat: null, wheel: null, hubMat: null, cabinPivots: null };
  const namesPerRoad = new Map();
  const towerList = [];
  const placeSign = (box, name, tx, tz) => {
    const facing = nearestFace(box, tx, tz);
    const p = signSpot(box, facing);
    // Every sign gets its own material clone: shared materials cannot
    // blink out of phase, but the texture stays shared.
    const mat = signMaterialFor(name).clone();
    const phase = rand() * Math.PI * 2;
    neonMats.push({ mat, phase });
    const mesh = new THREE.Mesh(signPlane, mat);
    mesh.position.set(p.x, SIGN_ELEV, p.z);
    mesh.rotation.y = p.rotY;
    root.add(mesh);
    const halo = new THREE.Mesh(haloPlane, haloMat);
    halo.position.set(p.x - p.nx * 0.06, SIGN_ELEV, p.z - p.nz * 0.06);
    halo.rotation.y = p.rotY;
    root.add(halo);
    const entry = { name, x: p.x, y: SIGN_ELEV, z: p.z, box, mesh, halo, p };
    signList.push(entry);
    return entry;
  };
  // Zoned skyline: downtown draws the tall tiers (7-12 storeys) while
  // the commercial ring stays mid-rise (3-6 storeys). A tall tower never
  // stands next to another tall tower downtown (prevTall caps the next
  // plot), so the rhythm reads short-tall-short instead of a flat line
  // or a clump. SUNSET TOWER (70m, Office Tower GLB) stays the tallest
  // silhouette on the island. Residential and beachfront blocks never
  // reach this code — they are houses, built below.
  let prevTall = false;
  const pickHeight = (zone) => {
    if (zone === 'downtown') {
      const t = rand();
      if (t < 0.25) return intBetween(rand, 18, 24);
      if (t < 0.65) return intBetween(rand, 24, 32);
      return intBetween(rand, 32, 40);
    }
    return intBetween(rand, 9, 18);
  };
  // A GLB plot starts as a box of the same footprint, swapped for the
  // model when it loads; on load failure the box stays and the game is
  // fine. The holder starts INVISIBLE: a box suddenly morphing into a
  // detailed building reads as a bug, while a building popping in once
  // reads as loading. Extras (tower helipad and signs) hide with the
  // holder and appear together with the model.
  const swapGlb = (name, holder, x, z, rotY, extras = []) => {
    holder.visible = false;
    for (const e of extras) e.visible = false;
    loadHouse(name).then((glb) => {
      const spec = HOUSE_SPECS[name];
      glb.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const wrap = new THREE.Group();
      wrap.name = `glb-${name}`;
      wrap.position.set(x, 0, z);
      wrap.rotation.y = rotY;
      glb.position.set(-spec.cx, 0, -spec.cz);
      wrap.add(glb);
      // GLB models are static once placed: compute matrices FIRST, then
      // freeze them so the renderer skips the per-frame recompute.
      // Freezing before computing leaves identity matrices — everything
      // renders at the origin with frustum culling broken.
      wrap.updateMatrixWorld(true);
      wrap.traverse((o) => { o.matrixAutoUpdate = false; });
      root.add(wrap);
      root.remove(holder);
      for (const e of extras) e.visible = true;
    }).catch(() => {
      holder.visible = true;
      for (const e of extras) e.visible = true;
    });
  };
  const placeGlbHouse = (name, x, z, rotIdx) => {
    const spec = HOUSE_SPECS[name];
    const rotY = rotIdx * Math.PI / 2;
    const swapped = rotIdx % 2 === 1;
    const w = swapped ? spec.d : spec.w;
    const d = swapped ? spec.w : spec.d;
    const wallH = Math.max(3, spec.h - 1.8);
    const holder = new THREE.Group();
    holder.name = `placeholder-${name}`;
    holder.position.set(x, 0, z);
    const box = new THREE.Mesh(unitBox, chooseMat(wallMtls));
    box.scale.set(w, wallH, d);
    box.position.y = wallH / 2;
    box.castShadow = true;
    const roof = new THREE.Mesh(pyrGeo, chooseMat(roofMtls));
    roof.scale.set(w * 0.7071, 1.8, d * 0.7071);
    roof.position.y = wallH + 0.9;
    holder.add(box, roof);
    root.add(holder);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    swapGlb(name, holder, x, z, rotY);
  };
  const placeBoxHouse = (x, z, zone) => {
    const w = 10 + Math.floor(rand() * 5);
    const d = 9 + Math.floor(rand() * 4);
    const h = 4 + Math.floor(rand() * (zone === 'beachfront' ? 2 : 3));
    const box = new THREE.Mesh(unitBox, chooseMat(zone === 'beachfront' ? villaMtls : wallMtls));
    box.scale.set(w, h, d);
    box.position.set(x, h / 2, z);
    box.castShadow = true;
    box.receiveShadow = true;
    root.add(box);
    // Two roof options — pyramid or a single shed slope. Never a flat
    // slab: a flat slab reads as a crate.
    const roofRoll = rand();
    const roofMat2 = chooseMat(roofMtls);
    if (roofRoll < 0.5) {
      const roof = new THREE.Mesh(pyrGeo, roofMat2);
      roof.scale.set(w * 0.7071, 2, d * 0.7071);
      roof.position.set(x, h + 1, z);
      root.add(roof);
    } else {
      const shed = new THREE.Mesh(unitBox, roofMat2);
      shed.scale.set(w + 0.6, 0.15, d + 0.6);
      shed.position.set(x, h + 0.55, z);
      shed.rotation.x = 0.22;
      root.add(shed);
    }
    // A door plus two windows on the south face, so the box reads as
    // a house.
    const door = new THREE.Mesh(doorBox, doorMtl);
    door.position.set(x, 1.05, z + d / 2 + 0.06);
    const winL = new THREE.Mesh(winBox, winMtl);
    winL.position.set(x - w / 4, 2.4, z + d / 2 + 0.06);
    const winR = new THREE.Mesh(winBox, winMtl);
    winR.position.set(x + w / 4, 2.4, z + d / 2 + 0.06);
    root.add(door, winL, winR);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  };
  const placeHouseBlock = (col, row, cx, cz, zone) => {
    // Two plots per block, both GLB houses. The model cycles through
    // the zone list by block hash, so every model shows up several times
    // and adjacent plots differ; the rotation cycles too. Box houses are
    // gone — a flat slab with a door on one face read as a beige crate
    // from every other angle.
    const models = ZONE_HOUSES[zone];
    for (let pi = 0; pi < 2; pi += 1) {
      const x = cx + (pi === 0 ? -10 : 10);
      placeGlbHouse(models[(col * 5 + row * 3 + pi) % models.length], x, cz, (col + row + pi) % 4);
    }
  };
  // Town GLB (supermarket / corner cafe): a placeholder box plus a shop
  // sign on the south face; the sign stays when the model swaps in.
  // Like the hospital, town buildings are NOT in `towerList` — a named
  // sign must never overwrite their own sign.
  const placeGlbBuilding = (name, x, z, signName) => {
    const spec = HOUSE_SPECS[name];
    const holder = new THREE.Group();
    holder.name = `placeholder-${name}`;
    holder.position.set(x, 0, z);
    const box = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: 0xe8e0d0 }));
    box.scale.set(spec.w, spec.h, spec.d);
    box.position.y = spec.h / 2;
    box.castShadow = true;
    holder.add(box);
    root.add(holder);
    const boxRec = { minX: x - spec.w / 2, maxX: x + spec.w / 2, minZ: z - spec.d / 2, maxZ: z + spec.d / 2 };
    colliders.push(boxRec);
    // Aim the sign target 1m south of the south face: nearestFace picks
    // the NEAREST face, and a far target (z+52) lands closer to the east
    // or west faces of a wide building than to its south face.
    if (signName) placeSign(boxRec, signName, x, z + spec.d / 2 + 1);
    swapGlb(name, holder, x, z, 0);
  };
  for (let r = 0; r < GRID_H; r += 1) {
    for (let c = 0; c < GRID_W; c += 1) {
      const bx = blockX(c);
      const bz = blockZ(r);
      // Reserved blocks — hospital (6,5), SUNSET TOWER (5,9), clock tower
      // (5,5), casino (9,2), stadium (3,9), park (7,9) — are built
      // separately below.
      if ((c === 6 && r === 5) || (c === 5 && r === 9) || (c === 5 && r === 5) || (c === 9 && r === 2) || (c === 3 && r === 9) || (c === 7 && r === 9)) continue;
      // White-front blocks go through the commercial parcel logic
      // even on row 9 (residential by zone), so the front row gets
      // white arena-style mid-rises instead of small houses.
      const whiteFront = isWhiteFront(c, r);
      const zk = whiteFront ? 'commercial' : blockZone(c, r);
      if (zk === 'residential' || zk === 'beachfront') {
        placeHouseBlock(c, r, bx, bz, zk);
        continue;
      }
      // Town anchors: the supermarket fills block (3,3) on its own
      // (36x38m); the corner cafe shares block (8,8) with one glass
      // mid-rise next door.
      if (c === 3 && r === 3) {
        placeGlbBuilding('supermarket', bx, bz, 'SUPERMARKET');
        continue;
      }
      const isTwin = rand() < 0.45;
      const dep = 28 + 4 * Math.floor(rand() * 3);
      // Corner cafe block: the cafe takes the west plot, one glass
      // mid-rise takes the east plot.
      if (c === 8 && r === 8) placeGlbBuilding('corner-cafe', bx - 10, bz, 'CORNER CAFE');
      const parcels = (c === 8 && r === 8)
        ? [{ x: bx + 10, z: bz, w: 16, d: dep }]
        : isTwin
          ? [{ x: bx - 10, z: bz, w: 16 + 2 * Math.floor(rand() * 3), d: dep }, { x: bx + 10, z: bz, w: 16 + 2 * Math.floor(rand() * 3), d: dep }]
          : [{ x: bx, z: bz, w: 30 + 2 * Math.floor(rand() * 3), d: dep }];
      for (const pc of parcels) {
        let h = pickHeight(zk);
        if (prevTall && h > 20) h = intBetween(rand, 8, 14);
        prevTall = h > 28;
        const fi = Math.floor(rand() * faceTexs.length);
        const ft = faceTexs[fi].clone();
        ft.needsUpdate = true;
        const rx = Math.max(1, Math.round(pc.w / 10));
        const ry = Math.max(1, Math.round(h / 8));
        ft.repeat.set(rx, ry);
        const et = nightWindowsTex(faceWins[fi], rand);
        et.repeat.set(rx, ry);
        // Glass curtain wall: high metalness and low roughness make the
        // facade reflect the sky environment and gleam in the sun; the
        // emissive map still drives the night windows (emissive is
        // independent of metalness). On mobile this is Lambert — see
        // facadeMat at the top of the file. White-front parcels use the
        // shared white arena-style material instead; ft/et are still built
        // above so the seeded rand stream stays aligned for the blocks
        // after this one.
        const sm = whiteFront ? whiteFrontMat : facadeMat(ft, et);
        if (!whiteFront) glowMats.push(sm);
        // One material, not a 6-material array: a material array costs
        // one draw call per box face group (6 per building); a single
        // material costs 1. The roof is a separate thin slab with its
        // top flush with the building top, so the facade never shows
        // on the roof.
        const bld = new THREE.Mesh(unitBox, sm);
        bld.scale.set(pc.w, h, pc.d);
        bld.position.set(pc.x, h / 2, pc.z);
        bld.castShadow = true;
        bld.receiveShadow = true;
        root.add(bld);
        const cap = new THREE.Mesh(unitBox, roofMat);
        cap.scale.set(pc.w, 0.15, pc.d);
        cap.position.set(pc.x, h - 0.075, pc.z);
        root.add(cap);
        // White-front dressing, arena style: a dark window band just
        // under the roofline and a gold trim line at the roofline, so
        // the white box reads as a building, not a blank slab. Main
        // box only — setbacks stay plain white like the arena's tiers.
        // Floor bands: one dark window band per 3m floor, so the hotel
        // reads as storeys. Bands stop 1m short of the top band (its
        // bottom is h-2.0), so the highest floor band's top is h-3.0.
        if (whiteFront) {
          const band = new THREE.Mesh(unitBox, whiteFrontBandMat);
          band.scale.set(pc.w + 0.1, 1.2, pc.d + 0.1);
          band.position.set(pc.x, h - 1.4, pc.z);
          root.add(band);
          const trim = new THREE.Mesh(unitBox, whiteFrontGoldMat);
          trim.scale.set(pc.w + 0.2, 0.25, pc.d + 0.2);
          trim.position.set(pc.x, h - 0.1, pc.z);
          root.add(trim);
          for (let fy = 3; fy + 0.5 <= h - 3.0; fy += 3) {
            const fb = new THREE.Mesh(unitBox, whiteFrontBandMat);
            fb.scale.set(pc.w + 0.1, 1.0, pc.d + 0.1);
            fb.position.set(pc.x, fy, pc.z);
            root.add(fb);
          }
        }
        // Shape variety: a setback box on some buildings, then a smaller
        // second setback on the tallest (guaranteed above 24m), plus a
        // parapet rim on most. Shops (6-7m) never get a setback — a box
        // on a 1-storey shop would double its height. ty/tw/td track
        // the roof the dressing sits on.
        let ty = h, tw = pc.w, td = pc.d;
        // White-front parcels keep a clean flat roof (full footprint)
        // for their rooftop feature, so the setback roll is computed
        // — the seeded rand stream stays aligned — then forced off.
        const sbRoll = h >= 8 && (rand() < 0.3 || h > 13);
        const sb = whiteFront ? false : sbRoll;
        if (sb) {
          const s1 = intBetween(rand, 3, 6);
          const sb1 = new THREE.Mesh(unitBox, sm);
          sb1.scale.set(pc.w * 0.55, s1, pc.d * 0.55);
          sb1.position.set(pc.x, h + s1 / 2, pc.z);
          root.add(sb1);
          const cap1 = new THREE.Mesh(unitBox, roofMat);
          cap1.scale.set(pc.w * 0.55, 0.15, pc.d * 0.55);
          cap1.position.set(pc.x, h + s1 - 0.075, pc.z);
          root.add(cap1);
          ty = h + s1;
          tw = pc.w * 0.55;
          td = pc.d * 0.55;
          if ((h > 13 && rand() < 0.6) || h > 24) {
            const s2 = intBetween(rand, 3, 5);
            const sb2 = new THREE.Mesh(unitBox, sm);
            sb2.scale.set(pc.w * 0.32, s2, pc.d * 0.32);
            sb2.position.set(pc.x, ty + s2 / 2, pc.z);
            root.add(sb2);
            const cap2 = new THREE.Mesh(unitBox, roofMat);
            cap2.scale.set(pc.w * 0.32, 0.15, pc.d * 0.32);
            cap2.position.set(pc.x, ty + s2 - 0.075, pc.z);
            root.add(cap2);
            ty += s2;
            tw = pc.w * 0.32;
            td = pc.d * 0.32;
          }
        }
        // Parapet: four thin walls around the roof edge (light concrete),
        // leaving the roof surface visible — never a solid slab. The
        // south and east walls are clones of the north and west ones,
        // just moved to the other side.
        if (rand() < 0.6) {
          const rh = 0.6, rt = 0.3;
          const rn = new THREE.Mesh(unitBox, rimMtl);
          rn.scale.set(pc.w + rt * 2, rh, rt);
          rn.position.set(pc.x, h + rh / 2, pc.z - pc.d / 2);
          const rs = rn.clone();
          rs.position.z = pc.z + pc.d / 2;
          const rw = new THREE.Mesh(unitBox, rimMtl);
          rw.scale.set(rt, rh, pc.d);
          rw.position.set(pc.x - pc.w / 2, h + rh / 2, pc.z);
          const re = rw.clone();
          re.position.x = pc.x + pc.w / 2;
          root.add(rn, rs, rw, re);
        }
        // Rooftop dressing: AC units on most roofs, vent pipes on some,
        // a rooftop garden on some low/mid roofs, and an antenna mast
        // on the tallest. When a setback leaves a lower roof ring
        // exposed, the ring gets its own AC unit so it is not a bare
        // slab. (Water towers were removed: brown wooden tanks look
        // wrong on modern glass towers — Miami style, not
        // old NYC.)
        if (rand() < 0.75) {
          const na = 1 + Math.floor(rand() * 2);
          for (let a = 0; a < na; a += 1) {
            const u = new THREE.Mesh(acBox, acMtl);
            u.position.set(pc.x + (rand() - 0.5) * (tw - 2), ty + 0.4, pc.z + (rand() - 0.5) * (td - 2));
            root.add(u);
          }
        }
        if (rand() < 0.4) {
          const nv = 1 + Math.floor(rand() * 2);
          for (let v = 0; v < nv; v += 1) {
            const vx = pc.x + (rand() - 0.5) * (tw - 2);
            const vz = pc.z + (rand() - 0.5) * (td - 2);
            const pipe = new THREE.Mesh(ventPipe, ventMtl);
            pipe.position.set(vx, ty + 0.7, vz);
            const lid = new THREE.Mesh(ventLid, ventMtl);
            lid.position.set(vx, ty + 1.45, vz);
            root.add(pipe, lid);
          }
        }
        if (h <= 20 && tw >= 12 && rand() < 0.15) {
          const pot = new THREE.Mesh(potBox, potMtl);
          pot.position.set(pc.x - tw / 4, ty + 0.35, pc.z);
          root.add(pot);
          for (let b = 0; b < 3; b += 1) {
            const shrub = new THREE.Mesh(shrubBall, shrubMtl);
            shrub.position.set(pc.x - tw / 4 - 1 + b, ty + 1.2, pc.z + (rand() - 0.5) * 0.8);
            root.add(shrub);
          }
        }
        if (sb && rand() < 0.6) {
          const rac = new THREE.Mesh(acBox, acMtl);
          const rx2 = pc.x + (rand() < 0.5 ? -1 : 1) * pc.w * 0.36;
          const rz2 = pc.z + (rand() - 0.5) * pc.d * 0.6;
          rac.position.set(rx2, h + 0.4, rz2);
          root.add(rac);
        }
        if (h > 13 && rand() < 0.4) {
          const mp = new THREE.Mesh(mastCyl, mastMtl);
          mp.position.set(pc.x, ty + 2.5, pc.z);
          const tp = new THREE.Mesh(tipBall, tipMtl);
          tp.position.set(pc.x, ty + 5, pc.z);
          root.add(mp, tp);
        }
        // White-front rooftop feature: one distinctive feature per
        // building, chosen by block position so it is stable across
        // runs — pool, helipad, antenna mast, rooftop garden in
        // rotation. A twin parcel's east building takes the next
        // feature in the rotation, so twin neighbours differ. All
        // features sit on the flat main roof (base at y = h), clear
        // of the parapet ring at the roof edge.
        if (whiteFront) {
          const feat = (c + r + (pc.x > bx ? 1 : 0)) % 4;
          if (feat === 0) {
            const pool = new THREE.Mesh(unitBox, whiteFrontPoolMat);
            pool.scale.set(pc.w * 0.6, 0.15, pc.d * 0.6);
            pool.position.set(pc.x, h + 0.075, pc.z);
            root.add(pool);
          } else if (feat === 1) {
            const pr = Math.min(pc.w, pc.d) * 0.32;
            const pad = new THREE.Mesh(whiteFrontPadGeo, whiteFrontPadMat);
            pad.scale.set(pr, 1, pr);
            pad.position.set(pc.x, h + 0.06, pc.z);
            root.add(pad);
            const bw = pr * 0.25, bl = pr * 1.2;
            const h1 = new THREE.Mesh(unitBox, whiteFrontMarkMat);
            h1.scale.set(bw, 0.06, bl);
            h1.position.set(pc.x - pr * 0.325, h + 0.15, pc.z);
            const h2 = h1.clone();
            h2.position.x = pc.x + pr * 0.325;
            const h3 = new THREE.Mesh(unitBox, whiteFrontMarkMat);
            h3.scale.set(pr * 0.9, 0.06, bw);
            h3.position.set(pc.x, h + 0.15, pc.z);
            root.add(h1, h2, h3);
          } else if (feat === 2) {
            const mp = new THREE.Mesh(mastCyl, mastMtl);
            mp.position.set(pc.x + pc.w * 0.25, h + 2.5, pc.z - pc.d * 0.25);
            const tp = new THREE.Mesh(tipBall, tipMtl);
            tp.position.set(pc.x + pc.w * 0.25, h + 5, pc.z - pc.d * 0.25);
            root.add(mp, tp);
          } else {
            const lawn = new THREE.Mesh(unitBox, whiteFrontLawnMat);
            lawn.scale.set(pc.w * 0.6, 0.12, pc.d * 0.6);
            lawn.position.set(pc.x, h + 0.06, pc.z);
            root.add(lawn);
            const shrubOffs = [[-0.18, 0.12], [0.14, -0.1], [0.04, 0.18], [-0.06, -0.16]];
            for (const [ox, oz] of shrubOffs) {
              const shrub = new THREE.Mesh(shrubBall, shrubMtl);
              shrub.position.set(pc.x + ox * pc.w, h + 1.0, pc.z + oz * pc.d);
              root.add(shrub);
            }
          }
        }
        const bb = { minX: pc.x - pc.w / 2, maxX: pc.x + pc.w / 2, minZ: pc.z - pc.d / 2, maxZ: pc.z + pc.d / 2 };
        colliders.push(bb);
        // Every building carries a name sign on the facade facing its
        // nearest road; no name repeats on the same street. Height is
        // kept for the high-sign pass below (tallest signed towers).
        const rec = { box: bb, sign: null, height: h, whiteFront };
        towerList.push(rec);
        if (rand() < 1) {
          const nzr = roadX(Math.round((pc.x + HALF - ROAD_W / 2) / PITCH));
          const nxr = roadZ(Math.round((pc.z + HALF - ROAD_W / 2) / PITCH));
          const dzr = Math.abs(pc.x - nzr);
          const dxr = Math.abs(pc.z - nxr);
          // Single plots sit equidistant from all four roads — break
          // the tie at random so signs do not all face east.
          const uz = dzr < dxr || (dzr === dxr && rand() < 0.5);
          // White-front signs always face SOUTH, toward the beach and
          // the title camera: the target sits 1m beyond the south
          // face, so nearestFace picks the south face (the 1m gap
          // beats every other face's distance). Their name key is the
          // E-W road south of the block, so no two front-row signs on
          // the same street share a name. Other buildings keep the
          // nearest-road logic above.
          const rk = whiteFront ? `x:${roadZ(r + 1)}` : (uz ? `z:${nzr}` : `x:${nxr}`);
          const tx = whiteFront ? pc.x : (uz ? nzr : pc.x);
          const tz = whiteFront ? pc.z + pc.d / 2 + 1 : (uz ? pc.z : nxr);
          if (!namesPerRoad.has(rk)) namesPerRoad.set(rk, new Set());
          const taken = namesPerRoad.get(rk);
          const si = Math.floor(rand() * SHOP_NAMES.length);
          let nm = SHOP_NAMES[si];
          for (let k = 0; k < SHOP_NAMES.length; k += 1) {
            const cand = SHOP_NAMES[(si + k) % SHOP_NAMES.length];
            if (!taken.has(cand)) { nm = cand; break; }
          }
          taken.add(nm);
          rec.sign = placeSign(bb, nm, tx, tz);
          // Ground-floor storefront on the same facade as the sign; a
          // 3D awning instead when the storefront does not roll (the
          // storefront texture already paints an awning — no doubling).
          const sp = rec.sign.p;
          if (rand() < 0.55) {
            const st = new THREE.Mesh(shopPlane, shopMat);
            st.position.set(sp.x - sp.nx * 0.04, 1.75, sp.z - sp.nz * 0.04);
            st.rotation.y = sp.rotY;
            root.add(st);
          } else if (rand() < 0.6) {
            const aw = new THREE.Mesh(shadeBox, shadeMtls[Math.floor(rand() * shadeMtls.length)]);
            aw.position.set(sp.x + sp.nx * 0.8, 3.4, sp.z + sp.nz * 0.8);
            aw.rotation.set(0.35, sp.rotY, 0, 'YXZ');
            root.add(aw);
          }
          // Balconies on tall signed buildings: two slabs on the sign
          // facade, staggered in height and offset along the facade;
          // taller towers get extra rows higher up.
          if (h > 14 && rand() < 0.5) {
            const tx2 = sp.nz !== 0 ? 1 : 0, tz2 = sp.nx !== 0 ? 1 : 0;
            const offs = [[-pc.w / 4, 6.5], [pc.w / 4, 11]];
            if (h > 20) offs.push([-pc.w / 4, 17]);
            if (h > 26) offs.push([pc.w / 4, 23]);
            for (const [o, y] of offs) {
              if (y + 1 > h) continue;
              const bl = new THREE.Mesh(balcGeo, balcMtl);
              bl.position.set(sp.x + tx2 * o + sp.nx * 0.5, y, sp.z + tz2 * o + sp.nz * 0.5);
              bl.rotation.y = sp.rotY;
              root.add(bl);
            }
          }
        }
      }
    }
  }
  // Named places get their own sign on the nearest building, facing the
  // spot itself: the three businesses, Pay'n'Spray, and the Harbor Lights
  // safehouse (second-nearest building to the dealership corner, so the
  // two signs do not land on the same facade).
  const closestTowers = (x, z) => [...towerList].sort((a, b) => {
    const da = Math.hypot((a.box.minX + a.box.maxX) / 2 - x, (a.box.minZ + a.box.maxZ) / 2 - z);
    const db = Math.hypot((b.box.minX + b.box.maxX) / 2 - x, (b.box.minZ + b.box.maxZ) / 2 - z);
    return da - db;
  });
  const setPlaceSign = (record, name, x, z) => {
    if (record.sign) {
      const mat = signMaterialFor(name).clone();
      neonMats.push({ mat, phase: rand() * Math.PI * 2 });
      record.sign.mesh.material = mat;
      record.sign.name = name;
      // Re-face the sign toward the named spot itself (halo follows).
      const p = signSpot(record.box, nearestFace(record.box, x, z));
      record.sign.mesh.position.set(p.x, SIGN_ELEV, p.z);
      record.sign.mesh.rotation.y = p.rotY;
      record.sign.halo.position.set(p.x - p.nx * 0.06, SIGN_ELEV, p.z - p.nz * 0.06);
      record.sign.halo.rotation.y = p.rotY;
      record.sign.x = p.x;
      record.sign.z = p.z;
      record.sign.p = p;
      return;
    }
    record.sign = placeSign(record.box, name, x, z);
  };
  const places = [
    { name: 'KEYS CAB CO.', x: 52, z: 52, nth: 0 },
    { name: 'NEON PALMS', x: -52, z: -52, nth: 0 },
    { name: 'SOLSTICE MOTORS', x: 104, z: -104, nth: 0 },
    { name: 'SAFEHOUSE', x: 104, z: -104, nth: 1 },
    { name: "PAY 'N SPRAY", x: 104, z: -52, nth: 0 },
  ];
  for (const pl of places) {
    const ord = closestTowers(pl.x, pl.z);
    if (ord[pl.nth]) setPlaceSign(ord[pl.nth], pl.name, pl.x, pl.z);
  }
  // High signs: ground-floor signs are invisible from the title
  // screen's aerial orbit, so the 10 tallest signed towers carry a
  // second, large sign near the roofline on the same facade (same name
  // as the ground sign — one building, one name).
  {
    const signedT = towerList.filter((r) => r.sign && r.height >= 18);
    signedT.sort((a, b) => b.height - a.height);
    const bigPl = new THREE.PlaneGeometry(16, 4);
    const addHighSign = (record) => {
      const p = record.sign.p;
      const fw = p.nz !== 0 ? record.box.maxX - record.box.minX : record.box.maxZ - record.box.minZ;
      const sw = Math.min(16, Math.max(10, fw - 2));
      const mm = signMaterialFor(record.sign.name).clone();
      neonMats.push({ mat: mm, phase: rand() * Math.PI * 2 });
      const sg = new THREE.Mesh(bigPl, mm);
      sg.scale.setScalar(sw / 16);
      sg.position.set(p.x, record.height - 2.2, p.z);
      sg.rotation.y = p.rotY;
      root.add(sg);
      const hg = new THREE.Mesh(haloPlane, haloMat);
      hg.scale.setScalar(sw / 12);
      hg.position.set(p.x - p.nx * 0.06, record.height - 2.2, p.z - p.nz * 0.06);
      hg.rotation.y = p.rotY;
      root.add(hg);
    };
    for (const record of signedT.slice(0, 10)) addHighSign(record);
    // White-front buildings carry a roofline sign too, on the same
    // south facade as their ground sign, so their names read from
    // the title screen's aerial orbit. In addition to the top-10
    // rule above — a front-row tower tall enough for both gets one
    // sign, not two.
    const frontDone = new Set(signedT.slice(0, 10));
    for (const record of towerList) {
      if (record.whiteFront && record.sign && !frontDone.has(record)) addHighSign(record);
    }
  }
  // HOSPITAL: white building on the block east of spawn; the starting
  // spawn and the WASTED respawn are its entrance (GTA-style). Its box
  // goes in colliders for collision, but it is NOT in `towerList` —
  // a named sign must never overwrite the HOSPITAL sign.
  // Facade side material (cloned texture + per-building lit windows).
  const sideMat = (idx, rx, ry) => {
    const ft = faceTexs[idx].clone();
    ft.needsUpdate = true;
    ft.repeat.set(rx, ry);
    const et = nightWindowsTex(faceWins[idx], rand);
    et.repeat.set(rx, ry);
    const side = facadeMat(ft, et);
    glowMats.push(side);
    return side;
  };
  const cWhite = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const cRed = new THREE.MeshLambertMaterial({ color: 0xe63946 });
  const cGold = new THREE.MeshLambertMaterial({ color: 0xffb703 });
  const cDark = new THREE.MeshLambertMaterial({ color: 0x5a5a6a });
  {
    const hs = sideMat(2, 3, 2);
    const hp = new THREE.Mesh(unitBox, [hs, hs, roofMat, roofMat, hs, hs]);
    hp.scale.set(32, 14, 32);
    hp.position.set(26, 7, -26);
    hp.castShadow = true;
    hp.receiveShadow = true;
    root.add(hp);
    const hb = { minX: 10, maxX: 42, minZ: -42, maxZ: -10 };
    colliders.push(hb);
    placeSign(hb, 'HOSPITAL', 0, -26);
    const cv = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.9), cRed);
    cv.position.set(9.9, 8, -26);
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 2.6), cRed);
    ch.position.set(9.9, 8, -26);
    root.add(cv, ch);
  }
  // Landmarks: one recognizable point per district, compact meshes.
  // SUNSET TOWER — Office Tower GLB (30.2 x 30.9m, antenna tip 69.74m —
  // both measured from the model, not guessed). A glass box of the
  // same footprint stands in until the GLB loads. Roof levels measured
  // from the GLB: main slab at 59m, stepped crown top at 62m (a 12.2m
  // square), antenna spike to 69.74m. The helipad sits on the crown
  // top, south of the antenna spike (the slab ring is only 3.5m wide,
  // no pad fits there). GLB-local
  // coords map to world with a -4.35 z shift (the model's centre
  // offset), so local (0, 3.5) is world (26, 233.15).
  {
    const TH = HOUSE_SPECS['office-tower'].h;
    const CR = 62.5;
    const ts = sideMat(0, 2, 7);
    const hd = new THREE.Group();
    hd.name = 'placeholder-office-tower';
    hd.position.set(26, 0, 234);
    const twr = new THREE.Mesh(unitBox, [ts, ts, roofMat, roofMat, ts, ts]);
    twr.scale.set(30.2, TH, 30.9);
    twr.position.y = TH / 2;
    twr.castShadow = true;
    hd.add(twr);
    root.add(hd);
    // Helipad on the crown top, south-east of the centre antenna
    // spike: white rim ring, dark pad, white H marking. Offset east so
    // the centre antenna spike (local 0,0) does not pierce the pad.
    const pr = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), new THREE.MeshLambertMaterial({ color: 0xf2f0e8 }));
    pr.rotation.x = -Math.PI / 2;
    pr.position.set(28.8, CR + 0.12, 227.15);
    const pd = new THREE.Mesh(new THREE.CircleGeometry(2.9, 24), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }));
    pd.rotation.x = -Math.PI / 2;
    pd.position.set(28.8, CR + 0.14, 227.15);
    const hm = new THREE.MeshLambertMaterial({ color: 0xf2f0e8 });
    const hb1 = new THREE.BoxGeometry(0.5, 0.05, 3.4);
    const hc1 = new THREE.BoxGeometry(2.2, 0.05, 0.5);
    const h1 = new THREE.Mesh(hb1, hm);
    h1.position.set(27.7, CR + 0.17, 227.15);
    const h2 = new THREE.Mesh(hb1, hm);
    h2.position.set(29.9, CR + 0.17, 227.15);
    const h3 = new THREE.Mesh(hc1, hm);
    h3.position.set(28.8, CR + 0.17, 227.15);
    root.add(pr, pd, h1, h2, h3);
    // High sign on ALL FOUR faces, just under the main slab (59m) — the
    // tower's name, readable from any direction. The GLB carries a -4.35
    // z offset, so its centre is at world z=21.65, not 26: south face at
    // z=37.1, north at z=6.2, east/west faces at x=41.1/10.9. Each sign
    // sits 0.15m off its face, halo 0.1m behind the sign.
    const tm = signMaterialFor('SUNSET TOWER').clone();
    neonMats.push({ mat: tm, phase: rand() * Math.PI * 2 });
    const sg2 = new THREE.PlaneGeometry(12, 3);
    const sS = new THREE.Mesh(sg2, tm);
    sS.position.set(24.5, 56, 245.25);
    root.add(sS);
    const hS = new THREE.Mesh(haloPlane, haloMat);
    hS.scale.set(1, 1, 1);
    hS.position.set(24.5, 56, 245.15);
    root.add(hS);
    const sN = new THREE.Mesh(sg2, tm);
    sN.rotation.y = Math.PI;
    sN.position.set(24.5, 56, 214.05);
    root.add(sN);
    const hN = new THREE.Mesh(haloPlane, haloMat);
    hN.scale.set(1, 1, 1);
    hN.rotation.y = Math.PI;
    hN.position.set(24.5, 56, 214.15);
    root.add(hN);
    const sE = new THREE.Mesh(sg2, tm);
    sE.rotation.y = Math.PI / 2;
    sE.position.set(41.25, 56, 229.65);
    root.add(sE);
    const hE = new THREE.Mesh(haloPlane, haloMat);
    hE.scale.set(1, 1, 1);
    hE.rotation.y = Math.PI / 2;
    hE.position.set(41.15, 56, 229.65);
    root.add(hE);
    const sW = new THREE.Mesh(sg2, tm);
    sW.rotation.y = -Math.PI / 2;
    sW.position.set(10.75, 56, 229.65);
    root.add(sW);
    const hW = new THREE.Mesh(haloPlane, haloMat);
    hW.scale.set(1, 1, 1);
    hW.rotation.y = -Math.PI / 2;
    hW.position.set(10.85, 56, 229.65);
    root.add(hW);
    colliders.push({ minX: 11, maxX: 41, minZ: 219, maxZ: 249 });
    swapGlb('office-tower', hd, 26, 234, 0, [pr, pd, h1, h2, h3, sS, hS, sN, hN, sE, hE, sW, hW]);
  }
  // Casino — gold pyramid + big neon sign, north-east block.
  {
    const cb = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: 0xfff3d6 }));
    cb.scale.set(30, 4, 30);
    cb.position.set(182, 2, -182);
    root.add(cb);
    const py = new THREE.Mesh(new THREE.ConeGeometry(24, 18, 4), cGold);
    py.rotation.y = Math.PI / 4;
    py.position.set(182, 13, -182);
    root.add(py);
    const cm = signMaterialFor('SUNSET CASINO').clone();
    neonMats.push({ mat: cm, phase: rand() * Math.PI * 2 });
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), cm);
    cs.position.set(182, 6, -166.8);
    root.add(cs);
    const ch2 = new THREE.Mesh(haloPlane, haloMat);
    ch2.scale.set(1.4, 1.4, 1);
    ch2.position.set(182, 6, -166.75);
    root.add(ch2);
    colliders.push({ minX: 167, maxX: 197, minZ: -197, maxZ: -167 });
  }
  // Park — front-row block (7,9) is green space instead of a white
  // building: lawn, cross paths, trees, benches and a round fountain
  // at the centre. Only the fountain collides; trees and benches are
  // small props like the beach benches. Everything stays inside the
  // 40m block, clear of the roads on all four sides.
  {
    const px = 130, pz = 234;
    const lawn = new THREE.Mesh(unitBox, whiteFrontLawnMat);
    lawn.scale.set(40, 0.1, 40);
    lawn.position.set(px, 0.05, pz);
    root.add(lawn);
    const pathMat = new THREE.MeshLambertMaterial({ color: 0xe8e0d0 });
    const pathNS = new THREE.Mesh(unitBox, pathMat);
    pathNS.scale.set(3, 0.06, 40);
    pathNS.position.set(px, 0.08, pz);
    root.add(pathNS);
    const pathEW = new THREE.Mesh(unitBox, pathMat);
    pathEW.scale.set(40, 0.06, 3);
    pathEW.position.set(px, 0.08, pz);
    root.add(pathEW);
    // Trees: trunk + round canopy, four at the corners and four
    // flanking the north-south path, all clear of the paths.
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 2.2, 6);
    const trunkMtl = new THREE.MeshLambertMaterial({ color: 0x6a4a2a });
    const canopyGeo = new THREE.SphereGeometry(1.6, 8, 6);
    const treeSpots = [
      [-16, -16], [16, -16], [-16, 16], [16, 16],
      [-10, -6], [10, -6], [-10, 6], [10, 6],
    ];
    for (const [ox, oz] of treeSpots) {
      const trunk = new THREE.Mesh(trunkGeo, trunkMtl);
      trunk.position.set(px + ox, 1.2, pz + oz);
      const canopy = new THREE.Mesh(canopyGeo, shrubMtl);
      canopy.position.set(px + ox, 3.4, pz + oz);
      root.add(trunk, canopy);
    }
    // Benches face the fountain: seat + back + two legs, grouped so
    // one rotation aims the whole bench. Default faces +z (south).
    const pkSeatGeo = new THREE.BoxGeometry(1.8, 0.12, 0.5);
    const pkBackGeo = new THREE.BoxGeometry(1.8, 0.5, 0.1);
    const pkLegGeo = new THREE.BoxGeometry(0.12, 0.45, 0.45);
    const pkBenchMtl = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
    const benchDefs = [
      { ox: -8, oz: 3, rotY: Math.PI / 2 },
      { ox: 8, oz: -3, rotY: -Math.PI / 2 },
      { ox: -3, oz: -8, rotY: 0 },
      { ox: 3, oz: 8, rotY: Math.PI },
    ];
    for (const bd of benchDefs) {
      const grp = new THREE.Group();
      const st = new THREE.Mesh(pkSeatGeo, pkBenchMtl);
      st.position.set(0, 0.5, 0);
      const bk = new THREE.Mesh(pkBackGeo, pkBenchMtl);
      bk.position.set(0, 0.85, -0.25);
      const l1 = new THREE.Mesh(pkLegGeo, pkBenchMtl);
      l1.position.set(-0.7, 0.22, 0);
      const l2 = new THREE.Mesh(pkLegGeo, pkBenchMtl);
      l2.position.set(0.7, 0.22, 0);
      grp.add(st, bk, l1, l2);
      grp.position.set(px + bd.ox, 0.1, pz + bd.oz);
      grp.rotation.y = bd.rotY;
      root.add(grp);
    }
    // Shrubs dotted around the lawn, clear of paths and benches.
    const shrubSpots = [
      [-13, -13], [13, -13], [-13, 13], [13, 13],
      [-6, -13], [6, 13], [-13, 5], [13, -5],
    ];
    for (const [ox, oz] of shrubSpots) {
      const sh = new THREE.Mesh(shrubBall, shrubMtl);
      sh.position.set(px + ox, 0.9, pz + oz);
      root.add(sh);
    }
    // Round fountain at the centre: blue disc, stone rim ring and a
    // small centre jet column. The only collider in the park.
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 0.3, 20), whiteFrontPoolMat);
    pool.position.set(px, 0.25, pz);
    root.add(pool);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.25, 8, 24), cWhite);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(px, 0.3, pz);
    root.add(rim);
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.9, 8), cWhite);
    jet.position.set(px, 0.8, pz);
    root.add(jet);
    const jetTop = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), whiteFrontPoolMat);
    jetTop.position.set(px, 1.4, pz);
    root.add(jetTop);
    colliders.push({ minX: px - 2.5, maxX: px + 2.5, minZ: pz - 2.5, maxZ: pz + 2.5 });
  }
  // Ferris wheel — south beach, slow rotation, lit hub at night.
  // A-frame legs converge on the hub (feet 7m out, tops at the axle),
  // double rim + 8 spoke bars, a solid hub, and 8 detailed cabins that
  // hang from their own pivots — counter-rotated every frame in
  // update() so they stay upright instead of tumbling with the wheel.
  {
    const fm = cWhite;
    const fl = Math.hypot(7, 15);
    const ft2 = Math.atan2(7, 15);
    for (const s of [-1, 1]) {
      const lg = new THREE.Mesh(new THREE.BoxGeometry(0.8, fl, 3.2), fm);
      lg.position.set(150 + s * 3.5, 7.5, 288);
      lg.rotation.z = s * ft2;
      lg.castShadow = true;
      root.add(lg);
      const ft3 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 2.4), cDark);
      ft3.position.set(150 + s * 7, 0.25, 288);
      root.add(ft3);
    }
    const cb2 = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.5, 3.2), fm);
    cb2.position.set(150, 7.5, 288);
    root.add(cb2);
    const wh = new THREE.Group();
    wh.position.set(150, 15, 288);
    // Real depth: twin rims front/back (z = +/-1.2) joined by cross-bars
    // at the cabin hang points, so the wheel reads as a 3D structure
    // from any angle instead of a flat disc.
    const rm = new THREE.MeshBasicMaterial({ color: 0xffc828 });
    for (const rz of [-1.2, 1.2]) {
      const ro = new THREE.Mesh(new THREE.TorusGeometry(12, 0.45, 8, 36), rm);
      ro.position.z = rz;
      wh.add(ro);
      const ri = new THREE.Mesh(new THREE.TorusGeometry(9, 0.25, 6, 32), rm);
      ri.position.z = rz;
      wh.add(ri);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 8;
      for (const rz of [-1.2, 1.2]) {
        const sk = new THREE.Mesh(new THREE.BoxGeometry(24, 0.3, 0.3), cWhite);
        sk.rotation.z = a;
        sk.position.z = rz;
        wh.add(sk);
      }
      const ca = (i / 8) * Math.PI * 2;
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.4), cWhite);
      br.position.set(Math.cos(ca) * 12, Math.sin(ca) * 12, 0);
      wh.add(br);
    }
    const hd2 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.0, 16), cGold);
    hd2.rotation.x = Math.PI / 2;
    wh.add(hd2);
    for (const s of [-1, 1]) {
      const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12), cDark);
      cp.rotation.x = Math.PI / 2;
      cp.position.z = s * 1.6;
      wh.add(cp);
    }
    const gc = [0xff5a7a, 0x2ad0c4, 0xffc828, 0x2fd35e, 0xff7a3d, 0xff2d78, 0x2a7ad0, 0xe63946];
    const cg = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });
    const cps = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const pv = new THREE.Group();
      pv.position.set(Math.cos(a) * 12, Math.sin(a) * 12, 0);
      const hg2 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 0.15), cDark);
      hg2.position.y = -0.6;
      pv.add(hg2);
      const bm = new THREE.MeshLambertMaterial({ color: gc[i] });
      const bd = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 1.4), bm);
      bd.position.y = -1.85;
      bd.castShadow = true;
      pv.add(bd);
      const wn = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.5, 1.46), cg);
      wn.position.y = -1.65;
      pv.add(wn);
      const rf = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.6, 4), bm);
      rf.rotation.y = Math.PI / 4;
      rf.scale.set(1, 1, 0.8);
      rf.position.y = -0.9;
      pv.add(rf);
      wh.add(pv);
      cps.push(pv);
    }
    root.add(wh);
    const hm2 = new THREE.SpriteMaterial({ map: glowTex, color: 0xffc828, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const hb2 = new THREE.Sprite(hm2);
    hb2.scale.set(10, 10, 1);
    hb2.position.set(150, 15, 288);
    root.add(hb2);
    landmarks.wheel = wh;
    landmarks.hubMat = hm2;
    landmarks.cabinPivots = cps;
    colliders.push({ minX: 141, maxX: 159, minZ: 284, maxZ: 292 });
  }
  // Stadium — domed roof, south-west block. Radius 19: the block is 40m
  // wide, so the old 26m drum spilled 6m onto the road on all four sides
  // (and its collision box blocked the road). A bare drum + dome read as
  // a grain silo, so the drum gets doors, a window band, ribs, a cornice
  // and a big name sign, the dome gets seam rings + a crown + antenna,
  // and four floodlight masts stand at the diagonals.
  {
    const ax = -78, az = 234;
    // Bright white, not dull: pure white + a strong emissive lift so
    // the shaded side stays white instead of going grey-beige. Lambert
    // alone darkens the dome's north side to mud.
    const aw = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9a9a9a });
    const wl = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 10, 20), aw);
    wl.position.set(ax, 5, az);
    wl.castShadow = true;
    root.add(wl);
    const pl2 = new THREE.Mesh(new THREE.CylinderGeometry(19.6, 19.8, 0.6, 20), cDark);
    pl2.position.set(ax, 0.3, az);
    root.add(pl2);
    // Four door portals (N/E/S/W): dark inset + steps.
    const dm = new THREE.MeshLambertMaterial({ color: 0x1a2030 });
    for (let d = 0; d < 4; d++) {
      const a = (d * Math.PI) / 2;
      const dr = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.6, 0.4), dm);
      dr.position.set(ax + Math.sin(a) * 19.05, 1.8, az + Math.cos(a) * 19.05);
      dr.rotation.y = a;
      root.add(dr);
      const st2 = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 1.4), cWhite);
      st2.position.set(ax + Math.sin(a) * 20, 0.15, az + Math.cos(a) * 20);
      st2.rotation.y = a;
      root.add(st2);
    }
    // Window/vent band around the drum, just under the cornice.
    const bn = new THREE.Mesh(new THREE.CylinderGeometry(19.2, 19.2, 1.6, 20, 1, true), new THREE.MeshLambertMaterial({ color: 0x1a2a3a }));
    bn.position.set(ax, 8.2, az);
    root.add(bn);
    // Ribs around the drum (skipping the four door angles).
    const rg = new THREE.BoxGeometry(0.5, 9.6, 0.35);
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0) continue;
      const a = (i * Math.PI) / 8;
      const rb = new THREE.Mesh(rg, cWhite);
      rb.position.set(ax + Math.sin(a) * 19.3, 5.1, az + Math.cos(a) * 19.3);
      rb.rotation.y = a;
      root.add(rb);
    }
    // Cornice ring at the drum/dome joint.
    const co = new THREE.Mesh(new THREE.TorusGeometry(19.35, 0.35, 8, 40), cGold);
    co.rotation.x = Math.PI / 2;
    co.position.set(ax, 10, az);
    root.add(co);
    // Big name sign on the SOUTH face (toward the beach and the title
    // camera), so the name reads from the front instead of edge-on.
    const am = signMaterialFor('SUNSET ARENA').clone();
    neonMats.push({ mat: am, phase: rand() * Math.PI * 2 });
    const asn = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), am);
    asn.position.set(ax, 5.5, az + 19.7);
    root.add(asn);
    const ahl = new THREE.Mesh(haloPlane, haloMat);
    ahl.position.set(ax, 5.5, az + 19.6);
    root.add(ahl);
    const dm2 = new THREE.Mesh(new THREE.SphereGeometry(19, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), aw);
    dm2.position.set(ax, 10, az);
    dm2.castShadow = true;
    root.add(dm2);
    // Panel seam rings on the dome (radii from the hemisphere at each height).
    const sm2 = new THREE.MeshLambertMaterial({ color: 0xc8ccd2 });
    for (const [y, r] of [[16, 18.0], [20, 16.2], [24, 12.9]]) {
      const se = new THREE.Mesh(new THREE.TorusGeometry(r, 0.15, 6, 40), sm2);
      se.rotation.x = Math.PI / 2;
      se.position.set(ax, y, az);
      root.add(se);
    }
    // Crown/skylight disc straddling the apex + antenna.
    const cr2 = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 1, 16), cDark);
    cr2.position.set(ax, 28.8, az);
    root.add(cr2);
    const an = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), cDark);
    an.position.set(ax, 31.3, az);
    root.add(an);
    const at = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a3a }));
    at.position.set(ax, 33.4, az);
    root.add(at);
    // Four floodlight masts at the diagonals (inside the block).
    const lm2 = new THREE.MeshBasicMaterial({ color: 0xfff6cc });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const mx = ax + sx * 15, mz = az + sz * 15;
      const bs = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4), cDark);
      bs.position.set(mx, 0.4, mz);
      root.add(bs);
      const po = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 20, 8), cDark);
      po.position.set(mx, 10.8, mz);
      po.castShadow = true;
      root.add(po);
      const hd3 = new THREE.Group();
      hd3.position.set(mx, 20.8, mz);
      hd3.lookAt(ax, 8, az);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 0.3), cDark);
      hd3.add(fr);
      const lp = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), lm2);
      lp.position.z = 0.18;
      hd3.add(lp);
      root.add(hd3);
    }
    colliders.push({ minX: -98, maxX: -58, minZ: 214, maxZ: 254 });
  }
  // Clock tower — centre-west block, glass curtain wall like the other
  // towers, flat roof with a parapet rim, big clock face on all four
  // sides. The emissive windows use a local fixed-seed rng so the
  // shared seed-1 stream (palms, trees, traffic spawns) is untouched.
  {
    const ct = (() => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = '#f2f0e8';
      x.beginPath();
      x.arc(64, 64, 62, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = '#1a1030';
      x.lineWidth = 6;
      x.beginPath();
      x.arc(64, 64, 58, 0, Math.PI * 2);
      x.stroke();
      x.lineWidth = 8;
      x.beginPath();
      x.moveTo(64, 64);
      x.lineTo(64, 26);
      x.stroke();
      x.lineWidth = 6;
      x.beginPath();
      x.moveTo(64, 64);
      x.lineTo(92, 78);
      x.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const tf = faceTexs[0].clone();
    tf.needsUpdate = true;
    tf.repeat.set(1, 3);
    const te = nightWindowsTex(faceWins[0], makeRng(0xc10c));
    te.repeat.set(1, 3);
    const ts2 = facadeMat(tf, te);
    glowMats.push(ts2);
    const tw2 = new THREE.Mesh(unitBox, [ts2, ts2, roofMat, roofMat, ts2, ts2]);
    tw2.scale.set(8, 20, 8);
    tw2.position.set(-26, 10, -26);
    tw2.castShadow = true;
    tw2.receiveShadow = true;
    root.add(tw2);
    // Flat roof: parapet rim around the roof edge (light concrete),
    // same dressing as the other buildings — no pyramid, no spire.
    const rh2 = 0.6, rt2 = 0.3;
    const rn2 = new THREE.Mesh(unitBox, rimMtl);
    rn2.scale.set(8 + rt2 * 2, rh2, rt2);
    rn2.position.set(-26, 20 + rh2 / 2, -30);
    const rs2 = rn2.clone();
    rs2.position.z = -22;
    const rw2 = new THREE.Mesh(unitBox, rimMtl);
    rw2.scale.set(rt2, rh2, 8);
    rw2.position.set(-30, 20 + rh2 / 2, -26);
    const re2 = rw2.clone();
    re2.position.x = -22;
    root.add(rn2, rs2, rw2, re2);
    const fg = new THREE.PlaneGeometry(5, 5);
    const cm2 = new THREE.MeshBasicMaterial({ map: ct });
    for (const [fx, fz, ry] of [[-26, -21.9, 0], [-26, -30.1, Math.PI], [-21.9, -26, Math.PI / 2], [-30.1, -26, -Math.PI / 2]]) {
      const fc = new THREE.Mesh(fg, cm2);
      fc.position.set(fx, 16, fz);
      fc.rotation.y = ry;
      root.add(fc);
    }
    colliders.push({ minX: -30, maxX: -22, minZ: -30, maxZ: -22 });
  }
  // Yacht — a proper luxury motor yacht anchored off the south beach
  // next to the ferris wheel, close enough to read from the coastal
  // road. Curved hull (extruded outline, pointed bow, flat transom),
  // rounded superstructure with a glass band, flybridge with a raked
  // windscreen, radar mast, railings and a sagging shade sail over
  // the aft sundeck. Local axes: bow +X, beam Z, deck at y≈2.15.
  {
    const yt = new THREE.Group();
    yt.position.set(230, 0, 380);
    yt.rotation.y = 0.15;
    // A proper superyacht: 2x the old 26m hull — 52m long, readable
    // from the coastal road instead of a toy boat.
    yt.scale.setScalar(2);
    const gm = new THREE.MeshPhongMaterial({ color: 0x16283a, shininess: 90, specular: 0x6a8aa0 });
    const tk = new THREE.MeshLambertMaterial({ color: 0xd8b98a });
    const nv2 = new THREE.MeshLambertMaterial({ color: 0x1a5a9a });
    // Bright gelcoat white for hull + cabin + rails (the shared warm
    // cream reads grey on the shaded side of the large curved hull).
    const yw = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0 });
    // Hull outline, top view: pointed bow, wide midships, flat stern.
    const hs2 = new THREE.Shape();
    hs2.moveTo(-13, -2.4);
    hs2.bezierCurveTo(-8, -3.5, 2, -3.5, 13, 0);
    hs2.bezierCurveTo(2, 3.5, -8, 3.5, -13, 2.4);
    hs2.closePath();
    const hg3 = new THREE.ExtrudeGeometry(hs2, {
      depth: 2.0, bevelEnabled: true, bevelThickness: 0.35,
      bevelSize: 0.3, bevelSegments: 3, curveSegments: 12,
    });
    hg3.rotateX(-Math.PI / 2);
    const hl = new THREE.Mesh(hg3, yw);
    hl.position.y = -0.2;
    yt.add(hl);
    // Deck, slightly inset from the hull's top edge.
    const dg = new THREE.ShapeGeometry(hs2, 12);
    dg.rotateX(-Math.PI / 2);
    const dk = new THREE.Mesh(dg, tk);
    dk.scale.set(0.96, 1, 0.96);
    dk.position.y = 2.16;
    yt.add(dk);
    // Outline points offset outward by a fixed distance (edge normals),
    // for the waterline stripe, cap rail and deck railing.
    const ol = hs2.getPoints(32);
    const offOut = (dist, y) => {
      const n = ol.length;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const prev = ol[(i - 1 + n) % n], cur = ol[i], next = ol[(i + 1) % n];
        let nx = 0, ny = 0;
        for (const [ax, ay, bx, by] of [[prev.x, prev.y, cur.x, cur.y], [cur.x, cur.y, next.x, next.y]]) {
          const ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey) || 1;
          nx += ey / len; ny -= ex / len;
        }
        const nl = Math.hypot(nx, ny) || 1;
        pts.push(new THREE.Vector3(cur.x + (nx / nl) * dist, y, -(cur.y + (ny / nl) * dist)));
      }
      return pts;
    };
    const tube = (pts, radius, mat) => {
      const curve = new THREE.CatmullRomCurve3(pts, true);
      const tb = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, radius, 6, true), mat);
      yt.add(tb);
      return tb;
    };
    tube(offOut(0.38, 0.15), 0.13, nv2);
    tube(offOut(0.12, 2.28), 0.1, yw);
    tube(offOut(0.12, 3.02), 0.05, yw);
    const sg3 = new THREE.CylinderGeometry(0.04, 0.04, 0.85, 5);
    const rp = offOut(0.12, 0);
    for (let i = 0; i < rp.length; i += 3) {
      const st3 = new THREE.Mesh(sg3, yw);
      st3.position.set(rp[i].x, 2.6, rp[i].z);
      yt.add(st3);
    }
    // Main superstructure: tapered elliptical cabin + glass band.
    const cb3 = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 1.7, 24), yw);
    cb3.scale.set(1.7, 1, 0.95);
    cb3.position.set(-1.5, 3.05, 0);
    yt.add(cb3);
    const cg2 = new THREE.Mesh(new THREE.CylinderGeometry(2.72, 2.92, 0.7, 24, 1, true), gm);
    cg2.scale.set(1.7, 1, 0.95);
    cg2.position.set(-1.5, 3.25, 0);
    yt.add(cg2);
    // Flybridge: smaller tapered cabin + raked wraparound windscreen.
    const fl2 = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.3, 1.2, 24), yw);
    fl2.scale.set(1.5, 1, 0.9);
    fl2.position.set(-2.5, 4.5, 0);
    yt.add(fl2);
    const sh3 = new THREE.Mesh(new THREE.CylinderGeometry(1.98, 2.38, 0.75, 16, 1, true, Math.PI / 2 - 0.75, 1.5), gm);
    sh3.scale.set(1.5, 1, 0.9);
    sh3.position.set(-2.5, 4.72, 0);
    sh3.rotation.z = 0.15;
    yt.add(sh3);
    // Radar arch over the flybridge + mast with radar bar and light.
    const ar = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.11, 6, 20, Math.PI), yw);
    ar.position.set(-2.5, 5.1, 0);
    ar.rotation.y = Math.PI / 2;
    yt.add(ar);
    const ms = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.2, 6), yw);
    ms.position.set(-3.5, 6.7, 0);
    yt.add(ms);
    const rd = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.3), yw);
    rd.position.set(-3.5, 7.4, 0);
    rd.rotation.y = 0.5;
    yt.add(rd);
    const ml = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff6cc }));
    ml.position.set(-3.5, 8.35, 0);
    yt.add(ml);
    // Shade sail: triangular sunshade over the aft sundeck, sagging
    // between the masthead and two aft poles.
    const spg = new THREE.CylinderGeometry(0.05, 0.05, 1.3, 5);
    for (const sz of [-1, 1]) {
      const po2 = new THREE.Mesh(spg, yw);
      po2.position.set(-11.5, 2.8, sz * 2.7);
      yt.add(po2);
    }
    const sg4 = (() => {
      const A = new THREE.Vector3(-3.5, 7.6, 0), B = new THREE.Vector3(-11.5, 3.4, -2.7), C = new THREE.Vector3(-11.5, 3.4, 2.7);
      const sg5 = 5, ps = [], ix = [], rs3 = [];
      for (let i = 0; i <= sg5; i++) {
        rs3.push(ps.length / 3);
        for (let j = 0; j <= sg5 - i; j++) {
          const u = i / sg5, v = j / sg5, w = 1 - u - v;
          const sg6 = 0.7 * 27 * u * v * w;
          ps.push(
            A.x + u * (B.x - A.x) + v * (C.x - A.x),
            A.y + u * (B.y - A.y) + v * (C.y - A.y) - sg6,
            A.z + u * (B.z - A.z) + v * (C.z - A.z),
          );
        }
      }
      for (let i = 0; i < sg5; i++) {
        for (let j = 0; j < sg5 - i; j++) {
          const a0 = rs3[i] + j, b0 = rs3[i + 1] + j;
          ix.push(a0, b0, a0 + 1);
          if (j < sg5 - i - 1) ix.push(a0 + 1, b0, b0 + 1);
        }
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3));
      gg.setIndex(ix);
      gg.computeVertexNormals();
      return gg;
    })();
    const sl = new THREE.Mesh(sg4, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    yt.add(sl);
    // Swim platform at the stern + bow windlass and anchor.
    const pf = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.22, 16), tk);
    pf.position.set(-13.8, 0.4, 0);
    yt.add(pf);
    const wl2 = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.35, 8), cDark);
    wl2.position.set(10.5, 2.35, 0);
    yt.add(wl2);
    const an2 = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 6, 12), cDark);
    an2.position.set(13.45, 1.1, 0);
    an2.rotation.y = Math.PI / 2;
    yt.add(an2);
    // Navigation lights: red port (-Z), green starboard (+Z), on the
    // cabin sides just proud of the glass band.
    const nr = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a3a }));
    nr.position.set(2, 3.0, -2.8);
    yt.add(nr);
    const ng = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0x2aff66 }));
    ng.position.set(2, 3.0, 2.8);
    yt.add(ng);
    // Big name board on the cabin's beach-facing side: 12x3m, readable
    // from the coastal road (the old yacht had no name at all).
    const ym = signMaterialFor('SOLSTICE').clone();
    neonMats.push({ mat: ym, phase: rand() * Math.PI * 2 });
    const ys = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), ym);
    ys.position.set(-1.5, 3.5, -3.15);
    ys.rotation.y = Math.PI;
    yt.add(ys);
    root.add(yt);
  }
  // City-kit accents (Vinish GLBs, added when loaded — the procedural
  // roads and streetlights stay; these are showcase pieces, not
  // replacements). Street lights + a traffic signal dress the (52,52)
  // intersection. The road GLB belongs on the streets (see the merged
  // GLB roads below), not on the sand.
  {
    const addProp = (name, x, z, rotY, y = 0) => {
      loadHouse(name).then((glb) => {
        glb.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        const wrap = new THREE.Group();
        wrap.name = `glb-${name}`;
        wrap.position.set(x, y, z);
        wrap.rotation.y = rotY;
        wrap.add(glb);
        root.add(wrap);
      }).catch(() => {});
    };
    // Street lights: pole at the corner, arm reaching over the road
    // (the GLB arm extends +Z, 2.74m).
    addProp('street-light', 45.2, 45.2, Math.PI / 2);
    addProp('street-light', 45.2, 58.8, Math.PI / 2);
    addProp('street-light', 58.8, 58.8, -Math.PI / 2);
    // Traffic signal: mast arm extends -X, so from the north-east
    // corner with a 90-degree turn it reaches over the road.
    addProp('traffic-signal', 58.8, 45.2, Math.PI / 2);
  }
  // GLB roads: the Vinish Road Straight tile (16x16m) laid along the
  // coastal ring (the +/-312 roads) and the two central avenues (x=0,
  // z=0), with Road Crossroads tiles at the 9 intersections where they
  // meet. Merged per material into one mesh per material (9 draw calls
  // for ~220 tiles — never ~220 clones). Straight tiles skip any
  // position within 8m of an intersection centre so they never overlap
  // the crossroads tile; the procedural strip shows through the 24m
  // gaps at road ends. The tile's biggest primitive has no UVs, so the
  // merge fills zeros where a part lacks them.
  {
    const TS = 16;
    const XINGS = [];
    for (const cx of [-312, 0, 312]) for (const cz of [-312, 0, 312]) XINGS.push({ x: cx, z: cz });
    const nearX = (x, z) => XINGS.some((c) => Math.abs(x - c.x) < 8 && Math.abs(z - c.z) < 8);
    // Roads run every 52m (-312 + i*52). A straight tile must skip
    // EVERY road crossing, not just the 9 GLB-road ones: the tile's
    // sidewalk (y=0.15) spans the full 16m width, so a tile sitting
    // on a non-GLB cross street paves over that road and cars drive
    // diagonally across the sidewalk to get through.
    const RDS = [];
    for (let i = 0; i <= 12; i++) RDS.push(-312 + i * 52);
    const nearRd = (p) => RDS.some((r) => Math.abs(p - r) < 8);
    const tiles = [];
    for (const at of [-312, 0, 312]) {
      for (let p = -288; p <= 288; p += TS) {
        if (!nearX(at, p) && !nearRd(p)) tiles.push({ x: at, z: p, rotY: 0 });
      }
      for (let p = -288; p <= 288; p += TS) {
        if (!nearX(p, at) && !nearRd(p)) tiles.push({ x: p, z: at, rotY: Math.PI / 2 });
      }
    }
    // GLB road tiles DISABLED: the Vinish road models sit 0.15-0.20m
    // above the ground plane (sidewalk at y=0.20 vs player/cars at
    // y=0), so peds and cars sink knee-deep into them, and their
    // sidewalks pave over every non-GLB cross street. The procedural
    // road strips (12m wide, y=0.03, lane markings in texture) are
    // consistent at all 169 intersections. The merge code stays for
    // reference; only the two load calls are disabled.
    const merge = (glb, centres) => {
      glb.updateMatrixWorld(true);
      const byM = new Map();
      glb.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        if (!byM.has(o.material)) byM.set(o.material, []);
        byM.get(o.material).push(g);
      });
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), T = new THREE.Vector3();
      const UP = new THREE.Vector3(0, 1, 0);
      const V = new THREE.Vector3(), NM = new THREE.Matrix3();
      for (const [mat, geos] of byM) {
        let VC = 0, IC = 0;
        for (const g of geos) { VC += g.attributes.position.count; IC += g.index.count; }
        VC *= centres.length;
        IC *= centres.length;
        const P = new Float32Array(VC * 3), N = new Float32Array(VC * 3), U = new Float32Array(VC * 2), I = new Uint32Array(IC);
        let VO = 0, IO = 0;
        for (const tl of centres) {
          Q.setFromAxisAngle(UP, tl.rotY || 0);
          T.set(tl.x, 0.05, tl.z);
          M.compose(T, Q, S);
          NM.getNormalMatrix(M);
          for (const g of geos) {
            const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
            for (let i = 0; i < p.count; i++) {
              V.fromBufferAttribute(p, i).applyMatrix4(M);
              P[(VO + i) * 3] = V.x; P[(VO + i) * 3 + 1] = V.y; P[(VO + i) * 3 + 2] = V.z;
              V.fromBufferAttribute(n, i).applyMatrix3(NM).normalize();
              N[(VO + i) * 3] = V.x; N[(VO + i) * 3 + 1] = V.y; N[(VO + i) * 3 + 2] = V.z;
              if (u) { U[(VO + i) * 2] = u.getX(i); U[(VO + i) * 2 + 1] = u.getY(i); }
            }
            for (let i = 0; i < g.index.count; i++) I[IO + i] = g.index.getX(i) + VO;
            VO += p.count;
            IO += g.index.count;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
        geo.setIndex(new THREE.BufferAttribute(I, 1));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        root.add(mesh);
      }
    };
    // GLB road tiles disabled (see note above): procedural strips only.
    // loadHouse('road-straight').then((glb) => merge(glb, tiles)).catch(() => {});
    // loadHouse('road-crossroads').then((glb) => merge(glb, XINGS)).catch(() => {});
  }
  // Lifeguard tower on the south sand, west of the ferris wheel: braced
  // legs, a deck with railings, a white cabin with a glass window band,
  // a ladder, and a red pyramid roof.
  {
    const lg2 = new THREE.BoxGeometry(0.25, 3, 0.25);
    for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
      const l2 = new THREE.Mesh(lg2, cWhite);
      l2.position.set(120 + lx, 1.5, 284 + lz);
      root.add(l2);
    }
    // X cross-braces between the legs on all four faces.
    const bg = new THREE.BoxGeometry(0.15, 4.0, 0.15);
    for (const [bx, bz, axis] of [[0, -1.4, 'z'], [0, 1.4, 'z'], [-1.4, 0, 'x'], [1.4, 0, 'x']]) {
      for (const tilt of [-0.75, 0.75]) {
        const br2 = new THREE.Mesh(bg, cRed);
        br2.position.set(120 + bx, 1.5, 284 + bz);
        if (axis === 'z') br2.rotation.z = tilt;
        else br2.rotation.x = tilt;
        root.add(br2);
      }
    }
    // Deck platform under the cabin, with railing posts + top rails.
    const dk2 = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.2, 4.6), cDark);
    dk2.position.set(120, 3.1, 284);
    root.add(dk2);
    const pg = new THREE.BoxGeometry(0.08, 0.9, 0.08);
    for (let i = 0; i <= 4; i++) {
      const t = -2.2 + i * 1.1;
      for (const [px, pz] of [[t, -2.2], [t, 2.2]]) {
        const po3 = new THREE.Mesh(pg, cRed);
        po3.position.set(120 + px, 3.65, 284 + pz);
        root.add(po3);
      }
      if (i > 0 && i < 4) {
        for (const [px, pz] of [[-2.2, t], [2.2, t]]) {
          const po3 = new THREE.Mesh(pg, cRed);
          po3.position.set(120 + px, 3.65, 284 + pz);
          root.add(po3);
        }
      }
    }
    for (const [rx, rz, w, d] of [[0, -2.2, 4.6, 0.08], [0, 2.2, 4.6, 0.08], [-2.2, 0, 0.08, 4.6], [2.2, 0, 0.08, 4.6]]) {
      const rl = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), cRed);
      rl.position.set(120 + rx, 4.1, 284 + rz);
      root.add(rl);
    }
    const cb4 = new THREE.Mesh(unitBox, cWhite);
    cb4.scale.set(3.4, 2.4, 3.4);
    cb4.position.set(120, 4.2, 284);
    cb4.castShadow = true;
    root.add(cb4);
    // Glass window band around the cabin (south face split around the door).
    const tg = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });
    const wn2 = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.9, 0.06), tg);
    wn2.position.set(120, 4.8, 284 - 1.73);
    root.add(wn2);
    for (const s of [-1, 1]) {
      const ws = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.06), tg);
      ws.position.set(120 + s * 1.2, 4.8, 284 + 1.73);
      root.add(ws);
      const wsd = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 3.5), tg);
      wsd.position.set(120 + s * 1.73, 4.8, 284);
      root.add(wsd);
    }
    const rf2 = new THREE.Mesh(pyrGeo, cRed);
    rf2.scale.set(3.4 * 0.7071, 1.6, 3.4 * 0.7071);
    rf2.position.set(120, 6.2, 284);
    root.add(rf2);
    const dr2 = new THREE.Mesh(doorBox, cRed);
    dr2.position.set(120, 4.05, 284 + 1.76);
    root.add(dr2);
    // Ladder from the sand up to the deck, south face.
    const lrg = new THREE.BoxGeometry(0.08, 3.2, 0.08);
    for (const lx of [-0.35, 0.35]) {
      const lr = new THREE.Mesh(lrg, cDark);
      lr.position.set(120 + lx, 1.6, 284 + 2.35);
      root.add(lr);
    }
    const rg2 = new THREE.BoxGeometry(0.78, 0.08, 0.08);
    for (let i = 0; i < 6; i++) {
      const rn3 = new THREE.Mesh(rg2, cDark);
      rn3.position.set(120, 0.4 + i * 0.5, 284 + 2.35);
      root.add(rn3);
    }
    colliders.push({ minX: 118.3, maxX: 121.7, minZ: 334.3, maxZ: 337.7 });
  }
  // Merges part geometries (each paired with a matrix) into a single
  // geometry, so the balcony slab + railing is one mesh instead of two.
  // (Hoisted: the balcony geometry above uses it before this line.)
  function mergeParts(parts) {
    let vc = 0, ic = 0;
    for (const [g] of parts) { vc += g.attributes.position.count; ic += g.index.count; }
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let vo = 0, io = 0;
    for (const [g, m] of parts) {
      nm.getNormalMatrix(m);
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
        v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
        nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
        uv[(vo + i) * 2] = u.getX(i); uv[(vo + i) * 2 + 1] = u.getY(i);
      }
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      vo += p.count; io += g.index.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }
  // Street-tree trunk bark.
  const barkMtl = new THREE.MeshLambertMaterial({ color: 0x8a6540 });
  // Clear of roads and buildings (with a 1m margin): beach palms use it
  // too, so none lands inside a landmark box (lighthouse, ferris wheel).
  const isClear = (x, z) => {
    for (let i = 0; i <= GRID_W; i += 1) {
      if (Math.abs(x - roadX(i)) < 8 && z >= NORTH && z <= HALF) return false;
    }
    for (let j = 0; j <= GRID_H; j += 1) {
      if (Math.abs(z - roadZ(j)) < 8 && x >= -HALF && x <= HALF) return false;
    }
    for (const box of colliders) {
      if (x > box.minX - 1 && x < box.maxX + 1 && z > box.minZ - 1 && z < box.maxZ + 1) return false;
    }
    return true;
  };
  const treeList = [];
  // Beach palms are the Vinish "Coconut Palm" GLB (CC BY 4.0): the loop
  // below only records spots, then one cached load clones the model per
  // palm — clones share the 6 materials, so ~500 palms cost one
  // download and one material set. Palms grow on the beach only, never
  // in the city.
  const palms = [];
  const plant = (x, z, scale) => {
    if (!isClear(x, z)) return;
    palms.push({ x, z, scale, rotY: rand() * Math.PI * 2 });
    treeList.push({ x, z });
  };
  // Beach palms on all four shores: one row per side (12–18m spacing)
  // so the beach reads lined, not scattered, plus a sparse second row
  // (15%) for depth. The GLB is ~9.3m tall, so the scale range is
  // 0.8–1.0. Was 6–10m + 30% (~350 palms, ~2.4M triangles) — the user
  // said there are too many, so the row is roughly halved (~190 palms,
  // ~1.3M triangles); the beach still reads lined from street level.
  for (let s = -HALF + 8; s < HALF; s += intBetween(rand, 12, 18)) {
    plant(s, CITY_EDGE + 6 + rand() * 6, 0.8 + rand() * 0.2);
    if (rand() < 0.15) plant(s + 5, SHORELINE - 8 - rand() * 8, 0.8 + rand() * 0.2);
    plant(s, -CITY_EDGE - 6 - rand() * 6, 0.8 + rand() * 0.2);
    if (rand() < 0.15) plant(s + 5, -SHORELINE + 8 + rand() * 8, 0.8 + rand() * 0.2);
    plant(CITY_EDGE + 6 + rand() * 6, s, 0.8 + rand() * 0.2);
    if (rand() < 0.15) plant(SHORELINE - 8 - rand() * 8, s + 5, 0.8 + rand() * 0.2);
    plant(-CITY_EDGE - 6 - rand() * 6, s, 0.8 + rand() * 0.2);
    if (rand() < 0.15) plant(-SHORELINE + 8 + rand() * 8, s + 5, 0.8 + rand() * 0.2);
  }
  // One InstancedMesh per shore per palm part (6 parts x 4 shores = 24
  // draw calls for ~190 palms, instead of ~1,100): clones share the
  // materials but not the draw calls. Per-shore meshes keep frustum
  // culling useful — one island-wide instance cloud would draw every
  // palm from every angle.
  loadGLB('assets/models/coconut-palm.glb').then((g) => {
    g.scene.updateMatrixWorld(true);
    const parts = [];
    g.scene.traverse((o) => {
      if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, local: o.matrixWorld.clone() });
    });
    const shores = [[], [], [], []];
    for (const spot of palms) {
      const side = Math.abs(spot.x) > Math.abs(spot.z) ? (spot.x > 0 ? 2 : 3) : (spot.z > 0 ? 1 : 0);
      shores[side].push(spot);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const spots of shores) {
      if (!spots.length) continue;
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geo, part.mat, spots.length);
        inst.name = 'glb-coconut-palm';
        inst.castShadow = true;
        spots.forEach((spot, i) => {
          q.setFromAxisAngle(up, spot.rotY);
          s.setScalar(spot.scale);
          t.set(spot.x, 0, spot.z);
          m.compose(t, q, s).multiply(part.local);
          inst.setMatrixAt(i, m);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        root.add(inst);
      }
    }
  }).catch(() => {});
  // Street trees: small round-canopy trees along the city sidewalks —
  // palms grow on the beach and the coastal road only, never downtown.
  // Same roadside placement as the old street palms (never on a road
  // rect in either orientation, never inside a building).
  const trunkCyl = new THREE.CylinderGeometry(0.14, 0.2, 1.8, 5);
  const can1 = new THREE.SphereGeometry(1.4, 8, 6);
  const can2 = new THREE.SphereGeometry(1.0, 8, 6);
  const leafMtl = new THREE.MeshLambertMaterial({ color: 0x3da86b });
  const streetTrees = [];
  const plantTree = (x, z, scale) => {
    if (!isClear(x, z)) return;
    streetTrees.push({ x, z, scale, rotY: rand() * Math.PI * 2 });
    treeList.push({ x, z });
  };
  for (let i = 0; i < 70; i += 1) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = roadX(intBetween(rand, 0, GRID_W)) + (rand() < 0.5 ? -1 : 1) * (8 + rand() * 3);
      const z = NORTH + rand() * (HALF - NORTH);
      if (!isClear(x, z)) continue;
      plantTree(x, z, 0.8 + rand() * 0.4);
      break;
    }
  }
  // Instanced street trees: 3 draw calls for ~70 trees instead of ~210.
  // The per-tree offsets match the old Group children exactly.
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const off2 = new THREE.Matrix4();
    const treePart = (geo, mat, ox, oy, oz) => {
      const inst = new THREE.InstancedMesh(geo, mat, streetTrees.length);
      inst.name = 'street-tree';
      streetTrees.forEach((spot, i) => {
        q.setFromAxisAngle(up, spot.rotY);
        s.setScalar(spot.scale);
        t.set(spot.x, 0, spot.z);
        off2.makeTranslation(ox, oy, oz);
        m.compose(t, q, s).multiply(off2);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      root.add(inst);
    };
    treePart(trunkCyl, barkMtl, 0, 0.9, 0);
    treePart(can1, leafMtl, 0, 2.6, 0);
    treePart(can2, leafMtl, 0.7, 3.2, 0.3);
  }
  // Streetlights: a pole + a curved arm reaching toward the intersection
  // + a lamp head at the arm's end, plus a glow sprite + ground pool.
  // 4 real SpotLights ride the nearest lamp heads around the player (the
  // only real lights besides the headlight).
  const poles = [];
  const poleCyl = new THREE.CylinderGeometry(0.12, 0.16, 7, 5);
  const poleMtl = new THREE.MeshLambertMaterial({ color: 0x70707c });
  const armBox = new THREE.BoxGeometry(0.1, 0.1, 2.2);
  const lampBox = new THREE.BoxGeometry(0.5, 0.16, 0.28);
  const lampMtl = new THREE.MeshBasicMaterial({ color: 0x555560 });
  const glowMtl = new THREE.SpriteMaterial({ map: glowTex, color: 0xffe6b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const poolDisc = new THREE.CircleGeometry(4.5, 20);
  poolDisc.rotateX(-Math.PI / 2);
  const poolMtl = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffe6b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  // Instanced poles/arms/lamps/pools: 4 draw calls instead of ~200.
  // Glow sprites stay individual (sprites cannot instance). The lamp
  // head hangs at the arm's far end, over the road.
  const lights = [];
  for (let i = 0; i <= GRID_W; i += 2) {
    for (let j = 0; j <= GRID_H; j += 2) {
      const px = roadX(i) + 6.8, pz = roadZ(j) + 6.8;
      const hx = px - 1.35, hz = pz - 1.35;
      lights.push({ px, pz, hx, hz });
      poles.push({ x: hx, z: hz });
    }
  }
  for (const { hx, hz } of lights) {
    const glow = new THREE.Sprite(glowMtl);
    glow.scale.set(7, 7, 1);
    glow.position.set(hx, 7, hz);
    root.add(glow);
  }
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const lightPart = (geo, mat, at) => {
      const inst = new THREE.InstancedMesh(geo, mat, lights.length);
      inst.name = 'streetlight';
      lights.forEach((spot, i) => {
        const [x, y, z, rotY] = at(spot);
        q.setFromAxisAngle(up, rotY);
        t.set(x, y, z);
        m.compose(t, q, s);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      root.add(inst);
    };
    lightPart(poleCyl, poleMtl, (p) => [p.px, 3.5, p.pz, 0]);
    lightPart(armBox, poleMtl, (p) => [p.px - 0.64, 7, p.pz - 0.64, Math.PI / 4]);
    lightPart(lampBox, lampMtl, (p) => [p.hx, 6.95, p.hz, 0]);
    lightPart(poolDisc, poolMtl, (p) => [p.hx, 0.05, p.hz, 0]);
  }
  const spots = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.SpotLight(0xffe6b0, 0, 34, 0.8, 0.7);
    s.position.set(0, 8.5, 0);
    scene.add(s);
    scene.add(s.target);
    spots.push(s);
  }
  let timer = 0;
  // Per-slot streetlight state: the assigned pole index (-1 = none),
  // the pending pole while fading out, the fade multiplier (0 = dark),
  // and the phase (-1 fading out, 0 steady, 1 fading in). A light never
  // slides between poles: it fades out, teleports, and fades back in.
  const slotPole = [-1, -1, -1, -1];
  const slotNext = [-1, -1, -1, -1];
  const slotFade = [0, 0, 0, 0];
  const slotPhase = [0, 0, 0, 0];
  function closestPole(pos, taken) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < poles.length; i++) {
      if (taken.has(i)) continue;
      const d = (poles[i].x - pos.x) ** 2 + (poles[i].z - pos.z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }
  // Beach dressing: colourful umbrellas scattered on the south sand +
  // benches along the south shore, facing the sea. No collision — they
  // are small props on open sand, like the palms.
  const umPole = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5);
  const umTop = new THREE.ConeGeometry(1.6, 0.7, 8);
  const umMtls = [0xff5aa8, 0x2ad0c4, 0xffc828, 0xff7a3d, 0x2a7ad0].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  for (let i = 0; i < 24; i += 1) {
    const x = -HALF + 20 + rand() * (HALF * 2 - 40);
    const z = CITY_EDGE + 10 + rand() * 20;
    if (Math.hypot(x - 150, z - 288) < 18) continue;
    if (Math.hypot(x - 120, z - 284) < 6) continue;
    if (x > 170 && x < 206 && z > 324 && z < 344) continue;
    const up = new THREE.Mesh(umPole, poleMtl);
    up.position.set(x, 1.1, z);
    const uc = new THREE.Mesh(umTop, umMtls[i % umMtls.length]);
    uc.position.set(x, 2.4, z);
    root.add(up, uc);
  }
  const seatBox = new THREE.BoxGeometry(1.8, 0.12, 0.5);
  const backBox = new THREE.BoxGeometry(1.8, 0.5, 0.1);
  const legBox = new THREE.BoxGeometry(0.12, 0.45, 0.45);
  const benchMtl = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
  for (let i = 0; i < 10; i += 1) {
    const x = -HALF + 30 + (i * (HALF * 2 - 60)) / 9 + rand() * 4;
    const z = CITY_EDGE + 2;
    if (Math.hypot(x - 150, z - 288) < 16) continue;
    const st4 = new THREE.Mesh(seatBox, benchMtl);
    st4.position.set(x, 0.5, z);
    const bk = new THREE.Mesh(backBox, benchMtl);
    bk.position.set(x, 0.85, z - 0.25);
    const ll = new THREE.Mesh(legBox, benchMtl);
    ll.position.set(x - 0.7, 0.22, z);
    const lr2 = new THREE.Mesh(legBox, benchMtl);
    lr2.position.set(x + 0.7, 0.22, z);
    root.add(st4, bk, ll, lr2);
  }
  const bbMat = new THREE.MeshBasicMaterial({ map: textures.billboard });
  const bbBack = new THREE.MeshLambertMaterial({ color: 0x241a2a });
  for (const bx of [-52, 52]) {
    const bd2 = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 0.4), [bbBack, bbBack, bbBack, bbBack, bbMat, bbBack]);
    bd2.position.set(bx, 10, 330);
    bd2.rotation.y = Math.PI;
    root.add(bd2);
    const po4 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), bbBack);
    po4.position.set(bx, 3.5, 330);
    root.add(po4);
  }
  const sun = new THREE.DirectionalLight(0xfff2d0, 3.0);
  sun.position.set(-120, 70, 200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  // A 200m shadow box that follows the player (updateSunFocus, below):
  // the old 760m box re-rendered the whole island into the shadow map
  // every frame, and the 300m box still covered most of downtown. 200m
  // keeps shadows where the player can see them; fog hides the edge.
  // The title orbit widens it back to 380 (full island).
  const SUN_VEC = new THREE.Vector3(-120, 70, 200).normalize();
  let halfBox = 100;
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1000;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 1;
  scene.add(sun);
  scene.add(sun.target);
  const hemiLight = new THREE.HemisphereLight(0xcfe8ff, 0x9a8a76, 1.7);
  scene.add(hemiLight);
  // Freeze static matrices: the city group holds ~4000 objects whose
  // transforms never change. Skipping their per-frame matrix recompute
  // frees CPU for peds and traffic. Only the animated objects keep
  // auto-update: lighthouse beam pivot, ferris wheel, cabin pivots.
  // (Sun, spotlights, peds, cars live in the scene, not this group.)
  // Compute matrices FIRST, then freeze — freezing first leaves every
  // object with an identity matrix (all geometry at the origin).
  root.updateMatrixWorld(true);
  const live = new Set([landmarks.beam, landmarks.wheel, ...(landmarks.cabinPivots || [])]);
  root.traverse((o) => { if (!live.has(o)) o.matrixAutoUpdate = false; });
  scene.add(root);
  return {
    buildingBoxes: colliders,
    trees: treeList,
    sunLight: sun,
    buildingMaterials: glowMats,
    signMaterials: neonMats,
    signs: signList,
    waterDepthAt,
    shoreOutward,
    bounds: { minX: -SEA_FAR + 100, maxX: SEA_FAR - 100, minZ: -SEA_FAR + 100, maxZ: SEA_FAR - 100 },
    resolveCircle(position, radius) {
      pushOutOfBoxes(position, radius, colliders);
      position.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, position.x));
      position.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, position.z));
    },
    // The shadow camera follows (x, z) with a +/-half box: a 300m box
    // skips distant casters in the shadow pass and resolves ~2.5x
    // finer than the old 760m box at the same 2048 map. The focus snaps
    // to the shadow-texel grid so shadows do not shimmer while moving.
    updateSunFocus(x, z, half) {
      if (half !== halfBox) {
        halfBox = half;
        const c = sun.shadow.camera;
        c.left = -half;
        c.right = half;
        c.top = half;
        c.bottom = -half;
        c.updateProjectionMatrix();
      }
      const texel = (half * 2) / sun.shadow.mapSize.x;
      const fx = Math.round(x / texel) * texel;
      const fz = Math.round(z / texel) * texel;
      sun.target.position.set(fx, 0, fz);
      sun.target.updateMatrixWorld();
      sun.position.set(fx + SUN_VEC.x * 250, SUN_VEC.y * 250, fz + SUN_VEC.z * 250);
    },
    update(dt) {
      nightTime += dt;
      if (landmarks.beam) {
        landmarks.beam.rotation.y += dt * 0.8;
        landmarks.beamMat.opacity = nightAmt * 0.35;
      }
      if (landmarks.wheel) {
        landmarks.wheel.rotation.z += dt * 0.08;
        landmarks.hubMat.opacity = nightAmt * 0.6;
        // Cabins hang from their own pivots: counter-rotate each one so
        // it stays upright while the wheel turns under it.
        if (landmarks.cabinPivots) {
          for (const p of landmarks.cabinPivots) p.rotation.z = -landmarks.wheel.rotation.z;
        }
      }
    },
    // The 4 real street SpotLights sit on the nearest poles to the player
    // (re-picked twice a second). A slot keeps its pole until the pole is
    // far (>40m) and another pole is clearly nearer (>10m), so a player
    // hovering between two poles does not flip the light back and forth.
    updateStreetlights(dt, pos, f) {
      timer -= dt;
      if (timer <= 0) {
        timer = 0.5;
        const taken = new Set(slotPole.filter((i) => i >= 0));
        for (let i = 0; i < 4; i++) if (slotPhase[i] < 0 && slotNext[i] >= 0) taken.add(slotNext[i]);
        for (let i = 0; i < 4; i++) {
          const cur = slotPole[i];
          if (cur < 0) {
            const next = closestPole(pos, taken);
            if (next >= 0) {
              slotPole[i] = next;
              taken.add(next);
              const p = poles[next];
              spots[i].position.set(p.x, 8.5, p.z);
              spots[i].target.position.set(p.x, 0, p.z);
              slotPhase[i] = 1;
            }
            continue;
          }
          const curDist = Math.hypot(poles[cur].x - pos.x, poles[cur].z - pos.z);
          if (curDist <= 40) continue;
          const next = closestPole(pos, taken);
          if (next < 0) continue;
          const nextDist = Math.hypot(poles[next].x - pos.x, poles[next].z - pos.z);
          if (nextDist > curDist - 10) continue;
          if (slotPhase[i] < 0 && slotNext[i] >= 0) taken.delete(slotNext[i]);
          taken.delete(cur);
          taken.add(next);
          slotNext[i] = next;
          slotPhase[i] = -1;
        }
      }
      for (let i = 0; i < 4; i++) {
        const s = spots[i];
        if (slotPhase[i] < 0) {
          slotFade[i] = Math.max(0, slotFade[i] - dt / 0.2);
          if (slotFade[i] === 0) {
            const next = slotNext[i];
            slotPole[i] = next;
            const p = poles[next];
            s.position.set(p.x, 8.5, p.z);
            s.target.position.set(p.x, 0, p.z);
            slotPhase[i] = 1;
          }
        } else if (slotPhase[i] > 0) {
          slotFade[i] = Math.min(1, slotFade[i] + dt / 0.2);
          if (slotFade[i] === 1) slotPhase[i] = 0;
        }
        s.intensity = f * 900 * slotFade[i];
        s.visible = f > 0.02 && slotFade[i] > 0;
      }
    },
    setNight(f) {
      nightAmt = f;
      sun.intensity = 3.0 - 2.85 * f;
      if (f < 0.5) {
        sun.color.lerpColors(sunDay, sunDusk, f * 2);
        scene.fog.color.lerpColors(fogDay, fogDusk, f * 2);
      } else {
        sun.color.lerpColors(sunDusk, sunNight, (f - 0.5) * 2);
        scene.fog.color.lerpColors(fogDusk, fogNight, (f - 0.5) * 2);
      }
      sunDisc.material.color.lerpColors(discDay, discDusk, Math.min(1, f * 2));
      hemiLight.intensity = 1.7 - 1.35 * f;
      sunDisc.visible = f < 0.5;
      moonDisc.visible = f > 0.5;
      if (f > 0.5) {
        scene.background = darkSky;
      } else {
        scene.background = daySky;
        updateSky(f);
      }
      // Windows glow as night falls (0 by day — daytime is unchanged).
      for (const material of glowMats) material.emissiveIntensity = f * 1.7;
      // Neon signs: halo always on at night, face blinks gently and slowly,
      // each sign out of phase.
      for (const s of neonMats) s.mat.emissiveIntensity = f * 1.8 * (0.72 + 0.28 * Math.sin(nightTime * 0.7 + s.phase));
      haloMat.opacity = f * 0.4;
      glowMtl.opacity = f * 0.5;
      poolMtl.opacity = f * 0.3;
      lampMtl.color.setHex(f > 0.5 ? 0xfff2cc : 0x555560);
    },
  };
}
