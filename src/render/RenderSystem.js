import * as THREE from 'three';
import { compileMeshes, Owned } from '../../lib/index.js';
import { PALETTE } from '../core/materials.js';

const SKY = {
  dawn: [0xd79b78, 0x8ba2b5, 0xffd99a],
  morning: [0x8bb8c8, 0xb8d2cf, 0xffe3ad],
  noon: [0x79acc4, 0xc9d9d0, 0xffe8bd],
  afternoon: [0x85b2bd, 0xb9c6ac, 0xffcf82],
  dusk: [0xbd6e5e, 0x59647a, 0xffb15f],
  night: [0x172638, 0x223245, 0x6c594a],
};

export class RenderSystem {
  static id = 'render';
  static deps = [];

  async init(ctx) {
    this.ctx = ctx;
    this.own = new Owned();
    const q = ctx.config.q;
    const renderer = new THREE.WebGLRenderer({ canvas: ctx.canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('[render] WebGL2 is required');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = true;
    this.renderer = this.own.add(renderer);
    this.scale = q.renderScale;

    this.sun = new THREE.DirectionalLight(0xffdfb4, 4.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 130;
    Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 38, bottom: -38 });
    this.sun.shadow.bias = -0.00045 * (2048 / q.shadowMapSize);
    this.sun.shadow.normalBias = 0.035;
    ctx.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xaed3d8, 0x756249, 1.8);
    ctx.scene.add(this.hemi);
    this.fill = new THREE.DirectionalLight(0xaec8dc, 0.95);
    this.fill.position.set(-25, 20, -15);
    ctx.scene.add(this.fill);

    ctx.scene.fog = new THREE.Fog(0x9db8ba, 55, 155);
    this._bg = new THREE.Color(PALETTE.sky);
    this._sunDir = new THREE.Vector3();
    this._tmpColor = new THREE.Color();
    this._hour = 5.7;
    this._phase = 'dawn';
    this.setTimeOfDay(this._hour, this._phase);
  }

  resize(w, h) {
    this._w = w; this._h = h;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.7) * this.scale);
    this.renderer.setSize(w, h, false);
  }

  setTimeOfDay(hour, forcedPhase = null) {
    this._hour = hour;
    const phase = forcedPhase ?? (hour < 7 ? 'dawn' : hour < 11.5 ? 'morning' : hour < 14 ? 'noon' : hour < 17.5 ? 'afternoon' : hour < 19.5 ? 'dusk' : 'night');
    this._phase = phase;
    const data = SKY[phase];
    const t = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(t);
    const daylight = Math.max(0, elev);
    const az = t - 0.55;
    this.sun.position.set(Math.cos(az) * 75, Math.max(4, elev * 72), Math.sin(az) * 42);
    this.sun.intensity = phase === 'night' ? 0.28 : 2.5 + daylight * 2.35;
    this.sun.color.set(data[2]);
    this.hemi.color.set(data[1]);
    this.hemi.groundColor.set(phase === 'night' ? 0x273229 : 0x766248);
    this.hemi.intensity = phase === 'night' ? 0.86 : phase === 'dusk' ? 2.05 : 1.55 + daylight * 0.45;
    this.fill.intensity = phase === 'night' ? 0.42 : phase === 'dusk' ? 1.18 : 0.88;
    this._bg.set(data[0]);
    ctxSafeSet(this.ctx.scene, this._bg);
    this.ctx.scene.fog.color.copy(this._bg).lerp(this._tmpColor.set(data[1]), 0.35);
    this.renderer.toneMappingExposure = phase === 'night' ? 1.02 : phase === 'dusk' ? 1.28 : 1.08;
    return phase;
  }

  lateUpdate(_dt, ctx) {
    const cam = ctx.camera;
    this.sun.target.position.set(cam.position.x, 0, cam.position.z);
    const dir = this._sunDir.copy(this.sun.position).normalize().multiplyScalar(72);
    this.sun.position.copy(this.sun.target.position).add(dir);
    const texel = 90 / ctx.config.q.shadowMapSize;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.target.updateMatrixWorld();
  }

  render(ctx) {
    this.renderer.render(ctx.scene, ctx.camera);
    if (ctx.overlayScene.children.length) {
      this.renderer.clearDepth();
      this.renderer.render(ctx.overlayScene, ctx.overlayCamera);
    }
  }

  resetTemporal() { return true; }

  async prewarmMaterials(ctx) {
    const meshes = [];
    ctx.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const compiled = compileMeshes(this.renderer, meshes, ctx.scene, ctx.camera);
    return { ok: true, compiled, meshes: meshes.length };
  }

  dispose() { this.own.disposeAll(); }
}

function ctxSafeSet(scene, color) {
  if (!scene.background?.isColor) scene.background = new THREE.Color();
  scene.background.copy(color);
}
