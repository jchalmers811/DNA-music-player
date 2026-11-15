import { translateCodon } from './genetics';
import { propertyClass } from './protein';
import type { NoteEvent } from './types';

export type DrumVoice = 'kick' | 'snare' | 'clap' | 'hat' | 'openHat' | 'crash' | 'sub808' | 'tom';

export interface DrumHit {
  /** Beats from the start, like note events. */
  time: number;
  voice: DrumVoice;
  /** 0..1 */
  velocity: number;
  /** Pitch for tuned voices (808 and toms), as a MIDI note. */
  midi?: number;
}

export type BeatId =
  | 'off'
  | 'steady'
  | 'backbeat'
  | 'halftime'
  | 'breakbeat'
  | 'shuffle'
  | 'boomBap'
  | 'dembow'
  | 'dnb'
  | 'tomGroove'
  | 'trap'
  | 'sequence';

export interface Beat {
  id: BeatId;
  name: string;
  description: string;
}

export const DEFAULT_BEAT: BeatId = 'steady';

export const BEATS: Beat[] = [
  { id: 'off', name: 'Off', description: 'No percussion.' },
  { id: 'steady', name: 'Steady', description: 'Kick on every beat, claps on 2 and 4, hi-hats in between.' },
  { id: 'backbeat', name: 'Backbeat', description: 'A classic rock beat: kick on 1 and 3, snare on 2 and 4.' },
  { id: 'halftime', name: 'Half-time', description: 'Slow and heavy: one snare per bar, on beat 3.' },
  { id: 'breakbeat', name: 'Breakbeat', description: 'Syncopated kicks, ghost snares and busy hi-hats.' },
  { id: 'shuffle', name: 'Shuffle', description: 'A swung, bouncing feel, with off-beats pushed late.' },
  {
    id: 'boomBap',
    name: 'Boom bap',
    description: '90s hip-hop: a punchy kick, a hard snare on 2 and 4, and lazily swung hi-hats.',
  },
  { id: 'dembow', name: 'Dembow', description: 'The reggaeton rhythm: a kick on every beat and a snare in a 3-3-2 pattern.' },
  {
    id: 'dnb',
    name: 'Drum and bass',
    description: 'A fast two-step beat at double speed: kick, snare and rapid hi-hats.',
  },
  {
    id: 'tomGroove',
    name: 'Tom groove',
    description: 'Rolling toms tuned to your key over a deep kick, with soft, shaker-like hi-hats.',
  },
  {
    id: 'trap',
    name: '808 trap',
    description: 'Half-time trap: a booming 808 bass tuned to your key, a clap on beat 3 and rapid hi-hat rolls.',
  },
  {
    id: 'sequence',
    name: 'From the sequence',
    description:
      'The gene plays the drums. In codon modes: water-avoiding amino acids hit the kick, charged ones the snare, the rest the hi-hat; start and stop codons get a cymbal. In base mode: A is kick, G is snare, C and T are hi-hats.',
  },
];

type PatternBeat = Exclude<BeatId, 'off'>;

interface Grid {
  /** Per voice, a step pattern; longer than 16 steps means a phrase of several bars. */
  voices: Partial<Record<DrumVoice, string>>;
  /** Length of one step in beats (default a sixteenth note, 0.25). */
  step?: number;
  /** How late every second step lands, in beats (swing). */
  swing?: number;
}

type GridBeat = 'steady' | 'backbeat' | 'halftime' | 'breakbeat' | 'boomBap' | 'dembow' | 'dnb';

/**
 * Step patterns per voice. Numbers are velocities (0 = silent); written as
 * strings so the grooves are easy to read and edit.
 * Digits: 0–9 → velocity 0–0.9 (9 is loudest).
 */
const GRID: Record<GridBeat, Grid> = {
  //                 1 . . . 2 . . . 3 . . . 4 . . .
  steady: { voices: {
    kick:    '9000900090009000',
    snare:   '0000800000008000',
    hat:     '0060006000600060',
  } },
  backbeat: { voices: {
    kick:    '9000000080600000',
    snare:   '0000900000009000',
    hat:     '6040604060406040',
  } },
  halftime: { voices: {
    kick:    '9000000000700000',
    snare:   '0000000090000000',
    hat:     '5030503050305030',
  } },
  breakbeat: { voices: {
    kick:    '9000000900800000',
    snare:   '0000900200009002',
    hat:     '6363636363636363',
  } },
  // Two-bar phrase, with every second sixteenth pushed late for a laid-back swing.
  //                 1 . . . 2 . . . 3 . . . 4 . . . 1 . . . 2 . . . 3 . . . 4 . . .
  boomBap: { swing: 0.06, voices: {
    kick:    '90000000907000009000000090700050',
    snare:   '00009000000090020000900000009000',
    hat:     '60406040604060406040604060406045',
  } },
  // Snare on the 3-3-2 dembow rhythm.
  dembow: { voices: {
    kick:    '9000900090009000',
    snare:   '0008008000080080',
    hat:     '0050005000500050',
  } },
  // Two-step at double time: each step is a 32nd note, so one pass of the pattern lasts two beats.
  dnb: { step: 0.125, voices: {
    kick:    '9000000000800000',
    snare:   '0000900200009000',
    hat:     '6040604060406040',
  } },
};

const BAR = 4; // beats per bar (4/4)
const STEP = BAR / 16;
/** Pieces shorter than this (in beats) don't get fills: there isn't room. */
const MIN_BEATS_FOR_FILLS = 12;

type Add = (time: number, voice: DrumVoice, velocity: number, extra?: { midi?: number; tone?: number }) => void;

function collector(): { hits: DrumHit[]; add: Add } {
  const hits: DrumHit[] = [];
  const add: Add = (time, voice, velocity, extra) => hits.push({ time, voice, velocity, ...extra });
  return { hits, add };
}

/** `n` evenly spaced hits from `from`, velocities ramping v0 → v1. */
function run(add: Add, voice: DrumVoice, from: number, n: number, step: number, v0: number, v1: number, extra?: (k: number) => { midi?: number; tone?: number }) {
  for (let k = 0; k < n; k++) add(from + k * step, voice, v0 + ((v1 - v0) * k) / Math.max(1, n - 1), extra?.(k));
}

// ---------- Main grooves ----------

function fromGrid(grid: Grid, totalBeats: number): DrumHit[] {
  const { hits, add } = collector();
  const step = grid.step ?? STEP;
  const swing = grid.swing ?? 0;
  for (const [voice, pattern] of Object.entries(grid.voices) as [DrumVoice, string][]) {
    const phrase = pattern.length * step;
    for (let start = 0; start < totalBeats; start += phrase) {
      for (let s = 0; s < pattern.length; s++) {
        const v = Number(pattern[s]);
        if (v > 0) add(start + s * step + (s % 2 ? swing : 0), voice, v / 10);
      }
    }
  }
  add(0, 'crash', 0.6); // a cymbal to open (replaced by the intro fill on longer pieces)
  return hits;
}

/** Swung eighths: each beat is split long–short (2/3 + 1/3), off-beats land late. */
function shuffle(totalBeats: number): DrumHit[] {
  const { hits, add } = collector();
  add(0, 'crash', 0.6);
  for (let beat = 0; beat < totalBeats; beat++) {
    const inBar = beat % BAR;
    add(beat, 'hat', 0.6);
    add(beat + 2 / 3, 'hat', 0.35);
    if (inBar === 0 || inBar === 2) add(beat, 'kick', inBar === 0 ? 0.9 : 0.75);
    if (inBar === 2) add(beat + 2 / 3, 'kick', 0.5);
    if (inBar === 1 || inBar === 3) add(beat, 'snare', 0.85);
  }
  return hits;
}

/**
 * Half-time trap over two-bar phrases: 808 bass (tuned to the key) with kicks,
 * a clap and snare on beat 3, and hi-hats that switch between eighths,
 * sixteenths, triplet rolls and 32nd-note rolls.
 */
function trap(totalBeats: number, key: number): DrumHit[] {
  const root = 24 + key; // 808 root note: C1 (≈33 Hz) up to B1
  const { hits, add } = collector();
  add(0, 'crash', 0.5);
  for (let bar = 0; bar * BAR < totalBeats; bar++) {
    const t = bar * BAR;
    const second = bar % 2 === 1;
    // 808 + kick: boom on 1, pick-ups that vary across the phrase.
    add(t, 'sub808', 0.95, { midi: root });
    add(t, 'kick', 0.8);
    add(t + 1.5, 'sub808', 0.8, { midi: second ? root + 3 : root });
    add(t + 2.75, 'kick', 0.6);
    if (second) add(t + 3.5, 'sub808', 0.75, { midi: root - 2 });
    else add(t + 3.25, 'sub808', 0.7, { midi: root });
    // Clap + snare together on beat 3 (the half-time backbeat).
    add(t + 2, 'clap', 0.9);
    add(t + 2, 'snare', 0.55);
    // Hi-hats: eighths, a sixteenth run, a triplet roll, and (second bar) a 32nd-note roll.
    run(add, 'hat', t, 2, 0.5, 0.55, 0.55);
    run(add, 'hat', t + 1, 4, 0.25, 0.45, 0.6);
    run(add, 'hat', t + 2, 2, 0.5, 0.55, 0.55);
    if (second) run(add, 'hat', t + 3, 8, 0.125, 0.3, 0.75);
    else {
      run(add, 'hat', t + 3, 3, 1 / 6, 0.35, 0.65);
      add(t + 3.5, 'openHat', 0.5);
    }
  }
  return hits;
}

/** [step, tom (0 = high … 3 = low), velocity] for each tom hit in a bar. */
type TomPart = [number, number, number][];
const TOM_BAR_A: TomPart = [[0, 3, 0.9], [3, 3, 0.6], [6, 2, 0.8], [8, 3, 0.85], [10, 2, 0.6], [11, 3, 0.6], [14, 1, 0.75]];
const TOM_BAR_B: TomPart = [[0, 3, 0.9], [3, 3, 0.6], [6, 2, 0.8], [8, 3, 0.85], [12, 1, 0.7], [13, 1, 0.6], [14, 0, 0.8], [15, 0, 0.85]];

/** Two-bar tom pattern tuned to the key, over a deep kick and soft shaker-like hats. */
function tomGroove(totalBeats: number, toms: number[]): DrumHit[] {
  const { hits, add } = collector();
  add(0, 'crash', 0.5);
  for (let bar = 0; bar * BAR < totalBeats; bar++) {
    const t = bar * BAR;
    for (const [step, tom, v] of bar % 2 ? TOM_BAR_B : TOM_BAR_A) add(t + step * STEP, 'tom', v, { midi: toms[tom] });
    add(t, 'kick', 0.85);
    add(t + 2, 'kick', 0.75);
    for (let s = 0; s < 16; s++) add(t + s * STEP, 'hat', s % 2 ? 0.2 : 0.32);
  }
  return hits;
}

/** Drums driven by the sequence itself, one hit per note event. */
function fromSequence(events: NoteEvent[], seq: string): DrumHit[] {
  const { hits, add } = collector();
  for (const ev of events) {
    const t = ev.time;
    if (ev.length === 1) {
      const b = seq[ev.start];
      if (b === 'A') add(t, 'kick', 0.8);
      else if (b === 'G') add(t, 'snare', 0.7);
      else if (b === 'C' || b === 'T') add(t, 'hat', b === 'C' ? 0.6 : 0.4);
      continue;
    }
    const aa = translateCodon(seq.slice(ev.start, ev.start + 3));
    if (ev.kind === 'start' || ev.kind === 'stop') {
      add(t, 'crash', 0.75);
      add(t, 'kick', 0.9);
      continue;
    }
    if (aa === 'X') continue;
    const cls = propertyClass(aa);
    if (cls === 'hydrophobic') add(t, 'kick', 0.8);
    else if (cls === 'positive' || cls === 'negative') add(t, 'snare', 0.75);
    else add(t, 'hat', 0.6);
    // A soft off-beat hat keeps the groove moving between codons.
    add(t + ev.duration / 1.8, 'hat', 0.3);
  }
  return hits;
}

// ---------- Fills ----------

interface FillContext {
  /** Four toms tuned to the key, high → low. */
  toms: number[];
  /** 808 root note. */
  root: number;
  /** Bases at the start / end of the piece (for "From the sequence"). */
  firstBases: string;
  lastBases: string;
}

type Fill = (add: Add, t: number, c: FillContext) => void;

const TOM_OF_BASE: Record<string, number> = { A: 3, C: 1, G: 2, T: 0 };

/** Intro fills: one bar starting at t (= 0). Each beat has its own. */
const INTRO: Record<PatternBeat, Fill> = {
  // Four-on-the-floor build: steady kicks, claps tightening 8ths → 16ths.
  steady: (add, t) => {
    run(add, 'kick', t, 4, 1, 0.9, 0.9);
    run(add, 'clap', t + 2, 2, 0.5, 0.4, 0.55);
    run(add, 'clap', t + 3, 4, 0.25, 0.55, 0.9);
  },
  // Drummer's count-in on the hi-hat, then a tom run high → low.
  backbeat: (add, t, c) => {
    run(add, 'hat', t, 3, 1, 0.7, 0.7);
    run(add, 'tom', t + 3, 4, 0.25, 0.7, 0.9, (k) => ({ midi: c.toms[k] }));
  },
  // Sparse and heavy: a kick, then slow descending toms.
  halftime: (add, t, c) => {
    add(t, 'kick', 0.9);
    run(add, 'tom', t + 2, 4, 0.5, 0.65, 0.9, (k) => ({ midi: c.toms[k] }));
  },
  // A choppy snare-and-kick break.
  breakbeat: (add, t) => {
    add(t, 'kick', 0.9);
    add(t + 0.75, 'snare', 0.4);
    add(t + 1, 'snare', 0.8);
    add(t + 1.75, 'kick', 0.7);
    add(t + 2.5, 'kick', 0.8);
    run(add, 'snare', t + 3, 4, 0.25, 0.5, 0.95);
    add(t + 3.75, 'kick', 0.8);
  },
  // Swung triplet toms.
  shuffle: (add, t, c) => {
    run(add, 'hat', t, 2, 1, 0.6, 0.6);
    run(add, 'tom', t + 2, 6, 1 / 3, 0.6, 0.9, (k) => ({ midi: c.toms[Math.min(3, Math.floor(k / 1.5))] }));
  },
  // Riser: hats accelerate 8ths → 16ths → 32nds, then the 808 drops.
  trap: (add, t, c) => {
    run(add, 'hat', t, 4, 0.5, 0.35, 0.5);
    run(add, 'hat', t + 2, 4, 0.25, 0.5, 0.65);
    run(add, 'hat', t + 3, 8, 0.125, 0.55, 0.9);
    add(t + 3.5, 'sub808', 0.6, { midi: c.root + 7 });
  },
  // Hi-hat count-in, then a snare pick-up into the groove.
  boomBap: (add, t) => {
    run(add, 'hat', t, 3, 1, 0.6, 0.6);
    add(t + 3, 'snare', 0.6);
    add(t + 3.5, 'snare', 0.9);
    add(t + 3.75, 'kick', 0.8);
  },
  // Kicks on the beat with the 3-3-2 snare already in.
  dembow: (add, t) => {
    run(add, 'kick', t, 4, 1, 0.85, 0.9);
    for (const at of [0.75, 1.5, 2.75, 3.5]) add(t + at, 'snare', 0.75);
    add(t + 3.25, 'hat', 0.5);
  },
  // A snare roll that doubles in speed.
  dnb: (add, t) => {
    run(add, 'snare', t, 8, 0.25, 0.3, 0.6);
    run(add, 'snare', t + 2, 16, 0.125, 0.5, 0.95);
  },
  // Toms climbing from low to high.
  tomGroove: (add, t, c) => run(add, 'tom', t, 8, 0.5, 0.6, 0.9, (k) => ({ midi: c.toms[3 - Math.floor(k / 2)] })),
  // The first bases of the gene, played on tuned toms (A low … T high).
  sequence: (add, t, c) => {
    [...c.firstBases].forEach((b, k) => {
      const tom = TOM_OF_BASE[b];
      if (tom !== undefined) add(t + k * 0.25, 'tom', 0.55 + 0.35 * (k / 15), { midi: c.toms[tom] });
    });
  },
};

/** Outro fills: two beats starting at t, leading into the final hit. */
const OUTRO: Record<PatternBeat, Fill> = {
  steady: (add, t) => {
    run(add, 'kick', t, 2, 1, 0.85, 0.85);
    run(add, 'clap', t, 8, 0.25, 0.4, 0.95);
  },
  backbeat: (add, t, c) => run(add, 'tom', t, 8, 0.25, 0.6, 0.95, (k) => ({ midi: c.toms[Math.floor(k / 2)] })),
  halftime: (add, t, c) => run(add, 'tom', t, 4, 0.5, 0.7, 0.95, (k) => ({ midi: c.toms[k] })),
  breakbeat: (add, t) => {
    run(add, 'snare', t, 8, 0.25, 0.45, 0.95);
    add(t + 0.75, 'kick', 0.8);
    add(t + 1.5, 'kick', 0.8);
  },
  shuffle: (add, t, c) => run(add, 'tom', t, 6, 1 / 3, 0.6, 0.95, (k) => ({ midi: c.toms[Math.min(3, Math.floor(k / 1.5))] })),
  trap: (add, t, c) => {
    run(add, 'hat', t, 16, 0.125, 0.4, 0.9);
    add(t, 'sub808', 0.85, { midi: c.root + 3 });
    add(t + 1, 'sub808', 0.85, { midi: c.root + 5 });
    add(t + 1, 'clap', 0.8);
  },
  boomBap: (add, t) => {
    add(t, 'snare', 0.85);
    add(t + 0.5, 'kick', 0.8);
    add(t + 0.75, 'snare', 0.4);
    add(t + 1, 'snare', 0.9);
    add(t + 1.25, 'kick', 0.7);
    add(t + 1.5, 'snare', 0.95);
  },
  dembow: (add, t, c) => {
    add(t, 'kick', 0.85);
    add(t + 1, 'kick', 0.85);
    for (const at of [0, 0.75, 1.5]) add(t + at, 'snare', 0.8);
    add(t + 1.75, 'tom', 0.85, { midi: c.toms[0] });
  },
  dnb: (add, t) => {
    run(add, 'snare', t, 16, 0.125, 0.4, 0.95);
    add(t, 'kick', 0.85);
    add(t + 1, 'kick', 0.85);
  },
  tomGroove: (add, t, c) => {
    const hits: [number, number][] = [[0, 3], [0.5, 2], [0.75, 2], [1, 1], [1.25, 1], [1.5, 0], [1.625, 0], [1.75, 0], [1.875, 0]];
    for (const [at, tom] of hits) add(t + at, 'tom', 0.65 + 0.15 * at, { midi: c.toms[tom] });
    add(t, 'kick', 0.85);
    add(t + 1, 'kick', 0.8);
  },
  // The last bases on toms, in a rhythm the gene sets: A/G (purines) are 8ths, C/T (pyrimidines) 16ths.
  sequence: (add, t, c) => {
    let at = t;
    for (const b of c.lastBases) {
      if (at >= t + 2 - 1e-9) break;
      const tom = TOM_OF_BASE[b];
      if (tom !== undefined) add(at, 'tom', 0.6 + 0.35 * ((at - t) / 2), { midi: c.toms[tom] });
      at += b === 'A' || b === 'G' ? 0.5 : 0.25;
    }
  },
};

/** The final hit: everyone together, then silence. */
function finale(add: Add, t: number, beat: PatternBeat, c: FillContext) {
  add(t, 'crash', 0.85);
  add(t, 'kick', 0.95);
  if (beat === 'trap') add(t, 'sub808', 0.95, { midi: c.root });
  else if (beat === 'tomGroove') add(t, 'tom', 0.95, { midi: c.toms[3] });
  else add(t, 'snare', 0.6);
}

/** Replace the first bar with the intro fill and the last two beats with the outro fill. */
function withFills(beat: PatternBeat, body: DrumHit[], totalBeats: number, c: FillContext): DrumHit[] {
  if (totalBeats < MIN_BEATS_FOR_FILLS) return body;
  const introEnd = BAR;
  const finalAt = Math.floor(totalBeats - 1e-6); // last whole beat
  const outroStart = finalAt - 2;
  const { hits, add } = collector();
  INTRO[beat](add, 0, c);
  add(introEnd, 'crash', 0.7); // land the intro
  OUTRO[beat](add, outroStart, c);
  finale(add, finalAt, beat, c);
  const kept = body.filter((h) => h.time >= introEnd && h.time < outroStart);
  return kept.concat(hits);
}

/**
 * All drum hits for a piece, sorted by time. A pure function, like the note
 * mappings: patterns repeat per 4/4 bar, or (for "From the sequence") follow
 * the note events. Longer pieces open with an intro fill and close with an
 * outro fill and a final hit. At most one hit per voice at any moment.
 */
export function drumHits(beat: BeatId, events: NoteEvent[], totalBeats: number, seq: string, key = 0): DrumHit[] {
  if (beat === 'off') return [];
  const tomRoot = 43 + key; // toms sit around G2–F♯3, tuned to the key
  const toms = [tomRoot + 12, tomRoot + 7, tomRoot + 3, tomRoot];
  let body: DrumHit[];
  switch (beat) {
    case 'shuffle':
      body = shuffle(totalBeats);
      break;
    case 'trap':
      body = trap(totalBeats, key);
      break;
    case 'tomGroove':
      body = tomGroove(totalBeats, toms);
      break;
    case 'sequence':
      body = fromSequence(events, seq);
      break;
    default:
      body = fromGrid(GRID[beat], totalBeats);
  }
  const first = events[0]?.start ?? 0;
  const last = events.length ? events[events.length - 1].start : 0;
  const context: FillContext = {
    toms,
    root: 24 + key,
    firstBases: seq.slice(first, first + 16),
    lastBases: seq.slice(Math.max(0, last - 12), last),
  };
  const hits = withFills(beat, body, totalBeats, context);

  const seen = new Set<string>();
  return hits
    .filter((h) => h.time >= 0 && h.time < totalBeats)
    .sort((a, b) => a.time - b.time)
    .filter((h) => {
      const id = `${h.voice}@${h.time.toFixed(4)}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}
