import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PALETTE, mat, enableShadows } from '../core/materials.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;

const ACTOR_POSITIONS = Object.freeze({
  ox: [5.8, 0, 8.8, -HALF_PI],
  sow: [-19.2, 0, 2.45, 0.5],
  piglet: [-17.9, 0, 2.75, -0.7],
  mare: [-16.4, 0, -10.6, 0.7],
  foal: [-14.9, 0, -9.9, -0.3],
  clerk: [17.2, 0, -1.95, Math.PI],
  xuFather: [9.75, 0, -15.4, 0.25],
  xuMother: [11.0, 0, -15.2, -0.2],
  xuChild: [10.45, 0, -14.25, 0.1],
});

const DEBUG_PLAYER = Object.freeze({
  agriculture: [0.36, 0, 4.46, 2.65],
  watering: [1.45, 0, 9.35, -2.25],
  sheep: [-17.51, 0, -3.68, 2.48],
  woodcutting: [20.05, 0, 16.85, 2.33],
  pigs: [-19.92, 0, 4.33, 2.51],
  events: [13.15, 0, -2.0, 0.79],
  'farm-animals': [-17.94, 0, -2.51, 2.47],
  horses: [-19.55, 0, -4.55, 2.12],
  tuntian: [13.15, 0, -2.0, 0.79],
});

function damp(current, target, response, dt) {
  return current + (target - current) * (1 - Math.exp(-response * dt));
}

function mesh(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const value = new THREE.Mesh(geometry, material);
  value.position.set(x, y, z);
  value.scale.set(sx, sy, sz);
  value.rotation.set(rx, ry, rz);
  parent.add(value);
  return value;
}

function pivotedLimb(parent, geometry, material, x, y, z, length, width) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const limb = mesh(pivot, geometry, material, 0, -length * 0.5, 0, width, length, width);
  parent.add(pivot);
  return { pivot, limb };
}

function setBase(record, x, z, yaw) {
  record.baseX = x;
  record.baseZ = z;
  record.baseYaw = yaw;
}

function resetBase(record) {
  setBase(record, record.homeX, record.homeZ, record.homeYaw);
  if (!Number.isFinite(record.homeScale)) record.homeScale = record.root.scale.x;
  record.root.scale.setScalar(record.homeScale);
  record.root.visible = true;
}

/**
 * Procedural presentation actors for the late-Han farm. Every visible part is
 * retained, every repeated primitive shares geometry, and every pose is driven
 * by the engine clock so capture-mode frames are exactly reproducible.
 */
export class ActorSystem {
  static id = 'actors';
  static deps = ['player'];

  async init(ctx) {
    this.ctx = ctx;
    this.player = ctx.get('player');
    this.rng = ctx.rng.fork();
    this.root = new THREE.Group();
    this.root.name = 'ProceduralHanActors';
    ctx.scene.add(this.root);

    this._scratchPosition = new THREE.Vector3();
    this._followPosition = new THREE.Vector3();
    this._publicState = {
      position: new THREE.Vector3(),
      yaw: 0,
      speed: 0,
      moving: false,
      interacting: false,
    };
    this._movingSpeed = 0;
    this._carryKind = 'none';
    this._carryAmount = 0;
    this._workKind = 'idle';
    this._workUntil = 0;
    this._celebrateUntil = 0;
    this._dayPhase = 'dawn';
    this._debugKind = 'none';
    this._debugPlayerMode = null;
    this._debugAction = 'idle';
    this._playerHomeScale = 1;

    this.animals = [];
    this.humans = [];
    this.pigs = [];
    this.sheep = [];
    this.goats = [];
    this.cattle = [];
    this.birds = [];
    this.horses = [];

    this._makeMaterials();
    this._makeGeometry();
    this._buildPlayer();
    this._playerHomeScale = this.playerRig.root.scale.x;
    this._buildOxAndPlough();
    this._buildPigs();
    this._buildPastureHerd();
    this._buildBirds();
    this._buildHorses();
    this._buildVillagers();
    this._buildActionCues();
    await this._loadOptionalAccents();

    enableShadows(this.root, true, true);
    this.root.traverse((o) => {
      if (o.userData.noShadow) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });

    this._offCarry = ctx.events.on('carry:changed', (event) => this._onCarry(event));
    this._offAttempt = ctx.events.on('interaction:attempt', (event) => this._onInteraction(event, false));
    this._offSuccess = ctx.events.on('interaction:success', (event) => this._onInteraction(event, true));
    this._offPhase = ctx.events.on('day:phase', (event) => this._onDayPhase(event));
    this._offComplete = ctx.events.on('day:complete', () => {
      this._celebrateUntil = this.ctx.time.elapsed + 4.8;
    });

    const farm = ctx.peek('farm');
    const initialCarry = farm?.carry ?? 'none';
    this._carryKind = this.playerRig.carryItems[initialCarry] ? initialCarry : 'none';
    this._carryAmount = Number.isFinite(farm?.carryAmount) ? farm.carryAmount : 0;
    this._dayPhase = farm?.phase ?? this._dayPhase;
    this._readPlayerState();
    this._applyPlayerTransform();
    this._syncPlayerProps(this._carryKind === 'none' ? 'idle' : 'carry', 'idle');
  }

  _makeMaterials() {
    this.M = {
      skin: mat(0xc58a62),
      skinWarm: mat(0xd49a70),
      skinDeep: mat(0xa96f4f),
      hair: mat(0x25221f),
      eye: mat(PALETTE.black, { roughness: 0.55 }),
      indigo: mat(0x42586b),
      indigoDark: mat(0x273947),
      ochre: mat(0xa86a37),
      clayRed: mat(0x8e493b),
      jade: mat(0x55745e),
      hemp: mat(PALETTE.hemp),
      hempDark: mat(PALETTE.hempDark),
      ragBlue: mat(0x657173),
      ragBrown: mat(0x705844),
      belt: mat(0x4c3125),
      lacquer: mat(PALETTE.lacquer),
      seal: mat(PALETTE.seal),
      gold: mat(PALETTE.gold, { emissive: 0x5a3105, emissiveIntensity: 0.25 }),
      timber: mat(PALETTE.timber),
      timberDark: mat(PALETTE.timberDark),
      bronze: mat(0x9b7b42, { metalness: 0.34, roughness: 0.55 }),
      water: mat(PALETTE.water, { roughness: 0.22, transparent: true, opacity: 0.84 }),
      millet: mat(PALETTE.millet),
      milletLight: mat(PALETTE.milletLight),
      ox: mat(PALETTE.ox),
      oxDark: mat(0x472c23),
      horn: mat(0xd8c99f),
      pig: mat(PALETTE.pig),
      pigLight: mat(0xe8a093),
      pigDark: mat(0x884c48),
      wool: mat(0xd1c096),
      woolShade: mat(0xb9a479),
      sheepFace: mat(0x8a684c),
      sheepLeg: mat(0x73523d),
      goat: mat(0xb29670),
      cattle: mat(0x8b5d3c),
      cattleWhite: mat(0xd8d0ba),
      chestnut: mat(PALETTE.horse),
      chestnutDark: mat(0x552d22),
      horseLight: mat(0xd9c39f),
      chicken: mat(0xb55e32),
      chickenLight: mat(0xe1b46d),
      goose: mat(0xdad6c7),
      beak: mat(0xd99b35),
      grass: mat(PALETTE.grass),
      black: mat(PALETTE.black),
    };
  }

  _makeGeometry() {
    this.G = {
      cube: new THREE.BoxGeometry(1, 1, 1),
      round: new THREE.IcosahedronGeometry(1, 1),
      roundLow: new THREE.IcosahedronGeometry(1, 0),
      limb: new THREE.CylinderGeometry(0.5, 0.58, 1, 6),
      taper: new THREE.CylinderGeometry(0.32, 0.5, 1, 7),
      robe: new THREE.CylinderGeometry(0.48, 0.67, 1, 7),
      snout: new THREE.CylinderGeometry(0.72, 0.92, 1, 8),
      cone: new THREE.ConeGeometry(0.5, 1, 6),
      cone4: new THREE.ConeGeometry(0.5, 1, 4),
      disc: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
      torus: new THREE.TorusGeometry(0.5, 0.09, 5, 14),
      tailCurl: new THREE.TorusGeometry(0.34, 0.06, 5, 12, Math.PI * 1.55),
      sickle: new THREE.TorusGeometry(0.28, 0.045, 4, 12, Math.PI * 1.25),
      wing: new THREE.SphereGeometry(0.5, 6, 4),
    };
  }

  _buildPlayer() {
    const rig = this._makeHuman({
      name: 'HanFarmerPlayer',
      robe: 'indigo',
      accent: 'hemp',
      skin: 'skinWarm',
      headwear: 'farmer',
      scale: 1.08,
      role: 'player',
    });
    this.playerRig = rig;
    this.root.add(rig.root);
    this._makeCarryProps(rig);
    this._makeTools(rig);
  }

  _makeHuman(options) {
    const root = new THREE.Group();
    root.name = options.name;
    root.scale.setScalar(options.scale ?? 1);
    const body = new THREE.Group();
    root.add(body);

    const robeMaterial = this.M[options.robe];
    const accentMaterial = this.M[options.accent];
    const skinMaterial = this.M[options.skin];
    const lower = mesh(body, this.G.robe, robeMaterial, 0, 0.68, 0, 0.72, 0.94, 0.62);
    const torso = mesh(body, this.G.taper, robeMaterial, 0, 1.25, 0, 1.0, 0.78, 0.82);
    mesh(body, this.G.cube, this.M.belt, 0, 0.98, 0, 0.76, 0.09, 0.61);

    const lapelLeft = mesh(body, this.G.cube, accentMaterial, -0.115, 1.36, 0.355, 0.075, 0.48, 0.035, 0, 0, -0.55);
    const lapelRight = mesh(body, this.G.cube, accentMaterial, 0.115, 1.36, 0.355, 0.075, 0.48, 0.035, 0, 0, 0.55);
    lapelLeft.userData.noShadow = true;
    lapelRight.userData.noShadow = true;

    const leftArm = pivotedLimb(body, this.G.limb, robeMaterial, -0.48, 1.46, 0, 0.68, 0.22);
    const rightArm = pivotedLimb(body, this.G.limb, robeMaterial, 0.48, 1.46, 0, 0.68, 0.22);
    const leftHand = mesh(leftArm.pivot, this.G.roundLow, skinMaterial, 0, -0.7, 0, 0.13, 0.15, 0.13);
    const rightHand = mesh(rightArm.pivot, this.G.roundLow, skinMaterial, 0, -0.7, 0, 0.13, 0.15, 0.13);

    const leftLeg = pivotedLimb(body, this.G.limb, this.M.indigoDark, -0.22, 0.46, 0, 0.58, 0.2);
    const rightLeg = pivotedLimb(body, this.G.limb, this.M.indigoDark, 0.22, 0.46, 0, 0.58, 0.2);
    const leftFoot = mesh(leftLeg.pivot, this.G.cube, this.M.hempDark, 0, -0.59, 0.09, 0.2, 0.12, 0.35);
    const rightFoot = mesh(rightLeg.pivot, this.G.cube, this.M.hempDark, 0, -0.59, 0.09, 0.2, 0.12, 0.35);

    const head = new THREE.Group();
    head.position.set(0, 1.82, 0);
    body.add(head);
    mesh(head, this.G.round, skinMaterial, 0, 0, 0, 0.29, 0.34, 0.28);
    mesh(head, this.G.roundLow, skinMaterial, 0, -0.015, 0.276, 0.06, 0.08, 0.075);
    const eyeLeft = mesh(head, this.G.roundLow, this.M.eye, -0.095, 0.055, 0.267, 0.033, 0.043, 0.025);
    const eyeRight = mesh(head, this.G.roundLow, this.M.eye, 0.095, 0.055, 0.267, 0.033, 0.043, 0.025);
    eyeLeft.userData.noShadow = true;
    eyeRight.userData.noShadow = true;
    // Keep the hair mass behind the brow. The earlier full-depth cap reached the
    // eye plane and read as a heavy black visor in the locked wide shots.
    mesh(head, this.G.round, this.M.hair, 0, 0.245, -0.12, 0.29, 0.12, 0.2);
    this._addHeadwear(head, options.headwear, accentMaterial);

    if (options.role === 'refugee') {
      const patchMaterial = options.robe === 'ragBrown' ? this.M.ragBlue : this.M.ragBrown;
      const bundleSide = options.bundleSide ?? 1;
      mesh(body, this.G.cube, patchMaterial, -0.22, 0.67, 0.39, 0.25, 0.18, 0.025, 0, 0, -0.12);
      mesh(body, this.G.cube, this.M.hemp, 0.25, 0.55, 0.365, 0.18, 0.14, 0.025, 0, 0, 0.1);
      mesh(leftArm.pivot, this.G.cube, patchMaterial, 0, -0.36, 0.205, 0.16, 0.17, 0.02, 0, 0, -0.08);
      const strap = mesh(body, this.G.cube, this.M.hempDark, -bundleSide * 0.04, 1.24, 0.405, 0.045, 0.74, 0.022, 0, 0, bundleSide * 0.34);
      strap.userData.noShadow = true;
      const bundle = new THREE.Group();
      bundle.position.set(bundleSide * 0.39, 1.04, -0.39);
      mesh(bundle, this.G.roundLow, this.M.ragBrown, 0, 0, 0, 0.31, 0.45, 0.22);
      mesh(bundle, this.G.torus, this.M.hempDark, 0, 0.04, -0.19, 0.25, 0.34, 0.15);
      if (options.headwear !== 'child') {
        mesh(bundle, this.G.disc, patchMaterial, 0, 0.39, -0.02, 0.18, 0.43, 0.18, 0, 0, HALF_PI);
        mesh(bundle, this.G.torus, this.M.hemp, 0, 0.39, -0.18, 0.18, 0.29, 0.18, HALF_PI, 0, 0);
      }
      body.add(bundle);
    }

    const carryMount = new THREE.Group();
    carryMount.position.set(0, 1.05, 0.54);
    body.add(carryMount);
    const toolMount = new THREE.Group();
    toolMount.position.set(0.55, 1.08, 0.18);
    body.add(toolMount);

    return {
      root, body, lower, torso, head,
      leftArm: leftArm.pivot,
      rightArm: rightArm.pivot,
      leftHand, rightHand,
      leftLeg: leftLeg.pivot,
      rightLeg: rightLeg.pivot,
      leftFoot, rightFoot,
      carryMount, toolMount,
      role: options.role,
      phase: this.rng.range(0, TAU),
    };
  }

  _addHeadwear(head, kind, accentMaterial) {
    if (kind === 'clerk') {
      // A modest Eastern Han administrative cap: raised crown and separated
      // horizontal ears, kept slim enough to read as rank rather than fantasy.
      mesh(head, this.G.cube, this.M.black, 0, 0.28, -0.03, 0.36, 0.095, 0.29);
      mesh(head, this.G.cube, this.M.black, 0, 0.38, -0.06, 0.23, 0.16, 0.21);
      mesh(head, this.G.cube, this.M.black, -0.42, 0.31, -0.04, 0.34, 0.045, 0.1, 0, 0, -0.06);
      mesh(head, this.G.cube, this.M.black, 0.42, 0.31, -0.04, 0.34, 0.045, 0.1, 0, 0, 0.06);
      mesh(head, this.G.cube, this.M.bronze, 0, 0.29, 0.285, 0.055, 0.075, 0.018);
      return;
    }
    if (kind === 'farmer') {
      // Flat work cloth with a rear knot and two tied tails. Nothing crosses
      // the eye line, so the silhouette stays rural and readable in profile.
      mesh(head, this.G.roundLow, accentMaterial, 0, 0.285, -0.07, 0.31, 0.09, 0.25);
      mesh(head, this.G.cube, accentMaterial, 0, 0.225, 0.15, 0.31, 0.055, 0.035);
      mesh(head, this.G.roundLow, accentMaterial, 0, 0.22, -0.28, 0.075, 0.075, 0.06);
      mesh(head, this.G.cube, accentMaterial, -0.075, 0.035, -0.27, 0.045, 0.23, 0.04, 0.08, 0, 0.16);
      mesh(head, this.G.cube, accentMaterial, 0.075, 0.035, -0.27, 0.045, 0.23, 0.04, 0.08, 0, -0.16);
      return;
    }
    if (kind === 'refugee-man') {
      mesh(head, this.G.roundLow, this.M.ragBrown, 0, 0.27, -0.08, 0.31, 0.105, 0.25);
      mesh(head, this.G.cube, this.M.hempDark, 0, 0.205, 0.14, 0.32, 0.055, 0.04);
      mesh(head, this.G.roundLow, this.M.ragBrown, -0.22, 0.21, -0.21, 0.085, 0.08, 0.07);
      mesh(head, this.G.cube, this.M.ragBrown, -0.245, 0.025, -0.2, 0.055, 0.24, 0.045, 0.06, 0, 0.18);
      return;
    }
    if (kind === 'refugee-woman') {
      mesh(head, this.G.roundLow, this.M.ragBlue, 0, 0.265, -0.075, 0.32, 0.13, 0.25);
      mesh(head, this.G.cube, this.M.hemp, 0, 0.205, 0.145, 0.33, 0.052, 0.038);
      mesh(head, this.G.roundLow, this.M.ragBlue, 0.22, 0.19, -0.21, 0.09, 0.085, 0.07);
      mesh(head, this.G.cube, this.M.ragBlue, 0.25, -0.005, -0.2, 0.06, 0.27, 0.045, 0.08, 0, -0.2);
      return;
    }
    if (kind === 'woman') {
      mesh(head, this.G.roundLow, this.M.hair, 0, 0.25, -0.13, 0.18, 0.18, 0.16);
      mesh(head, this.G.cube, accentMaterial, 0, 0.2, 0.16, 0.35, 0.07, 0.05);
      return;
    }
    if (kind === 'child') {
      mesh(head, this.G.cube, accentMaterial, 0, 0.18, 0.02, 0.32, 0.09, 0.31);
      return;
    }
    mesh(head, this.G.cube, accentMaterial, 0, 0.18, 0.01, 0.33, 0.075, 0.3);
    mesh(head, this.G.roundLow, this.M.hair, 0, 0.34, -0.03, 0.12, 0.17, 0.12);
    mesh(head, this.G.cube, accentMaterial, 0, 0.42, -0.03, 0.09, 0.18, 0.09);
  }

  _makeCarryProps(rig) {
    const items = {};

    const bucket = new THREE.Group();
    mesh(bucket, this.G.disc, this.M.timber, 0, -0.11, 0, 0.44, 0.48, 0.44);
    mesh(bucket, this.G.torus, this.M.timberDark, 0, 0.14, 0, 0.48, 0.48, 0.48, HALF_PI, 0, 0);
    mesh(bucket, this.G.disc, this.M.water, 0, 0.145, 0, 0.37, 0.035, 0.37);
    const handle = mesh(bucket, this.G.torus, this.M.hempDark, 0, 0.31, 0, 0.48, 0.62, 0.48);
    handle.rotation.x = 0;
    rig.carryMount.add(bucket);
    items['water-bucket'] = bucket;

    const sheaf = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const x = (i % 3 - 1) * 0.09;
      const z = (Math.floor(i / 3) - 1) * 0.07;
      const stalk = mesh(sheaf, this.G.limb, this.M.millet, x, 0.05 + (i % 2) * 0.03, z, 0.035, 0.86, 0.035, 0, 0, (i - 3) * 0.035);
      stalk.userData.noShadow = true;
      mesh(sheaf, this.G.roundLow, i % 2 ? this.M.milletLight : this.M.millet, x, 0.5 + (i % 2) * 0.05, z, 0.09, 0.19, 0.08);
    }
    mesh(sheaf, this.G.torus, this.M.hempDark, 0, 0.02, 0, 0.25, 0.18, 0.25, HALF_PI, 0, 0);
    sheaf.rotation.z = -0.35;
    rig.carryMount.add(sheaf);
    items['millet-sheaf'] = sheaf;

    const sack = new THREE.Group();
    mesh(sack, this.G.roundLow, this.M.hemp, 0, -0.05, 0, 0.43, 0.55, 0.3);
    mesh(sack, this.G.torus, this.M.hempDark, 0, 0.35, 0, 0.18, 0.16, 0.18, HALF_PI, 0, 0);
    mesh(sack, this.G.cube, this.M.seal, 0, 0.02, 0.305, 0.16, 0.16, 0.018, 0, 0, 0.08);
    rig.carryMount.add(sack);
    items['grain-sack'] = sack;

    const pouch = new THREE.Group();
    mesh(pouch, this.G.roundLow, this.M.ochre, 0, 0, 0, 0.28, 0.34, 0.19);
    mesh(pouch, this.G.torus, this.M.hempDark, 0, 0.22, 0, 0.15, 0.14, 0.15, HALF_PI, 0, 0);
    rig.carryMount.add(pouch);
    items['seed-pouch'] = pouch;

    const lamp = new THREE.Group();
    mesh(lamp, this.G.disc, this.M.lacquer, 0, -0.12, 0, 0.28, 0.18, 0.28);
    mesh(lamp, this.G.cube, this.M.timberDark, -0.2, 0.12, 0, 0.05, 0.5, 0.05);
    mesh(lamp, this.G.cube, this.M.timberDark, 0.2, 0.12, 0, 0.05, 0.5, 0.05);
    mesh(lamp, this.G.cube, this.M.timberDark, 0, 0.35, 0, 0.45, 0.05, 0.05);
    mesh(lamp, this.G.cone, this.M.gold, 0, 0.1, 0, 0.14, 0.32, 0.14);
    const lampHandle = mesh(lamp, this.G.torus, this.M.hempDark, 0, 0.45, 0, 0.32, 0.42, 0.32);
    lampHandle.userData.noShadow = true;
    rig.carryMount.add(lamp);
    items.lamp = lamp;

    for (const key of Object.keys(items)) items[key].visible = false;
    rig.carryItems = items;
    rig.carryKeys = Object.keys(items);
  }

  _makeTools(rig) {
    const tools = {};
    const sickle = new THREE.Group();
    mesh(sickle, this.G.limb, this.M.timber, 0, 0, 0, 0.06, 0.64, 0.06, 0, 0, -0.35);
    mesh(sickle, this.G.sickle, this.M.bronze, -0.03, 0.29, 0, 0.9, 0.9, 0.9, 0, 0, 0.75);
    rig.toolMount.add(sickle);
    tools.sickle = sickle;

    const hoe = new THREE.Group();
    mesh(hoe, this.G.limb, this.M.timber, 0, 0, 0, 0.065, 1.45, 0.065, 0, 0, -0.55);
    mesh(hoe, this.G.cube, this.M.bronze, -0.38, 0.59, 0, 0.65, 0.08, 0.25, 0, 0, -0.2);
    rig.toolMount.add(hoe);
    tools.hoe = hoe;

    const axe = new THREE.Group();
    mesh(axe, this.G.limb, this.M.timber, 0, 0, 0, 0.07, 1.25, 0.07, 0, 0, -0.25);
    mesh(axe, this.G.cone4, this.M.bronze, -0.18, 0.48, 0, 0.32, 0.48, 0.16, 0, 0, HALF_PI);
    rig.toolMount.add(axe);
    tools.axe = axe;

    const brush = new THREE.Group();
    mesh(brush, this.G.cube, this.M.timber, 0, 0, 0, 0.34, 0.1, 0.16);
    for (let i = 0; i < 5; i++) mesh(brush, this.G.cube, this.M.hempDark, -0.25 + i * 0.125, -0.13, 0, 0.045, 0.18, 0.08);
    brush.rotation.z = -0.35;
    rig.toolMount.add(brush);
    tools.brush = brush;

    for (const key of Object.keys(tools)) tools[key].visible = false;
    rig.tools = tools;
    rig.toolKeys = Object.keys(tools);
  }

  _buildActionCues() {
    this.actionCues = new THREE.Group();
    this.actionCues.name = 'DebugActionCues';
    this.root.add(this.actionCues);
    this.feedCue = new THREE.Group();
    this.pigFeedCue = new THREE.Group();
    this.birdSeedCue = new THREE.Group();
    this.fieldTallyCue = new THREE.Group();
    this.handoffSackCue = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const x = ((i * 7) % 11 - 5) * 0.075;
      const z = ((i * 5) % 9 - 4) * 0.065;
      const grain = mesh(this.feedCue, this.G.roundLow, i % 3 ? this.M.millet : this.M.milletLight, x, 0.035 + (i % 2) * 0.025, z, 0.055, 0.075, 0.045);
      grain.userData.noShadow = true;
      const pigGrain = mesh(this.pigFeedCue, this.G.roundLow, i % 2 ? this.M.milletLight : this.M.ochre, x * 1.25, 0.035, z * 1.2, 0.06, 0.08, 0.05);
      pigGrain.userData.noShadow = true;
      const birdGrain = mesh(this.birdSeedCue, this.G.roundLow, i % 3 ? this.M.milletLight : this.M.gold, x * 1.55, 0.03, z * 1.5, 0.05, 0.065, 0.04);
      birdGrain.userData.noShadow = true;
    }
    const tray = mesh(this.feedCue, this.G.disc, this.M.hempDark, 0, 0.025, 0, 0.82, 0.06, 0.82);
    tray.userData.noShadow = true;
    this.feedCue.position.set(-16.4, 0.02, -5.1);
    this.pigFeedCue.position.set(-18.5, 0.02, 2.4);
    this.birdSeedCue.position.set(-16.2, 0.02, -4.7);
    mesh(this.fieldTallyCue, this.G.cube, this.M.timber, 0, 0.92, 0, 0.95, 0.09, 0.45);
    for (const x of [-0.72, 0.72]) mesh(this.fieldTallyCue, this.G.cube, this.M.timberDark, x, 0.44, 0, 0.07, 0.44, 0.07);
    for (let i = 0; i < 7; i++) {
      mesh(this.fieldTallyCue, this.G.cube, i === 5 ? this.M.seal : this.M.milletLight, -0.58 + i * 0.19, 1.03, -0.08 + (i % 2) * 0.16, 0.055, 0.025, 0.32, 0, -0.08 + i * 0.025, 0);
    }
    this.fieldTallyCue.position.set(-1.16, 0, 5.92);
    mesh(this.handoffSackCue, this.G.roundLow, this.M.hemp, 0, 0.56, 0, 0.46, 0.58, 0.34);
    mesh(this.handoffSackCue, this.G.torus, this.M.hempDark, 0, 0.94, 0, 0.2, 0.17, 0.2, HALF_PI, 0, 0);
    mesh(this.handoffSackCue, this.G.cube, this.M.seal, 0, 0.57, 0.345, 0.16, 0.16, 0.018, 0, 0, 0.08);
    this.handoffSackCue.position.set(14.85, 0, -0.3);
    this.actionCues.add(this.feedCue, this.pigFeedCue, this.birdSeedCue, this.fieldTallyCue, this.handoffSackCue);
    this.feedCue.visible = false;
    this.pigFeedCue.visible = false;
    this.birdSeedCue.visible = false;
    this.fieldTallyCue.visible = false;
    this.handoffSackCue.visible = false;
  }

  async _loadOptionalAccents() {
    this.optionalModels = [];
    this.optionalAccents = new THREE.Group();
    this.optionalAccents.name = 'OptionalThrixelFarmAccents';
    this.root.add(this.optionalAccents);
    const loader = new GLTFLoader();
    const farmerUrl = new URL('../../assets/models/a-young-adult-late-eastern-han-civilian-field.glb', import.meta.url).href;
    const oxUrl = new URL('../../assets/models/a-sturdy-chestnut-brown-eastern-han-farm-ox.glb', import.meta.url).href;
    const loaded = await Promise.allSettled([loader.loadAsync(farmerUrl), loader.loadAsync(oxUrl)]);
    if (loaded[0].status === 'fulfilled') {
      const farmer = this._prepareOptionalAccent(loaded[0].value.scene, 1.72, -3.15, 7.1, -2.3, 'DistantThrixelFieldWorker');
      if (farmer) this.optionalModels.push(loaded[0].value.scene);
    }
    if (loaded[1].status === 'fulfilled') {
      const ox = this._prepareOptionalAccent(loaded[1].value.scene, 1.58, -4.75, 5.7, -2.3, 'DistantThrixelPloughOx');
      if (ox) {
        this.optionalModels.push(loaded[1].value.scene);
        this._addAccentPlough(ox);
      }
    }
  }

  _prepareOptionalAccent(model, targetHeight, x, z, yaw, name) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0.0001) {
      this._disposeOptionalModel(model);
      return null;
    }
    model.scale.multiplyScalar(targetHeight / size.y);
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.y -= box.min.y;
    model.position.z -= center.z;
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    const holder = new THREE.Group();
    holder.name = name;
    holder.position.set(x, 0, z);
    holder.rotation.y = yaw;
    holder.add(model);
    this.optionalAccents.add(holder);
    return holder;
  }

  _addAccentPlough(holder) {
    mesh(holder, this.G.cube, this.M.timberDark, 0, 1.14, -0.5, 1.45, 0.12, 0.16);
    mesh(holder, this.G.cube, this.M.timber, 0, 0.65, -1.45, 0.12, 0.12, 2.25, -0.17, 0, 0);
    mesh(holder, this.G.cube, this.M.bronze, 0, 0.22, -2.38, 0.62, 0.1, 0.28, 0.18, 0, 0);
    mesh(holder, this.G.limb, this.M.timber, -0.34, 0.92, -2.13, 0.07, 1.35, 0.07, 0.4, 0, 0.16);
    mesh(holder, this.G.limb, this.M.timber, 0.34, 0.92, -2.13, 0.07, 1.35, 0.07, 0.4, 0, -0.16);
  }

  _disposeOptionalModel(model) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    model.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const material = object.material;
      if (Array.isArray(material)) {
        for (let i = 0; i < material.length; i++) materials.add(material[i]);
      } else if (material) materials.add(material);
    });
    for (const material of materials) {
      for (const key of Object.keys(material)) {
        const value = material[key];
        if (value?.isTexture) textures.add(value);
      }
    }
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  _buildOxAndPlough() {
    const root = new THREE.Group();
    root.name = 'OxAndWoodenPlough';
    const body = mesh(root, this.G.round, this.M.ox, 0, 1.12, 0, 0.78, 0.6, 1.18);
    mesh(root, this.G.roundLow, this.M.oxDark, 0, 1.25, 0.75, 0.62, 0.52, 0.72);
    const head = new THREE.Group();
    head.position.set(0, 1.37, 1.08);
    root.add(head);
    mesh(head, this.G.round, this.M.ox, 0, 0, 0, 0.46, 0.43, 0.55);
    mesh(head, this.G.snout, this.M.oxDark, 0, -0.1, 0.49, 0.3, 0.22, 0.24, HALF_PI, 0, 0);
    for (const side of [-1, 1]) {
      mesh(head, this.G.cone, this.M.horn, side * 0.38, 0.3, 0.05, 0.16, 0.62, 0.16, 0, 0, -side * 0.85);
      mesh(head, this.G.roundLow, this.M.oxDark, side * 0.39, 0.08, 0.14, 0.22, 0.11, 0.28, 0, side * 0.2, side * 0.18);
      const eye = mesh(head, this.G.roundLow, this.M.eye, side * 0.25, 0.07, 0.47, 0.035, 0.045, 0.03);
      eye.userData.noShadow = true;
    }
    const legs = [];
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const front = i < 2 ? 1 : -1;
      const leg = pivotedLimb(root, this.G.limb, this.M.oxDark, side * 0.48, 0.82, front * 0.67, 0.78, 0.22);
      mesh(leg.pivot, this.G.cube, this.M.black, 0, -0.79, 0.06, 0.22, 0.15, 0.3);
      legs.push(leg.pivot);
    }
    const tail = new THREE.Group();
    tail.position.set(0, 1.34, -1.0);
    mesh(tail, this.G.limb, this.M.oxDark, 0, -0.42, -0.08, 0.07, 0.85, 0.07, -0.25, 0, 0);
    mesh(tail, this.G.roundLow, this.M.black, 0, -0.87, -0.18, 0.12, 0.2, 0.12);
    root.add(tail);

    mesh(root, this.G.cube, this.M.timberDark, 0, 1.36, -0.85, 1.72, 0.13, 0.16);
    mesh(root, this.G.cube, this.M.timber, 0, 0.76, -2.15, 0.13, 0.13, 2.9, -0.16, 0, 0);
    mesh(root, this.G.cube, this.M.bronze, 0, 0.24, -3.28, 0.72, 0.12, 0.34, 0.2, 0, 0);
    const handleLeft = mesh(root, this.G.limb, this.M.timber, -0.42, 1.0, -3.0, 0.07, 1.7, 0.07, 0.45, 0, 0.15);
    const handleRight = mesh(root, this.G.limb, this.M.timber, 0.42, 1.0, -3.0, 0.07, 1.7, 0.07, 0.45, 0, -0.15);
    handleLeft.userData.noShadow = false;
    handleRight.userData.noShadow = false;

    const p = ACTOR_POSITIONS.ox;
    root.position.set(p[0], p[1], p[2]);
    root.rotation.y = p[3];
    this.root.add(root);
    this.ox = {
      kind: 'ox', root, body, head, legs, tail,
      homeX: p[0], homeZ: p[2], homeYaw: p[3],
      baseX: p[0], baseZ: p[2], baseYaw: p[3],
      phase: this.rng.range(0, TAU),
    };
    this.animals.push(this.ox);
  }

  _buildPigs() {
    const sowPos = ACTOR_POSITIONS.sow;
    const pigletPos = ACTOR_POSITIONS.piglet;
    this.sow = this._makePig('ExpressiveSow', sowPos, 1, false);
    this.piglet = this._makePig('Piglet', pigletPos, 0.58, true);
    this.pigs.push(this.sow, this.piglet);
    this.animals.push(this.sow, this.piglet);
  }

  _makePig(name, position, scale, baby) {
    const root = new THREE.Group();
    root.name = name;
    root.scale.setScalar(scale);
    mesh(root, this.G.round, baby ? this.M.pigLight : this.M.pig, 0, 0.68, 0, 0.72, 0.5, 0.98);
    const head = new THREE.Group();
    head.position.set(0, 0.75, 0.78);
    root.add(head);
    mesh(head, this.G.round, baby ? this.M.pigLight : this.M.pig, 0, 0, 0, 0.52, 0.45, 0.52);
    mesh(head, this.G.snout, this.M.pigDark, 0, -0.08, 0.45, 0.31, 0.17, 0.28, HALF_PI, 0, 0);
    const ears = [];
    for (const side of [-1, 1]) {
      const ear = mesh(head, this.G.cone4, this.M.pigDark, side * 0.31, 0.35, 0.02, 0.22, 0.34, 0.12, 0, 0, side * 0.28);
      ears.push(ear);
      const eye = mesh(head, this.G.roundLow, this.M.eye, side * 0.19, 0.1, 0.43, 0.045, 0.055, 0.03);
      eye.userData.noShadow = true;
      const nostril = mesh(head, this.G.roundLow, this.M.black, side * 0.1, -0.065, 0.63, 0.027, 0.025, 0.018);
      nostril.userData.noShadow = true;
    }
    const legs = [];
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const front = i < 2 ? 1 : -1;
      const leg = pivotedLimb(root, this.G.limb, this.M.pigDark, side * 0.42, 0.43, front * 0.5, 0.48, 0.16);
      legs.push(leg.pivot);
    }
    const tail = mesh(root, this.G.tailCurl, this.M.pigDark, 0.12, 0.86, -0.95, 0.7, 0.7, 0.7, 0, HALF_PI, 0.1);
    root.position.set(position[0], position[1], position[2]);
    root.rotation.y = position[3];
    this.root.add(root);
    return {
      kind: 'pig', root, head, ears, legs, tail, baby,
      homeX: position[0], homeZ: position[2], homeYaw: position[3],
      baseX: position[0], baseZ: position[2], baseYaw: position[3],
      phase: this.rng.range(0, TAU),
    };
  }

  _buildPastureHerd() {
    const budget = this.ctx.config.q.particleBudget;
    const sheepCount = budget < 3000 ? 3 : budget < 10000 ? 4 : 5;
    const goatCount = budget < 3000 ? 1 : 2;
    const cattleCount = budget < 3000 ? 1 : 2;
    for (let i = 0; i < sheepCount; i++) {
      const x = -21.0 + (i % 3) * 2.55;
      const z = -3.0 - Math.floor(i / 3) * 2.4 - (i % 2) * 0.45;
      const record = this._makeSheepOrGoat(`Sheep${i + 1}`, x, z, i * 0.73, false, 0.9 + (i % 3) * 0.05);
      this.sheep.push(record);
      this.animals.push(record);
    }
    for (let i = 0; i < goatCount; i++) {
      const record = this._makeSheepOrGoat(`Goat${i + 1}`, -20 + i * 4.1, -7.15 - i * 0.5, 1.2 + i, true, 0.88 + i * 0.06);
      this.goats.push(record);
      this.animals.push(record);
    }
    for (let i = 0; i < cattleCount; i++) {
      const record = this._makeCattle(`PastureCattle${i + 1}`, -14.8 - i * 3.1, -5.0 - i * 1.5, -0.9 + i * 1.6, i === 1);
      this.cattle.push(record);
      this.animals.push(record);
    }
  }

  _makeSheepOrGoat(name, x, z, yaw, goat, scale) {
    const root = new THREE.Group();
    root.name = name;
    root.scale.setScalar(scale);
    if (goat) {
      mesh(root, this.G.round, this.M.goat, 0, 0.78, 0, 0.58, 0.45, 0.8);
    } else {
      mesh(root, this.G.round, this.M.wool, 0, 0.8, 0, 0.67, 0.54, 0.86);
      mesh(root, this.G.roundLow, this.M.woolShade, -0.36, 0.84, -0.08, 0.38, 0.4, 0.43);
      mesh(root, this.G.roundLow, this.M.wool, 0.35, 0.91, -0.05, 0.39, 0.4, 0.44);
    }
    const head = new THREE.Group();
    head.position.set(0, 0.88, 0.72);
    root.add(head);
    mesh(head, this.G.roundLow, goat ? this.M.goat : this.M.sheepFace, 0, 0, 0, 0.34, 0.38, 0.42);
    for (const side of [-1, 1]) {
      mesh(head, this.G.roundLow, goat ? this.M.goat : this.M.sheepFace, side * 0.25, 0.05, 0.03, 0.18, 0.08, 0.25, 0, 0, side * 0.2);
      const eye = mesh(head, this.G.roundLow, this.M.eye, side * 0.16, 0.08, 0.37, 0.03, 0.04, 0.025);
      eye.userData.noShadow = true;
      if (goat) mesh(head, this.G.cone, this.M.horn, side * 0.17, 0.34, -0.05, 0.095, 0.43, 0.095, -0.28, 0, side * 0.18);
    }
    if (goat) mesh(head, this.G.cone, this.M.goat, 0, -0.35, 0.23, 0.13, 0.38, 0.13, Math.PI, 0, 0);
    const legs = [];
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const front = i < 2 ? 1 : -1;
      const leg = pivotedLimb(root, this.G.limb, goat ? this.M.sheepLeg : this.M.sheepFace, side * 0.35, 0.53, front * 0.45, 0.6, 0.12);
      legs.push(leg.pivot);
    }
    root.position.set(x, 0, z);
    root.rotation.y = yaw;
    this.root.add(root);
    return {
      kind: goat ? 'goat' : 'sheep', root, head, legs,
      homeX: x, homeZ: z, homeYaw: yaw,
      baseX: x, baseZ: z, baseYaw: yaw,
      phase: this.rng.range(0, TAU),
    };
  }

  _makeCattle(name, x, z, yaw, patched) {
    const root = new THREE.Group();
    root.name = name;
    mesh(root, this.G.round, patched ? this.M.cattleWhite : this.M.cattle, 0, 1.03, 0, 0.7, 0.55, 1.02);
    if (patched) {
      mesh(root, this.G.roundLow, this.M.cattle, -0.56, 1.08, 0.14, 0.16, 0.3, 0.38);
      mesh(root, this.G.roundLow, this.M.cattle, 0.58, 0.94, -0.38, 0.15, 0.28, 0.32);
    }
    const head = new THREE.Group();
    head.position.set(0, 1.2, 0.9);
    root.add(head);
    mesh(head, this.G.roundLow, this.M.cattle, 0, 0, 0, 0.43, 0.4, 0.48);
    mesh(head, this.G.snout, this.M.cattleWhite, 0, -0.1, 0.4, 0.29, 0.2, 0.22, HALF_PI, 0, 0);
    for (const side of [-1, 1]) {
      mesh(head, this.G.cone, this.M.horn, side * 0.31, 0.26, 0, 0.11, 0.43, 0.11, 0, 0, -side * 0.7);
      const eye = mesh(head, this.G.roundLow, this.M.eye, side * 0.2, 0.04, 0.4, 0.032, 0.045, 0.025);
      eye.userData.noShadow = true;
    }
    const legs = [];
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const front = i < 2 ? 1 : -1;
      const leg = pivotedLimb(root, this.G.limb, this.M.cattle, side * 0.42, 0.73, front * 0.58, 0.75, 0.18);
      mesh(leg.pivot, this.G.cube, this.M.black, 0, -0.76, 0.05, 0.18, 0.13, 0.25);
      legs.push(leg.pivot);
    }
    const tail = new THREE.Group();
    tail.position.set(0, 1.25, -0.9);
    mesh(tail, this.G.limb, this.M.cattle, 0, -0.36, -0.05, 0.055, 0.72, 0.055, -0.2, 0, 0);
    root.add(tail);
    root.position.set(x, 0, z);
    root.rotation.y = yaw;
    this.root.add(root);
    return {
      kind: 'cattle', root, head, legs, tail,
      homeX: x, homeZ: z, homeYaw: yaw,
      baseX: x, baseZ: z, baseYaw: yaw,
      phase: this.rng.range(0, TAU),
    };
  }

  _buildBirds() {
    const budget = this.ctx.config.q.particleBudget;
    const chickenCount = budget < 3000 ? 4 : budget < 10000 ? 6 : 8;
    const gooseCount = budget < 3000 ? 2 : budget < 10000 ? 3 : 4;
    for (let i = 0; i < chickenCount; i++) {
      const x = -9.6 + (i % 4) * 1.05;
      const z = -7.2 + Math.floor(i / 4) * 1.2 + (i % 2) * 0.25;
      const record = this._makeBird(`Chicken${i + 1}`, x, z, i * 0.9, false, i % 3 === 0);
      this.birds.push(record);
      this.animals.push(record);
    }
    for (let i = 0; i < gooseCount; i++) {
      const x = 18.8 + (i % 2) * 1.25;
      const z = -17.8 - Math.floor(i / 2) * 1.0;
      const record = this._makeBird(`Goose${i + 1}`, x, z, -0.8 + i * 0.5, true, false);
      this.birds.push(record);
      this.animals.push(record);
    }
  }

  _makeBird(name, x, z, yaw, goose, rooster) {
    const root = new THREE.Group();
    root.name = name;
    const bodyMaterial = goose ? this.M.goose : rooster ? this.M.chicken : this.M.chickenLight;
    mesh(root, this.G.round, bodyMaterial, 0, goose ? 0.52 : 0.4, 0, goose ? 0.34 : 0.3, goose ? 0.38 : 0.32, goose ? 0.52 : 0.42);
    const neck = new THREE.Group();
    neck.position.set(0, goose ? 0.72 : 0.53, goose ? 0.35 : 0.31);
    root.add(neck);
    if (goose) mesh(neck, this.G.limb, this.M.goose, 0, 0.17, 0, 0.16, 0.5, 0.16, -0.38, 0, 0);
    mesh(neck, this.G.roundLow, bodyMaterial, 0, goose ? 0.43 : 0.17, goose ? 0.14 : 0.08, goose ? 0.22 : 0.2, goose ? 0.24 : 0.22, goose ? 0.24 : 0.22);
    mesh(neck, this.G.cone4, this.M.beak, 0, goose ? 0.4 : 0.15, goose ? 0.37 : 0.29, 0.12, goose ? 0.28 : 0.22, 0.12, HALF_PI, 0, 0);
    const eye = mesh(neck, this.G.roundLow, this.M.eye, -0.12, goose ? 0.47 : 0.22, goose ? 0.3 : 0.22, 0.025, 0.03, 0.02);
    eye.userData.noShadow = true;
    if (!goose) {
      mesh(neck, this.G.cone4, this.M.seal, 0, 0.43, 0, 0.12, 0.3, 0.1);
      if (rooster) {
        mesh(root, this.G.cone, this.M.black, 0, 0.62, -0.38, 0.18, 0.56, 0.12, -0.7, 0, 0);
        mesh(root, this.G.cone, this.M.clayRed, 0.12, 0.64, -0.4, 0.15, 0.5, 0.1, -0.8, 0, 0);
      }
    }
    const wingLeft = mesh(root, this.G.wing, bodyMaterial, -0.28, goose ? 0.54 : 0.42, -0.02, 0.36, 0.13, 0.48, 0, 0, -0.22);
    const wingRight = mesh(root, this.G.wing, bodyMaterial, 0.28, goose ? 0.54 : 0.42, -0.02, 0.36, 0.13, 0.48, 0, 0, 0.22);
    const legs = [];
    for (const side of [-1, 1]) {
      const leg = pivotedLimb(root, this.G.limb, this.M.beak, side * 0.13, goose ? 0.29 : 0.22, 0, goose ? 0.32 : 0.26, 0.065);
      mesh(leg.pivot, this.G.cube, this.M.beak, 0, goose ? -0.33 : -0.27, 0.07, 0.15, 0.045, 0.24);
      legs.push(leg.pivot);
    }
    root.position.set(x, 0, z);
    root.rotation.y = yaw;
    this.root.add(root);
    return {
      kind: goose ? 'goose' : 'chicken', root, neck, wingLeft, wingRight, legs,
      homeX: x, homeZ: z, homeYaw: yaw,
      baseX: x, baseZ: z, baseYaw: yaw,
      phase: this.rng.range(0, TAU),
    };
  }

  _buildHorses() {
    this.mare = this._makeHorse('ChestnutMare', ACTOR_POSITIONS.mare, 1, false);
    this.foal = this._makeHorse('ChestnutFoal', ACTOR_POSITIONS.foal, 0.68, true);
    this.horses.push(this.mare, this.foal);
    this.animals.push(this.mare, this.foal);
  }

  _makeHorse(name, position, scale, foal) {
    const root = new THREE.Group();
    root.name = name;
    root.scale.setScalar(scale);
    mesh(root, this.G.round, this.M.chestnut, 0, 1.22, 0, 0.69, 0.56, 1.13);
    const neck = new THREE.Group();
    neck.position.set(0, 1.45, 0.7);
    neck.rotation.x = -0.38;
    root.add(neck);
    mesh(neck, this.G.taper, this.M.chestnut, 0, 0.38, 0, 0.62, 0.9, 0.62);
    const head = new THREE.Group();
    head.position.set(0, 0.82, 0.06);
    neck.add(head);
    mesh(head, this.G.round, this.M.chestnut, 0, 0, 0, 0.34, 0.35, 0.58);
    mesh(head, this.G.roundLow, this.M.chestnutDark, 0, -0.08, 0.46, 0.27, 0.22, 0.3);
    mesh(head, this.G.cube, this.M.horseLight, 0, 0.09, 0.49, 0.08, 0.28, 0.025, -0.1, 0, 0);
    for (const side of [-1, 1]) {
      mesh(head, this.G.cone, this.M.chestnutDark, side * 0.16, 0.36, -0.1, 0.12, 0.32, 0.1, 0, 0, side * 0.15);
      const eye = mesh(head, this.G.roundLow, this.M.eye, side * 0.18, 0.08, 0.38, 0.032, 0.045, 0.025);
      eye.userData.noShadow = true;
    }
    mesh(neck, this.G.cube, this.M.chestnutDark, 0, 0.5, -0.29, 0.12, 0.95, 0.12, 0.12, 0, 0);
    const legs = [];
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const front = i < 2 ? 1 : -1;
      const leg = pivotedLimb(root, this.G.limb, this.M.chestnut, side * 0.4, 0.9, front * 0.63, 1.0, 0.15);
      mesh(leg.pivot, this.G.cube, this.M.chestnutDark, 0, -1.01, 0.06, 0.16, 0.12, 0.27);
      legs.push(leg.pivot);
    }
    const tail = new THREE.Group();
    tail.position.set(0, 1.45, -1.02);
    mesh(tail, this.G.cone, this.M.chestnutDark, 0, -0.54, -0.12, 0.22, 1.2, 0.22, -0.25, 0, 0);
    root.add(tail);
    root.position.set(position[0], position[1], position[2]);
    root.rotation.y = position[3];
    this.root.add(root);
    return {
      kind: 'horse', root, neck, head, legs, tail, foal,
      homeX: position[0], homeZ: position[2], homeYaw: position[3],
      baseX: position[0], baseZ: position[2], baseYaw: position[3],
      phase: this.rng.range(0, TAU),
    };
  }

  _buildVillagers() {
    const clerk = this._makeHuman({
      name: 'TuntianGranaryClerk', robe: 'clayRed', accent: 'hemp', skin: 'skin',
      headwear: 'clerk', scale: 1.03, role: 'clerk',
    });
    const cp = ACTOR_POSITIONS.clerk;
    clerk.root.position.set(cp[0], cp[1], cp[2]);
    clerk.root.rotation.y = cp[3];
    mesh(clerk.body, this.G.cube, this.M.hemp, -0.03, 1.02, 0.52, 0.5, 0.38, 0.035);
    for (let i = 0; i < 5; i++) {
      mesh(clerk.body, this.G.cube, this.M.milletLight, -0.22 + i * 0.095, 1.02, 0.557, 0.055, 0.29, 0.012);
    }
    mesh(clerk.body, this.G.cube, this.M.lacquer, -0.03, 0.9, 0.57, 0.49, 0.025, 0.012);
    mesh(clerk.body, this.G.cube, this.M.lacquer, -0.03, 1.14, 0.57, 0.49, 0.025, 0.012);
    mesh(clerk.body, this.G.cube, this.M.seal, 0.18, 1.04, 0.555, 0.11, 0.11, 0.02, 0, 0, 0.08);
    mesh(clerk.leftArm, this.G.cube, this.M.hemp, 0, -0.54, 0, 0.25, 0.15, 0.25);
    mesh(clerk.rightArm, this.G.cube, this.M.hemp, 0, -0.54, 0, 0.25, 0.15, 0.25);
    const tallyBaton = new THREE.Group();
    tallyBaton.name = 'BambooAllocationTally';
    tallyBaton.position.set(0, -0.78, 0.12);
    mesh(tallyBaton, this.G.cube, this.M.milletLight, 0, 0, 0, 0.075, 0.48, 0.045, 0, 0, 0.08);
    mesh(tallyBaton, this.G.cube, this.M.lacquer, 0, 0.09, 0.05, 0.085, 0.035, 0.012);
    clerk.rightArm.add(tallyBaton);
    mesh(clerk.body, this.G.cube, this.M.lacquer, 0.32, 0.82, 0.39, 0.025, 0.26, 0.025, 0, 0, -0.1);
    mesh(clerk.body, this.G.cube, this.M.seal, 0.35, 0.65, 0.415, 0.11, 0.14, 0.07, 0, 0, 0.08);
    clerk.homeX = cp[0]; clerk.homeZ = cp[2]; clerk.homeYaw = cp[3];
    clerk.baseX = cp[0]; clerk.baseZ = cp[2]; clerk.baseYaw = cp[3];
    this.root.add(clerk.root);
    this.clerk = clerk;
    this.humans.push(clerk);

    this.xuFather = this._makeRefugee('XuFather', ACTOR_POSITIONS.xuFather, 1.03, 'ragBrown', 'hempDark', 'refugee-man', -1);
    this.xuMother = this._makeRefugee('XuMother', ACTOR_POSITIONS.xuMother, 0.98, 'ragBlue', 'hemp', 'refugee-woman', 1);
    this.xuChild = this._makeRefugee('XuChild', ACTOR_POSITIONS.xuChild, 0.7, 'ochre', 'ragBlue', 'child', 1);
    this.xuFamily = [this.xuFather, this.xuMother, this.xuChild];
    this.humans.push(this.xuFather, this.xuMother, this.xuChild);
  }

  _makeRefugee(name, position, scale, robe, accent, headwear, bundleSide) {
    const human = this._makeHuman({
      name, robe, accent, skin: 'skinDeep', headwear, scale, role: 'refugee', bundleSide,
    });
    human.root.position.set(position[0], position[1], position[2]);
    human.root.rotation.y = position[3];
    human.homeX = position[0]; human.homeZ = position[2]; human.homeYaw = position[3];
    human.baseX = position[0]; human.baseZ = position[2]; human.baseYaw = position[3];
    this.root.add(human.root);
    return human;
  }

  _onCarry(event) {
    const kind = event?.kind ?? 'none';
    this._carryKind = this.playerRig.carryItems[kind] ? kind : 'none';
    this._carryAmount = Number.isFinite(event?.amount) ? event.amount : 0;
    this._syncPlayerProps(this._carryKind === 'none' ? 'idle' : 'carry', 'idle');
  }

  _onInteraction(event, success) {
    const id = event?.id ?? '';
    if (id === 'well' || id.startsWith('water')) this._workKind = 'water';
    else if (id.startsWith('harvest')) this._workKind = 'harvest';
    else if (id === 'thresher') this._workKind = 'thresh';
    else if (id === 'granary') this._workKind = 'ledger';
    else if (id === 'refugees') this._workKind = 'offer';
    else if (id === 'shrine' || id === 'bed') this._workKind = 'lamp';
    else this._workKind = 'work';
    this._workUntil = Math.max(this._workUntil, this.ctx.time.elapsed + (success ? 1.8 : 0.72));
  }

  _onDayPhase(event) {
    this._dayPhase = event?.phase ?? this._dayPhase;
    if (this._dayPhase === 'night') this._workKind = 'lamp';
  }

  _readPlayerState() {
    const player = this.player;
    let state = player.publicState ?? player.public ?? player.state ?? player;
    if (typeof player.getPublicState === 'function') {
      const result = player.getPublicState(this._publicState);
      state = result ?? this._publicState;
    }

    let position = state?.position ?? state?.pos ?? player.position ?? player.root?.position ?? player.object?.position;
    if (!position && typeof player.getPosition === 'function') {
      player.getPosition(this._scratchPosition);
      position = this._scratchPosition;
    }
    if (position) {
      if (Array.isArray(position)) this._followPosition.set(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
      else this._followPosition.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    }

    const yaw = state?.yaw ?? state?.heading ?? player.yaw ?? player.root?.rotation?.y ?? player.object?.rotation?.y;
    if (Number.isFinite(yaw)) this._publicState.yaw = yaw;

    const velocity = state?.velocity ?? player.velocity;
    let speed = state?.speed;
    if (!Number.isFinite(speed) && velocity) {
      const vx = velocity.x ?? velocity[0] ?? 0;
      const vz = velocity.z ?? velocity[2] ?? 0;
      speed = Math.sqrt(vx * vx + vz * vz);
    }
    if (!Number.isFinite(speed)) speed = state?.moving ? 1 : 0;
    this._movingSpeed = speed;
  }

  _applyPlayerTransform() {
    const rig = this.playerRig;
    if (this._debugKind !== 'none') {
      const staged = DEBUG_PLAYER[this._debugKind];
      if (staged) {
        rig.root.position.set(staged[0], staged[1], staged[2]);
        rig.root.rotation.y = staged[3];
      }
      rig.root.scale.setScalar(this._debugKind === 'horses' ? 1.14 : this._playerHomeScale);
      return;
    }
    rig.root.position.copy(this._followPosition);
    rig.root.rotation.y = this._publicState.yaw;
    rig.root.scale.setScalar(this._playerHomeScale);
  }

  update(dt, ctx) {
    const t = ctx.time.elapsed;
    this._readPlayerState();
    this._applyPlayerTransform();
    this._animatePlayer(dt, t);
    this._animateAnimals(t);
    this._animateVillagers(t);
  }

  _animatePlayer(dt, t) {
    let mode = 'idle';
    let action = this._workKind;
    if (this._debugPlayerMode) {
      mode = this._debugPlayerMode;
      action = this._debugAction;
    } else if (this._celebrateUntil > t) {
      mode = 'celebrate';
    } else if (this._workUntil > t) {
      mode = 'work';
    } else if (this._carryKind !== 'none') {
      mode = 'carry';
    } else if (this._movingSpeed > 0.08) {
      mode = 'walk';
    }
    if (this.feedCue) {
      this.feedCue.visible = this._debugKind === 'sheep';
      this.pigFeedCue.visible = this._debugKind === 'pigs';
      this.birdSeedCue.visible = this._debugKind === 'farm-animals';
      this.fieldTallyCue.visible = this._debugKind === 'agriculture' || this._debugKind === 'watering';
      this.handoffSackCue.visible = this._debugKind === 'events' || this._debugKind === 'tuntian';
    }

    const rig = this.playerRig;
    const stride = Math.sin(t * (7.5 + Math.min(4, this._movingSpeed * 1.7)));
    let legLeft = 0;
    let legRight = 0;
    let armLeft = 0;
    let armRight = 0;
    let armLeftZ = 0;
    let armRightZ = 0;
    let bodyPitch = 0;
    let bodyY = 0;
    let headPitch = 0;

    if (mode === 'walk') {
      const amplitude = Math.min(0.68, 0.25 + this._movingSpeed * 0.12);
      legLeft = stride * amplitude;
      legRight = -stride * amplitude;
      armLeft = -stride * amplitude * 0.72;
      armRight = stride * amplitude * 0.72;
      bodyY = Math.abs(Math.sin(t * 7.5)) * 0.055;
      bodyPitch = 0.08;
    } else if (mode === 'carry') {
      legLeft = stride * Math.min(0.34, this._movingSpeed * 0.1);
      legRight = -legLeft;
      armLeft = -1.0;
      armRight = -1.0;
      armLeftZ = -0.18;
      armRightZ = 0.18;
      bodyPitch = 0.09;
      bodyY = Math.sin(t * 2.4) * 0.012;
    } else if (mode === 'work') {
      if (action === 'harvest') {
        const cut = Math.sin(t * 8.2);
        bodyPitch = 0.52;
        bodyY = -0.12;
        armLeft = -0.72;
        armRight = -0.9 + cut * 0.58;
        armRightZ = 0.25;
        legLeft = -0.25;
        legRight = 0.38;
        headPitch = -0.22;
      } else if (action === 'water') {
        bodyPitch = 0.26;
        armLeft = -1.2;
        armRight = -1.2;
        armLeftZ = -0.22;
        armRightZ = 0.22;
        rig.carryMount.rotation.x = -0.48 + Math.sin(t * 3.5) * 0.08;
      } else if (action === 'thresh') {
        const pump = Math.sin(t * 7.5);
        bodyPitch = 0.24;
        armLeft = -0.75 + pump * 0.26;
        armRight = -0.75 - pump * 0.26;
        legLeft = -0.2 + pump * 0.45;
        legRight = 0.18 - pump * 0.18;
        bodyY = Math.max(0, pump) * 0.06;
      } else if (action === 'offer' || action === 'ledger') {
        armLeft = -1.1;
        armRight = -1.1;
        armLeftZ = -0.17;
        armRightZ = 0.17;
        headPitch = 0.13;
      } else if (action === 'feed') {
        bodyPitch = 0.46;
        bodyY = -0.08;
        armLeft = -1.34;
        armRight = -1.52;
        armLeftZ = -0.28;
        armRightZ = 0.32;
        legLeft = -0.22;
        legRight = 0.35;
        headPitch = 0.22;
      } else if (action === 'scatter') {
        const cast = 0.5 + Math.sin(t * 2.6) * 0.12;
        bodyPitch = 0.18;
        armLeft = -0.85;
        armRight = -1.25 - cast;
        armLeftZ = -0.12;
        armRightZ = 0.66;
        legLeft = -0.18;
        legRight = 0.28;
        headPitch = 0.12;
      } else if (action === 'groom') {
        bodyPitch = 0.3;
        armLeft = -1.18;
        armRight = -1.72;
        armLeftZ = -0.28;
        armRightZ = 0.46;
        legLeft = -0.18;
        legRight = 0.25;
        headPitch = 0.08;
      } else if (action === 'lamp') {
        armLeft = -0.45;
        armRight = -1.62;
        armRightZ = 0.2;
        headPitch = -0.12;
      } else if (action === 'woodcutting') {
        const swing = Math.sin(t * 5.4);
        bodyPitch = 0.23 + Math.max(0, swing) * 0.15;
        armLeft = -1.35 + swing * 0.52;
        armRight = -1.18 + swing * 0.48;
        armLeftZ = -0.32;
        armRightZ = 0.18;
      } else if (action === 'plough') {
        bodyPitch = 0.3;
        armLeft = -1.0;
        armRight = -1.0;
        armLeftZ = -0.22;
        armRightZ = 0.22;
        legLeft = stride * 0.3;
        legRight = -stride * 0.3;
      } else {
        armLeft = -0.7 + Math.sin(t * 5.8) * 0.35;
        armRight = -0.5 - Math.sin(t * 5.8) * 0.35;
        bodyPitch = 0.2;
      }
    } else if (mode === 'celebrate') {
      armLeft = -2.35;
      armRight = -2.35;
      armLeftZ = -0.28;
      armRightZ = 0.28;
      bodyY = Math.abs(Math.sin(t * 4.5)) * 0.1;
      headPitch = -0.18;
    } else {
      bodyY = Math.sin(t * 1.7) * 0.014;
      armLeft = Math.sin(t * 1.2) * 0.035;
      armRight = -armLeft;
      headPitch = Math.sin(t * 0.7) * 0.025;
    }

    rig.leftLeg.rotation.x = damp(rig.leftLeg.rotation.x, legLeft, 13, dt);
    rig.rightLeg.rotation.x = damp(rig.rightLeg.rotation.x, legRight, 13, dt);
    rig.leftArm.rotation.x = damp(rig.leftArm.rotation.x, armLeft, 13, dt);
    rig.rightArm.rotation.x = damp(rig.rightArm.rotation.x, armRight, 13, dt);
    rig.leftArm.rotation.z = damp(rig.leftArm.rotation.z, armLeftZ, 13, dt);
    rig.rightArm.rotation.z = damp(rig.rightArm.rotation.z, armRightZ, 13, dt);
    rig.body.rotation.x = damp(rig.body.rotation.x, bodyPitch, 11, dt);
    rig.body.position.y = damp(rig.body.position.y, bodyY, 12, dt);
    rig.head.rotation.x = damp(rig.head.rotation.x, headPitch, 9, dt);
    if (!(mode === 'work' && action === 'water')) rig.carryMount.rotation.x = damp(rig.carryMount.rotation.x, 0, 11, dt);
    this._syncPlayerProps(mode, action);
  }

  _syncPlayerProps(mode, action) {
    const items = this.playerRig.carryItems;
    let visibleKind = this._carryKind;
    if (mode === 'carry' && visibleKind === 'none') visibleKind = 'millet-sheaf';
    if (mode === 'work' && action === 'water') visibleKind = 'water-bucket';
    else if (mode === 'work' && (action === 'offer' || action === 'feed' || action === 'scatter')) visibleKind = 'seed-pouch';
    else if (mode === 'work' && action === 'ledger') visibleKind = this._debugKind === 'events' || this._debugKind === 'tuntian' ? 'none' : 'grain-sack';
    else if (mode === 'work' && action === 'lamp') visibleKind = 'lamp';
    else if (mode === 'work' && (action === 'woodcutting' || action === 'groom' || action === 'plough')) visibleKind = 'none';
    const carryKeys = this.playerRig.carryKeys;
    for (let i = 0; i < carryKeys.length; i++) items[carryKeys[i]].visible = carryKeys[i] === visibleKind;
    items['water-bucket'].scale.setScalar(action === 'water' ? 1.4 : 1);
    items['grain-sack'].scale.setScalar(action === 'ledger' ? 1.38 : 1);
    items['seed-pouch'].scale.setScalar(action === 'feed' || action === 'scatter' ? 1.28 : 1);
    if (action === 'water') this.playerRig.carryMount.position.set(0, 0.84, 0.73);
    else if (action === 'feed' || action === 'scatter') this.playerRig.carryMount.position.set(0, 0.78, 0.72);
    else if (action === 'ledger') this.playerRig.carryMount.position.set(0, 1.03, 0.72);
    else this.playerRig.carryMount.position.set(0, 1.05, 0.54);

    const tools = this.playerRig.tools;
    tools.sickle.visible = mode === 'work' && action === 'harvest';
    tools.hoe.visible = mode === 'work' && (action === 'work' || action === 'plough');
    tools.axe.visible = mode === 'work' && action === 'woodcutting';
    tools.brush.visible = mode === 'work' && action === 'groom';
    if (tools.axe.visible) {
      this.playerRig.toolMount.position.set(0.4, 1.12, 0.5);
      this.playerRig.toolMount.rotation.set(-0.42, 0.04, 0.32);
      tools.axe.scale.setScalar(1.15);
    } else {
      this.playerRig.toolMount.position.set(0.55, 1.08, 0.18);
      this.playerRig.toolMount.rotation.set(0, 0, 0);
      tools.axe.scale.setScalar(1);
    }
    if (tools.brush.visible) {
      this.playerRig.toolMount.position.set(0.56, 1.03, 0.58);
      this.playerRig.toolMount.rotation.set(-0.32, 0.08, 0.42);
      tools.brush.scale.setScalar(1.35);
    }
  }

  _animateAnimals(t) {
    for (let i = 0; i < this.animals.length; i++) {
      const animal = this.animals[i];
      const phase = animal.phase;
      const slow = t * 0.42 + phase;
      if (animal.kind === 'chicken' || animal.kind === 'goose') {
        const stagedBirds = this._debugKind === 'farm-animals';
        const radius = stagedBirds ? 0.055 : animal.kind === 'goose' ? 0.19 : 0.32;
        animal.root.position.x = animal.baseX + Math.sin(slow * 0.9) * radius;
        animal.root.position.z = animal.baseZ + Math.cos(slow * 0.9) * radius;
        animal.root.rotation.y = animal.baseYaw + Math.sin(slow * 0.9) * 0.7;
        const peck = stagedBirds ? 0.88 : Math.max(0, Math.sin(t * 3.8 + phase));
        animal.neck.rotation.x = peck * 0.72;
        animal.root.position.y = Math.abs(Math.sin(t * 4.6 + phase)) * 0.018;
        animal.legs[0].rotation.x = Math.sin(t * 4.6 + phase) * 0.22;
        animal.legs[1].rotation.x = -animal.legs[0].rotation.x;
        animal.wingLeft.rotation.z = -0.2 - Math.sin(t * 1.3 + phase) * 0.04;
        animal.wingRight.rotation.z = 0.2 + Math.sin(t * 1.3 + phase) * 0.04;
        continue;
      }

      const isReactionAnimal =
        (this._debugKind === 'pigs' && animal.kind === 'pig') ||
        (this._debugKind === 'sheep' && animal === this.sheep[0]) ||
        (this._debugKind === 'horses' && animal.kind === 'horse');
      const shift = isReactionAnimal ? 0.018 : animal.kind === 'pig' ? 0.17 : 0.08;
      animal.root.position.x = animal.baseX + Math.sin(slow * 0.31) * shift;
      animal.root.position.z = animal.baseZ + Math.cos(slow * 0.27) * shift;
      animal.root.rotation.y = animal.baseYaw + Math.sin(slow * 0.22) * 0.12;
      animal.root.position.y = 0;

      if (animal.head) {
        const graze = animal.kind === 'sheep' || animal.kind === 'goat' || animal.kind === 'cattle';
        const careSheep = this._debugKind === 'sheep' && animal === this.sheep[0];
        const reactingPig = this._debugKind === 'pigs' && animal.kind === 'pig';
        animal.head.rotation.x = careSheep ? -0.12 : reactingPig ? -0.08 : graze ? 0.2 + Math.max(0, Math.sin(t * 0.65 + phase)) * 0.48 : Math.sin(t * 0.9 + phase) * 0.08;
        animal.head.rotation.y = careSheep || reactingPig ? 0 : Math.sin(t * 0.53 + phase) * 0.09;
      }
      if (animal.neck && animal.kind === 'horse') {
        if (this._debugKind === 'horses') {
          animal.neck.rotation.x = animal.foal ? -0.72 : -0.58;
          animal.head.rotation.x = animal.foal ? 0.12 : -0.06;
          animal.head.rotation.y = animal.foal ? -0.14 : 0.12;
        } else {
          animal.neck.rotation.x = -0.38 + Math.sin(t * 0.48 + phase) * 0.06;
          animal.head.rotation.x = Math.sin(t * 0.72 + phase) * 0.08;
        }
      }
      if (animal.ears) {
        animal.ears[0].rotation.z = -0.22 + Math.sin(t * 2.2 + phase) * 0.13;
        animal.ears[1].rotation.z = 0.22 - Math.sin(t * 2.2 + phase) * 0.13;
      }
      if (animal.tail) animal.tail.rotation.y = Math.sin(t * 2.0 + phase) * 0.35;

      const gait = animal === this.ox && this._debugKind === 'agriculture' ? 0.34 : animal.kind === 'pig' && animal.baby ? 0.12 : 0.035;
      if (animal.legs) {
        const step = Math.sin(t * 4.1 + phase) * gait;
        for (let j = 0; j < animal.legs.length; j++) animal.legs[j].rotation.x = (j % 2 ? -step : step);
      }
    }
  }

  _animateVillagers(t) {
    const allocationTableau = this._debugKind === 'agriculture' || this._debugKind === 'watering' || this._debugKind === 'events' || this._debugKind === 'tuntian';
    for (let i = 0; i < this.humans.length; i++) {
      const human = this.humans[i];
      human.root.position.x = human.baseX;
      human.root.position.z = human.baseZ;
      human.root.rotation.y = human.baseYaw;
      human.body.position.y = Math.sin(t * 1.15 + human.phase) * 0.012;
      human.head.rotation.y = Math.sin(t * 0.6 + human.phase) * 0.09;
      if (human.role === 'clerk') {
        if (allocationTableau) {
          human.leftArm.rotation.x = -1.35;
          human.rightArm.rotation.x = -1.35;
          human.leftArm.rotation.z = -0.16;
          human.rightArm.rotation.z = 0.16;
          human.head.rotation.x = 0.05;
          human.head.rotation.y = -0.15;
        } else {
          human.leftArm.rotation.x = -0.72 + Math.sin(t * 0.9) * 0.04;
          human.rightArm.rotation.x = -0.72 - Math.sin(t * 0.9) * 0.04;
          human.leftArm.rotation.z = 0;
          human.rightArm.rotation.z = 0;
          human.head.rotation.x = 0.16 + Math.sin(t * 0.55) * 0.03;
        }
      } else {
        human.leftArm.rotation.x = -0.12 + Math.sin(t * 0.8 + human.phase) * 0.06;
        human.rightArm.rotation.x = 0.08 - Math.sin(t * 0.8 + human.phase) * 0.06;
        human.head.rotation.x = 0.08;
        if (allocationTableau) {
          human.head.rotation.y = human === this.xuChild ? 0.32 : 0.2;
          human.leftArm.rotation.x = human === this.xuChild ? -0.45 : -0.18;
        }
      }
    }
  }

  /**
   * Deterministic capture hook. Named locked-shot kinds arrange the relevant
   * ensemble without mutating gameplay. `none` and `clean` restore all homes.
   */
  debugPose(kind = 'none') {
    let value = String(kind ?? 'none').toLowerCase();
    if (value === 'herd') value = 'sheep';
    else if (value === 'woodcut') value = 'woodcutting';
    else if (value === 'granary') value = 'events';
    this._resetDebugStage();
    if (value === 'none' || value === 'clean') return 'none';
    this._debugKind = value;

    if (value === 'watering') {
      this._debugPlayerMode = 'work';
      this._debugAction = 'water';
      this._hideAllAnimals();
      this._stageFieldAllocation();
    } else if (value === 'agriculture') {
      this._debugPlayerMode = 'work';
      this._debugAction = 'harvest';
      this._hideAllAnimals();
      this._stageFieldAllocation();
    } else if (value === 'woodcutting') {
      this._debugPlayerMode = 'work';
      this._debugAction = 'woodcutting';
      this.playerRig.root.scale.setScalar(1.12);
    } else if (value === 'pigs') {
      this._debugPlayerMode = 'work';
      this._debugAction = 'feed';
      this._hideAllAnimals();
      this._hideAllHumans();
      this.sow.root.visible = true;
      this.piglet.root.visible = true;
      setBase(this.piglet, -17.67, 1.27, -0.63);
      setBase(this.sow, -16.43, -0.42, -0.63);
    } else if (value === 'sheep') {
      this._debugPlayerMode = 'work';
      this._debugAction = 'feed';
      this._hideAllAnimals();
      this._hideAllHumans();
      this.sheep[0].root.visible = true;
      setBase(this.sheep[0], -15.29, -6.52, -0.66);
      if (this.sheep[1]) {
        this.sheep[1].root.visible = true;
        setBase(this.sheep[1], -21.45, -2.71, 2.25);
      }
      if (this.sheep[2]) {
        this.sheep[2].root.visible = true;
        setBase(this.sheep[2], -18.37, -6.64, 0.32);
      }
      if (this.goats[0]) {
        this.goats[0].root.visible = true;
        setBase(this.goats[0], -15.28, -10.58, -0.72);
      }
    } else if (value === 'events') {
      this._debugPlayerMode = 'work';
      this._debugAction = 'ledger';
      this._hideAllAnimals();
      this._stageGranaryExchange();
    } else if (value === 'farm-animals') {
      this._debugPlayerMode = 'work';
      this._debugAction = 'scatter';
      this._hideAllAnimals();
      this._hideAllHumans();
      const stagedBirds = [this.birds[0], this.birds[1], this.birds[2], this.birds[3], this.birds[this.birds.length - 2], this.birds[this.birds.length - 1]];
      const birdPose = [
        [-15.52, -6.2, 0.45],
        [-16.59, -5.65, 0.7],
        [-16.89, -4.48, 1.92],
        [-18.04, -3.99, 1.95],
        [-16.39, -7.67, 0.09],
        [-19.49, -4.26, 1.91],
      ];
      for (let i = 0; i < stagedBirds.length; i++) {
        stagedBirds[i].root.visible = true;
        setBase(stagedBirds[i], birdPose[i][0], birdPose[i][1], birdPose[i][2]);
      }
      if (this.cattle[0]) {
        this.cattle[0].root.visible = true;
        setBase(this.cattle[0], -22.44, -1.36, 2.06);
      }
    } else if (value === 'horses') {
      this._debugPlayerMode = 'work';
      this._debugAction = 'groom';
      this._hideAllAnimals();
      this._hideAllHumans();
      this.mare.root.visible = true;
      this.foal.root.visible = true;
      setBase(this.foal, -16.75, -6.15, -1.25);
      setBase(this.mare, -15.25, -8.75, -0.58);
      this.mare.root.scale.setScalar(0.9);
      this.foal.root.scale.setScalar(0.55);
    } else if (value === 'tuntian' || value === 'allocation') {
      this._debugKind = 'tuntian';
      this._debugPlayerMode = 'work';
      this._debugAction = 'ledger';
      this._hideAllAnimals();
      this._stageGranaryExchange();
    } else if (value === 'walk' || value === 'work' || value === 'carry') {
      this._debugKind = 'agriculture';
      this._debugPlayerMode = value;
      this._debugAction = value === 'work' ? 'harvest' : 'idle';
    } else if (value === 'ox-plough') {
      this._debugKind = 'agriculture';
      this._debugPlayerMode = 'work';
      this._debugAction = 'plough';
      setBase(this.ox, 2.3, 6.4, Math.PI);
    } else if (value === 'refugees') {
      this._debugKind = 'events';
      this._debugPlayerMode = 'work';
      this._debugAction = 'offer';
    }
    this._applyPlayerTransform();
    if (value === 'woodcutting') this.playerRig.root.scale.setScalar(1.12);
    return this._debugKind;
  }

  _stageFieldAllocation() {
    setBase(this.clerk, -1.99, 6.83, 2.4);
    setBase(this.xuFather, 0.67, 0.43, 0.16);
    setBase(this.xuMother, 1.08, -1.4, 0.04);
    setBase(this.xuChild, 1.45, -3.13, -0.07);
  }

  _stageGranaryExchange() {
    setBase(this.clerk, 16.56, 1.38, -2.35);
    setBase(this.xuFather, 20.1, 0.16, -1.88);
    setBase(this.xuMother, 21.4, 0.74, -1.94);
    setBase(this.xuChild, 22.66, 1.43, -1.98);
  }

  _hideAllAnimals() {
    for (let i = 0; i < this.animals.length; i++) this.animals[i].root.visible = false;
    if (this.optionalAccents) this.optionalAccents.visible = false;
  }

  _hideAllHumans() {
    for (let i = 0; i < this.humans.length; i++) this.humans[i].root.visible = false;
  }

  _resetDebugStage() {
    this._debugKind = 'none';
    this._debugPlayerMode = null;
    this._debugAction = 'idle';
    this.playerRig.root.scale.setScalar(this._playerHomeScale);
    if (this.feedCue) {
      this.feedCue.visible = false;
      this.pigFeedCue.visible = false;
      this.birdSeedCue.visible = false;
      this.fieldTallyCue.visible = false;
      this.handoffSackCue.visible = false;
    }
    if (this.optionalAccents) this.optionalAccents.visible = true;
    resetBase(this.ox);
    for (let i = 0; i < this.animals.length; i++) resetBase(this.animals[i]);
    for (let i = 0; i < this.humans.length; i++) resetBase(this.humans[i]);
    this._applyPlayerTransform();
  }

  getPlayerVisualPosition(out) {
    return out.copy(this.playerRig.root.position);
  }

  getActor(name) {
    if (name === 'player') return this.playerRig.root;
    if (name === 'ox') return this.ox.root;
    if (name === 'sow') return this.sow.root;
    if (name === 'piglet') return this.piglet.root;
    if (name === 'mare') return this.mare.root;
    if (name === 'foal') return this.foal.root;
    if (name === 'clerk') return this.clerk.root;
    if (name === 'refugees') return this.xuFather.root;
    return null;
  }

  async prewarmMaterials() {
    let meshes = 0;
    this.root.traverse((o) => { if (o.isMesh) meshes++; });
    return { ok: true, meshes, retained: true };
  }

  dispose() {
    this._offCarry?.();
    this._offAttempt?.();
    this._offSuccess?.();
    this._offPhase?.();
    this._offComplete?.();
    this.root.parent?.remove(this.root);
    this.root.traverse((o) => { if (o.isInstancedMesh) o.dispose?.(); });
    for (const key of Object.keys(this.G)) this.G[key].dispose();
    for (const key of Object.keys(this.M)) this.M[key].dispose();
    for (let i = 0; i < this.optionalModels.length; i++) this._disposeOptionalModel(this.optionalModels[i]);
    this.root.clear();
  }
}
