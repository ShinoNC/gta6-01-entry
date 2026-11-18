// Loads the pixel-art PNG textures and keeps them chunky: NearestFilter means
// a texel stays one hard square instead of blurring, which is the whole look.
// Ground textures that stretch to the horizon (road, sand, water, sidewalk)
// use nearest-mipmapped minification so they stay crisp up close without
// shimmering far away; flat sprites (cars, palms, facades) stay unmipped.
import * as THREE from 'three';

const TEXTURE_FILES = {
  facadeA: 'facade-a.png',
  facadeB: 'facade-b.png',
  facadeC: 'facade-c.png',
  facadeD: 'facade-d.png',
  road: 'road.png',
  sidewalk: 'sidewalk.png',
  sand: 'sand.png',
  palm: 'palm.png',
  carRed: 'car-red.png',
  carBlue: 'car-blue.png',
  carTaxi: 'car-taxi.png',
  water: 'water.png',
  roof: 'roof.png',
  billboard: 'billboard.png',
};
// Textures tiled over long ground planes: mipmaps kill the far-field shimmer.
const MIPMAPPED_TEXTURES = new Set(['road', 'sidewalk', 'sand', 'water']);

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
            if (MIPMAPPED_TEXTURES.has(name)) {
              texture.minFilter = THREE.NearestMipmapLinearFilter;
              texture.generateMipmaps = true;
              texture.anisotropy = 4;
            } else {
              texture.minFilter = THREE.NearestFilter;
              texture.generateMipmaps = false;
            }
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
