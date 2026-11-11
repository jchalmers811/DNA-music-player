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
  /** Hi-hat brightness, 0 (dark) .. 1 (bright). Used by slices; plain hats leave it unset. */
  tone?: number;
}

export type BeatId =
  | 'off'
  | 'steady'
  | 'backbeat'
  | 'halftime'
  | 'breakbeat'
  | 'shuffle'
  | 'trap'
  | 'trapSlices'
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
    id: 'trap',
    name: '808 trap',
    description: 'Half-time trap: a booming 808 bass tuned to your key, a clap on beat 3 and rapid hi-hat rolls.',
  },
  {
    id: 'trapSlices',
    name: '808 trap (slices)',
    description:
      'The 808 trap beat with occasional hi-hat slices: stuttering 32nd, triplet and 64th-note bursts that sweep up or down in tone.',
  },
  {
    id: 'sequence',
    name: 'From the sequence',
    description:
      'The gene plays the drums. In codon modes: water-avoiding amino acids hit the kick, charged ones the snare, the rest the hi-hat; start and stop codons get a cymbal. In base mode: A is kick, G is snare, C and T are hi-hats.',
  },
];

type PatternBeat = Exclude<BeatId, 'off'>;

/**
 * One bar of 16 sixteenth-note steps per voice. Numbers are velocities
 * (0 = silent); written as strings so the grooves are easy to read and edit.
 * Digits: 0–9 → velocity 0–0.9 (9 is loudest).
 */
const GRID: Record<'steady' | 'backbeat' | 'halftime' | 'breakbeat', Partial<Record<DrumVoice, string>>> = {
  //                 1 . . . 2 . . . 3 . . . 4 . . .
  steady: {
    kick:    '9000900090009000',
    snare:   '0000800000008000',
    hat:     '0060006000600060',
  },
  backbeat: {
    kick:    '9000000080600000',
    snare:   '0000900000009000',
    hat:     '6040604060406040',
  },
  halftime: {
    kick:    '9000000000700000',
    snare:   '0000000090000000',
    hat:     '5030503050305030',
  },
  breakbeat: {
    kick:    '9000000900800000',
    snare:   '0000900200009002',
    hat:     '6363636363636363',
  },
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

/** Small deterministic hash → 0..1, so "random" choices are the same every time. */
function rand(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ---------- Main grooves ----------

function fromGrid(grid: Partial<Record<DrumVoice, string>>, totalBeats: number): DrumHit[] {
  const { hits, add } = collector();
  for (let bar = 0; bar * BAR < totalBeats; bar++) {
    for (const [voice, pattern] of Object.entries(grid) as [DrumVoice, string][]) {
      for (let s = 0; s < 16; s++) {
        const v = Number(pattern[s]);
        if (v > 0) add(bar * BAR + s * STEP, voice, v / 10);
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

/** A stutter burst: fast hats whose tone sweeps up or down. */
function slice(add: Add, from: number, length: number, step: number, up: boolean) {
  const n = Math.round(length / step);
  run(add, 'hat', from, n, step, 0.35, 0.8, (k) => {
    const p = k / Math.max(1, n - 1);
    return { tone: up ? 0.1 + 0.9 * p : 1 - 0.9 * p };
  });
}

const SLICE_STEPS = [0.125, 1 / 12, 0.0625]; // 32nds, 32nd triplets, 64ths
const SLICE_SPOTS = [1.5, 2.5, 3, 3.5];

/**
 * The trap groove plus occasional hi-hat slices. About half the bars get one
 * slice at a varied spot; its ordinary hats are removed, and sometimes the hats
 * drop out for a moment straight after, for a choppy, edited feel.
 */
function trapSlices(totalBeats: number, key: number): DrumHit[] {
  let hits = trap(totalBeats, key);
  const { hits: extra, add } = collector();
  const cleared: [number, number][] = [];
  for (let bar = 0; bar * BAR < totalBeats; bar++) {
    if (rand(bar, 1) < 0.45) continue;
    const t = bar * BAR;
    const at = t + SLICE_SPOTS[Math.floor(rand(bar, 2) * SLICE_SPOTS.length)];
    const len = at - t >= 3.5 ? 0.5 : rand(bar, 3) < 0.5 ? 0.5 : 0.75;
    const step = SLICE_STEPS[Math.floor(rand(bar, 4) * SLICE_STEPS.length)];
    slice(add, at, len, step, rand(bar, 5) < 0.5);
    let end = at + len;
    if (rand(bar, 6) < 0.4 && end + 0.5 <= t + BAR) end += 0.5; // brief hat dropout
    cleared.push([at, end]);
  }
  hits = hits.filter((h) => !(h.voice === 'hat' && cleared.some(([a, b]) => h.time >= a - 1e-9 && h.time < b - 1e-9)));
  return hits.concat(extra);
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
  // Riser made of slices: the tone sweeps up across the whole bar.
  trapSlices: (add, t) => {
    slice(add, t, 2, 0.25, true);
    slice(add, t + 2, 1, 0.125, true);
    slice(add, t + 3, 1, 0.0625, true);
    add(t + 2, 'clap', 0.6);
  },
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
  trapSlices: (add, t, c) => {
    slice(add, t, 1, 0.0625, false);
    slice(add, t + 1, 1, 1 / 12, true);
    add(t, 'sub808', 0.85, { midi: c.root + 3 });
    add(t + 1, 'clap', 0.8);
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
  if (beat === 'trap' || beat === 'trapSlices') add(t, 'sub808', 0.95, { midi: c.root });
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
  let body: DrumHit[];
  switch (beat) {
    case 'shuffle':
      body = shuffle(totalBeats);
      break;
    case 'trap':
      body = trap(totalBeats, key);
      break;
    case 'trapSlices':
      body = trapSlices(totalBeats, key);
      break;
    case 'sequence':
      body = fromSequence(events, seq);
      break;
    default:
      body = fromGrid(GRID[beat], totalBeats);
  }
  const tomRoot = 43 + key; // toms sit around G2–F♯3, tuned to the key
  const first = events[0]?.start ?? 0;
  const last = events.length ? events[events.length - 1].start : 0;
  const context: FillContext = {
    toms: [tomRoot + 12, tomRoot + 7, tomRoot + 3, tomRoot],
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
