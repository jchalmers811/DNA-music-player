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
 * keepZoom says when a double-click means something else (clicking the DNA twice).
 */
export function addZoomControls(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  { onPinchStart, keepZoom }: { onPinchStart?: () => void; keepZoom?: (e: MouseEvent) => boolean } = {},
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
  canvas.addEventListener('dblclick', (e) => {
    if (!keepZoom?.(e)) apply(1);
  });

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

/**
 * Finds which base pair of a drawn DNA strand is under the pointer.
 *
 * A scene tells it, each frame, where the centre of each drawn base pair is.
 * A click (not a drag) anywhere in line with a base pair, within `band` of the
 * strand's centre line, picks that base. The pointer shows a hand over the DNA.
 */
export class BasePicker {
  /** Called with the base index when the DNA is clicked. */
  onPick: (index: number) => void = () => {};
  private start = 0;
  private readonly pts: Float32Array; // xyz per slot, in `frame` coordinates; NaN = not pickable
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly v = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  /**
   * @param frame the object whose coordinates the centres are given in
   * @param band how far from the strand's centre line a click still counts, in scene units (Infinity = anywhere in line)
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly frame: THREE.Object3D,
    private readonly count: number,
    private readonly band: number,
  ) {
    this.pts = new Float32Array(count * 3).fill(NaN);
    this.sx = new Float32Array(count);
    this.sy = new Float32Array(count);

    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('click', (e) => {
      // A drag (turning the view) ends in a click too; only a still press counts.
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const index = this.at(e.clientX, e.clientY);
      if (index !== null) this.onPick(index);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      canvas.style.cursor = this.at(e.clientX, e.clientY) !== null ? 'pointer' : '';
    });
  }

  /** Start a frame: slot k will hold base `start + k`. */
  begin(start: number): void {
    this.start = start;
  }

  /** Centre of the base pair in slot k, or null if it isn't drawn. */
  set(k: number, centre: THREE.Vector3 | null): void {
    if (centre) centre.toArray(this.pts, k * 3);
    else this.pts[k * 3] = NaN;
  }

  /** The base under a point on the screen, or null. */
  at(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return null;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    this.frame.updateWorldMatrix(true, false);
    this.camera.updateMatrixWorld();
    const toScreen = (v: THREE.Vector3) => {
      v.project(this.camera);
      v.set(((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height, v.z);
    };
    const { pts, sx, sy, v, count } = this;
    for (let k = 0; k < count; k++) {
      if (Number.isNaN(pts[k * 3])) {
        sx[k] = NaN;
        continue;
      }
      toScreen(v.fromArray(pts, k * 3).applyMatrix4(this.frame.matrixWorld));
      sx[k] = v.z > 1 ? NaN : v.x; // behind the camera
      sy[k] = v.y;
    }

    let best = -1;
    let bestPerp = Infinity;
    for (let k = 0; k < count; k++) {
      if (Number.isNaN(sx[k])) continue;
      // The strand's direction on screen here, from the neighbouring base pairs.
      const p = k > 0 && !Number.isNaN(sx[k - 1]) ? k - 1 : k;
      const n = k < count - 1 && !Number.isNaN(sx[k + 1]) ? k + 1 : k;
      if (p === n) continue;
      const span = Math.hypot(sx[n] - sx[p], sy[n] - sy[p]);
      if (span < 1e-3) continue;
      const tx = (sx[n] - sx[p]) / span;
      const ty = (sy[n] - sy[p]) / span;
      const spacing = span / (n - p);
      const dx = px - sx[k];
      const dy = py - sy[k];
      if (Math.abs(dx * tx + dy * ty) > spacing / 2 + 0.5) continue; // in line with a neighbour instead
      const perp = Math.abs(dx * ty - dy * tx);
      if (perp < bestPerp) {
        bestPerp = perp;
        best = k;
      }
    }
    if (best < 0) return null;
    if (this.band !== Infinity) {
      // The band in pixels at this base's depth, never smaller than a fingertip.
      v.fromArray(pts, best * 3).applyMatrix4(this.frame.matrixWorld);
      this.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion).multiplyScalar(this.band).add(v);
      toScreen(this.up);
      const bandPx = Math.max(28, Math.hypot(this.up.x - sx[best], this.up.y - sy[best]));
      if (bestPerp > bandPx) return null;
    }
    return this.start + best;
  }
}
