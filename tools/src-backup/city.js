import * as THREE from 'three';
import { intBetween, pick } from './random.js';
const CITY_BLOCK_COLUMNS = 6;
const CITY_BLOCK_ROWS = 4;
const BLOCK_SIZE = 40;
const ROAD_WIDTH = 12;
const STREET_PITCH = BLOCK_SIZE + ROAD_WIDTH;
const HALF_W = (CITY_BLOCK_COLUMNS * STREET_PITCH + ROAD_WIDTH) / 2;
const NORTH_EDGE = -HALF_W;
const BEACH_ROAD_Z = 52;
const BEACH_START_Z = BEACH_ROAD_Z + ROAD_WIDTH / 2;
const SHORELINE_Z = 96;
const OCEAN_FAR_Z = 520;
const DISTRICTS = [
  { name: 'OLD PORT', west: true, band: 0, lx: -107, lz: -135 },
  { name: 'HARBOR LIGHTS', west: false, band: 0, lx: 107, lz: -135 },
  { name: 'LANTERN ROW', west: true, band: 1, lx: -107, lz: -13 },
  { name: 'MARINA DEL SOL', west: false, band: 1, lx: 107, lz: -13 },
  { name: 'PALM ROW', west: true, band: 2, lx: -107, lz: 42 },
  { name: 'PELICAN BAY', west: false, band: 2, lx: 107, lz: 42 },
];
export function districtNameAt(x, z) {
  if (z >= BEACH_START_Z) return x < 0 ? 'CORAL STRAND' : 'SUNSET BLUFF';
  const band = z <= -STREET_PITCH ? 0 : z < 26 ? 1 : 2;
  const west = x < 0;
  return DISTRICTS.find((d) => d.west === west && d.band === band).name;
}
export function districtLabels() {
  return [...DISTRICTS.map((d) => ({ name: d.name, x: d.lx, z: d.lz })), { name: 'CORAL STRAND', x: -81, z: 77 }, { name: 'SUNSET BLUFF', x: 81, z: 77 }];
}
const blockCentreX = (c) => -HALF_W + ROAD_WIDTH + BLOCK_SIZE / 2 + c * STREET_PITCH;
const blockCentreZ = (r) => NORTH_EDGE + ROAD_WIDTH + BLOCK_SIZE / 2 + r * STREET_PITCH;
const roadCentreX = (i) => -HALF_W + ROAD_WIDTH / 2 + i * STREET_PITCH;
const roadCentreZ = (i) => NORTH_EDGE + ROAD_WIDTH / 2 + i * STREET_PITCH;
export function roadLines() {
  const lines = [];
  for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 1) {
    lines.push({ axis: 'z', at: roadCentreX(i), from: NORTH_EDGE, to: BEACH_ROAD_Z });
  }
  for (let j = 0; j <= CITY_BLOCK_ROWS; j += 1) {
    lines.push({ axis: 'x', at: roadCentreZ(j), from: -HALF_W, to: HALF_W });
  }
  return lines;
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
export function buildCity(scene, textures, rng) {
  const group = new THREE.Group();
  const buildingBoxes = [];
  const skyTex = skyGradientTexture();
  const nightSky = new THREE.Color(0x14102a);
  const daySunCol = new THREE.Color(0xffa050);
  const nightSunCol = new THREE.Color(0x8090c8);
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0xff8f6b, 110, 430);
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
  const ground = flat(textures.sidewalk, 40, 28, HALF_W * 2, BEACH_START_Z - NORTH_EDGE, 0, 0, (NORTH_EDGE + BEACH_START_Z) / 2);
  ground.receiveShadow = true;
  for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 1) {
    flat(textures.road, 1, 26, ROAD_WIDTH, BEACH_ROAD_Z - NORTH_EDGE + ROAD_WIDTH, roadCentreX(i), 0.02, (NORTH_EDGE + BEACH_ROAD_Z) / 2);
  }
  for (let j = 0; j <= CITY_BLOCK_ROWS; j += 1) {
    const stripTexture = textures.road.clone();
    stripTexture.needsUpdate = true;
    stripTexture.repeat.set(1, 26);
    const stripGeometry = new THREE.PlaneGeometry(ROAD_WIDTH, HALF_W * 2);
    stripGeometry.rotateX(-Math.PI / 2);
    stripGeometry.rotateY(Math.PI / 2);
    const strip = new THREE.Mesh(stripGeometry, new THREE.MeshLambertMaterial({ map: stripTexture }));
    strip.position.set(0, 0.03, roadCentreZ(j));
    group.add(strip);
  }
  flat(textures.sand, 30, 4, HALF_W * 2 + 200, SHORELINE_Z - BEACH_START_Z, 0, 0.01, (BEACH_START_Z + SHORELINE_Z) / 2);
  const ocean = flat(textures.water, 48, 40, 1200, OCEAN_FAR_Z - SHORELINE_Z, 0, -0.15, (SHORELINE_Z + OCEAN_FAR_Z) / 2);
  const waterTexture = ocean.material.map;
  const facades = [textures.facadeA, textures.facadeB, textures.facadeC, textures.facadeD];
  const roofMaterial = new THREE.MeshLambertMaterial({ map: textures.roof });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (let row = 0; row < CITY_BLOCK_ROWS; row += 1) {
    for (let column = 0; column < CITY_BLOCK_COLUMNS; column += 1) {
      const cx = blockCentreX(column);
      const cz = blockCentreZ(row);
      const twin = rng() < 0.45;
      const plots = twin ? [{ x: cx - 10, z: cz, w: 18, d: 32 }, { x: cx + 10, z: cz, w: 18, d: 32 }] : [{ x: cx, z: cz, w: 32, d: 32 }];
      for (const plot of plots) {
        const height = intBetween(rng, 8, 26);
        const facadeTexture = pick(rng, facades).clone();
        facadeTexture.needsUpdate = true;
        facadeTexture.repeat.set(Math.max(1, Math.round(plot.w / 10)), Math.max(1, Math.round(height / 8)));
        const side = new THREE.MeshLambertMaterial({ map: facadeTexture });
        const building = new THREE.Mesh(boxGeometry, [side, side, roofMaterial, roofMaterial, side, side]);
        building.scale.set(plot.w, height, plot.d);
        building.position.set(plot.x, height / 2, plot.z);
        group.add(building);
        buildingBoxes.push({ minX: plot.x - plot.w / 2, maxX: plot.x + plot.w / 2, minZ: plot.z - plot.d / 2, maxZ: plot.z + plot.d / 2 });
      }
    }
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
  };
  for (let x = -HALF_W + 8; x < HALF_W; x += intBetween(rng, 10, 18)) {
    plantPalm(x, BEACH_START_Z + 6 + rng() * 6, 0.9 + rng() * 0.5);
    if (rng() < 0.6) plantPalm(x + 5, SHORELINE_Z - 8 - rng() * 8, 0.8 + rng() * 0.5);
  }
  for (let i = 0; i < 26; i += 1) {
    const x = roadCentreX(intBetween(rng, 0, CITY_BLOCK_COLUMNS)) + (rng() < 0.5 ? -7 : 7);
    const z = NORTH_EDGE + rng() * (BEACH_ROAD_Z - NORTH_EDGE);
    plantPalm(x, z, 0.8 + rng() * 0.4);
  }
  const billboardMaterial = new THREE.MeshBasicMaterial({ map: textures.billboard });
  const billboardBack = new THREE.MeshLambertMaterial({ color: 0x241a2a });
  for (const bx of [-52, 52]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 0.4), [billboardBack, billboardBack, billboardBack, billboardBack, billboardMaterial, billboardBack]);
    board.position.set(bx, 10, 62);
    board.rotation.y = Math.PI;
    group.add(board);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), billboardBack);
    post.position.set(bx, 3.5, 62);
    group.add(post);
  }
  const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x4a4460 });
  const stripeMaterial = new THREE.MeshLambertMaterial({ color: 0xffc828 });
  const edgeWall = (w, d, x, z) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, d), wallMaterial);
    wall.position.set(x, 1.3, z);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), stripeMaterial);
    stripe.position.set(x, 2.6, z);
    group.add(wall, stripe);
  };
  edgeWall(HALF_W * 2 + 4, 1, 0, NORTH_EDGE - 1.5);
  edgeWall(1, SHORELINE_Z - NORTH_EDGE + 4, -HALF_W - 1.5, (NORTH_EDGE + SHORELINE_Z) / 2);
  edgeWall(1, SHORELINE_Z - NORTH_EDGE + 4, HALF_W + 1.5, (NORTH_EDGE + SHORELINE_Z) / 2);
  const sunLight = new THREE.DirectionalLight(0xffa050, 2.2);
  sunLight.position.set(-120, 70, 200);
  scene.add(sunLight);
  const hemi = new THREE.HemisphereLight(0x8a6fd6, 0x2a1a3a, 1.2);
  scene.add(hemi);
  scene.add(group);
  return {
    buildingBoxes,
    bounds: { minX: -HALF_W, maxX: HALF_W, minZ: NORTH_EDGE, maxZ: SHORELINE_Z },
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
    },
  };
}