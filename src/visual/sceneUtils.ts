import * as THREE from 'three';

/** Small helpers shared by the 3D scenes. */

export const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// scratch
const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const dir = new THREE.Vector3();
const mid = new THREE.Vector3();
const s = new THREE.Vector3();

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

export function hideInstances(mesh: THREE.InstancedMesh, ...indices: number[]): void {
  for (const i of indices) mesh.setMatrixAt(i, ZERO);
}

/** An instanced mesh with every slot hidden: an untouched slot would otherwise draw a full-size shape at the origin. */
export function makeInstanced(geo: THREE.BufferGeometry, count: number, parent: THREE.Object3D): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.06 }), count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(0xffffff));
  hideInstances(mesh, ...range(count));
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

export function setSphere(mesh: THREE.InstancedMesh, index: number, at: THREE.Vector3, radius: number): void {
  m.compose(at, q.identity(), s.setScalar(radius));
  mesh.setMatrixAt(index, m);
}

/** Places a unit cylinder (height along y) between two points. */
export function setCylinder(mesh: THREE.InstancedMesh, index: number, from: THREE.Vector3, to: THREE.Vector3, radius: number): void {
  dir.subVectors(to, from);
  const len = dir.length();
  if (len < 1e-6 || radius <= 0) return hideInstances(mesh, index);
  q.setFromUnitVectors(UP, dir.divideScalar(len));
  mid.addVectors(from, to).multiplyScalar(0.5);
  m.compose(mid, q, s.set(radius, len, radius));
  mesh.setMatrixAt(index, m);
}

export function markDirty(...meshes: THREE.InstancedMesh[]): void {
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/** A soft radial texture drawn on a canvas: colour stops from the centre out, plus optional thin rings. */
export function radialTexture(stops: [number, string][], rings: number[] = [], ringColor = 'rgba(0,0,0,0)'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = ringColor;
  g.lineWidth = 1.2;
  for (const r of rings) {
    g.beginPath();
    g.arc(128, 128, r, 0, Math.PI * 2);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}
