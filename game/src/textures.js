// Loads the pixel-art PNG textures and keeps them chunky: NearestFilter means
// a texel stays one hard square instead of blurring, which is the whole look.
import * as THREE from 'three';

const TEXTURE_FILES = {
  facadeA: 'facade-a.png',
  facadeB: 'facade-b.png',
  facadeC: 'facade-c.png',
  road: 'road.png',
  sidewalk: 'sidewalk.png',
  sand: 'sand.png',
  palm: 'palm.png',
  carRed: 'car-red.png',
  carBlue: 'car-blue.png',
  water: 'water.png',
  roof: 'roof.png',
};

// Load every texture; resolves to { name: THREE.Texture }. Ground textures
// repeat, so they get RepeatWrapping here and their repeat set by the caller.
export function loadTextures() {
  const loader = new THREE.TextureLoader();
  const loaded = {};
  const jobs = Object.entries(TEXTURE_FILES).map(
    ([name, file]) =>
      new Promise((resolve, reject) => {
        loader.load(
          `./assets/${file}`,
          (texture) => {
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.generateMipmaps = false;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            loaded[name] = texture;
            resolve();
          },
          undefined,
          () => reject(new Error(`texture failed to load: ${file}`)),
        );
      }),
  );
  return Promise.all(jobs).then(() => loaded);
}
