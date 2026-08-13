import * as THREE from 'three';

export function box(w, h, d, material, x = 0, y = h / 2, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

export function cyl(rt, rb, h, seg, material, x = 0, y = h / 2, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  return m;
}

export function sphere(r, seg, material, x = 0, y = r, z = 0, sy = 1) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, seg), material);
  m.position.set(x, y, z);
  m.scale.y = sy;
  return m;
}

export function roof(width, depth, height, material, x = 0, y = 0, z = 0) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(0, height);
  s.lineTo(width / 2, 0);
  s.lineTo(-width / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  return m;
}

export function pointAlong(mesh, a, b, thickness = 0.1) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  mesh.scale.set(thickness, len, thickness);
  mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  return mesh;
}

export function makeLabelTexture(text, fg = '#eadbb7', bg = '#63251f', width = 512, height = 160) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, width, height);
  x.strokeStyle = '#241915'; x.lineWidth = 12; x.strokeRect(6, 6, width - 12, height - 12);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `700 ${Math.floor(height * 0.47)}px Georgia, serif`;
  x.fillText(text, width / 2, height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
