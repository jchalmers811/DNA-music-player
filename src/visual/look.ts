import * as THREE from 'three';

/**
 * How the DNA is coloured and drawn in every scene.
 *
 * - classic: blue-grey backbones, and green / red / amber / blue bases, as lit solid beads.
 * - spectral: for a black background, made in the 3D Effect Lab (../3d-effect-lab). The DNA is
 *   faint glass that adds light where it overlaps, with bright rims. The backbones run through the
 *   spectrum from green to pink and back along their length, drifting slowly over time. The bases
 *   keep their usual colours.
 *
 * Pick the look before the scenes are built: it decides their materials. Only the DNA and mRNA
 * take the spectral material; the protein keeps its own colour-coded beads.
 */
export type LookId = 'classic' | 'spectral';

/** The spectral look's settings, as exported from the 3D Effect Lab. */
const SPECTRAL = {
  hueStart: 128,
  hueSpan: 217,
  /** Bases per trip through the spectrum and back. */
  period: 34,
  /** The second strand runs a little ahead in the spectrum, so the strands shimmer against each other. */
  strandOffset: 0.1,
  saturation: 0.97,
  lightness: 0.41,
  /** How fast the spectrum drifts along the strand, in trips per second. */
  shimmer: 0.03,
  emissive: 0.288,
  lit: 0.19,
  rim: 2.4,
  rimPower: 2.9,
  opacity: 0.16,
  threadGlow: 1.33,
  rungGlow: 1.49,
  /** Sizes relative to the classic look's: bigger beads and threads, thinner base pairs. */
  bead: 0.235 / 0.19,
  thread: 0.074 / 0.055,
  rung: 0.06 / 0.085,
  radius: 1.06,
};

/** The four bases' colours, the same in every look: A green, T red, G amber, C blue. */
const BASES: Record<string, number> = { A: 0x34d399, T: 0xf87171, G: 0xfbbf24, C: 0x60a5fa, N: 0x6b7280 };

const CLASSIC_STRANDS = [0xa5b4cf, 0x7f8db0] as const;
/** Greys for DNA outside the gene: still a ladder, but clearly not part of what's playing. */
const CLASSIC_FLANK_STRANDS = [0x6f7889, 0x5a6273] as const;
const CLASSIC_FLANK_RUNGS: Record<string, number> = { A: 0x5d6678, C: 0x4f5869, G: 0x687183, T: 0x565f70 };

let current: LookId = 'classic';
let time = 0;

export function setLook(id: LookId): void {
  current = id;
}

export function look(): LookId {
  return current;
}

/** Seconds since the page loaded; moves the spectral drift. Call once per frame. */
export function setLookTime(seconds: number): void {
  time = seconds;
}

/** Size multipliers for the DNA's parts, and the helix radius. 1 in the classic look. */
export function dnaScale(): { bead: number; thread: number; rung: number; radius: number } {
  return current === 'spectral'
    ? { bead: SPECTRAL.bead, thread: SPECTRAL.thread, rung: SPECTRAL.rung, radius: SPECTRAL.radius }
    : { bead: 1, thread: 1, rung: 1, radius: 1 };
}

/** Base colours, also used for mRNA beads (U takes T's colour) and free nucleotides. */
export function baseColors(): Record<string, number> {
  return BASES;
}

export function baseColor(base: string): number {
  const colors = baseColors();
  return colors[base] ?? colors.N;
}

/**
 * Hue (0..1) of base i in the spectral look. It goes from hueStart across hueSpan and back again,
 * so there's never a hard seam, and the whole pattern drifts slowly along the strand.
 */
function spectrumHue(i: number, strand: number): number {
  const x = fract(i / SPECTRAL.period + strand * SPECTRAL.strandOffset + time * SPECTRAL.shimmer);
  const there = 1 - Math.abs(1 - 2 * x);
  return fract((SPECTRAL.hueStart + SPECTRAL.hueSpan * there) / 360);
}

/** Backbone bead colour of base i on a strand (0 or 1), written into `out`. */
export function backboneColor(i: number, strand: number, flank: boolean, out: THREE.Color): THREE.Color {
  if (current === 'spectral') {
    // Outside the gene the spectrum carries on, but dimmed to a faint trace.
    return out.setHSL(spectrumHue(i, strand), flank ? 0.45 : SPECTRAL.saturation, flank ? 0.1 : SPECTRAL.lightness);
  }
  return out.setHex(flank ? CLASSIC_FLANK_STRANDS[strand] : CLASSIC_STRANDS[strand]);
}

/** The thread joining a strand's beads: the backbone colour, a little brighter in spectral. */
export function threadColor(i: number, strand: number, flank: boolean, out: THREE.Color): THREE.Color {
  backboneColor(i, strand, flank, out);
  return current === 'spectral' ? out.multiplyScalar(SPECTRAL.threadGlow) : out;
}

/** Rung colour for one base of a strand: its base colour inside the gene, faint outside. */
export function rungColor(base: string, flank: boolean, out: THREE.Color): THREE.Color {
  if (current === 'spectral') return out.setHex(baseColor(base)).multiplyScalar(flank ? 0.16 : SPECTRAL.rungGlow);
  if (!flank) return out.setHex(baseColor(base));
  return out.setHex(CLASSIC_FLANK_RUNGS[base] ?? CLASSIC_FLANK_RUNGS.A);
}

/** The thread between mRNA beads: grey in classic, carrying on the spectrum in spectral. */
export function mrnaLinkColor(j: number, out: THREE.Color): THREE.Color {
  if (current !== 'spectral') return out.setHex(0x9aa7bd);
  return out.setHSL(spectrumHue(j, 0), SPECTRAL.saturation, SPECTRAL.lightness).multiplyScalar(SPECTRAL.threadGlow);
}

/** Fog and far-away tint for the 3D scene. */
export function fogColor(): number {
  return current === 'spectral' ? 0x000000 : 0x0b1220;
}

/** The floor light under the 3D scene, and its glow: sky blue in classic, white light in spectral. */
export function floorLight(): { light: number; glow: [number, string][]; ring: string } {
  return current === 'spectral'
    ? {
        light: 0xffffff,
        glow: [[0, 'rgba(255, 255, 255, 0.4)'], [0.35, 'rgba(200, 200, 220, 0.14)'], [1, 'rgba(0, 0, 0, 0)']],
        ring: 'rgba(255, 255, 255, 0.18)',
      }
    : {
        light: 0x7dd3fc,
        glow: [[0, 'rgba(125, 211, 252, 0.55)'], [0.35, 'rgba(56, 150, 220, 0.22)'], [1, 'rgba(10, 14, 22, 0)']],
        ring: 'rgba(165, 220, 252, 0.28)',
      };
}

/** CSS colours for the four bases, for the sequence strip and the text around the scenes. */
export function baseCssColors(): Record<'A' | 'T' | 'G' | 'C' | 'N', string> {
  const colors = baseColors();
  const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
  return { A: css(colors.A), T: css(colors.T), G: css(colors.G), C: css(colors.C), N: css(colors.N) };
}

// ---------- The spectral material ----------

const glassVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vColor;
  void main() {
    vec4 local = vec4(position, 1.0);
    vec3 nrm = normal;
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      nrm = mat3(instanceMatrix) * nrm;
    #endif
    vec4 mv = modelViewMatrix * local;
    vNormal = normalize(normalMatrix * nrm);
    vView = mv.xyz;
    vColor = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #endif
    gl_Position = projectionMatrix * mv;
  }`;

const glassFragment = /* glsl */ `
  uniform float uEmissive;
  uniform float uLit;
  uniform float uRim;
  uniform float uRimPower;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vColor;
  void main() {
    vec3 n = normalize(vNormal);
    float facing = clamp(abs(dot(n, normalize(-vView))), 0.0, 1.0);
    float rim = pow(1.0 - facing, uRimPower);
    float lambert = max(dot(n, normalize(vec3(0.35, 0.75, 0.55))), 0.0);
    vec3 color = vColor * (uEmissive + uLit * lambert) + vColor * rim * uRim;
    // Faint in the middle, solid at the edges: glass seen side-on.
    float alpha = clamp(uOpacity + rim * uRim * 0.4, 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/**
 * The material for the DNA's instanced parts. Classic: the lit solid material the scene passes in.
 * Spectral: faint glass in each instance's own colour, bright at the rim, adding light where it
 * overlaps, so the order things are drawn in never matters.
 */
export function dnaMaterial(classic: () => THREE.Material): THREE.Material {
  if (current !== 'spectral') return classic();
  return new THREE.ShaderMaterial({
    uniforms: {
      uEmissive: { value: SPECTRAL.emissive },
      uLit: { value: SPECTRAL.lit },
      uRim: { value: SPECTRAL.rim },
      uRimPower: { value: SPECTRAL.rimPower },
      uOpacity: { value: SPECTRAL.opacity },
    },
    vertexShader: glassVertex,
    fragmentShader: glassFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function fract(x: number): number {
  return x - Math.floor(x);
}
