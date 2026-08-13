import * as THREE from 'three';
import { PALETTE, mat, enableShadows, varyColor } from '../core/materials.js';
import { box, cyl, sphere, roof, makeLabelTexture } from '../core/geometry.js';
import { LANDMARKS } from './landmarks.js';

const M = {};
const G = {};

export class WorldSystem {
  static id = 'world';
  static deps = ['render'];

  async init(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'HanFarmWorld';
    ctx.scene.add(this.root);
    this.interactableRoots = new Map();
    this.activeTarget = null;
    this._wind = 0;
    this._makeMaterials();
    this._makeGround();
    this._makeFarmstead();
    this._makeFields();
    this._makeWell();
    this._makeThresher();
    this._makeGranary();
    this._makeMilitarySupplyRoad();
    this._makeRefugeePlot();
    this._makeShrine();
    this._makePastures();
    this._makeForestAndHorizon();
    this._makePathsAndGuides();
    enableShadows(this.root);
    this._offTask = ctx.events.on('task:changed', (e) => this.setActiveTarget(e.targetId));
  }

  _makeMaterials() {
    Object.assign(M, {
      earth: mat(PALETTE.earth, { roughness: 1 }), earthDark: mat(PALETTE.earthDark), earthLight: mat(PALETTE.earthLight),
      earthCourse: mat(PALETTE.earthCourse, { roughness: 1 }), clayWash: mat(PALETTE.clayWash, { roughness: 1 }),
      path: mat(PALETTE.path), hemp: mat(PALETTE.hemp), hempDark: mat(PALETTE.hempDark),
      timber: mat(PALETTE.timber), timberDark: mat(PALETTE.timberDark),
      tile: mat(PALETTE.tile), tileLight: mat(PALETTE.tileLight), tileDark: mat(PALETTE.tileDark),
      millet: mat(PALETTE.millet), milletLight: mat(PALETTE.milletLight), milletDark: mat(PALETTE.milletDark),
      grass: mat(PALETTE.grass), grassBlade: mat(PALETTE.grass, { side: THREE.DoubleSide }),
      grassLight: mat(PALETTE.grassLight), grassDark: mat(PALETTE.grassDark), leaf: mat(PALETTE.leaf),
      water: mat(PALETTE.water, { roughness: 0.28, metalness: 0.04, transparent: true, opacity: 0.82 }),
      stone: mat(0x716c60), stoneLight: mat(0x938b78), seal: mat(PALETTE.seal), lacquer: mat(PALETTE.lacquer),
      gold: mat(PALETTE.gold, { emissive: 0x6b3b05, emissiveIntensity: 0.55 }), white: mat(PALETTE.white), black: mat(PALETTE.black),
      thatch: mat(PALETTE.thatch, { roughness: 1 }), thatchLight: mat(PALETTE.thatchLight, { roughness: 1 }),
      thatchDark: mat(PALETTE.thatchDark, { roughness: 1 }), bamboo: mat(PALETTE.bamboo),
      bambooLight: mat(PALETTE.bambooLight), bambooDark: mat(PALETTE.bambooDark), ink: mat(0x2b241c),
      clothIndigo: mat(PALETTE.clothIndigo, { roughness: 1 }), clothRust: mat(PALETTE.clothRust, { roughness: 1 }),
      clothFaded: mat(PALETTE.clothFaded, { roughness: 1 }),
    });
    Object.assign(G, {
      grass: makeGrassClumpGeometry(), milletStem: new THREE.CylinderGeometry(0.018, 0.028, 1, 5),
      milletBlade: makeMilletBladeGeometry(), milletRachis: new THREE.CylinderGeometry(0.012, 0.017, 1, 5),
      milletSeed: new THREE.IcosahedronGeometry(0.034, 0), leaf: new THREE.IcosahedronGeometry(0.12, 0),
      trunk: new THREE.CylinderGeometry(0.18, 0.28, 1.8, 7), crown: new THREE.IcosahedronGeometry(1.05, 1), post: new THREE.CylinderGeometry(0.05, 0.065, 1, 6),
    });
  }

  _makeGround() {
    // A broad, low outer apron keeps the playable square from ending in a hard
    // tabletop edge when the camera drops near crop height.
    const outer = new THREE.Mesh(new THREE.CircleGeometry(94, 64), M.grassDark);
    outer.name = 'DistantGroundApron'; outer.rotation.x = -Math.PI / 2; outer.scale.z = 0.78;
    outer.position.y = -0.055; outer.receiveShadow = true; this.root.add(outer);
    const base = box(66, 1.2, 62, M.grassDark, 0, -0.62, 0);
    base.receiveShadow = true; this.root.add(base);
    const yard = new THREE.Mesh(new THREE.CircleGeometry(23, 48), M.grass);
    yard.rotation.x = -Math.PI / 2; yard.position.y = 0.005; yard.scale.z = 0.9; yard.receiveShadow = true; this.root.add(yard);
    this._scatterGrass(0, 0, 24, 1350);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(4.5, 28), M.water);
    pond.rotation.x = -Math.PI / 2; pond.scale.z = 0.58; pond.position.set(22, 0.035, -20); pond.userData.noShadow = true; this.root.add(pond);
    for (let i = 0; i < 32; i++) {
      const a = i * 2.399, r = 3.4 + (i % 4) * 0.35;
      const reed = cyl(0.035, 0.05, 0.7 + (i % 3) * 0.17, 5, M.grassLight, 22 + Math.cos(a) * r, 0.35, -20 + Math.sin(a) * r * 0.58);
      this.root.add(reed);
    }
  }

  _scatterGrass(cx, cz, radius, count) {
    const mesh = new THREE.InstancedMesh(G.grass, M.grassLight, count);
    mesh.frustumCulled = false; mesh.receiveShadow = true;
    const d = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = i * 2.399963, r = radius * Math.sqrt(((i * 47) % count) / count);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if ((x > -5 && x < 5 && z > -2 && z < 11) || (x > 5 && x < 12 && z > 1 && z < 7)) d.scale.setScalar(0.01);
      else d.scale.set(0.75 + (i % 5) * 0.09, 0.65 + (i % 7) * 0.08, 0.75 + (i % 3) * 0.1);
      d.position.set(x, 0.015, z); d.rotation.y = a; d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true; this.root.add(mesh);
  }

  _makeFarmstead() {
    const home = new THREE.Group(); home.position.set(-12, 0, -11);
    home.add(box(8.8, 3.8, 5.6, M.earthLight, 0, 1.9, 0));
    this._addEarthCourses(home, 8.8, 3.8, 5.6);
    this._addThatchRoof(home, 10.2, 6.5, 2.2, 0, 3.7, 0);
    for (const x of [-4, -2, 0, 2, 4]) home.add(box(0.18, 3.9, 0.22, M.timber, x, 1.95, 2.86));
    for (const y of [0.72, 2.55]) home.add(box(8.55, 0.13, 0.24, M.timber, 0, y, 2.88));
    home.add(box(1.7, 2.6, 0.25, M.lacquer, 0, 1.3, 2.9));
    home.add(box(2.6, 0.35, 1.05, M.hemp, 0.8, 0.35, -0.9));
    home.add(box(2.15, 0.55, 1.45, M.earthDark, 0.8, 0.28, -0.9));
    this.root.add(home);
    this.interactableRoots.set('bed', home);
    for (let i = 0; i < 8; i++) this.root.add(cyl(0.2, 0.26, 1.7, 7, M.timber, -17 + i * 1.25, 0.85, -7.2));
  }

  _makeFields() {
    const soil = new THREE.Group();
    for (let row = 0; row < 6; row++) {
      const z = 8.2 - row * 2.05;
      soil.add(box(11.2, 0.2, 1.35, row < 3 ? M.earth : M.earthDark, 0.3, 0.11, z));
      soil.add(box(11.2, 0.06, 0.25, M.path, 0.3, 0.15, z - 0.8));
    }
    this.root.add(soil);
    const waterPos = [-3.2, 0, 3.2];
    for (let i = 0; i < 3; i++) this._makeSeedBed(`water${i + 1}`, waterPos[i], 8.2);
    const harvestPos = [[-3,2.4],[0,2.4],[3,2.4],[-1.55,-0.15],[1.55,-0.15]];
    harvestPos.forEach((p, i) => this._makeMilletPatch(`harvest${i + 1}`, p[0], p[1]));
    this._makeCropPatch(-3.6, 5.3, 0x789b51, 'soybean');
    this._makeCropPatch(4.1, 5.3, 0x708d3c, 'hemp');
    this._makeFieldTally();
  }

  _makeFieldTally() {
    const g = new THREE.Group(); g.position.set(5.25, 0, 3.6); g.name = 'FieldTallyStation';
    g.add(box(2.9, 0.17, 1.34, M.timber, 0, 1.08, 0));
    for (const x of [-1.18, 1.18]) g.add(box(0.17, 1.08, 0.17, M.timberDark, x, 0.54, 0));
    const register = this._makeBambooRegister(13);
    register.position.set(-0.08, 1.2, 0.03); register.rotation.x = -0.13; register.rotation.y = -0.04;
    g.add(register);
    const brushCup = cyl(0.31, 0.38, 0.4, 10, M.earthDark, 1.08, 1.32, -0.06);
    g.add(brushCup);
    for (const x of [0.99, 1.11, 1.2]) {
      const brush = cyl(0.018, 0.022, 0.72, 5, M.bambooDark, x, 1.78, -0.06);
      brush.rotation.z = (x - 1.1) * 0.35; g.add(brush);
    }
    this.root.add(g);
  }

  _makeSeedBed(id, x, z) {
    const g = new THREE.Group(); g.position.set(x, 0.18, z);
    for (let i = 0; i < 12; i++) {
      const plant = new THREE.Group();
      plant.position.set(((i % 4) - 1.5) * 0.36, 0, (Math.floor(i / 4) - 1) * 0.28);
      plant.add(cyl(0.022,0.03,0.3,5,M.grassDark,0,0.15,0));
      const l1 = sphere(0.12,0,M.grassLight,-0.08,0.28,0,0.55); l1.rotation.z = 0.45; plant.add(l1);
      const l2 = sphere(0.12,0,M.grass,0.08,0.25,0,0.55); l2.rotation.z = -0.45; plant.add(l2); g.add(plant);
    }
    g.userData.state = 'dry'; this.root.add(g); this.interactableRoots.set(id, g);
  }

  _makeMilletPatch(id, x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    g.name = `MilletPaniclePatch:${id}`;
    const count = 14;
    const stems = new THREE.InstancedMesh(G.milletStem, M.grassLight, count);
    const blades = new THREE.InstancedMesh(G.milletBlade, M.grassBlade, count * 3);
    const rachis = new THREE.InstancedMesh(G.milletRachis, M.milletDark, count * 4);
    const seeds = new THREE.InstancedMesh(G.milletSeed, M.millet, count * 9);
    const d = new THREE.Object3D();
    let bladeIndex = 0, rachisIndex = 0, seedIndex = 0;
    for (let i = 0; i < 14; i++) {
      const a = i * 2.399, r = 0.18 + (i % 5) * 0.16;
      const px = Math.cos(a) * r, pz = Math.sin(a) * r * 0.65;
      const h = 1.02 + (i % 4) * 0.055;
      d.position.set(px, h * 0.5, pz); d.rotation.set(0, a * 0.17, (i % 3 - 1) * 0.035);
      d.scale.set(0.88 + (i % 2) * 0.12, h, 0.88 + ((i + 1) % 2) * 0.12); d.updateMatrix(); stems.setMatrixAt(i, d.matrix);

      // Three long, narrow blades at staggered heights read as a dense cereal
      // stand; broad cabbage-like blobs made the old plants resemble maize.
      for (let j = 0; j < 3; j++) {
        d.position.set(px, 0.17 + j * 0.2, pz);
        d.rotation.set(0, a + j * 2.05 + (i % 2) * 0.4, (j - 1) * 0.025);
        const bladeScale = 0.72 + ((i + j) % 3) * 0.08;
        d.scale.set(bladeScale, bladeScale, bladeScale); d.updateMatrix(); blades.setMatrixAt(bladeIndex++, d.matrix);
      }

      // A fine, four-link rachis bows out and down. Nine tiny offset seed
      // clusters keep the silhouette open and tapering instead of cob-shaped.
      const dir = a + 0.75 + (i % 3) * 0.2;
      const dx = Math.cos(dir), dz = Math.sin(dir);
      const points = [
        new THREE.Vector3(px, h, pz),
        new THREE.Vector3(px + dx * 0.08, h + 0.17, pz + dz * 0.08),
        new THREE.Vector3(px + dx * 0.22, h + 0.18, pz + dz * 0.22),
        new THREE.Vector3(px + dx * 0.37, h + 0.10, pz + dz * 0.37),
        new THREE.Vector3(px + dx * 0.48, h - 0.035, pz + dz * 0.48),
      ];
      for (let j = 0; j < 4; j++) setInstanceBetween(rachis, rachisIndex++, d, points[j], points[j + 1]);
      for (let j = 0; j < 9; j++) {
        const t = (j + 0.5) / 9;
        const segment = Math.min(3, Math.floor(t * 4));
        const localT = t * 4 - segment;
        const p = points[segment].clone().lerp(points[segment + 1], localT);
        const side = (j % 2 ? 1 : -1) * (0.025 + (j % 3) * 0.012) * (1 - t * 0.45);
        p.x += -dz * side; p.z += dx * side;
        d.position.copy(p); d.rotation.set((j % 3 - 1) * 0.3, dir, 0.25 + t * 0.55);
        const taper = 1 - t * 0.38;
        d.scale.set(taper * 1.2, taper * 1.6, taper); d.updateMatrix(); seeds.setMatrixAt(seedIndex++, d.matrix);
      }
    }
    for (const mesh of [stems, blades, rachis, seeds]) {
      mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; g.add(mesh);
    }
    this.root.add(g); this.interactableRoots.set(id, g);
  }

  _makeCropPatch(x, z, color, name) {
    const material = mat(color); const group = new THREE.Group(); group.name = name;
    for (let i = 0; i < 18; i++) {
      const px = x + ((i % 6) - 2.5) * 0.33, pz = z + (Math.floor(i / 6) - 1) * 0.35;
      const stem = cyl(0.02,0.025,0.52,5,M.grassDark,px,0.26,pz); group.add(stem);
      group.add(sphere(0.13,0,material,px,0.54,pz,0.65));
    }
    this.root.add(group);
  }

  _makeWell() {
    const g = new THREE.Group(); g.position.set(LANDMARKS.well.x, 0, LANDMARKS.well.z);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const s = box(0.75,0.42,0.34,i%2?M.stone:M.stoneLight,Math.cos(a)*1.15,0.3,Math.sin(a)*1.15); s.rotation.y=-a; g.add(s); }
    g.add(cyl(0.95,0.95,0.12,24,M.water,0,0.42,0));
    g.add(box(0.18,2.8,0.18,M.timber,-1.28,1.4,0)); g.add(box(0.18,2.8,0.18,M.timber,1.28,1.4,0));
    g.add(box(3.0,0.18,0.18,M.timber,0,2.5,0));
    const spindle = cyl(0.15,0.15,2.7,8,M.timber,0,1.75,0); spindle.rotation.z=Math.PI/2; g.add(spindle);
    g.add(box(0.07,1.1,0.07,M.hemp,0,1.2,0)); g.add(cyl(0.25,0.2,0.42,8,M.timber,0,0.72,0));
    this.root.add(g); this.interactableRoots.set('well', g);
  }

  _makeThresher() {
    const g = new THREE.Group(); g.position.set(LANDMARKS.thresher.x, 0, LANDMARKS.thresher.z);
    g.add(box(3.6,0.45,2.5,M.timberDark,0,0.25,0)); g.add(box(3.15,1.3,2.1,M.timber,0,1.05,0));
    const drum = cyl(0.62,0.62,2.5,12,M.earthLight,0,1.42,0); drum.rotation.z=Math.PI/2; drum.name='ThreshingDrum'; g.add(drum); this.threshDrum=drum;
    for(let i=0;i<8;i++){const slat=box(0.08,0.08,2.65,M.hemp);slat.rotation.x=(i/8)*Math.PI*2;slat.position.y=1.42;g.add(slat);}
    g.add(box(2.6,0.16,0.8,M.earth,0,0.66,-1.45));
    this.root.add(g); this.interactableRoots.set('thresher', g);
  }

  _makeGranary() {
    const g = new THREE.Group(); g.position.set(18,0,-6);
    g.add(box(10,4.3,6.8,M.earthLight,0,2.15,0));
    this._addEarthCourses(g, 10, 4.3, 6.8);
    this._addTileRoof(g, 11.4, 8, 2.35, 0, 4.1, 0);
    for(const x of [-4.6,-2.3,0,2.3,4.6])g.add(box(0.22,4.35,0.26,M.timber,x,2.18,3.45));
    g.add(box(3.1,2.8,0.35,M.lacquer,0,1.4,3.55)); g.add(box(5.4,0.28,0.65,M.timberDark,0,3.5,3.72));
    const tex=makeLabelTexture('屯田署','#e7d9b5','#7c2d24'); const signMat=new THREE.MeshBasicMaterial({map:tex,transparent:true});
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(3.1,1.05),signMat);sign.position.set(0,3.72,3.88);g.add(sign);
    // Simple bracket sets and circular roof-tile ends give the official store
    // a restrained Han administrative silhouette rather than fantasy trim.
    for (const x of [-3.75, -1.9, 1.9, 3.75]) {
      g.add(box(0.68, 0.17, 0.95, M.timberDark, x, 4.03, 3.7));
      g.add(box(0.23, 0.52, 0.36, M.lacquer, x, 3.82, 3.58));
      g.add(box(1.02, 0.14, 0.38, M.timber, x, 3.74, 3.76));
    }
    const tally = new THREE.Group(); tally.position.set(-2.65, 0, 3.92); tally.name = 'GranaryBambooTallyDesk';
    tally.add(box(2.75, 0.17, 1.22, M.timber, 0, 1.1, 0));
    for (const x of [-1.1, 1.1]) tally.add(box(0.15, 1.12, 0.15, M.timberDark, x, 0.56, 0));
    const register = this._makeBambooRegister(13);
    register.position.set(0, 1.21, 0.02); register.rotation.x = -0.16; register.rotation.y = 0.04;
    tally.add(register);
    g.add(tally);
    // The share is visibly measured and divided here: a Han-era balance beam,
    // suspended pans, standard grain measures and two destination sacks turn
    // the tuntian levy from background copy into a physical farm institution.
    const scale = new THREE.Group(); scale.position.set(0.2, 0, 4.0); scale.name = 'TuntianGrainBalance';
    scale.add(cyl(0.1, 0.13, 1.72, 8, M.timberDark, 0, 0.86, 0));
    const beam = box(3.0, 0.13, 0.16, M.bambooDark, 0, 1.65, 0); beam.rotation.z = -0.045; scale.add(beam);
    scale.add(cyl(0.18, 0.22, 0.22, 8, M.lacquer, 0, 1.72, 0));
    for (const x of [-1.22, 1.22]) {
      for (const dx of [-0.29, 0.29]) {
        const cord = cyl(0.012, 0.012, 0.64, 5, M.hempDark, x + dx, 1.30 + (x > 0 ? -0.04 : 0.04), 0);
        cord.rotation.z = (dx > 0 ? -1 : 1) * 0.17; scale.add(cord);
      }
      const pan = cyl(0.48, 0.34, 0.12, 12, M.lacquer, x, 0.95 + (x > 0 ? -0.08 : 0.08), 0);
      scale.add(pan);
      if (x < 0) for (let i = 0; i < 9; i++) scale.add(sphere(0.065, 0, M.gold, x - 0.27 + (i % 3) * 0.27, 1.05 + Math.floor(i / 3) * 0.085, -0.13 + (i % 2) * 0.16));
      else scale.add(cyl(0.29, 0.36, 0.42, 10, M.bamboo, x, 1.08, 0));
    }
    g.add(scale);
    const split = new THREE.Group(); split.position.set(2.45, 0, 4.0); split.name = 'TuntianShareSplit';
    const makeSack = (x, material) => {
      const sack = sphere(0.43, 1, material, x, 0.47, 0, 1.28); split.add(sack);
      split.add(cyl(0.12, 0.17, 0.25, 8, material, x, 0.92, 0));
      split.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 5, 12), M.hempDark));
      const tie = split.children[split.children.length - 1]; tie.rotation.x = Math.PI / 2; tie.position.set(x, 0.84, 0);
    };
    makeSack(-0.48, M.hemp); makeSack(0.48, M.hempDark);
    g.add(split);
    for(const x of [-3.2,3.2]){const jar=cyl(0.5,0.62,1.2,10,M.earth,x,0.62,2.8);g.add(jar);g.add(cyl(0.34,0.34,0.12,10,M.timberDark,x,1.27,2.8));}
    this.root.add(g); this.interactableRoots.set('granary', g);
  }

  _makeMilitarySupplyRoad() {
    const g = new THREE.Group(); g.position.set(19.5, 0, -1.2); g.name = 'XuchangMilitarySupplyTrain';
    // A compact grain cart waits beside the granary road. Spears and the
    // courier's relay horse are intentionally background-scale: war pressures
    // the farm without turning this cozy day into a hero parade.
    g.add(box(3.1, 0.58, 1.9, M.timber, 0, 1.05, 0));
    for (const x of [-1.15, 1.15]) {
      const axle = cyl(0.11, 0.11, 2.35, 7, M.timberDark, x, 0.72, 0); axle.rotation.x = Math.PI / 2; g.add(axle);
      for (const z of [-1.05, 1.05]) {
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.61, 0.1, 6, 14), M.timberDark);
        wheel.position.set(x, 0.68, z); wheel.rotation.y = Math.PI / 2; g.add(wheel);
      }
    }
    for (const x of [-0.8, 0, 0.8]) {
      const sack = sphere(0.43, 1, x === 0 ? M.hempDark : M.hemp, x, 1.6, 0, 1.15); g.add(sack);
      g.add(cyl(0.1, 0.14, 0.22, 7, x === 0 ? M.hempDark : M.hemp, x, 2.04, 0));
    }
    for (const x of [-1.25, 1.25]) {
      const spear = cyl(0.025, 0.032, 3.2, 6, M.bambooDark, x, 2.0, 0); spear.rotation.z = x * 0.035; g.add(spear);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.36, 4), M.stoneLight); head.position.set(x, 3.58, 0); g.add(head);
    }
    this.root.add(g);
  }

  _makeRefugeePlot() {
    const g=new THREE.Group();g.position.set(10.5,0,-17.5); g.name = 'XuRefugeeColony';
    g.add(box(10.4,0.13,7.2,M.earthDark,0,0.065,-0.55));

    // Broken old ridges alternate with newly reclaimed strips. Their gaps and
    // slight misalignment keep this from reading as a prosperous finished plot.
    const furrowSegments = [[-3.85,1.75,2.0],[-1.25,1.8,1.55],[1.05,1.72,1.75],[3.65,1.78,1.7]];
    for (let row=0;row<5;row++) {
      for (let s=0;s<furrowSegments.length;s++) {
        const [fx,fz,len] = furrowSegments[s];
        const ridge = box(len,0.16,0.31,(row+s)%3===0?M.earthCourse:M.earth,fx+(row%2)*0.12,0.13,fz-row*0.69);
        ridge.rotation.y=(s%2?1:-1)*0.025*(row+1);g.add(ridge);
      }
    }
    const shoots = new THREE.InstancedMesh(G.grass, M.grassLight, 30); const d = new THREE.Object3D();
    for (let i=0;i<30;i++) {
      const row=i%4, col=Math.floor(i/4);
      d.position.set(-3.6+col*0.62+(row%2)*0.11,0.18,1.73-row*0.69);
      d.rotation.y=i*2.399;d.scale.set(0.5,0.42+(i%3)*0.08,0.5);d.updateMatrix();shoots.setMatrixAt(i,d.matrix);
    }
    shoots.instanceMatrix.needsUpdate=true;g.add(shoots);

    g.add(box(4.8,2.7,3.8,M.earthLight,2.6,1.35,-3.2));
    this._addEarthCourses(g,4.8,2.7,3.8,2.6,0,-3.2);
    this._addThatchRoof(g,5.8,4.7,1.65,2.6,2.65,-3.2);
    g.add(box(1.45,2.0,0.22,M.timberDark,2.6,1.0,-1.28));

    const cart=this._makeRefugeeCart();cart.position.set(-2.7,0,-2.25);cart.rotation.y=-0.2;g.add(cart);
    const basketA=this._makeBasket(1);basketA.position.set(0.0,0.03,-2.15);g.add(basketA);
    const basketB=this._makeBasket(0.82);basketB.position.set(0.8,0.02,-1.72);basketB.rotation.y=0.4;g.add(basketB);
    const bundle=this._makePatchedBundle(M.clothFaded,M.clothIndigo);bundle.position.set(0.05,0.27,-1.25);bundle.scale.set(1.05,0.8,0.9);g.add(bundle);

    // A reed sleeping mat and repair frame turn the baggage into a lived-in
    // roadside colony rather than decorative crates.
    g.add(box(2.55,0.10,1.1,M.hemp,-0.85,0.14,-3.35));
    for(const z of [-3.76,-2.94])for(const x of [-1.95,0.25])g.add(box(.07,.04,1.0,M.bambooDark,x,0.2,z));
    for(const x of [-1.7,0.1])g.add(box(.11,1.35,.11,M.timber,x,.68,-3.82));
    g.add(box(2.05,.1,.1,M.timberDark,-.8,1.28,-3.82));
    const patchedCloth=box(1.8,.76,.035,M.clothIndigo,-.8,.9,-3.76);patchedCloth.rotation.z=-.045;g.add(patchedCloth);
    g.add(box(.52,.32,.045,M.clothRust,-.32,.98,-3.735));
    this.root.add(g); this.interactableRoots.set('refugees', g);
  }

  _makeShrine() {
    const g=new THREE.Group();g.position.set(LANDMARKS.shrine.x,0,LANDMARKS.shrine.z);
    g.add(box(4.4,0.42,3.2,M.stone,0,0.21,0));g.add(box(3.5,2.5,2.35,M.lacquer,0,1.65,0));g.add(roof(4.7,3.2,1.35,M.tile,0,2.85,0));
    g.add(box(2.7,0.18,0.85,M.timber,0,1.1,1.45));
    for(const x of [-0.75,0,0.75]){g.add(cyl(0.17,0.22,0.32,8,M.seal,x,1.4,1.55));}
    const flame=sphere(0.16,0,M.gold,0,1.78,1.55,1.45);flame.name='ShrineFlame';flame.visible=false;g.add(flame);this.shrineFlame=flame;
    this.root.add(g);this.interactableRoots.set('shrine',g);
  }

  _makePastures() {
    const fence = new THREE.Group(); fence.name='PastureFence';
    // Low, irregular wattle hurdles read as household animal management, not
    // a modern ranch/petting-zoo grid. Open gaps also preserve easy walking.
    const hurdle = (x1,z1,x2,z2) => {
      const dx=x2-x1,dz=z2-z1,len=Math.hypot(dx,dz),cx=(x1+x2)/2,cz=(z1+z2)/2,angle=Math.atan2(dx,dz);
      for(let i=0;i<=Math.floor(len/1.7);i++) {
        const t=i/Math.max(1,Math.floor(len/1.7));
        fence.add(cyl(.045,.065,.88,6,M.timberDark,x1+dx*t,.44,z1+dz*t));
      }
      for(const y of [.3,.58]) {
        const weave=box(.07,.065,len,M.bambooDark,cx,y,cz);weave.rotation.y=angle;weave.rotation.z=(y>.4?.018:-.014);fence.add(weave);
      }
    };
    hurdle(-23,-1.2,-18,-.7); hurdle(-16.2,-.7,-11.4,-1.4);
    hurdle(-23,-14.6,-17.7,-15.1); hurdle(-15.8,-15.1,-11.3,-14.4);
    hurdle(-23,-14.6,-22.7,-8.2); hurdle(-22.7,-6.5,-23,-1.2);
    hurdle(-11.3,-14.4,-11.1,-8.7); hurdle(-11.1,-7,-11.4,-1.4);
    this.root.add(fence);
    const stable=new THREE.Group();stable.position.set(-19.2,0,-11.95); stable.name='ThatchStable';
    stable.add(box(7.1,3.05,3.9,M.earthLight,0,1.525,0));
    this._addEarthCourses(stable,7.1,3.05,3.9);
    this._addThatchRoof(stable,8.25,4.9,1.65,0,2.95,0);
    for(const x of [-3.35,-1.68,0,1.68,3.35])stable.add(box(.18,3.05,.22,M.timber,x,1.525,2.02));
    stable.add(box(2.35,2.2,.25,M.timberDark,0,1.1,2.06));
    this.root.add(stable);
  }

  _addEarthCourses(group,width,height,depth,x=0,yBase=0,z=0) {
    group.add(box(width+0.16,0.18,depth+0.16,M.earthDark,x,yBase+0.09,z));
    const rows=Math.floor(height/0.64);
    for(let row=1;row<=rows;row++) {
      const y=yBase+row*0.64;
      group.add(box(width+0.045,0.052,depth+0.045,M.earthCourse,x,y,z));
      if(row<rows) {
        const patchWidth=width*(row%2?0.2:0.15);
        const px=x+width*(row%2?-0.24:0.23);
        group.add(box(patchWidth,0.2,0.035,M.clayWash,px,y+0.25,z+depth/2+0.02));
      }
    }
  }

  _addThatchRoof(group,width,depth,height,x=0,y=0,z=0) {
    group.add(roof(width,depth,height,M.thatch,x,y,z));
    const half=width/2;
    const ribs=Math.max(6,Math.floor(depth/0.7));
    for(let i=0;i<=ribs;i++) {
      const rz=z-depth/2+0.12+(depth-0.24)*(i/ribs);
      const tone=i%3===0?M.thatchDark:M.thatchLight;
      group.add(beamBetween(new THREE.Vector3(x-half-0.025,y+0.02,rz),new THREE.Vector3(x,y+height+0.045,rz),0.026,tone));
      group.add(beamBetween(new THREE.Vector3(x,y+height+0.045,rz),new THREE.Vector3(x+half+0.025,y+0.02,rz),0.026,tone));
    }
    const ridge=cyl(0.11,0.14,depth+0.35,7,M.thatchDark,x,y+height+0.09,z);
    ridge.rotation.x=Math.PI/2;group.add(ridge);
    const fringeCount=Math.max(8,Math.floor(depth/0.42));
    for(let i=0;i<=fringeCount;i++) {
      const fz=z-depth/2+(depth*i/fringeCount);
      const length=0.18+(i%3)*0.045;
      for(const side of [-1,1])group.add(cyl(0.014,0.02,length,4,i%2?M.thatchLight:M.thatchDark,x+side*(half+0.025),y-length/2+0.035,fz));
    }
  }

  _addTileRoof(group,width,depth,height,x=0,y=0,z=0) {
    group.add(roof(width,depth,height,M.tile,x,y,z));
    const half=width/2;
    const channels=12;
    for(let i=0;i<=channels;i++) {
      const rx=x-half+width*(i/channels);
      const surfaceY=y+height*(1-Math.abs(rx-x)/half)+0.045;
      group.add(box(0.09,0.065,depth+0.18,i%2?M.tileLight:M.tileDark,rx,surfaceY,z));
      const end=cyl(0.085,0.085,0.05,10,M.tileLight,rx,surfaceY,z+depth/2+0.07);
      end.rotation.x=Math.PI/2;group.add(end);
      const boss=sphere(0.024,0,M.tileDark,rx,surfaceY,z+depth/2+0.105);group.add(boss);
    }
    const ridge=cyl(0.14,0.17,depth+0.48,9,M.tileLight,x,y+height+0.12,z);
    ridge.rotation.x=Math.PI/2;group.add(ridge);
    const ridgeEnd=cyl(0.18,0.18,0.08,12,M.tileLight,x,y+height+0.12,z+depth/2+0.12);
    ridgeEnd.rotation.x=Math.PI/2;group.add(ridgeEnd);
    group.add(sphere(0.05,0,M.tileDark,x,y+height+0.12,z+depth/2+0.17));
  }

  _makeBambooRegister(count=13) {
    const g=new THREE.Group();g.name='TiedBambooSlipRegister';
    const spacing=0.158,total=(count-1)*spacing+0.15;
    for(let i=0;i<count;i++) {
      const x=(i-(count-1)/2)*spacing;
      const slip=box(0.145,0.052,1.04,i%4===0?M.bamboo:M.bambooLight,x,(i%3)*0.006,0);
      slip.rotation.y=(i%3-1)*0.012;g.add(slip);
      for(let mark=0;mark<2+(i%2);mark++) {
        const ink=box(0.027,0.016,0.11,M.ink,x,0.044,-0.19+mark*0.19+(i%3)*0.014);
        ink.rotation.y=(i%3-1)*0.012;g.add(ink);
      }
    }
    for(const rz of [-0.37,0.37]) {
      g.add(beamBetween(new THREE.Vector3(-total/2-0.04,0.095,rz),new THREE.Vector3(total/2+0.04,0.095,rz),0.018,M.hempDark));
      g.add(sphere(0.055,0,M.hempDark,total/2+0.05,0.1,rz));
    }
    const seal=cyl(0.115,0.115,0.045,10,M.seal,total*0.3,0.145,0.4);g.add(seal);
    g.add(beamBetween(new THREE.Vector3(total*0.27,0.11,0.36),new THREE.Vector3(total*0.16,0.08,0.23),0.014,M.hempDark));
    return g;
  }

  _makeBasket(scale=1) {
    const g=new THREE.Group();g.name='WovenTravelBasket';
    const body=new THREE.Mesh(new THREE.CylinderGeometry(0.38,0.27,0.56,10,1,true),M.bambooDark);
    body.position.y=0.31;g.add(body);
    for(const y of [0.12,0.34,0.57]) {
      const band=new THREE.Mesh(new THREE.TorusGeometry(0.29+(y/0.57)*0.075,0.022,5,10),M.bambooLight);
      band.rotation.x=Math.PI/2;band.position.y=y;g.add(band);
    }
    const mouth=cyl(0.31,0.31,0.025,10,M.ink,0,0.59,0);g.add(mouth);
    const handle=new THREE.Mesh(new THREE.TorusGeometry(0.37,0.028,5,12),M.bambooLight);
    handle.rotation.y=Math.PI/2;handle.position.y=0.66;handle.scale.y=1.05;g.add(handle);
    g.scale.setScalar(scale);return g;
  }

  _makePatchedBundle(material,patchMaterial) {
    const g=new THREE.Group();g.name='PatchedClothBundle';
    const bundle=sphere(0.43,1,material,0,0.38,0);bundle.scale.set(1.25,0.82,0.95);g.add(bundle);
    const knot=box(0.18,0.2,0.16,material,0,0.76,0);knot.rotation.z=Math.PI/4;g.add(knot);
    g.add(box(0.055,0.045,0.78,M.hempDark,0,0.69,0));
    g.add(box(0.72,0.045,0.055,M.hempDark,0,0.69,0));
    const patch=box(0.3,0.025,0.24,patchMaterial,0.14,0.71,0.1);patch.rotation.y=-0.18;g.add(patch);
    return g;
  }

  _makeRefugeeCart() {
    const g=new THREE.Group();g.name='XuFamilyBaggageCart';
    g.add(box(2.2,0.2,1.15,M.timber,-0.02,0.78,0));
    for(const x of [-1.02,1.02])for(const z of [-0.49,0.49])g.add(box(0.12,0.65,0.12,M.timberDark,x,1.02,z));
    for(const z of [-0.5,0.5])g.add(box(2.18,0.1,0.1,M.timberDark,0,1.3,z));
    const axle=beamBetween(new THREE.Vector3(-1.38,0.57,0),new THREE.Vector3(1.38,0.57,0),0.09,M.timberDark);g.add(axle);
    for(const x of [-1.21,1.21]) {
      const wheel=new THREE.Mesh(new THREE.TorusGeometry(0.55,0.075,6,14),M.timberDark);
      wheel.rotation.y=Math.PI/2;wheel.position.set(x,0.56,0);g.add(wheel);
      const hub=cyl(0.12,0.12,0.22,8,M.timber,x,0.56,0);hub.rotation.z=Math.PI/2;g.add(hub);
      for(let i=0;i<6;i++) {
        const a=(i/6)*Math.PI*2;
        g.add(beamBetween(new THREE.Vector3(x,0.56,0),new THREE.Vector3(x,0.56+Math.cos(a)*0.46,Math.sin(a)*0.46),0.025,M.timber));
      }
    }
    for(const x of [-0.46,0.46])g.add(beamBetween(new THREE.Vector3(x,0.7,0.45),new THREE.Vector3(x,0.34,2.65),0.065,M.timber));
    const bundleA=this._makePatchedBundle(M.clothRust,M.clothIndigo);bundleA.position.set(-0.45,0.85,-0.08);bundleA.scale.set(0.9,0.85,0.82);g.add(bundleA);
    const bundleB=this._makePatchedBundle(M.clothIndigo,M.clothFaded);bundleB.position.set(0.47,0.83,0.02);bundleB.scale.set(0.78,0.72,0.85);g.add(bundleB);
    return g;
  }

  _makeTree(x,z,scale=1,peach=false) {
    const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(scale);
    g.name=`Tree:${x}:${z}`;
    g.add(new THREE.Mesh(G.trunk,M.timber));g.children[0].position.y=0.9;
    for(const [dx,dy,dz,s] of [[0,2.1,0,1],[-.65,1.9,.1,.68],[.65,1.95,-.15,.7],[0,2.65,.2,.65]]){const c=new THREE.Mesh(G.crown,M.leaf);c.position.set(dx,dy,dz);c.scale.setScalar(s);g.add(c);}
    if (peach) for (const [dx,dy,dz,s] of [[-.72,2.35,.62,.2],[.54,2.15,.74,.16],[.15,2.82,.35,.18],[-.2,1.9,-.72,.14]]) { const b=new THREE.Mesh(G.crown,mat(PALETTE.peach)); b.position.set(dx,dy,dz); b.scale.setScalar(s); g.add(b); }
    this.root.add(g);return g;
  }

  debugTreeVisible(x,z,visible=true) {
    const tree=this.root.getObjectByName(`Tree:${x}:${z}`);
    if(tree)tree.visible=visible;
    return Boolean(tree);
  }

  debugFelledLog(x=18,z=17.75,visible=true) {
    let log=this.root.getObjectByName('DebugFelledLog');
    if(!log){
      log=new THREE.Group();log.name='DebugFelledLog';
      const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.36,.45,4.2,7),M.timber);
      trunk.rotation.z=Math.PI/2;trunk.position.y=.43;log.add(trunk);
      const cut=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,.025,16),M.hemp);
      cut.rotation.z=Math.PI/2;cut.position.set(2.11,.43,0);log.add(cut);
      this.root.add(log);
    }
    log.position.set(x,0,z);log.visible=visible;return log;
  }

  debugPastureVisible(visible=true) {
    const fence=this.root.getObjectByName('PastureFence');
    const stable=this.root.getObjectByName('ThatchStable');
    if(fence)fence.visible=visible;
    if(stable)stable.visible=visible;
    return Boolean(fence||stable);
  }

  _makeForestAndHorizon() {
    const trees=[[-24,18,1.4],[-20,20,1.2],[-15,22,1.5],[16,18,1.4],[20,16,1.2],[24,12,1.55],[24,5,1.2],[23,-4,1.15],[18,-22,1.3],[4,-23,1.25],[-5,-22,1.4],[-18,15,1.3]];
    trees.forEach((p,i)=>this._makeTree(p[0],p[1],p[2],i===9||i===10));
    for(let i=0;i<7;i++)this._makeTree(-8+i*2.1,-17.5+(i%2)*0.6,0.75,i%2===0);
    const ridge=new THREE.Group();ridge.position.set(0,-2,-75);
    for(let i=0;i<13;i++){const m=new THREE.Mesh(new THREE.ConeGeometry(9+(i%3)*3,22+(i%4)*5,6),i%2?M.tile:M.stone);m.position.set(-70+i*12,10+(i%2)*2,(i%3)*3);m.scale.z=.6;ridge.add(m);}this.root.add(ridge);
    const wall=box(100,4.8,3,M.earthLight,0,2.4,-47);this.root.add(wall);
    for (const y of [.75,1.55,2.35,3.15,3.95]) this.root.add(box(100.2,.07,3.08,M.earth,0,y,-47));
    for(const x of [-34,0,34]){const t=box(6.2,7.2,5.2,M.earth,x,3.6,-46);for(const y of [1.1,2.2,3.3,4.4,5.5])t.add(box(6.25,.07,5.25,M.earthDark,0,y-3.6,0));t.add(roof(8.1,7.1,1.55,M.tile,0,3.55,0));this.root.add(t);}
    const watch=new THREE.Group();watch.position.set(4,0,-38);
    for(const x of [-1.8,1.8])for(const z of [-1.8,1.8])watch.add(box(.32,8,.32,M.timber,x,4,z));
    watch.add(box(5.4,.35,5.4,M.timberDark,0,6.4,0));watch.add(roof(6.8,6.8,2.6,M.tile,0,6.7,0));
    for(const x of [-2.3,2.3])watch.add(box(.18,1.3,.18,M.timber,x,7.05,2.35));
    const beacon=sphere(.38,0,M.gold,0,8.4,0,1.35);watch.add(beacon);this.root.add(watch);
  }

  _makePathsAndGuides() {
    const pathPoints=[[-13,18],[-8,11],[0,8],[1,2],[8.5,4],[17,-5],[11,-17],[-7,-13],[-13,-10]];
    for(let i=0;i<pathPoints.length-1;i++){
      const a=pathPoints[i],b=pathPoints[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
      const p=box(2.1,0.06,len,M.path,(a[0]+b[0])/2,0.035,(a[1]+b[1])/2);p.rotation.y=Math.atan2(dx,dz);this.root.add(p);
    }
    this.marker=new THREE.Group();
    const ring=new THREE.Mesh(new THREE.TorusGeometry(0.82,0.08,8,28),M.gold);ring.rotation.x=Math.PI/2;this.marker.add(ring);
    const diamond=new THREE.Mesh(new THREE.OctahedronGeometry(0.42,0),M.gold);diamond.position.y=2.05;diamond.scale.y=1.35;this.marker.add(diamond);
    const halo=new THREE.Mesh(new THREE.TorusGeometry(.48,.07,8,20),M.gold);halo.position.y=2.05;halo.rotation.x=Math.PI/2;this.marker.add(halo);
    this.marker.visible=false;this.root.add(this.marker);
    this._makeBanners();
    this._makeClouds();
  }

  _makeBanners(){
    const sites=[[-10,12],[-4,10],[6,6],[16,-10],[-2,-14]];
    const hanTex=makeLabelTexture('漢','#f1d27e','#852d24',256,384); const tunTex=makeLabelTexture('屯','#f1d27e','#852d24',256,384);
    const hanMat=new THREE.MeshStandardMaterial({map:hanTex,roughness:.9}); const tunMat=new THREE.MeshStandardMaterial({map:tunTex,roughness:.9});
    for(let i=0;i<sites.length;i++){
      const [x,z]=sites[i];const g=new THREE.Group();g.position.set(x,0,z);g.name=`Banner:${x}:${z}`;
      g.add(cyl(.06,.075,3.6,6,M.timber,0,1.8,0));
      const cloth=box(1.05,1.6,.05,i%3===0?hanMat:tunMat,.58,2.7,0);g.add(cloth);
      const knot=cyl(.07,.07,1.15,6,M.bamboo,.58,3.47,.04);knot.rotation.z=Math.PI/2;g.add(knot);
      this.root.add(g);
    }
  }

  debugBannerVisible(x,z,visible=true) {
    const banner=this.root.getObjectByName(`Banner:${x}:${z}`);
    if(banner)banner.visible=visible;
    return Boolean(banner);
  }

  _makeClouds(){
    const cloudMat=new THREE.MeshBasicMaterial({color:0xf3e9d0,fog:false});
    const sites=[[-24,18,-32],[9,21,-42],[32,16,-28],[-2,25,-60]];
    for(const [x,y,z] of sites){const g=new THREE.Group();g.position.set(x,y,z);for(let i=0;i<5;i++){const c=new THREE.Mesh(new THREE.IcosahedronGeometry(1.8+(i%3)*.55,1),cloudMat);c.position.set((i-2)*2.2,(i%2)*.45,0);c.scale.z=.35;g.add(c);}this.root.add(g);}
  }

  setActiveTarget(id) {
    this.activeTarget=id;
    const root=this.interactableRoots.get(id) ?? this.interactableRoots.get(id?.replace(/\d+$/,'1'));
    if(!root){this.marker.visible=false;return;}
    const p=new THREE.Vector3();root.getWorldPosition(p);this.marker.position.set(p.x,0.1,p.z);this.marker.visible=true;
  }

  setInteractionState(id,state){
    const root=this.interactableRoots.get(id);if(!root)return;
    root.userData.state=state;
    if(id.startsWith('water')&&state==='watered')root.traverse(o=>{if(o.isMesh&&o.material===M.grassLight)o.material=M.leaf;});
    if(id.startsWith('water')&&state!=='watered')root.traverse(o=>{if(o.isMesh&&o.material===M.leaf)o.material=M.grassLight;});
    if(id.startsWith('harvest'))root.visible=state!=='harvested';
    if(id==='shrine')this.shrineFlame.visible=state==='lit';
  }

  getInteractablePosition(id,out){
    const root=this.interactableRoots.get(id);if(!root)return null;root.getWorldPosition(out);return out;
  }

  update(_dt,ctx){
    const t=ctx.time.elapsed;
    if(this.marker.visible){this.marker.position.y=.12+Math.sin(t*3.2)*.1;this.marker.children[1].rotation.y=t*1.4;this.marker.children[2].rotation.z=t*.85;}
    if(this.threshDrum&&this.threshDrum.userData.spinUntil>ctx.time.elapsed)this.threshDrum.rotation.x+=ctx.time.dt*8;
    if(this.shrineFlame?.visible){const s=1+Math.sin(t*9)*.12;this.shrineFlame.scale.set(s,s*1.1,s);}
  }

  debugSpinThresher(seconds=2){if(this.threshDrum)this.threshDrum.userData.spinUntil=this.ctx.time.elapsed+seconds;}
  dispose(){this._offTask?.();this.ctx.scene.remove(this.root);this.root.traverse(o=>{o.geometry?.dispose?.();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose?.());else o.material?.dispose?.();});}
}

const UP = new THREE.Vector3(0,1,0);

function beamBetween(a,b,radius,material) {
  const direction=new THREE.Vector3().subVectors(b,a);
  const length=direction.length();
  const mesh=new THREE.Mesh(G.post,material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP,direction.normalize());
  mesh.scale.set(radius/0.05,length,radius/0.05);
  return mesh;
}

function setInstanceBetween(mesh,index,dummy,a,b) {
  const direction=new THREE.Vector3().subVectors(b,a);
  const length=direction.length();
  dummy.position.copy(a).add(b).multiplyScalar(0.5);
  dummy.quaternion.setFromUnitVectors(UP,direction.normalize());
  dummy.scale.set(1,length,1);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
}

function makeMilletBladeGeometry() {
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([
    -0.018,0,0, 0.018,0,0, 0.13,0.35,0, 0.17,0.62,0, 0.09,0.36,0,
  ],3));
  geometry.setIndex([0,1,2,0,2,4,4,2,3]);
  geometry.computeVertexNormals();
  return geometry;
}

function makeGrassClumpGeometry() {
  const positions = [];
  for (let i=0;i<3;i++) {
    const a=i*Math.PI/3, c=Math.cos(a), s=Math.sin(a), w=.095;
    positions.push(-w*c,0,-w*s, 0,.56,0, w*c,0,w*s);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  return geometry;
}
