import * as THREE from 'three';
import { intBetween } from './random.js';
// VICE ROYALE is an island: a 12x12 block city grid (bigger than top-1
// KARIMBU's 10x10) with a beach ring and wide sea on all four sides.
// Pitch 52 is kept, so every existing coordinate (missions, businesses,
// shop, spray, parked cars) stays valid: the old 6x4 city is the centre
// of the new grid, and the new blocks fill the ring around it.
const CITY_BLOCK_COLUMNS = 12;
const CITY_BLOCK_ROWS = 12;
const BLOCK_SIZE = 40;
const ROAD_WIDTH = 12;
const STREET_PITCH = BLOCK_SIZE + ROAD_WIDTH;
const HALF_W = (CITY_BLOCK_COLUMNS * STREET_PITCH + ROAD_WIDTH) / 2;
const NORTH_EDGE = -HALF_W;
export const CITY_EDGE = HALF_W;
export const BEACH_WIDTH = 38;
export const SHORELINE = HALF_W + BEACH_WIDTH;
const WATER_SLOPE = 0.2;
const WATER_FAR = 1500;
export const MAP_EXTENT = 420;
const DISTRICTS = [
  { name: 'NORTHGATE', west: true, band: -1, lx: -159, lz: -263, colour: '#8a7bd8' },
  { name: 'FOG HARBOR', west: false, band: -1, lx: 159, lz: -263, colour: '#7ac4ff' },
  { name: 'OLD PORT', west: true, band: 0, lx: -107, lz: -135, colour: '#c98a5a' },
  { name: 'HARBOR LIGHTS', west: false, band: 0, lx: 107, lz: -135, colour: '#ffd978' },
  { name: 'LANTERN ROW', west: true, band: 1, lx: -107, lz: -13, colour: '#ff5aa8' },
  { name: 'MARINA DEL SOL', west: false, band: 1, lx: 107, lz: -13, colour: '#2ad0c4' },
  { name: 'PALM ROW', west: true, band: 2, lx: -107, lz: 42, colour: '#7affc4' },
  { name: 'PELICAN BAY', west: false, band: 2, lx: 107, lz: 42, colour: '#9fd4e8' },
  { name: 'SUNSET KEYS', west: true, band: 3, lx: -159, lz: 107, colour: '#ff7a3d' },
  { name: 'GULL HARBOR', west: false, band: 3, lx: 159, lz: 107, colour: '#ff8a94' },
  { name: 'SOUTH POINT', west: true, band: 4, lx: -159, lz: 237, colour: '#3da86b' },
  { name: 'BEACON KEY', west: false, band: 4, lx: 159, lz: 237, colour: '#e8a33d' },
];
// Every named place on the island (city districts + the two beach names
// the shoreline returns) for the map's District Standing panel.
export function districtList() {
  return [
    ...DISTRICTS.map((d) => ({ name: d.name, colour: d.colour })),
    { name: 'CORAL STRAND', colour: '#f0cd8c' },
    { name: 'SUNSET BLUFF', colour: '#e8b07a' },
  ];
}
export function districtNameAt(x, z) {
  if (Math.abs(x) > CITY_EDGE || Math.abs(z) > CITY_EDGE) return x < 0 ? 'CORAL STRAND' : 'SUNSET BLUFF';
  const band = z < -208 ? -1 : z <= -STREET_PITCH ? 0 : z < 26 ? 1 : z < 58 ? 2 : z < 156 ? 3 : 4;
  const west = x < 0;
  return DISTRICTS.find((d) => d.west === west && d.band === band).name;
}
export function districtLabels() {
  return [...DISTRICTS.map((d) => ({ name: d.name, x: d.lx, z: d.lz })), { name: 'CORAL STRAND', x: -159, z: 337 }, { name: 'SUNSET BLUFF', x: 159, z: 337 }];
}
// Street density by time of day (GTA-like: 3am streets are near-empty,
// the evening is moderate, daytime is full). Keyframes in game minutes;
// linear between them. The nightlife districts stay busier at night.
export const NIGHTLIFE_DISTRICTS = ['LANTERN ROW', 'MARINA DEL SOL'];
const NIGHTLIFE_FLOOR = 0.7;
const DENSITY_KEYS = [[0, 0.6], [60, 0.6], [120, 0.22], [360, 0.22], [420, 1], [1320, 1], [1380, 0.6], [1440, 0.6]];
export function densityForMinute(minutes) {
  const t = ((minutes % 1440) + 1440) % 1440;
  for (let i = 0; i < DENSITY_KEYS.length - 1; i += 1) {
    const [t0, d0] = DENSITY_KEYS[i];
    const [t1, d1] = DENSITY_KEYS[i + 1];
    if (t >= t0 && t <= t1) return t1 === t0 ? d0 : d0 + ((d1 - d0) * (t - t0)) / (t1 - t0);
  }
  return 0.6;
}
export function densityAt(minutes, x, z) {
  const base = densityForMinute(minutes);
  return NIGHTLIFE_DISTRICTS.includes(districtNameAt(x, z)) ? Math.max(base, NIGHTLIFE_FLOOR) : base;
}
export function averageDensity(minutes) {
  const base = densityForMinute(minutes);
  return (10 * base + 2 * Math.max(base, NIGHTLIFE_FLOOR)) / 12;
}
const blockCentreX = (c) => -HALF_W + ROAD_WIDTH + BLOCK_SIZE / 2 + c * STREET_PITCH;
const blockCentreZ = (r) => NORTH_EDGE + ROAD_WIDTH + BLOCK_SIZE / 2 + r * STREET_PITCH;
const roadCentreX = (i) => -HALF_W + ROAD_WIDTH / 2 + i * STREET_PITCH;
const roadCentreZ = (i) => NORTH_EDGE + ROAD_WIDTH / 2 + i * STREET_PITCH;
export function roadLines() {
  const lines = [];
  for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 1) {
    lines.push({ axis: 'z', at: roadCentreX(i), from: NORTH_EDGE, to: HALF_W });
  }
  for (let j = 0; j <= CITY_BLOCK_ROWS; j += 1) {
    lines.push({ axis: 'x', at: roadCentreZ(j), from: -HALF_W, to: HALF_W });
  }
  return lines;
}
// Water depth in metres: 0 on land, growing 1m per 5m past the shoreline.
// The depth gradient IS the boundary — no invisible wall at the shore.
// Cars stall at ~1.4m, the player starts swimming at ~1m.
export function waterDepthAt(x, z) {
  const dx = Math.max(0, Math.abs(x) - SHORELINE);
  const dz = Math.max(0, Math.abs(z) - SHORELINE);
  return Math.hypot(dx, dz) * WATER_SLOPE;
}
export function shoreOutward(x, z) {
  const cx = Math.max(-SHORELINE, Math.min(SHORELINE, x));
  const cz = Math.max(-SHORELINE, Math.min(SHORELINE, z));
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  return d > 0.001 ? { x: dx / d, z: dz / d } : null;
}
function skyGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [o, c] of [[0, '#6b4a9a'], [0.35, '#c45a9a'], [0.62, '#ff8a7a'], [0.82, '#ffb347'], [1, '#ffd98a']]) gradient.addColorStop(o, c);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function resolveCircleAgainstBoxes(position, radius, boxes) {
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
    } else {
      const push = [position.x - box.minX + radius, box.maxX - position.x + radius, position.z - box.minZ + radius, box.maxZ - position.z + radius];
      const m = Math.min(...push);
      if (m === push[0]) position.x = box.minX - radius;
      else if (m === push[1]) position.x = box.maxX + radius;
      else if (m === push[2]) position.z = box.minZ - radius;
      else position.z = box.maxZ + radius;
    }
  }
}
// Window cells in a facade texture: connected components of the two window
// colours (dark slate unlit, warm yellow lit-by-day). All four facades
// share those colours, so one detector covers them.
function windowCells(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const isWindow = (x, y) => {
    const i = (y * canvas.width + x) * 4;
    return (data[i] === 44 && data[i + 1] === 62 && data[i + 2] === 96)
      || (data[i] === 255 && data[i + 1] === 214 && data[i + 2] === 120);
  };
  const seen = new Uint8Array(canvas.width * canvas.height);
  const cells = [];
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
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= canvas.width || ny >= canvas.height) continue;
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
// ~45% of its windows, glowing warm yellow. Rolled per building, so no
// two buildings share a lit pattern.
function litWindowsTexture(cells, rng) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 64, 64);
  const shades = ['#ffd978', '#ffce6b', '#ffe6a8'];
  for (const cell of cells) {
    if (rng() >= 0.45) continue;
    ctx.fillStyle = shades[Math.floor(rng() * shades.length)];
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
// Building name signs: fictional GTA-style names, one shared canvas
// texture per name. White bold text on a dark panel with a gold border
// (white on #141030 is ~16:1) — readable from street level, and the
// emissive map makes the sign glow at night like the lit windows.
export const SIGN_NAMES = ['PALM HOTEL', 'VICE DINER', 'NEON MART', 'CORAL CAFE', 'SUNSET BAR', 'KEYS BAKERY', 'MARINA MOTEL', 'LANTERN LOUNGE', 'HARBOR GYM', 'OLD PORT TAVERN', 'PELICAN PIZZA', 'SOLARIS SUSHI', 'BLUFF BOOKS', 'GULL GROCERY', 'EMBER GRILL', 'TIDE TATTOO', 'COCONUT CLUB', 'STARFISH SPA', 'ANCHOR ARMS', 'RIPTIDE RECORDS'];
const signTextureCache = new Map();
export function makeSignTexture(text) {
  if (signTextureCache.has(text)) return signTextureCache.get(text);
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
  signTextureCache.set(text, texture);
  return texture;
}
const signMaterialCache = new Map();
export function signMaterialFor(text) {
  if (signMaterialCache.has(text)) return signMaterialCache.get(text);
  const tex = makeSignTexture(text);
  const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
  signMaterialCache.set(text, mat);
  return mat;
}
// Which facade of a box faces a target point (a road or a named place).
function facingFor(box, tx, tz) {
  const d = [
    ['S', Math.abs(tz - box.maxZ)],
    ['N', Math.abs(tz - box.minZ)],
    ['E', Math.abs(tx - box.maxX)],
    ['W', Math.abs(tx - box.minX)],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0][0];
}
const SIGN_W = 8, SIGN_H = 2, SIGN_Y = 4.5;
function signPlacement(box, facing) {
  if (facing === 'S') return { x: (box.minX + box.maxX) / 2, z: box.maxZ + 0.12, rotY: 0 };
  if (facing === 'N') return { x: (box.minX + box.maxX) / 2, z: box.minZ - 0.12, rotY: Math.PI };
  if (facing === 'E') return { x: box.maxX + 0.12, z: (box.minZ + box.maxZ) / 2, rotY: Math.PI / 2 };
  return { x: box.minX - 0.12, z: (box.minZ + box.maxZ) / 2, rotY: -Math.PI / 2 };
}
export function buildCity(scene, textures, rng) {
  const group = new THREE.Group();
  const buildingBoxes = [];
  const buildingMaterials = [];
  const signMaterials = [];
  const signs = [];
  const skyTex = skyGradientTexture();
  const nightSky = new THREE.Color(0x14102a);
  const daySunCol = new THREE.Color(0xffa050);
  const nightSunCol = new THREE.Color(0x8090c8);
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0xff8f6b, 120, 900);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(26, 24), new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
  sun.position.set(-180, 42, 420);
  sun.lookAt(0, 20, 0);
  group.add(sun);
  const flat = (tex, rx, ry, w, d, x, y, z) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: t }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  // Island stack: wide ocean underneath everything, a sand sheet for the
  // beach ring, then the city ground on top — the sand shows as a 38m
  // ring around all four sides. Roads sit above the ground.
  const ocean = flat(textures.water, 120, 120, WATER_FAR * 2, WATER_FAR * 2, 0, -0.15, 0);
  const waterTexture = ocean.material.map;
  flat(textures.sand, 40, 40, SHORELINE * 2, SHORELINE * 2, 0, 0.01, 0);
  const ground = flat(textures.sidewalk, 80, 80, HALF_W * 2, HALF_W * 2, 0, 0.02, 0);
  ground.receiveShadow = true;
  for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 1) {
    flat(textures.road, 1, 74, ROAD_WIDTH, HALF_W * 2 + ROAD_WIDTH, roadCentreX(i), 0.03, 0);
  }
  for (let j = 0; j <= CITY_BLOCK_ROWS; j += 1) {
    const stripTexture = textures.road.clone();
    stripTexture.needsUpdate = true;
    stripTexture.repeat.set(1, 74);
    const stripGeometry = new THREE.PlaneGeometry(ROAD_WIDTH, HALF_W * 2 + ROAD_WIDTH);
    stripGeometry.rotateX(-Math.PI / 2);
    stripGeometry.rotateY(Math.PI / 2);
    const strip = new THREE.Mesh(stripGeometry, new THREE.MeshLambertMaterial({ map: stripTexture }));
    strip.position.set(0, 0.04, roadCentreZ(j));
    group.add(strip);
  }
  const facades = [textures.facadeA, textures.facadeB, textures.facadeC, textures.facadeD];
  const facadeCells = facades.map((facade) => windowCells(facade.image));
  const roofMaterial = new THREE.MeshLambertMaterial({ map: textures.roof });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const signGeometry = new THREE.PlaneGeometry(SIGN_W, SIGN_H);
  const usedNamesByRoad = new Map();
  const buildings = [];
  const addSign = (box, name, tx, tz) => {
    const facing = facingFor(box, tx, tz);
    const p = signPlacement(box, facing);
    const mat = signMaterialFor(name);
    if (!signMaterials.includes(mat)) signMaterials.push(mat);
    const mesh = new THREE.Mesh(signGeometry, mat);
    mesh.position.set(p.x, SIGN_Y, p.z);
    mesh.rotation.y = p.rotY;
    group.add(mesh);
    const entry = { name, x: p.x, y: SIGN_Y, z: p.z, box, mesh };
    signs.push(entry);
    return entry;
  };
  for (let row = 0; row < CITY_BLOCK_ROWS; row += 1) {
    for (let column = 0; column < CITY_BLOCK_COLUMNS; column += 1) {
      const cx = blockCentreX(column);
      const cz = blockCentreZ(row);
      const twin = rng() < 0.45;
      const plots = twin ? [{ x: cx - 10, z: cz, w: 18, d: 32 }, { x: cx + 10, z: cz, w: 18, d: 32 }] : [{ x: cx, z: cz, w: 32, d: 32 }];
      for (const plot of plots) {
        const height = intBetween(rng, 8, 26);
        const facadeIndex = Math.floor(rng() * facades.length);
        const facadeTexture = facades[facadeIndex].clone();
        facadeTexture.needsUpdate = true;
        const repeatX = Math.max(1, Math.round(plot.w / 10));
        const repeatY = Math.max(1, Math.round(height / 8));
        facadeTexture.repeat.set(repeatX, repeatY);
        const emissiveTexture = litWindowsTexture(facadeCells[facadeIndex], rng);
        emissiveTexture.repeat.set(repeatX, repeatY);
        const side = new THREE.MeshLambertMaterial({ map: facadeTexture, emissive: 0xffffff, emissiveMap: emissiveTexture, emissiveIntensity: 0 });
        buildingMaterials.push(side);
        const building = new THREE.Mesh(boxGeometry, [side, side, roofMaterial, roofMaterial, side, side]);
        building.scale.set(plot.w, height, plot.d);
        building.position.set(plot.x, height / 2, plot.z);
        building.castShadow = true;
        building.receiveShadow = true;
        group.add(building);
        const box = { minX: plot.x - plot.w / 2, maxX: plot.x + plot.w / 2, minZ: plot.z - plot.d / 2, maxZ: plot.z + plot.d / 2 };
        buildingBoxes.push(box);
        // ~60% of buildings carry a name sign on the facade facing their
        // nearest road; no name repeats on the same street.
        const record = { box, sign: null };
        buildings.push(record);
        if (rng() < 0.6) {
          const nearestZRoad = roadCentreX(Math.round((plot.x + HALF_W - ROAD_WIDTH / 2) / STREET_PITCH));
          const nearestXRoad = roadCentreZ(Math.round((plot.z + HALF_W - ROAD_WIDTH / 2) / STREET_PITCH));
          const dzRoad = Math.abs(plot.x - nearestZRoad);
          const dxRoad = Math.abs(plot.z - nearestXRoad);
          // Single plots sit equidistant from all four roads — break the
          // tie at random so signs do not all face east.
          const useZ = dzRoad < dxRoad || (dzRoad === dxRoad && rng() < 0.5);
          const roadKey = useZ ? `z:${nearestZRoad}` : `x:${nearestXRoad}`;
          const tx = useZ ? nearestZRoad : plot.x;
          const tz = useZ ? plot.z : nearestXRoad;
          if (!usedNamesByRoad.has(roadKey)) usedNamesByRoad.set(roadKey, new Set());
          const used = usedNamesByRoad.get(roadKey);
          const start = Math.floor(rng() * SIGN_NAMES.length);
          let name = SIGN_NAMES[start];
          for (let k = 0; k < SIGN_NAMES.length; k += 1) {
            const candidate = SIGN_NAMES[(start + k) % SIGN_NAMES.length];
            if (!used.has(candidate)) { name = candidate; break; }
          }
          used.add(name);
          record.sign = addSign(box, name, tx, tz);
        }
      }
    }
  }
  // Named places get their own sign on the nearest building, facing the
  // spot itself: the three businesses, Pay'n'Spray, and the Harbor Lights
  // safehouse (second-nearest building to the dealership corner, so the
  // two signs do not land on the same facade).
  const nearestBuildings = (x, z) => [...buildings].sort((a, b) => {
    const da = Math.hypot((a.box.minX + a.box.maxX) / 2 - x, (a.box.minZ + a.box.maxZ) / 2 - z);
    const db = Math.hypot((b.box.minX + b.box.maxX) / 2 - x, (b.box.minZ + b.box.maxZ) / 2 - z);
    return da - db;
  });
  const setNamedSign = (record, name, x, z) => {
    if (record.sign) {
      const mat = signMaterialFor(name);
      if (!signMaterials.includes(mat)) signMaterials.push(mat);
      record.sign.mesh.material = mat;
      record.sign.name = name;
      // Re-face the sign toward the named spot itself.
      const p = signPlacement(record.box, facingFor(record.box, x, z));
      record.sign.mesh.position.set(p.x, SIGN_Y, p.z);
      record.sign.mesh.rotation.y = p.rotY;
      record.sign.x = p.x;
      record.sign.z = p.z;
      return;
    }
    record.sign = addSign(record.box, name, x, z);
  };
  const named = [
    { name: 'KEYS CAB CO.', x: 52, z: 52, nth: 0 },
    { name: 'NEON PALMS', x: -52, z: -52, nth: 0 },
    { name: 'SOLSTICE MOTORS', x: 104, z: -104, nth: 0 },
    { name: 'SAFEHOUSE', x: 104, z: -104, nth: 1 },
    { name: "PAY 'N SPRAY", x: 104, z: -52, nth: 0 },
  ];
  for (const place of named) {
    const ranked = nearestBuildings(place.x, place.z);
    if (ranked[place.nth]) setNamedSign(ranked[place.nth], place.name, place.x, place.z);
  }
  const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.32, 4.4, 5);
  const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x7a5434 });
  const frondGeometry = new THREE.PlaneGeometry(7, 7);
  const frondMaterial = new THREE.MeshLambertMaterial({
    map: textures.palm,
    transparent: true,
    side: THREE.DoubleSide,
    alphaTest: 0.1,
  });
  const trees = [];
  const plantPalm = (x, z, scale) => {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = 2.2;
    trunk.rotation.z = (rng() - 0.5) * 0.2;
    palm.add(trunk);
    for (let i = 0; i < 2; i += 1) {
      const f = new THREE.Mesh(frondGeometry, frondMaterial);
      f.position.y = 5.4;
      f.rotation.y = (i * Math.PI) / 2 + rng() * 0.6;
      palm.add(f);
    }
    palm.position.set(x, 0, z);
    palm.scale.setScalar(scale);
    group.add(palm);
    trees.push({ x, z });
  };
  // Beach palms on all four shores: two loose rows per side.
  for (let s = -HALF_W + 8; s < HALF_W; s += intBetween(rng, 10, 18)) {
    plantPalm(s, CITY_EDGE + 6 + rng() * 6, 0.9 + rng() * 0.5);
    if (rng() < 0.6) plantPalm(s + 5, SHORELINE - 8 - rng() * 8, 0.8 + rng() * 0.5);
    plantPalm(s, -CITY_EDGE - 6 - rng() * 6, 0.9 + rng() * 0.5);
    if (rng() < 0.6) plantPalm(s + 5, -SHORELINE + 8 + rng() * 8, 0.8 + rng() * 0.5);
    plantPalm(CITY_EDGE + 6 + rng() * 6, s, 0.9 + rng() * 0.5);
    if (rng() < 0.6) plantPalm(SHORELINE - 8 - rng() * 8, s + 5, 0.8 + rng() * 0.5);
    plantPalm(-CITY_EDGE - 6 - rng() * 6, s, 0.9 + rng() * 0.5);
    if (rng() < 0.6) plantPalm(-SHORELINE + 8 + rng() * 8, s + 5, 0.8 + rng() * 0.5);
  }
  // Street palms: roadside only — never on a road rect (either orientation)
  // and never inside a building. The old code put them 7m off a z-road with
  // a random z, so a palm could land squarely on a crossing x-road.
  const roadClear = (x, z) => {
    for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 1) {
      if (Math.abs(x - roadCentreX(i)) < 8 && z >= NORTH_EDGE && z <= HALF_W) return false;
    }
    for (let j = 0; j <= CITY_BLOCK_ROWS; j += 1) {
      if (Math.abs(z - roadCentreZ(j)) < 8 && x >= -HALF_W && x <= HALF_W) return false;
    }
    for (const box of buildingBoxes) {
      if (x > box.minX - 1 && x < box.maxX + 1 && z > box.minZ - 1 && z < box.maxZ + 1) return false;
    }
    return true;
  };
  for (let i = 0; i < 60; i += 1) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = roadCentreX(intBetween(rng, 0, CITY_BLOCK_COLUMNS)) + (rng() < 0.5 ? -1 : 1) * (8 + rng() * 3);
      const z = NORTH_EDGE + rng() * (HALF_W - NORTH_EDGE);
      if (!roadClear(x, z)) continue;
      plantPalm(x, z, 0.8 + rng() * 0.4);
      break;
    }
  }
  const billboardMaterial = new THREE.MeshBasicMaterial({ map: textures.billboard });
  const billboardBack = new THREE.MeshLambertMaterial({ color: 0x241a2a });
  for (const bx of [-52, 52]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 0.4), [billboardBack, billboardBack, billboardBack, billboardBack, billboardMaterial, billboardBack]);
    board.position.set(bx, 10, 330);
    board.rotation.y = Math.PI;
    group.add(board);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), billboardBack);
    post.position.set(bx, 3.5, 330);
    group.add(post);
  }
  const sunLight = new THREE.DirectionalLight(0xffa050, 2.2);
  sunLight.position.set(-120, 70, 200);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -380;
  sunLight.shadow.camera.right = 380;
  sunLight.shadow.camera.top = 380;
  sunLight.shadow.camera.bottom = -380;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 1000;
  sunLight.shadow.bias = -0.0002;
  sunLight.shadow.normalBias = 1;
  scene.add(sunLight);
  const hemi = new THREE.HemisphereLight(0x8a6fd6, 0x2a1a3a, 1.2);
  scene.add(hemi);
  scene.add(group);
  return {
    buildingBoxes,
    trees,
    sunLight,
    buildingMaterials,
    signMaterials,
    signs,
    waterDepthAt,
    shoreOutward,
    bounds: { minX: -WATER_FAR + 100, maxX: WATER_FAR - 100, minZ: -WATER_FAR + 100, maxZ: WATER_FAR - 100 },
    resolveCircle(position, radius) {
      resolveCircleAgainstBoxes(position, radius, buildingBoxes);
      position.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, position.x));
      position.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, position.z));
    },
    update(dt) {
      waterTexture.offset.x += dt * 0.008;
      waterTexture.offset.y += dt * 0.005;
    },
    setNight(f) {
      sunLight.intensity = 2.2 - 1.8 * f;
      sunLight.color.lerpColors(daySunCol, nightSunCol, f);
      hemi.intensity = 1.2 - 0.85 * f;
      sun.visible = f < 0.5;
      scene.background = f > 0.5 ? nightSky : skyTex;
      // Windows glow as night falls (0 by day — daytime is unchanged).
      for (const material of buildingMaterials) material.emissiveIntensity = f * 1.3;
      for (const material of signMaterials) material.emissiveIntensity = f * 1.2;
    },
  };
}
