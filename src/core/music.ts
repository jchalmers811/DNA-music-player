import type { MusicSettings, ScaleId } from './types';

export const SCALES: Record<ScaleId, { name: string; intervals: number[] }> = {
  majorPentatonic: { name: 'Major pentatonic', intervals: [0, 2, 4, 7, 9] },
  minorPentatonic: { name: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10] },
  // The seven modes, in their usual order.
  major: { name: 'Major (Ionian)', intervals: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  minor: { name: 'Natural minor (Aeolian)', intervals: [0, 2, 3, 5, 7, 8, 10] },
  locrian: { name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
};

export const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** The pitch set a mapping should use: the chosen scale, or all 12 semitones in faithful mode. */
export function scaleIntervals(settings: MusicSettings): number[] {
  return settings.faithful ? CHROMATIC : SCALES[settings.scale].intervals;
}

/**
 * MIDI note for the root of the given key near `octaveC` (a MIDI C, e.g. 60).
 * Keys above F♯ drop an octave so every key sits in a similar register.
 */
export function rootMidi(key: number, octaveC: number): number {
  return octaveC + (key > 6 ? key - 12 : key);
}

/** Convert a scale degree (0 = root, may exceed one octave) to a MIDI note. */
export function degreeToMidi(degree: number, intervals: number[], root: number): number {
  const n = intervals.length;
  const octave = Math.floor(degree / n);
  const step = ((degree % n) + n) % n;
  return root + octave * 12 + intervals[step];
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function midiToName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
