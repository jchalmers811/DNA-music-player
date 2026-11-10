import { findFirstStart, HYDROPATHY_ORDER, AMINO_ACIDS, translateCodon } from './genetics';
import { degreeToMidi, rootMidi, scaleIntervals } from './music';
import type { FrameSetting, MappingResult, MusicSettings, NoteEvent } from './types';

export type MappingId = 'base' | 'codon' | 'aminoAcid';

/**
 * A mapping is a pure function from (sequence, settings) to note events.
 * New mappings (V2+) plug in here without touching audio or visuals.
 */
export interface Mapping {
  id: MappingId;
  name: string;
  /** One-line, plain-language description. */
  summary: string;
  /** Longer explanation shown when "Show the biology" is on. */
  biology: string;
  /** Whether the reading-frame control applies. */
  usesFrame: boolean;
  map(seq: string, settings: MusicSettings): MappingResult;
}

const BASE_INDEX: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 };

/** Beats per base in base mode, and per codon in codon modes. */
export const BASE_STEP = 0.5;
export const CODON_STEP = 1;

/** First base a codon mapping reads from for the given frame setting. */
export function resolveReadingStart(seq: string, frame: FrameSetting): number {
  if (frame === 'auto') {
    const atg = findFirstStart(seq);
    return atg >= 0 ? atg : 0;
  }
  return Math.min(frame, Math.max(0, seq.length - 1));
}

/** 0..63 in ACGT order, or -1 if the codon contains N. */
export function codonIndex(codon: string): number {
  const a = BASE_INDEX[codon[0]];
  const b = BASE_INDEX[codon[1]];
  const c = BASE_INDEX[codon[2]];
  if (a === undefined || b === undefined || c === undefined) return -1;
  return a * 16 + b * 4 + c;
}

const baseMapping: Mapping = {
  id: 'base',
  name: 'Base → note',
  summary: 'Each letter plays one of four notes. Simple and fast-moving.',
  biology:
    'Reads the sequence one base at a time. A, C, G and T each get one note, spread across the scale. Unknown bases (N) are rests.',
  usesFrame: false,
  map(seq, settings) {
    const intervals = scaleIntervals(settings);
    const root = rootMidi(settings.key, 60);
    const events: NoteEvent[] = [];
    for (let i = 0; i < seq.length; i++) {
      const b = seq[i];
      const idx = BASE_INDEX[b];
      events.push({
        time: i * BASE_STEP,
        duration: BASE_STEP * 0.9,
        midi: idx === undefined ? null : degreeToMidi(Math.round((idx * intervals.length) / 4), intervals, root),
        velocity: 0.7,
        start: i,
        length: 1,
        label: b,
      });
    }
    return { events, totalBeats: seq.length * BASE_STEP, readingStart: 0 };
  },
};

/** Shared loop for codon-based mappings. */
function mapCodons(
  seq: string,
  settings: MusicSettings,
  pick: (codon: string, isFirst: boolean) => Pick<NoteEvent, 'midi' | 'label' | 'kind' | 'velocity'>,
): MappingResult {
  const readingStart = resolveReadingStart(seq, settings.frame);
  const events: NoteEvent[] = [];
  let t = 0;
  for (let i = readingStart; i + 3 <= seq.length; i += 3) {
    const codon = seq.slice(i, i + 3);
    events.push({ time: t, duration: CODON_STEP * 0.9, start: i, length: 3, ...pick(codon, i === readingStart) });
    t += CODON_STEP;
  }
  return { events, totalBeats: t, readingStart };
}

function codonKind(codon: string, isFirst: boolean): NoteEvent['kind'] {
  const aa = translateCodon(codon);
  if (aa === '*') return 'stop';
  if (isFirst && codon === 'ATG') return 'start';
  return undefined;
}

const codonMapping: Mapping = {
  id: 'codon',
  name: 'Codon → note',
  summary: 'Every three-letter codon gets its own pitch across three octaves.',
  biology:
    'Reads triplets (codons), the unit of the genetic code. All 64 codons get their own pitch. Codons that share a first base sit close together in pitch.',
  usesFrame: true,
  map(seq, settings) {
    const intervals = scaleIntervals(settings);
    const root = rootMidi(settings.key, 48);
    const span = intervals.length * 3;
    return mapCodons(seq, settings, (codon, isFirst) => {
      const idx = codonIndex(codon);
      const kind = codonKind(codon, isFirst);
      return {
        midi: idx < 0 ? null : degreeToMidi(Math.floor((idx * span) / 64), intervals, root),
        label: codon,
        kind,
        velocity: kind === 'start' ? 0.95 : 0.7,
      };
    });
  },
};

const aminoAcidMapping: Mapping = {
  id: 'aminoAcid',
  name: 'Amino acid → note',
  summary: 'Codons that build the same amino acid play the same note. The most melodic mode.',
  biology:
    'Translates each codon into one of the 20 amino acids, then gives each amino acid a pitch. Water-loving (hydrophilic) residues are low and water-avoiding (hydrophobic) residues are high. Synonymous codons share a note, and stop codons are rests.',
  usesFrame: true,
  map(seq, settings) {
    const intervals = scaleIntervals(settings);
    const root = rootMidi(settings.key, 48);
    const span = intervals.length * 3;
    return mapCodons(seq, settings, (codon, isFirst) => {
      const aa = translateCodon(codon);
      const kind = codonKind(codon, isFirst);
      const rank = HYDROPATHY_ORDER.indexOf(aa);
      return {
        midi: rank < 0 ? null : degreeToMidi(Math.floor((rank * span) / 20), intervals, root),
        label: aa === '*' ? 'Stop' : (AMINO_ACIDS[aa]?.three ?? '?'),
        kind,
        velocity: kind === 'start' ? 0.95 : 0.7,
      };
    });
  },
};

export const MAPPINGS: Mapping[] = [aminoAcidMapping, codonMapping, baseMapping];

export function getMapping(id: MappingId): Mapping {
  const m = MAPPINGS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown mapping: ${id}`);
  return m;
}
