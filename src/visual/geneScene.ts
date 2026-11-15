import * as THREE from 'three';
import { complement } from '../core/genetics';
import { BASE_COLORS, type HelixHighlight } from './helix';
import { ProteinChain, type SceneProtein } from './proteinChain';
import { hideInstances, makeInstanced, markDirty, setCylinder, smoothstep } from './sceneUtils';

export { PROPERTY_COLORS, type SceneProtein } from './proteinChain';

/**
 * The gene-to-protein view: DNA → RNA polymerase → mRNA → ribosome → protein.
 *
 * Like the helix, it knows nothing about audio. Every frame is a pure function
 * of (sequence, protein, playhead position), so seeking anywhere just works.
 *
 * Layout (landscape, scene units): everything flows right → left, matching the
 * helix and the sequence strip (upcoming bases are on the right). In portrait
 * the whole layout turns 90° so the flow runs bottom → top.
 */

const TWIST = (2 * Math.PI) / 10.5;
const DNA_Y = 3.0;
const POL_X = 3.6;
const MRNA_Y = 0;
const RIB_X = -1.4;
const EXIT = new THREE.Vector3(RIB_X - 0.15, -1.5, 0); // exit tunnel, under the large subunit
const STAGE = new THREE.Vector3(-5.9, -2.85, 0);
const STEP = 0.2; // scene units per base, DNA and mRNA
const DNA_WINDOW = 96; // bases drawn around the polymerase
const MRNA_TAIL = 30; // bases drawn after the ribosome
const BOUNDS = { minX: -8.6, maxX: 6.8, minY: -5.4, maxY: 4.3 }; // landscape layout extent

export class GeneScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  private readonly orient = new THREE.Group();
  private readonly dnaSpheres: THREE.InstancedMesh;
  private readonly dnaRungs: THREE.InstancedMesh;
  private readonly mrnaBeads: THREE.InstancedMesh;
  private readonly mrnaLinks: THREE.InstancedMesh;
  private readonly chain: ProteinChain;
  private readonly labels: { el: HTMLElement; at: () => THREE.Vector3 | null }[] = [];
  private readonly mrnaPath: THREE.CurvePath<THREE.Vector3>;
  private readonly ribDist: number; // path distance from polymerase exit to ribosome
  private readonly resizeObserver: ResizeObserver;

  private seq = '';
  private frameStart = 0;
  private yaw = 0;
  private pitch = 0.25;
  private dragging: { x: number; y: number } | null = null;

  // scratch
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly white = new THREE.Color(0xffffff);

  constructor(
    private readonly container: HTMLElement,
    labelLayer: HTMLElement,
    opts: { small: boolean },
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.small ? 1.5 : 2));
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.classList.add('gene-canvas');
    container.prepend(this.canvas);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(3, 6, 10);
    const rim = new THREE.DirectionalLight(0x8ab4ff, 0.9);
    rim.position.set(-6, -4, -6);
    this.scene.add(key, rim, this.orient);

    const sphere = new THREE.SphereGeometry(1, 14, 10);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    this.dnaSpheres = makeInstanced(sphere, DNA_WINDOW * 2, this.orient);
    this.dnaRungs = makeInstanced(cyl, DNA_WINDOW * 2, this.orient);

    // mRNA path: down out of the polymerase, round a corner, left through the ribosome and beyond.
    const p = (x: number, y: number) => new THREE.Vector3(x, y, 0);
    this.mrnaPath = new THREE.CurvePath<THREE.Vector3>();
    this.mrnaPath.add(new THREE.LineCurve3(p(POL_X - 0.15, DNA_Y - 0.75), p(POL_X - 0.15, MRNA_Y + 0.7)));
    this.mrnaPath.add(new THREE.QuadraticBezierCurve3(p(POL_X - 0.15, MRNA_Y + 0.7), p(POL_X - 0.15, MRNA_Y), p(POL_X - 0.85, MRNA_Y)));
    this.mrnaPath.add(new THREE.LineCurve3(p(POL_X - 0.85, MRNA_Y), p(RIB_X, MRNA_Y)));
    this.mrnaPath.add(new THREE.LineCurve3(p(RIB_X, MRNA_Y), p(RIB_X - MRNA_TAIL * STEP - 2, MRNA_Y)));
    this.ribDist = this.mrnaPath.getCurveLengths()[2];
    const mrnaCount = Math.ceil(this.ribDist / STEP) + MRNA_TAIL + 4;
    this.mrnaBeads = makeInstanced(sphere, mrnaCount, this.orient);
    this.mrnaLinks = makeInstanced(cyl, mrnaCount, this.orient);

    this.chain = new ProteinChain(this.orient, sphere, cyl, opts.small ? 800 : 1500, {
      exit: EXIT,
      away: new THREE.Vector3(-0.5, -0.85, 0.2).normalize(),
      stage: STAGE,
      angstrom: 0.055,
      stagedScale: 1.2,
    });

    // Machines: soft translucent bodies.
    const blob = (color: number, opacity: number, pos: THREE.Vector3, s: THREE.Vector3, glow = 0.35) => {
      const mesh = new THREE.Mesh(
        sphere,
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: glow, // keeps translucent bodies bright against the dark background
          roughness: 0.6,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      mesh.position.copy(pos);
      mesh.scale.copy(s);
      mesh.renderOrder = 2;
      this.orient.add(mesh);
      return mesh;
    };
    blob(0xa78bfa, 0.3, new THREE.Vector3(POL_X, DNA_Y - 0.1, 0), new THREE.Vector3(1.0, 0.95, 0.85));
    // Ribosome: small subunit above the mRNA, large subunit below (the protein leaves from its underside).
    blob(0xfde4b8, 0.4, new THREE.Vector3(RIB_X, MRNA_Y + 0.46, 0), new THREE.Vector3(0.95, 0.46, 0.75), 0.7);
    blob(0xfcd9a0, 0.36, new THREE.Vector3(RIB_X, MRNA_Y - 0.74, 0), new THREE.Vector3(1.15, 0.78, 0.9), 0.7);

    // Floating labels, positioned by projecting points each frame.
    const label = (text: string, at: () => THREE.Vector3 | null) => {
      const el = document.createElement('span');
      el.className = 'scene-label';
      el.textContent = text;
      labelLayer.append(el);
      this.labels.push({ el, at });
    };
    label('DNA', () => new THREE.Vector3(POL_X + 2.4, DNA_Y + 0.75, 0));
    label('RNA polymerase', () => new THREE.Vector3(POL_X, DNA_Y + 1.15, 0));
    label('mRNA', () => new THREE.Vector3(POL_X - 2.2, MRNA_Y - 0.42, 0));
    label('Ribosome', () => new THREE.Vector3(RIB_X + 1.75, MRNA_Y + 0.55, 0));
    label('Protein', () =>
      this.chain.hasResidues ? this.chain.labelPoint(new THREE.Vector3(1.1, -0.9, 0), new THREE.Vector3(2.7, 0.4, 0)) : null,
    );

    // Drag to turn the finished protein.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.dragging.x) * 0.01;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (e.clientY - this.dragging.y) * 0.01));
      this.dragging = { x: e.clientX, y: e.clientY };
    });
    const end = () => (this.dragging = null);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setSequence(seq: string, frameStart: number): void {
    this.seq = seq;
    this.frameStart = frameStart;
  }

  setProtein(protein: SceneProtein | null): void {
    this.chain.setProtein(protein);
  }

  setVisible(visible: boolean): void {
    this.canvas.hidden = !visible;
    // three.js sets an inline display:block on its canvas, so `hidden` alone isn't enough.
    this.canvas.style.display = visible ? 'block' : 'none';
    for (const l of this.labels) l.el.hidden = !visible;
    if (visible) this.resize();
  }

  render(pos: number, hl: HelixHighlight | null, timeSec: number): void {
    const ribPos = pos;
    const polyPos = Math.min(this.seq.length, ribPos + this.ribDist / STEP);
    this.renderDna(polyPos);
    this.renderMrna(ribPos, polyPos, hl);
    // How far translation has got, in residues (fractional).
    this.chain.render((pos - this.frameStart) / 3, hl?.pulse ?? 0, timeSec, this.yaw, this.pitch);
    markDirty(this.dnaSpheres, this.dnaRungs, this.mrnaBeads, this.mrnaLinks);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  // ---------- DNA: a twisted ladder that unzips inside the polymerase ----------
  private renderDna(polyPos: number): void {
    const start = Math.floor(polyPos) - DNA_WINDOW / 2;
    for (let k = 0; k < DNA_WINDOW; k++) {
      const i = start + k;
      if (i < 0 || i >= this.seq.length) {
        hideInstances(this.dnaSpheres, 2 * k, 2 * k + 1);
        hideInstances(this.dnaRungs, 2 * k, 2 * k + 1);
        continue;
      }
      const x = POL_X + (i - polyPos) * STEP;
      // Fade at the window ends and before the edge of the layout, so DNA never runs under the overlays.
      const fade = smoothstep(0, 12, Math.min(k, DNA_WINDOW - 1 - k)) * smoothstep(BOUNDS.maxX + 0.3, BOUNDS.maxX - 1.8, x);
      const open = Math.exp(-(((x - POL_X) / 0.75) ** 2)); // 1 inside the polymerase
      const r = 0.2 + 0.42 * open;
      const theta = i * TWIST * (1 - open);
      // Strand 0 = coding strand (top when open); strand 1 = template strand (bottom), read by the polymerase.
      this.a.set(x, DNA_Y + r * Math.cos(theta), r * Math.sin(theta));
      this.b.set(x, DNA_Y - r * Math.cos(theta), -r * Math.sin(theta));
      const base = this.seq[i];
      for (let s = 0; s < 2; s++) {
        const pt = s === 0 ? this.a : this.b;
        this.m.compose(pt, this.q.identity(), this.scale.setScalar(0.085 * fade));
        this.dnaSpheres.setMatrixAt(2 * k + s, this.m);
        this.dnaSpheres.setColorAt(2 * k + s, this.col.setHex(s === 0 ? 0xa5b4cf : 0x7f8db0));
      }
      // Half-rungs reach toward each other; they shrink apart as the strands separate.
      const reach = Math.min(r, 0.2);
      this.v.subVectors(this.b, this.a).normalize();
      this.center.copy(this.a).addScaledVector(this.v, reach);
      setCylinder(this.dnaRungs, 2 * k, this.a, this.center, 0.045 * fade);
      this.center.copy(this.b).addScaledVector(this.v, -reach);
      setCylinder(this.dnaRungs, 2 * k + 1, this.b, this.center, 0.045 * fade);
      this.dnaRungs.setColorAt(2 * k, this.col.setHex(BASE_COLORS[base] ?? BASE_COLORS.N));
      this.dnaRungs.setColorAt(2 * k + 1, this.col.setHex(BASE_COLORS[complement(base)] ?? BASE_COLORS.N));
    }
  }

  // ---------- mRNA: beads sliding along a fixed path, read at the ribosome ----------
  private renderMrna(ribPos: number, polyPos: number, hl: HelixHighlight | null): void {
    const count = this.mrnaBeads.count;
    const total = this.mrnaPath.getLength();
    const first = Math.ceil(ribPos - MRNA_TAIL);
    for (let k = 0; k < count; k++) {
      const j = first + k;
      // Base j sits at the ribosome when j == ribPos; earlier bases have moved further along.
      const dist = this.ribDist + (ribPos - j) * STEP;
      if (j < 0 || j >= polyPos || j >= this.seq.length || dist < 0 || dist > total) {
        hideInstances(this.mrnaBeads, k);
        hideInstances(this.mrnaLinks, k);
        continue;
      }
      this.mrnaPath.getPointAt(dist / total, this.a);
      const fade = smoothstep(0, 10, k);
      const active = hl !== null && j >= hl.start && j < hl.start + hl.length;
      const r = 0.07 * fade * (active ? 1.35 + 0.5 * hl!.pulse : 1);
      this.m.compose(this.a, this.q.identity(), this.scale.setScalar(r));
      this.mrnaBeads.setMatrixAt(k, this.m);
      this.col.setHex(BASE_COLORS[this.seq[j]] ?? BASE_COLORS.N); // U takes T's colour
      if (active) this.col.lerp(this.white, 0.2 + 0.5 * hl!.pulse);
      this.mrnaBeads.setColorAt(k, this.col);

      const nextDist = dist - STEP; // base j+1 is one step back along the path
      if (j + 1 < polyPos && nextDist >= 0) {
        this.mrnaPath.getPointAt(nextDist / total, this.b);
        setCylinder(this.mrnaLinks, k, this.a, this.b, 0.025 * fade);
        this.mrnaLinks.setColorAt(k, this.col.setHex(0x9aa7bd));
      } else hideInstances(this.mrnaLinks, k);
    }
  }

  private placeLabels(): void {
    if (this.canvas.hidden) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.orient.updateMatrixWorld();
    for (const { el, at } of this.labels) {
      const p = at();
      if (!p) {
        el.style.opacity = '0';
        continue;
      }
      p.applyMatrix4(this.orient.matrixWorld).project(this.camera);
      el.style.opacity = '';
      // Keep labels fully inside the frame.
      const hw = el.offsetWidth / 2 + 6;
      const hh = el.offsetHeight / 2 + 6;
      const sx = Math.min(w - hw, Math.max(hw, ((p.x + 1) / 2) * w));
      const sy = Math.min(h - hh, Math.max(hh, ((1 - p.y) / 2) * h));
      el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
    }
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const portrait = aspect < 1;
    // Portrait: turn the layout so the flow runs bottom → top (upcoming bases below).
    this.orient.rotation.z = portrait ? -Math.PI / 2 : 0;
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cy = (BOUNDS.minY + BOUNDS.maxY) / 2;
    const halfLong = (BOUNDS.maxX - BOUNDS.minX) / 2;
    const halfShort = (BOUNDS.maxY - BOUNDS.minY) / 2;
    const halfW = portrait ? halfShort : halfLong;
    // Leave a strip at the bottom for the legend and caveat (taller on narrow screens, where they stack).
    const inset = w < 600 ? 0.2 : 0.07;
    const halfH = (portrait ? halfLong : halfShort) / (1 - inset);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(halfH / tanHalf, halfW / (tanHalf * aspect)) * 1.04;
    // Centre of the layout after rotation: (x, y) → (y, -x) in portrait; shift down to clear the inset.
    const wx = portrait ? cy : cx;
    const wy = (portrait ? -cx : cy) - inset * dist * tanHalf;
    this.camera.position.set(wx, wy + dist * 0.06, dist);
    this.camera.lookAt(wx, wy, 0);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}
