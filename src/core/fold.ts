import { propertyClass, predictSecondaryStructure, type SecStruct } from './protein';

/**
 * A rough, illustrative fold. NOT a structure prediction.
 *
 * The protein is modelled as one bead per residue (its alpha carbon):
 *   1. Build a starting chain from ideal helix and strand geometry, with random loops.
 *   2. Run a small, deterministic simulation: keep bonds and helix/strand shapes,
 *      stop beads overlapping, pull water-avoiding residues together into a core,
 *      and let strands pair up.
 * The recorded trajectory lets the scene show folding at any playhead position.
 */

/** Distance between consecutive alpha carbons, in ångströms. */
export const CA_BOND = 3.8;
const CLASH = 4.5;
const CELL = 8;

export interface FoldResult {
  n: number;
  ss: SecStruct[];
  /** Snapshots from the starting chain (first) to the folded estimate (last). xyz per residue, in Å. */
  frames: Float32Array[];
}

export interface FoldOptions {
  iterations?: number;
  frames?: number;
}

/** Deterministic PRNG so the same protein always folds the same way. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Virtual alpha-carbon bond angle and torsion (degrees) for ideal helices and strands. */
const GEOMETRY: Record<'H' | 'E', [number, number]> = { H: [91, 50], E: [122, -170] };

/**
 * Place point d from a, b, c so that |cd| = len, angle(b, c, d) = angle and
 * torsion(a, b, c, d) = torsion (the "NeRF" method).
 */
function place(x: Float32Array, ia: number, ib: number, ic: number, id: number, len: number, angle: number, torsion: number) {
  const ax = x[ia * 3], ay = x[ia * 3 + 1], az = x[ia * 3 + 2];
  const bx = x[ib * 3], by = x[ib * 3 + 1], bz = x[ib * 3 + 2];
  const cx = x[ic * 3], cy = x[ic * 3 + 1], cz = x[ic * 3 + 2];
  let bcx = cx - bx, bcy = cy - by, bcz = cz - bz;
  const bcl = Math.hypot(bcx, bcy, bcz) || 1;
  bcx /= bcl; bcy /= bcl; bcz /= bcl;
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  // n = ab × bc
  let nx = aby * bcz - abz * bcy, ny = abz * bcx - abx * bcz, nz = abx * bcy - aby * bcx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  // m = n × bc
  const mx = ny * bcz - nz * bcy, my = nz * bcx - nx * bcz, mz = nx * bcy - ny * bcx;
  const th = (angle * Math.PI) / 180;
  const tau = (torsion * Math.PI) / 180;
  const d0 = -len * Math.cos(th);
  const d1 = len * Math.sin(th) * Math.cos(tau);
  const d2 = len * Math.sin(th) * Math.sin(tau);
  x[id * 3] = cx + d0 * bcx + d1 * mx + d2 * nx;
  x[id * 3 + 1] = cy + d0 * bcy + d1 * my + d2 * ny;
  x[id * 3 + 2] = cz + d0 * bcz + d1 * mz + d2 * nz;
}

/** Starting chain: ideal helices and strands joined by random loops. */
export function buildInitialChain(ss: SecStruct[], rand: () => number): Float32Array {
  const n = ss.length;
  const x = new Float32Array(n * 3);
  const geom = (i: number): [number, number] => {
    const s = ss[i];
    if (s === 'H' || s === 'E') return GEOMETRY[s];
    return [95 + rand() * 35, -180 + rand() * 360];
  };
  if (n > 1) x[3] = CA_BOND;
  if (n > 2) {
    const th = (geom(1)[0] * Math.PI) / 180;
    x[6] = CA_BOND - CA_BOND * Math.cos(th);
    x[7] = CA_BOND * Math.sin(th);
  }
  for (let i = 3; i < n; i++) {
    const [angle, torsion] = geom(i - 1);
    place(x, i - 3, i - 2, i - 1, i, CA_BOND, angle, torsion);
  }
  return x;
}

interface Restraint {
  i: number;
  j: number;
  d: number;
  k: number;
}

function shapeRestraints(ss: SecStruct[]): Restraint[] {
  const n = ss.length;
  const out: Restraint[] = [];
  for (let i = 0; i + 1 < n; i++) out.push({ i, j: i + 1, d: CA_BOND, k: 1 });
  const same = (i: number, j: number, s: SecStruct) => {
    for (let k = i; k <= j; k++) if (ss[k] !== s) return false;
    return true;
  };
  for (let i = 0; i < n; i++) {
    if (i + 2 < n && same(i, i + 2, 'H')) out.push({ i, j: i + 2, d: 5.4, k: 0.6 });
    if (i + 3 < n && same(i, i + 3, 'H')) out.push({ i, j: i + 3, d: 5.0, k: 0.6 });
    if (i + 4 < n && same(i, i + 4, 'H')) out.push({ i, j: i + 4, d: 6.2, k: 0.6 });
    if (i + 2 < n && same(i, i + 2, 'E')) out.push({ i, j: i + 2, d: 6.4, k: 0.6 });
  }
  return out;
}

/** Move i and j toward distance `target` by `strength` of the error (0..1). */
function project(x: Float32Array, i: number, j: number, target: number, strength: number) {
  const dx = x[j * 3] - x[i * 3], dy = x[j * 3 + 1] - x[i * 3 + 1], dz = x[j * 3 + 2] - x[i * 3 + 2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) {
    x[j * 3] += 0.01 * (i % 3 === 0 ? 1 : -1); // nudge coincident beads apart
    return;
  }
  const s = (((d - target) / d) * strength) / 2;
  x[i * 3] += dx * s; x[i * 3 + 1] += dy * s; x[i * 3 + 2] += dz * s;
  x[j * 3] -= dx * s; x[j * 3 + 1] -= dy * s; x[j * 3 + 2] -= dz * s;
}

export function radiusOfGyration(x: Float32Array): number {
  const n = x.length / 3;
  if (n === 0) return 0;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += x[i * 3]; cy += x[i * 3 + 1]; cz += x[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i * 3] - cx) ** 2 + (x[i * 3 + 1] - cy) ** 2 + (x[i * 3 + 2] - cz) ** 2;
  return Math.sqrt(s / n);
}

export function foldProtein(residues: string, options: FoldOptions = {}): FoldResult {
  const n = residues.length;
  const ss = predictSecondaryStructure(residues);
  const rand = mulberry32(hashString(residues));
  const x = buildInitialChain(ss, rand);
  const frameCount = Math.max(2, options.frames ?? 24);
  if (n < 2) return { n, ss, frames: Array.from({ length: frameCount }, () => x.slice()) };

  const iterations = options.iterations ?? Math.round(Math.min(600, Math.max(250, 150000 / n)));
  const hydrophobic = Uint8Array.from(residues, (aa) => (propertyClass(aa) === 'hydrophobic' ? 1 : 0));
  const strand = Uint8Array.from(ss, (s) => (s === 'E' ? 1 : 0));
  const restraints = shapeRestraints(ss);
  const targetRg = 2.2 * Math.pow(n, 0.38); // typical radius of a compact protein, Å

  // Snapshots spaced more densely early on, where the shape changes fastest.
  const snapAt = new Set<number>();
  for (let f = 0; f < frameCount; f++) snapAt.add(Math.round(iterations * (f / (frameCount - 1)) ** 2));
  const frames: Float32Array[] = [];
  const grid = new Map<number, number[]>();
  const cellKey = (a: number, b: number, c: number) => ((a + 512) * 1024 + (b + 512)) * 1024 + (c + 512);

  /** Pairwise contacts via a spatial grid. Always resolves clashes; optionally applies attractions. */
  const contacts = (attract: boolean) => {
    grid.clear();
    for (let i = 0; i < n; i++) {
      const key = cellKey(Math.floor(x[i * 3] / CELL), Math.floor(x[i * 3 + 1] / CELL), Math.floor(x[i * 3 + 2] / CELL));
      const cell = grid.get(key);
      if (cell) cell.push(i);
      else grid.set(key, [i]);
    }
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(x[i * 3] / CELL), gy = Math.floor(x[i * 3 + 1] / CELL), gz = Math.floor(x[i * 3 + 2] / CELL);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++)
          for (let oz = -1; oz <= 1; oz++) {
            const cell = grid.get(cellKey(gx + ox, gy + oy, gz + oz));
            if (!cell) continue;
            for (const j of cell) {
              if (j <= i + 2) continue; // each pair once; skip close chain neighbours
              const dx = x[j * 3] - x[i * 3], dy = x[j * 3 + 1] - x[i * 3 + 1], dz = x[j * 3 + 2] - x[i * 3 + 2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > CELL * CELL) continue;
              if (d2 < CLASH * CLASH) project(x, i, j, CLASH, 1);
              else if (!attract) continue;
              else if (j - i >= 4 && strand[i] && strand[j] && d2 < 49) project(x, i, j, 4.8, 0.1);
              else if (j - i >= 4 && hydrophobic[i] && hydrophobic[j] && d2 < 64) project(x, i, j, 5.5, 0.05);
            }
          }
    }
  };
  const bonds = (passes: number) => {
    for (let pass = 0; pass < passes; pass++) for (let i = 0; i + 1 < n; i++) project(x, i, i + 1, CA_BOND, 1);
  };

  for (let iter = 0; iter <= iterations; iter++) {
    if (iter === iterations) {
      // Tidy up: alternate clash removal and bond fixing so the final shape is clean.
      for (let k = 0; k < 30; k++) {
        contacts(false);
        bonds(2);
      }
    }
    if (snapAt.has(iter)) frames.push(x.slice());
    if (iter === iterations) break;

    // 1. Collapse toward the centre until compact; water-avoiding residues pull harder.
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += x[i * 3]; cy += x[i * 3 + 1]; cz += x[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    const rg = radiusOfGyration(x);
    const g = 0.03 * Math.min(1, Math.max(0, (rg - targetRg) / rg));
    for (let i = 0; i < n; i++) {
      const k = g * (hydrophobic[i] ? 1.6 : 0.6);
      x[i * 3] += (cx - x[i * 3]) * k;
      x[i * 3 + 1] += (cy - x[i * 3 + 1]) * k;
      x[i * 3 + 2] += (cz - x[i * 3 + 2]) * k;
    }

    // 2. Pairwise contacts: clashes, strand pairing, water-avoiding residues sticking together.
    contacts(true);

    // 3. Helix/strand shapes, then bonds last so the chain stays intact.
    for (let pass = 0; pass < 3; pass++) for (const r of restraints) project(x, r.i, r.j, r.d, r.k);
    bonds(3);
  }
  while (frames.length < frameCount) frames.push(x.slice());
  return { n, ss, frames };
}
