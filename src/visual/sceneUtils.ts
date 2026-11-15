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

const FLANK_BASES = 'ACGT';
/** Muted greys for DNA outside the gene: still a ladder, but clearly not part of what's playing. */
const FLANK_RUNG_COLORS: Record<string, number> = { A: 0x5d6678, C: 0x4f5869, G: 0x687183, T: 0x565f70 };
export const FLANK_BACKBONE = [0x6f7889, 0x5a6273] as const;

/**
 * DNA doesn't end where a gene ends: the chromosome carries on either side.
 * Outside the sequence the scenes draw grey stand-in bases, fixed per position
 * so they slide along like the real ones instead of flickering.
 */
export function dnaBaseAt(seq: string, i: number): { base: string; flank: boolean } {
  if (i >= 0 && i < seq.length) return { base: seq[i], flank: false };
  return { base: FLANK_BASES[Math.imul(i, 0x9e3779b1) >>> 30], flank: true };
}

/** Rung colour for one base of a strand: its usual colour inside the gene, grey outside. */
export function rungColor(base: string, flank: boolean, colors: Record<string, number>): number {
  return flank ? (FLANK_RUNG_COLORS[base] ?? FLANK_RUNG_COLORS.A) : (colors[base] ?? colors.N);
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

/**
 * Zoom with the scroll wheel, a trackpad pinch or a two-finger pinch on a phone;
 * double-click (or double-tap) to go back to the default framing.
 * Uses the camera's zoom (a lens zoom), so each view's own fitting and
 * framing stay untouched and zoom 1 is exactly the default view.
 * onPinchStart lets a view drop any one-finger drag, so it doesn't jump.
 */
export function addZoomControls(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  onPinchStart?: () => void,
): void {
  const apply = (zoom: number) => {
    camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    camera.updateProjectionMatrix();
  };
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1); // lines/pages → pixels
      apply(camera.zoom * Math.exp(-px * 0.0015));
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', () => apply(1));

  // Two-finger pinch. One finger still scrolls the page or turns the view as before.
  const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  let pinch: { from: number; zoom: number } | null = null;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    pinch = { from: Math.max(1, spread(e.touches)), zoom: camera.zoom };
    onPinchStart?.();
  });
  canvas.addEventListener(
    'touchmove',
    (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault(); // stop the browser zooming the whole page
      apply(pinch.zoom * (spread(e.touches) / pinch.from));
    },
    { passive: false },
  );
  const end = (e: TouchEvent) => {
    if (e.touches.length < 2) pinch = null;
  };
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', end);
  // iOS Safari: stop its own page pinch-zoom starting over the picture.
  canvas.addEventListener('gesturestart', (e) => e.preventDefault());
}
