import * as THREE from 'three';
import { PALETTE, mat } from '../core/materials.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const FALLBACK = Object.freeze({
  water: [-8, 0.45, 11],
  harvest: [0.4, 0.8, 2.3],
  thresh: [8.5, 1.2, 4.2],
  ledger: [17.2, 1.5, -2.0],
  seed: [10.8, 1.1, -15.7],
  lamp: [-7.2, 1.3, -12.8],
  complete: [-12.6, 1.5, -9.6],
});

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
function easeOutBack(value) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = value - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function fxMaterial(color, options = {}) {
  const material = mat(color, {
    roughness: options.roughness ?? 0.65,
    metalness: options.metalness ?? 0,
    transparent: options.transparent ?? true,
    opacity: options.opacity ?? 0.9,
    emissive: options.emissive ?? 0,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  material.depthWrite = false;
  material.blending = options.blending ?? THREE.NormalBlending;
  return material;
}

/** Fixed-slot, instanced particle batch. Slots are overwritten in a ring and
 * transformed in place; update() allocates nothing. */
class ParticleBatch {
  constructor(parent, geometry, material, capacity, mode) {
    this.capacity = capacity;
    this.mode = mode;
    this.cursor = 0;
    this.live = 0;
    this.active = new Uint8Array(capacity);
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = `FxBatch:${mode}`;
    this.mesh.count = capacity;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.userData.noShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, ZERO_MATRIX);
    this.mesh.instanceMatrix.needsUpdate = true;
    parent.add(this.mesh);

    this._position = new THREE.Vector3();
    this._velocity = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._spinQuaternion = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._matrix = new THREE.Matrix4();
  }

  spawn(px, py, pz, vx, vy, vz, life, size, spin, seed) {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (!this.active[index]) this.live++;
    this.active[index] = 1;
    const offset = index * 3;
    this.position[offset] = px;
    this.position[offset + 1] = py;
    this.position[offset + 2] = pz;
    this.velocity[offset] = vx;
    this.velocity[offset + 1] = vy;
    this.velocity[offset + 2] = vz;
    this.age[index] = 0;
    this.life[index] = life;
    this.size[index] = size;
    this.spin[index] = spin;
    this.seed[index] = seed;
    return index;
  }

  update(dt, time, camera) {
    let dirty = false;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      const age = this.age[i] + dt;
      this.age[i] = age;
      if (age >= this.life[i]) {
        this.active[i] = 0;
        this.live--;
        this.mesh.setMatrixAt(i, ZERO_MATRIX);
        dirty = true;
        continue;
      }

      const offset = i * 3;
      const lifeT = age / this.life[i];
      let vx = this.velocity[offset];
      let vy = this.velocity[offset + 1];
      let vz = this.velocity[offset + 2];
      let drag = 1;
      let gravity = 0;
      if (this.mode === 'water') {
        gravity = -7.8;
        drag = Math.exp(-0.3 * dt);
      } else if (this.mode === 'chaff') {
        gravity = -2.4;
        drag = Math.exp(-1.15 * dt);
      } else if (this.mode === 'dust') {
        gravity = 0.2;
        drag = Math.exp(-2.2 * dt);
      } else if (this.mode === 'gift') {
        gravity = -0.42;
        drag = Math.exp(-0.6 * dt);
        const swirl = this.seed[i] * TAU + time * 2.1;
        vx += Math.cos(swirl) * dt * 0.42;
        vz += Math.sin(swirl) * dt * 0.42;
      } else if (this.mode === 'ember') {
        gravity = 0.55;
        drag = Math.exp(-0.85 * dt);
        vx += Math.sin(time * 3.1 + this.seed[i] * 9) * dt * 0.18;
      }
      vx *= drag;
      vy = vy * drag + gravity * dt;
      vz *= drag;
      this.velocity[offset] = vx;
      this.velocity[offset + 1] = vy;
      this.velocity[offset + 2] = vz;
      this.position[offset] += vx * dt;
      this.position[offset + 1] += vy * dt;
      this.position[offset + 2] += vz * dt;

      let size = this.size[i];
      let sx = size;
      let sy = size;
      let sz = size;
      if (this.mode === 'water') {
        const fade = 1 - lifeT * 0.78;
        sx = size * fade;
        sy = size * (1.45 + Math.abs(vy) * 0.25) * fade;
        sz = size * fade;
        this._velocity.set(vx, vy, vz);
        if (this._velocity.lengthSq() > 0.000001) {
          this._velocity.normalize();
          this._quaternion.setFromUnitVectors(Y_AXIS, this._velocity);
        } else this._quaternion.identity();
      } else if (this.mode === 'dust') {
        const bloom = Math.sin(Math.PI * clamp01(lifeT));
        size *= 0.35 + bloom * 1.45;
        sx = size * (1.1 + this.seed[i] * 0.45);
        sy = size;
        sz = size;
        this._quaternion.copy(camera.quaternion);
        this._spinQuaternion.setFromAxisAngle(Z_AXIS, this.spin[i] + age * (0.2 + this.seed[i]));
        this._quaternion.multiply(this._spinQuaternion);
      } else {
        const fade = 1 - lifeT * (this.mode === 'ember' ? 0.55 : 0.82);
        const twinkle = this.mode === 'gift' || this.mode === 'ember'
          ? 0.76 + Math.sin(time * 10 + this.seed[i] * 17) * 0.24
          : 1;
        sx = size * fade * twinkle;
        sy = size * fade * twinkle;
        sz = size * fade * twinkle;
        this._euler.set(
          this.spin[i] + age * (1.7 + this.seed[i]),
          this.seed[i] * TAU + age * 2.2,
          this.spin[i] * 0.7 + age * 1.35,
        );
        this._quaternion.setFromEuler(this._euler);
      }

      this._position.set(this.position[offset], this.position[offset + 1], this.position[offset + 2]);
      this._scale.set(sx, sy, sz);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.mesh.setMatrixAt(i, this._matrix);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.active.fill(0);
    this.live = 0;
    this.cursor = 0;
    for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, ZERO_MATRIX);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.dispose();
  }
}

/** A retained pool of orbiting, pulsing fireflies. The pattern is initialized
 * once from a forked deterministic RNG and merely re-centered for each burst. */
class FireflyField {
  constructor(parent, geometry, material, capacity, rng) {
    this.capacity = capacity;
    this.phase = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.height = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.phase[i] = rng.range(0, TAU);
      this.radius[i] = rng.range(0.45, 2.15);
      this.height[i] = rng.range(0.15, 1.65);
      this.speed[i] = rng.range(0.32, 0.88) * (i % 2 ? -1 : 1);
    }
    this.centerX = 0;
    this.centerY = 0;
    this.centerZ = 0;
    this.start = -1;
    this.end = -1;
    this.active = false;

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'FxBatch:fireflies';
    this.mesh.count = capacity;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.userData.noShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, ZERO_MATRIX);
    this.mesh.instanceMatrix.needsUpdate = true;
    parent.add(this.mesh);

    this._position = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._matrix = new THREE.Matrix4();
  }

  show(x, y, z, now, duration) {
    this.centerX = x;
    this.centerY = y;
    this.centerZ = z;
    this.start = now;
    this.end = now + duration;
    this.active = true;
  }

  update(time) {
    if (!this.active) return;
    if (time >= this.end) {
      this.clear();
      return;
    }
    const fadeIn = clamp01((time - this.start) * 2.4);
    const fadeOut = clamp01((this.end - time) * 0.8);
    const fade = Math.min(fadeIn, fadeOut);
    for (let i = 0; i < this.capacity; i++) {
      const angle = this.phase[i] + time * this.speed[i];
      const orbit = this.radius[i];
      const x = this.centerX + Math.cos(angle) * orbit + Math.sin(time * 0.71 + i) * 0.16;
      const y = this.centerY + this.height[i] + Math.sin(time * 1.45 + this.phase[i] * 2) * 0.22;
      const z = this.centerZ + Math.sin(angle) * orbit * 0.7;
      const pulse = 0.045 + (0.5 + 0.5 * Math.sin(time * 8.5 + this.phase[i] * 3)) * 0.055;
      const size = pulse * fade;
      this._position.set(x, y, z);
      this._scale.set(size, size, size);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.mesh.setMatrixAt(i, this._matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.active = false;
    this.start = -1;
    this.end = -1;
    for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, ZERO_MATRIX);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.dispose();
  }
}

/**
 * Pooled world-space feedback for every first-day milestone. No burst creates a
 * mesh and no update creates a vector, matrix, quaternion, array, or object.
 */
export class FxSystem {
  static id = 'fx';
  static deps = ['render'];

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.debugRng = ctx.rng.fork();
    this._debugRngState = this.debugRng.save();
    this.root = new THREE.Group();
    this.root.name = 'HanFarmFx';
    ctx.scene.add(this.root);
    this._position = new THREE.Vector3();
    this._playerPosition = new THREE.Vector3();
    this._debugPosition = new THREE.Vector3();
    this._debugKind = 'none';
    this._phase = 'dawn';

    this._makeResources();
    this._makeBatches();
    this._makeSeal();
    this._makeLampFlare();

    this._offSuccess = ctx.events.on('interaction:success', (event) => this._onInteraction(event));
    this._offComplete = ctx.events.on('day:complete', (event) => this._onDayComplete(event));
    this._offPhase = ctx.events.on('day:phase', (event) => this._onDayPhase(event));

    const farm = ctx.peek('farm');
    this._phase = farm?.phase ?? this._phase;
    if (this._phase === 'night') {
      const p = FALLBACK.lamp;
      this.fireflies.show(p[0], p[1], p[2], ctx.time.elapsed, farm?.dayComplete ? 30 : 12);
    }
  }

  _makeResources() {
    this.G = {
      drop: new THREE.IcosahedronGeometry(0.12, 0),
      chaff: new THREE.TetrahedronGeometry(0.12, 0),
      dust: new THREE.IcosahedronGeometry(0.18, 1),
      gift: new THREE.OctahedronGeometry(0.1, 0),
      ember: new THREE.IcosahedronGeometry(0.09, 0),
      firefly: new THREE.IcosahedronGeometry(1, 0),
      circle: new THREE.CircleGeometry(0.72, 24),
      sealRing: new THREE.RingGeometry(0.5, 0.68, 8),
      cube: new THREE.BoxGeometry(1, 1, 1),
      flame: new THREE.ConeGeometry(0.22, 0.6, 7),
      glow: new THREE.IcosahedronGeometry(0.58, 1),
      halo: new THREE.TorusGeometry(0.58, 0.045, 5, 20),
    };
    this.M = {
      water: fxMaterial(0x83d6d2, { roughness: 0.2, opacity: 0.9, emissive: 0x153c43, emissiveIntensity: 0.32 }),
      chaff: fxMaterial(PALETTE.milletLight, { roughness: 0.75, opacity: 0.96, emissive: 0x4b3100, emissiveIntensity: 0.22 }),
      leaf: fxMaterial(PALETTE.grassLight, { roughness: 0.76, opacity: 0.94, emissive: 0x183a10, emissiveIntensity: 0.18 }),
      dust: fxMaterial(0xb39369, { roughness: 1, opacity: 0.34 }),
      gift: fxMaterial(PALETTE.gold, { roughness: 0.35, opacity: 0.95, emissive: 0x8e4d05, emissiveIntensity: 0.75, blending: THREE.AdditiveBlending }),
      ember: fxMaterial(0xffbd54, { roughness: 0.25, opacity: 0.94, emissive: 0xff6b16, emissiveIntensity: 1.25, blending: THREE.AdditiveBlending }),
      firefly: new THREE.MeshBasicMaterial({ color: 0xffe779, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      stamp: new THREE.MeshBasicMaterial({ color: PALETTE.seal, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide }),
      stampGold: new THREE.MeshBasicMaterial({ color: PALETTE.gold, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }),
      stampInk: new THREE.MeshBasicMaterial({ color: PALETTE.lacquer, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide }),
      flame: new THREE.MeshBasicMaterial({ color: 0xffbd54, transparent: true, opacity: 0.96, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      glow: new THREE.MeshBasicMaterial({ color: 0xff8a32, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    };
  }

  _makeBatches() {
    const budget = this.ctx.config.q.particleBudget;
    const factor = budget < 3000 ? 0.55 : budget < 10000 ? 0.8 : 1;
    const count = (base) => Math.max(8, Math.floor(base * factor));
    this.water = new ParticleBatch(this.root, this.G.drop, this.M.water, count(52), 'water');
    this.chaff = new ParticleBatch(this.root, this.G.chaff, this.M.chaff, count(76), 'chaff');
    this.leaves = new ParticleBatch(this.root, this.G.chaff, this.M.leaf, count(42), 'chaff');
    this.dust = new ParticleBatch(this.root, this.G.dust, this.M.dust, count(64), 'dust');
    this.gift = new ParticleBatch(this.root, this.G.gift, this.M.gift, count(72), 'gift');
    this.embers = new ParticleBatch(this.root, this.G.ember, this.M.ember, count(42), 'ember');
    this.fireflies = new FireflyField(this.root, this.G.firefly, this.M.firefly, count(38), this.rng);
    this.batches = [this.water, this.chaff, this.leaves, this.dust, this.gift, this.embers];
  }

  _makeSeal() {
    this.sealRoot = new THREE.Group();
    this.sealRoot.name = 'LedgerSealFeedback';
    this.sealRoot.visible = false;
    const face = new THREE.Group();
    this.sealRoot.add(face);
    const disc = new THREE.Mesh(this.G.circle, this.M.stamp);
    face.add(disc);
    const ring = new THREE.Mesh(this.G.sealRing, this.M.stampGold);
    ring.position.z = 0.012;
    face.add(ring);
    const barA = new THREE.Mesh(this.G.cube, this.M.stampInk);
    barA.scale.set(0.12, 0.82, 0.035);
    barA.position.z = 0.026;
    face.add(barA);
    const barB = new THREE.Mesh(this.G.cube, this.M.stampInk);
    barB.scale.set(0.72, 0.11, 0.035);
    barB.position.set(0, 0.11, 0.026);
    face.add(barB);
    const barC = new THREE.Mesh(this.G.cube, this.M.stampInk);
    barC.scale.set(0.5, 0.09, 0.035);
    barC.position.set(0, -0.2, 0.026);
    face.add(barC);
    const cornerA = new THREE.Mesh(this.G.cube, this.M.stampGold);
    cornerA.scale.set(0.13, 0.13, 0.035);
    cornerA.position.set(-0.3, 0.3, 0.03);
    cornerA.rotation.z = Math.PI * 0.25;
    face.add(cornerA);
    const cornerB = cornerA.clone();
    cornerB.position.x = 0.3;
    face.add(cornerB);
    this.root.add(this.sealRoot);
    this._sealStart = -1;
    this._sealEnd = -1;
    this._sealBaseY = 0;
    this._sealMaterials = [this.M.stamp, this.M.stampGold, this.M.stampInk];
  }

  _makeLampFlare() {
    this.lampRoot = new THREE.Group();
    this.lampRoot.name = 'LampKindledFeedback';
    this.lampRoot.visible = false;
    const glow = new THREE.Mesh(this.G.glow, this.M.glow);
    glow.userData.noShadow = true;
    this.lampRoot.add(glow);
    const flame = new THREE.Mesh(this.G.flame, this.M.flame);
    flame.position.y = 0.18;
    flame.userData.noShadow = true;
    this.lampRoot.add(flame);
    const haloA = new THREE.Mesh(this.G.halo, this.M.flame);
    haloA.rotation.x = HALF_PI;
    haloA.userData.noShadow = true;
    this.lampRoot.add(haloA);
    const haloB = new THREE.Mesh(this.G.halo, this.M.glow);
    haloB.rotation.y = HALF_PI;
    haloB.userData.noShadow = true;
    this.lampRoot.add(haloB);
    this.root.add(this.lampRoot);
    this._lampStart = -1;
    this._lampEnd = -1;
  }

  _onInteraction(event) {
    const id = event?.id ?? '';
    const rng = this.rng;
    if (id === 'well' || id.startsWith('water')) {
      this._resolvePosition(event, FALLBACK.water);
      this._burstWater(this._position.x, this._position.y + 0.25, this._position.z, rng);
    } else if (id.startsWith('harvest')) {
      this._resolvePosition(event, FALLBACK.harvest);
      this._burstChaff(this._position.x, this._position.y + 0.75, this._position.z, rng);
    } else if (id === 'thresher') {
      this._resolvePosition(event, FALLBACK.thresh);
      this._burstThresh(this._position.x, this._position.y + 0.35, this._position.z, rng);
    } else if (id === 'granary') {
      this._resolvePosition(event, FALLBACK.ledger);
      this._burstLedger(this._position.x, this._position.y + 1.1, this._position.z, rng);
    } else if (id === 'refugees') {
      this._resolvePosition(event, FALLBACK.seed);
      this._burstSeedGift(this._position.x, this._position.y + 0.8, this._position.z, rng);
    } else if (id === 'shrine' || id === 'bed') {
      this._resolvePosition(event, FALLBACK.lamp);
      this._burstLamp(this._position.x, this._position.y + 0.75, this._position.z, rng, 8);
    }
  }

  _onDayComplete(event) {
    this._resolvePosition(event, FALLBACK.complete);
    this._burstLedger(this._position.x, this._position.y + 1.25, this._position.z, this.rng);
    this._burstLamp(this._position.x - 0.7, this._position.y + 0.25, this._position.z + 0.4, this.rng, 13);
  }

  _onDayPhase(event) {
    this._phase = event?.phase ?? this._phase;
    if (this._phase === 'night' && !this.fireflies.active) {
      const p = FALLBACK.lamp;
      this.fireflies.show(p[0], p[1], p[2], this.ctx.time.elapsed, 30);
    }
  }

  _resolvePosition(event, fallback) {
    const world = event?.world;
    if (world) {
      if (Array.isArray(world)) this._position.set(world[0] ?? fallback[0], world[1] ?? fallback[1], world[2] ?? fallback[2]);
      else this._position.set(world.x ?? fallback[0], world.y ?? fallback[1], world.z ?? fallback[2]);
      return this._position;
    }
    const id = event?.id;
    const worldSystem = this.ctx.peek('world');
    if (id && typeof worldSystem?.getInteractablePosition === 'function') {
      const result = worldSystem.getInteractablePosition(id, this._position);
      if (result) return this._position;
    }
    const actors = this.ctx.peek('actors');
    if (typeof actors?.getPlayerVisualPosition === 'function') {
      actors.getPlayerVisualPosition(this._playerPosition);
      this._position.copy(this._playerPosition);
      return this._position;
    }
    this._position.set(fallback[0], fallback[1], fallback[2]);
    return this._position;
  }

  _burstWater(x, y, z, rng) {
    const count = Math.min(28, this.water.capacity);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + rng.range(-0.16, 0.16);
      const radial = rng.range(0.65, 1.9);
      this.water.spawn(
        x + Math.cos(angle) * 0.12,
        y + rng.range(0, 0.16),
        z + Math.sin(angle) * 0.12,
        Math.cos(angle) * radial,
        rng.range(1.7, 3.5),
        Math.sin(angle) * radial,
        rng.range(0.55, 0.88),
        rng.range(0.55, 1.15),
        rng.range(0, TAU),
        rng.float(),
      );
    }
  }

  _burstChaff(x, y, z, rng) {
    const count = Math.min(38, this.chaff.capacity);
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, TAU);
      const radial = rng.range(0.35, 1.45);
      this.chaff.spawn(
        x + rng.range(-0.25, 0.25),
        y + rng.range(-0.05, 0.45),
        z + rng.range(-0.25, 0.25),
        Math.cos(angle) * radial,
        rng.range(0.8, 2.8),
        Math.sin(angle) * radial,
        rng.range(0.9, 1.65),
        rng.range(0.55, 1.15),
        rng.range(0, TAU),
        rng.float(),
      );
    }
  }

  _burstLeaves(x, y, z, rng) {
    const count = Math.min(32, this.leaves.capacity);
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, TAU);
      const radial = rng.range(0.45, 1.65);
      this.leaves.spawn(
        x + rng.range(-0.28, 0.28),
        y + rng.range(-0.25, 0.55),
        z + rng.range(-0.28, 0.28),
        Math.cos(angle) * radial,
        rng.range(0.7, 2.45),
        Math.sin(angle) * radial,
        rng.range(1.1, 2.15),
        rng.range(0.85, 1.45),
        rng.range(0, TAU),
        rng.float(),
      );
    }
  }

  _burstFeed(x, y, z, rng) {
    const count = Math.min(28, this.chaff.capacity);
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, TAU);
      const radial = rng.range(0.15, 0.85);
      this.chaff.spawn(
        x + rng.range(-0.2, 0.2),
        y + rng.range(0.08, 0.4),
        z + rng.range(-0.2, 0.2),
        Math.cos(angle) * radial,
        rng.range(0.3, 1.25),
        Math.sin(angle) * radial,
        rng.range(0.75, 1.35),
        rng.range(0.35, 0.72),
        rng.range(0, TAU),
        rng.float(),
      );
    }
  }

  _burstGroom(x, y, z, rng) {
    const count = Math.min(24, this.gift.capacity);
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      this.gift.spawn(
        x + side * rng.range(0.05, 0.55),
        y + rng.range(-0.35, 0.65),
        z + rng.range(-0.28, 0.28),
        side * rng.range(0.1, 0.55),
        rng.range(0.25, 1.05),
        rng.range(-0.25, 0.25),
        rng.range(1.1, 1.9),
        rng.range(0.42, 0.8),
        rng.range(0, TAU),
        rng.float(),
      );
    }
  }

  _burstThresh(x, y, z, rng) {
    const dustCount = Math.min(30, this.dust.capacity);
    for (let i = 0; i < dustCount; i++) {
      const angle = rng.range(0, TAU);
      const radial = rng.range(0.15, 0.9);
      this.dust.spawn(
        x + Math.cos(angle) * rng.range(0.1, 0.65),
        y + rng.range(0.05, 0.55),
        z + Math.sin(angle) * rng.range(0.1, 0.65),
        Math.cos(angle) * radial,
        rng.range(0.25, 1.0),
        Math.sin(angle) * radial,
        rng.range(1.15, 1.9),
        rng.range(0.85, 1.6),
        rng.range(0, TAU),
        rng.float(),
      );
    }
    const chaffCount = Math.min(24, this.chaff.capacity);
    for (let i = 0; i < chaffCount; i++) {
      const angle = rng.range(-1.0, 1.0);
      this.chaff.spawn(
        x + rng.range(-0.45, 0.45),
        y + rng.range(0.15, 0.8),
        z + rng.range(-0.35, 0.35),
        Math.sin(angle) * rng.range(0.5, 1.4),
        rng.range(1.0, 2.5),
        Math.cos(angle) * rng.range(0.5, 1.3),
        rng.range(1.0, 1.7),
        rng.range(0.5, 1.0),
        rng.range(0, TAU),
        rng.float(),
      );
    }
  }

  _burstLedger(x, y, z, rng) {
    this._showSeal(x, y, z, 2.75);
    const count = Math.min(30, this.gift.capacity);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + rng.range(-0.1, 0.1);
      const radial = rng.range(0.75, 1.8);
      this.gift.spawn(
        x + Math.cos(angle) * 0.25,
        y + Math.sin(angle * 2) * 0.16,
        z + Math.sin(angle) * 0.15,
        Math.cos(angle) * radial,
        rng.range(0.5, 1.8),
        Math.sin(angle) * radial * 0.45,
        rng.range(1.0, 1.75),
        rng.range(0.55, 1.15),
        rng.range(0, TAU),
        rng.float(),
      );
    }
  }

  _burstSeedGift(x, y, z, rng) {
    const count = Math.min(42, this.gift.capacity);
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, TAU);
      const radius = rng.range(0.08, 0.65);
      this.gift.spawn(
        x + Math.cos(angle) * radius,
        y + rng.range(-0.15, 0.25),
        z + Math.sin(angle) * radius,
        Math.cos(angle) * rng.range(0.2, 0.9),
        rng.range(0.8, 2.1),
        Math.sin(angle) * rng.range(0.2, 0.9),
        rng.range(1.35, 2.25),
        rng.range(0.48, 1.0),
        rng.range(0, TAU),
        rng.float(),
      );
    }
  }

  _burstLamp(x, y, z, rng, duration) {
    this._showLamp(x, y, z, duration);
    this.fireflies.show(x, y - 0.45, z, this.ctx.time.elapsed, duration);
    const count = Math.min(24, this.embers.capacity);
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, TAU);
      this.embers.spawn(
        x + Math.cos(angle) * rng.range(0.02, 0.22),
        y + rng.range(0, 0.25),
        z + Math.sin(angle) * rng.range(0.02, 0.22),
        Math.cos(angle) * rng.range(0.05, 0.3),
        rng.range(0.45, 1.05),
        Math.sin(angle) * rng.range(0.05, 0.3),
        rng.range(1.0, 2.1),
        rng.range(0.55, 1.2),
        rng.range(0, TAU),
        rng.float(),
      );
    }
  }

  _showSeal(x, y, z, duration) {
    this.sealRoot.position.set(x, y, z);
    this._sealBaseY = y;
    this.sealRoot.scale.setScalar(0.001);
    this.sealRoot.visible = true;
    this._sealStart = this.ctx.time.elapsed;
    this._sealEnd = this._sealStart + duration;
  }

  _showLamp(x, y, z, duration) {
    this.lampRoot.position.set(x, y, z);
    this.lampRoot.scale.setScalar(0.001);
    this.lampRoot.visible = true;
    this._lampStart = this.ctx.time.elapsed;
    this._lampEnd = this._lampStart + duration;
  }

  update(dt, ctx) {
    const t = ctx.time.elapsed;
    for (let i = 0; i < this.batches.length; i++) this.batches[i].update(dt, t, ctx.camera);
    this.fireflies.update(t);
    this._updateSeal(t, ctx.camera);
    this._updateLamp(t);
  }

  _updateSeal(time, camera) {
    if (!this.sealRoot.visible) return;
    if (time >= this._sealEnd) {
      this.sealRoot.visible = false;
      return;
    }
    const age = time - this._sealStart;
    const duration = this._sealEnd - this._sealStart;
    const normalized = clamp01(age / duration);
    const intro = clamp01(age * 4.2);
    const outro = clamp01((this._sealEnd - time) * 2.1);
    const scale = easeOutBack(intro) * (0.85 + outro * 0.15);
    this.sealRoot.scale.setScalar(scale);
    this.sealRoot.position.y = this._sealBaseY + Math.sin(time * 2.4) * 0.035;
    this.sealRoot.quaternion.copy(camera.quaternion);
    this.sealRoot.rotateZ(0.08 + normalized * 0.18);
    const opacity = Math.min(1, outro * 1.3);
    this.M.stamp.opacity = opacity * 0.9;
    this.M.stampGold.opacity = opacity;
    this.M.stampInk.opacity = opacity * 0.92;
  }

  _updateLamp(time) {
    if (!this.lampRoot.visible) return;
    if (time >= this._lampEnd) {
      this.lampRoot.visible = false;
      return;
    }
    const age = time - this._lampStart;
    const intro = clamp01(age * 4.5);
    const outro = clamp01((this._lampEnd - time) * 1.2);
    const pulse = 1 + Math.sin(time * 9.2) * 0.09 + Math.sin(time * 13.7) * 0.035;
    this.lampRoot.scale.setScalar((0.65 + easeOutBack(intro) * 0.35) * pulse * Math.min(1, outro * 1.5));
    this.lampRoot.rotation.y = time * 0.28;
    this.lampRoot.children[2].rotation.z = time * 0.42;
    this.lampRoot.children[3].rotation.z = -time * 0.35;
    this.M.flame.opacity = Math.min(0.96, outro * 1.4);
    this.M.glow.opacity = Math.min(0.24, outro * 0.35);
  }

  /** Deterministic capture hook. Each call first removes every older transient;
   * debug RNG state is restored so repeated captures are pixel-identical. */
  debugBurst(kind = 'none', world = null) {
    const value = String(kind ?? 'none').toLowerCase();
    this.clear();
    if (value === 'none' || value === 'clean') return 'none';
    this._debugKind = value;
    this.debugRng.load(this._debugRngState);
    const rng = this.debugRng;
    let p;
    if (value === 'water' || value === 'water-splash') {
      p = FALLBACK.water;
      this._setDebugPosition(world, p);
      this._burstWater(this._debugPosition.x, this._debugPosition.y + 0.3, this._debugPosition.z, rng);
    } else if (value === 'harvest' || value === 'harvest-chaff' || value === 'chaff') {
      p = FALLBACK.harvest;
      this._setDebugPosition(world, p);
      this._burstChaff(this._debugPosition.x, this._debugPosition.y + 0.55, this._debugPosition.z, rng);
    } else if (value === 'thresh' || value === 'thresh-dust' || value === 'dust') {
      p = FALLBACK.thresh;
      this._setDebugPosition(world, p);
      this._burstThresh(this._debugPosition.x, this._debugPosition.y, this._debugPosition.z, rng);
    } else if (value === 'ledger' || value === 'ledger-seal' || value === 'seal') {
      p = FALLBACK.ledger;
      this._setDebugPosition(world, p);
      this._burstLedger(this._debugPosition.x, this._debugPosition.y + 0.5, this._debugPosition.z, rng);
    } else if (value === 'seed' || value === 'seed-gift' || value === 'gift') {
      p = FALLBACK.seed;
      this._setDebugPosition(world, p);
      this._burstSeedGift(this._debugPosition.x, this._debugPosition.y + 0.45, this._debugPosition.z, rng);
    } else if (value === 'lamp' || value === 'fireflies' || value === 'lamp-fireflies') {
      p = FALLBACK.lamp;
      this._setDebugPosition(world, p);
      this._burstLamp(this._debugPosition.x, this._debugPosition.y + 0.35, this._debugPosition.z, rng, 18);
    } else if (value === 'leaves' || value === 'leaf') {
      p = FALLBACK.harvest;
      this._debugPosition.set(18, 1.8, 17);
      this._setDebugPosition(world, this._debugPosition);
      this._burstLeaves(this._debugPosition.x, this._debugPosition.y, this._debugPosition.z, rng);
    } else if (value === 'feed') {
      this._debugPosition.set(-18.5, 0.2, 2.4);
      this._setDebugPosition(world, this._debugPosition);
      this._burstFeed(this._debugPosition.x, this._debugPosition.y, this._debugPosition.z, rng);
    } else if (value === 'groom') {
      this._debugPosition.set(-16.1, 1.0, -10.5);
      this._setDebugPosition(world, this._debugPosition);
      this._burstGroom(this._debugPosition.x, this._debugPosition.y, this._debugPosition.z, rng);
    } else if (value === 'complete' || value === 'day-complete') {
      p = FALLBACK.complete;
      this._burstLedger(p[0], p[1] + 0.5, p[2], rng);
      this._burstLamp(p[0] - 0.7, p[1], p[2] + 0.4, rng, 18);
    } else if (value === 'all') {
      p = FALLBACK.water; this._burstWater(p[0], p[1] + 0.3, p[2], rng);
      p = FALLBACK.harvest; this._burstChaff(p[0], p[1] + 0.55, p[2], rng);
      p = FALLBACK.thresh; this._burstThresh(p[0], p[1], p[2], rng);
      p = FALLBACK.ledger; this._burstLedger(p[0], p[1] + 0.5, p[2], rng);
      p = FALLBACK.seed; this._burstSeedGift(p[0], p[1] + 0.45, p[2], rng);
      p = FALLBACK.lamp; this._burstLamp(p[0], p[1] + 0.35, p[2], rng, 18);
    }
    return this._debugKind;
  }

  _setDebugPosition(world, fallback) {
    const fx = fallback.x ?? fallback[0];
    const fy = fallback.y ?? fallback[1];
    const fz = fallback.z ?? fallback[2];
    if (!world) {
      this._debugPosition.set(fx, fy, fz);
    } else if (Array.isArray(world)) {
      this._debugPosition.set(world[0] ?? fx, world[1] ?? fy, world[2] ?? fz);
    } else {
      this._debugPosition.set(world.x ?? fx, world.y ?? fy, world.z ?? fz);
    }
    return this._debugPosition;
  }

  clear() {
    for (let i = 0; i < this.batches.length; i++) this.batches[i].clear();
    this.fireflies.clear();
    this.sealRoot.visible = false;
    this.lampRoot.visible = false;
    this._sealStart = -1;
    this._sealEnd = -1;
    this._lampStart = -1;
    this._lampEnd = -1;
    this._debugKind = 'none';
  }

  getStats() {
    return {
      water: this.water.live,
      chaff: this.chaff.live,
      leaves: this.leaves.live,
      dust: this.dust.live,
      gift: this.gift.live,
      embers: this.embers.live,
      fireflies: this.fireflies.active ? this.fireflies.capacity : 0,
    };
  }

  async prewarmMaterials() {
    return { ok: true, batches: this.batches.length + 1, retained: true };
  }

  dispose() {
    this._offSuccess?.();
    this._offComplete?.();
    this._offPhase?.();
    for (let i = 0; i < this.batches.length; i++) this.batches[i].dispose();
    this.fireflies.dispose();
    this.root.parent?.remove(this.root);
    for (const key of Object.keys(this.G)) this.G[key].dispose();
    for (const key of Object.keys(this.M)) this.M[key].dispose();
    this.root.clear();
  }
}
