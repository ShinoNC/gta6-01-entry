import * as THREE from 'three';

// One entry per texture file in game/assets/. The keys are the names the
// rest of the game looks textures up by; the values are the file names.
const TEXTURE_FILES = {
  facadeA: 'facade-a.png',
  facadeB: 'facade-b.png',
  facadeC: 'facade-c.png',
  facadeD: 'facade-d.png',
  facadeE: 'facade-e.png',
  facadeF: 'facade-f.png',
  palm: 'palm.png',
  carRed: 'car-red.png',
  carBlue: 'car-blue.png',
  carTaxi: 'car-taxi.png',
  carWhite: 'car-white.png',
  roof: 'roof.png',
  billboard: 'billboard.png',
};

// Smooth filtering for every texture: linear magnification blends texels
// instead of stamping each one as a hard-edged square, and trilinear
// minification with mipmaps keeps distant surfaces free of shimmer.
// Anisotropy sharpens surfaces seen at a grazing angle, like roads
// stretching away from the camera.
function smoothTexture(texture) {
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
}

export function loadTextures() {
  const loader = new THREE.TextureLoader();
  const loaded = {};
  const jobs = Object.entries(TEXTURE_FILES).map(
    ([name, file]) =>
      new Promise((resolve, reject) => {
        loader.load(
          `./assets/${file}`,
          (texture) => {
            smoothTexture(texture);
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
