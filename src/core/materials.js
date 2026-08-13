import * as THREE from 'three';

export const PALETTE = Object.freeze({
  ink: 0x1d1b18,
  night: 0x172534,
  earthDark: 0x5d4028,
  earth: 0x96633a,
  earthLight: 0xc18a53,
  earthCourse: 0x79492d,
  clayWash: 0xd09a62,
  path: 0xc3a274,
  hemp: 0xddc99c,
  hempDark: 0x88775d,
  timber: 0x704a2d,
  timberDark: 0x402d22,
  tile: 0x53635f,
  tileLight: 0x82958a,
  tileDark: 0x394946,
  thatch: 0x9a8151,
  thatchLight: 0xc1a567,
  thatchDark: 0x6d5a38,
  bamboo: 0xc5a45e,
  bambooLight: 0xe0c77f,
  bambooDark: 0x76562d,
  millet: 0xe1b843,
  milletLight: 0xf4d878,
  milletDark: 0xa97925,
  grass: 0x709b4d,
  grassLight: 0xa5c864,
  grassDark: 0x355f3d,
  leaf: 0x527d43,
  peach: 0xc97f76,
  water: 0x5f9b9d,
  sky: 0x90b7c2,
  lacquer: 0x2a1a16,
  clothIndigo: 0x445963,
  clothRust: 0x8f4d38,
  clothFaded: 0xb49a72,
  seal: 0x9d3229,
  sealBright: 0xc64a35,
  gold: 0xf2bf46,
  ox: 0x69402a,
  pig: 0xd98777,
  horse: 0x8f4a29,
  white: 0xece4cf,
  black: 0x242522,
});

export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.86,
    metalness: opts.metalness ?? 0,
    flatShading: opts.flatShading ?? true,
    vertexColors: opts.vertexColors ?? false,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

export function enableShadows(root, cast = true, receive = true) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = cast && !o.userData.noShadow;
    o.receiveShadow = receive;
  });
  return root;
}

export function varyColor(base, factor) {
  const c = new THREE.Color(base);
  c.offsetHSL(0, 0, factor);
  return c;
}
