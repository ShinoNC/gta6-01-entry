// SOLARIS KEYS city: a procedural sun-soaked coastal grid. Streets run on a
// regular pitch, blocks hold 1-2 low-poly buildings with pixel facades, palms
// line the beachfront, and the ocean fills the south. Six named districts
// split the map; districtNameAt() is what the HUD shows as you cross them.
import * as THREE from 'three';
import { intBetween, pick } from './random.js';

export const CITY_BLOCK_COLUMNS = 6;
export const CITY_BLOCK_ROWS = 4;
export const BLOCK_SIZE = 40;
export const ROAD_WIDTH = 12;
const STREET_PITCH = BLOCK_SIZE + ROAD_WIDTH;
const CITY_HALF_WIDTH = (CITY_BLOCK_COLUMNS * STREET_PITCH + ROAD_WIDTH) / 2;
const NORTH_EDGE = -CITY_HALF_WIDTH;
const BEACHFRONT_ROAD_Z = 52;
const BEACH_START_Z = BEACHFRONT_ROAD_Z + ROAD_WIDTH / 2;
const SHORELINE_Z = 96;
const OCEAN_FAR_Z = 520;

const DISTRICTS = [
  { name: 'OLD PORT', west: true, north: true },
  { name: 'HARBOR LIGHTS', west: false, north: true },
  { name: 'PALM ROW', west: true, north: false },
  { name: 'MARINA DEL SOL', west: false, north: false },
];

// District for any map position: the north half splits Old Port / Harbor
// Lights, the middle splits Palm Row / Marina Del Sol, and the beach strip
// splits Coral Strand / Sunset Bluff.
export function districtNameAt(x, z) {
  if (z >= BEACH_START_Z) return x < 0 ? 'CORAL STRAND' : 'SUNSET BLUFF';
  const north = z < -STREET_PITCH;
  const west = x < 0;
  return DISTRICTS.find((d) => d.west === west && d.north === north).name;
}

function blockCentreX(column) {
  return -CITY_HALF_WIDTH + ROAD_WIDTH + BLOCK_SIZE / 2 + column * STREET_PITCH;
}

function blockCentreZ(row) {
  return NORTH_EDGE + ROAD_WIDTH + BLOCK_SIZE / 2 + row * STREET_PITCH;
}

function roadCentreX(index) {
  return -CITY_HALF_WIDTH + ROAD_WIDTH / 2 + index * STREET_PITCH;
}

function roadCentreZ(index) {
  return NORTH_EDGE + ROAD_WIDTH / 2 + index * STREET_PITCH;
}

// The drivable road centrelines, for traffic and police in later phases.
export function roadLines() {
  const lines = [];
  for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 1) {
    lines.push({ axis: 'z', at: roadCentreX(i), from: NORTH_EDGE, to: BEACHFRONT_ROAD_Z });
  }
  for (let j = 0; j <= CITY_BLOCK_ROWS; j += 1) {
    lines.push({ axis: 'x', at: roadCentreZ(j), from: -CITY_HALF_WIDTH, to: CITY_HALF_WIDTH });
  }
  return lines;
}

function skyGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0.0, '#3b2a6b');
  gradient.addColorStop(0.35, '#a44a8a');
  gradient.addColorStop(0.62, '#ff7e6b');
  gradient.addColorStop(0.82, '#ffb347');
  gradient.addColorStop(1.0, '#ffd98a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Push a circle (player or car) out of every building box it overlaps.
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
      // Centre inside the box: push out along the smallest penetration.
      const pushLeft = position.x - box.minX + radius;
      const pushRight = box.maxX - position.x + radius;
      const pushNorth = position.z - box.minZ + radius;
      const pushSouth = box.maxZ - position.z + radius;
      const smallest = Math.min(pushLeft, pushRight, pushNorth, pushSouth);
      if (smallest === pushLeft) position.x = box.minX - radius;
      else if (smallest === pushRight) position.x = box.maxX + radius;
      else if (smallest === pushNorth) position.z = box.minZ - radius;
      else position.z = box.maxZ + radius;
    }
  }
}

export function buildCity(scene, textures, rng) {
  const group = new THREE.Group();
  const buildingBoxes = [];
  scene.background = skyGradientTexture();
  scene.fog = new THREE.Fog(0xff9e7e, 130, 430);

  // Sun: a flat glowing disc low over the ocean, due south-west.
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(26, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }),
  );
  sun.position.set(-180, 42, 420);
  sun.lookAt(0, 20, 0);
  group.add(sun);

  // Ground: pavement under the whole street grid.
  const groundTexture = textures.sidewalk.clone();
  groundTexture.needsUpdate = true;
  groundTexture.repeat.set(40, 28);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_HALF_WIDTH * 2, BEACH_START_Z - NORTH_EDGE),
    new THREE.MeshLambertMaterial({ map: groundTexture }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, (NORTH_EDGE + BEACH_START_Z) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // Road strips with lane markings, laid over the pavement.
  for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 1) {
    const stripTexture = textures.road.clone();
    stripTexture.needsUpdate = true;
    stripTexture.repeat.set(1, 26);
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_WIDTH, BEACHFRONT_ROAD_Z - NORTH_EDGE + ROAD_WIDTH),
      new THREE.MeshLambertMaterial({ map: stripTexture }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(roadCentreX(i), 0.02, (NORTH_EDGE + BEACHFRONT_ROAD_Z) / 2);
    group.add(strip);
  }
  for (let j = 0; j <= CITY_BLOCK_ROWS; j += 1) {
    const stripTexture = textures.road.clone();
    stripTexture.needsUpdate = true;
    stripTexture.repeat.set(1, 26);
    // Same tall plane as the north-south strips, turned east-west by rotating
    // the geometry: rotating the mesh instead would spin the texture with it.
    // Sits 1 cm above the north-south strips so crossings never z-fight.
    const stripGeometry = new THREE.PlaneGeometry(ROAD_WIDTH, CITY_HALF_WIDTH * 2);
    stripGeometry.rotateX(-Math.PI / 2);
    stripGeometry.rotateY(Math.PI / 2);
    const strip = new THREE.Mesh(stripGeometry, new THREE.MeshLambertMaterial({ map: stripTexture }));
    strip.position.set(0, 0.03, roadCentreZ(j));
    group.add(strip);
  }
  // Beach sand, then the ocean.
  const sandTexture = textures.sand.clone();
  sandTexture.needsUpdate = true;
  sandTexture.repeat.set(30, 4);
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_HALF_WIDTH * 2 + 200, SHORELINE_Z - BEACH_START_Z),
    new THREE.MeshLambertMaterial({ map: sandTexture }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(0, 0.01, (BEACH_START_Z + SHORELINE_Z) / 2);
  group.add(beach);

  const waterTexture = textures.water.clone();
  waterTexture.needsUpdate = true;
  waterTexture.repeat.set(48, 40);
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, OCEAN_FAR_Z - SHORELINE_Z),
    new THREE.MeshLambertMaterial({ map: waterTexture }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.15, (SHORELINE_Z + OCEAN_FAR_Z) / 2);
  group.add(ocean);

  // Buildings: one wide tower or two side-by-side blocks per city block.
  const facades = [textures.facadeA, textures.facadeB, textures.facadeC];
  const roofMaterial = new THREE.MeshLambertMaterial({ map: textures.roof });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (let row = 0; row < CITY_BLOCK_ROWS; row += 1) {
    for (let column = 0; column < CITY_BLOCK_COLUMNS; column += 1) {
      const cx = blockCentreX(column);
      const cz = blockCentreZ(row);
      const twin = rng() < 0.45;
      const plots = twin
        ? [
            { x: cx - 10, z: cz, w: 18, d: 32 },
            { x: cx + 10, z: cz, w: 18, d: 32 },
          ]
        : [{ x: cx, z: cz, w: 32, d: 32 }];
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
        buildingBoxes.push({
          minX: plot.x - plot.w / 2,
          maxX: plot.x + plot.w / 2,
          minZ: plot.z - plot.d / 2,
          maxZ: plot.z + plot.d / 2,
        });
      }
    }
  }

  // Palms: a double row along the beach, plus scattered street palms.
  const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.32, 4.4, 5);
  const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x7a5434 });
  const frondGeometry = new THREE.PlaneGeometry(7, 7);
  const frondMaterial = new THREE.MeshLambertMaterial({
    map: textures.palm,
    transparent: true,
    side: THREE.DoubleSide,
    alphaTest: 0.1,
  });
  function plantPalm(x, z, scale) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = 2.2;
    trunk.rotation.z = (rng() - 0.5) * 0.2;
    palm.add(trunk);
    for (let i = 0; i < 2; i += 1) {
      const fronds = new THREE.Mesh(frondGeometry, frondMaterial);
      fronds.position.y = 5.4;
      fronds.rotation.y = (i * Math.PI) / 2 + rng() * 0.6;
      palm.add(fronds);
    }
    palm.position.set(x, 0, z);
    palm.scale.setScalar(scale);
    group.add(palm);
  }
  for (let x = -CITY_HALF_WIDTH + 8; x < CITY_HALF_WIDTH; x += intBetween(rng, 10, 18)) {
    plantPalm(x, BEACH_START_Z + 6 + rng() * 6, 0.9 + rng() * 0.5);
    if (rng() < 0.6) plantPalm(x + 5, SHORELINE_Z - 8 - rng() * 8, 0.8 + rng() * 0.5);
  }
  for (let i = 0; i < 26; i += 1) {
    const x = roadCentreX(intBetween(rng, 0, CITY_BLOCK_COLUMNS)) + (rng() < 0.5 ? -7 : 7);
    const z = NORTH_EDGE + rng() * (BEACHFRONT_ROAD_Z - NORTH_EDGE);
    plantPalm(x, z, 0.8 + rng() * 0.4);
  }

  // Warm sunset lighting: low orange sun + soft purple fill.
  const sunLight = new THREE.DirectionalLight(0xffb36b, 1.6);
  sunLight.position.set(-120, 90, 180);
  scene.add(sunLight);
  scene.add(new THREE.HemisphereLight(0x8a6fd6, 0x2a1a3a, 0.9));

  scene.add(group);
  return {
    group,
    buildingBoxes,
    bounds: { minX: -CITY_HALF_WIDTH, maxX: CITY_HALF_WIDTH, minZ: NORTH_EDGE, maxZ: SHORELINE_Z },
    resolveCircle(position, radius) {
      resolveCircleAgainstBoxes(position, radius, buildingBoxes);
      position.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, position.x));
      position.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, position.z));
    },
    update(dt) {
      waterTexture.offset.x += dt * 0.008;
      waterTexture.offset.y += dt * 0.005;
    },
  };
}
