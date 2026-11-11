/** A single nucleotide after cleaning. Ambiguous IUPAC codes collapse to N. */
export type Base = 'A' | 'C' | 'G' | 'T' | 'N';

/** Which reading frame codon-based mappings use. 'auto' = start at the first ATG. */
export type FrameSetting = 'auto' | 0 | 1 | 2;

export type ScaleId =
  | 'majorPentatonic'
  | 'minorPentatonic'
  | 'major'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'minor'
  | 'locrian';

export interface MusicSettings {
  /** Root pitch class, 0 = C … 11 = B. */
  key: number;
  scale: ScaleId;
  /** Faithful mode ignores the scale and maps onto all 12 semitones. */
  faithful: boolean;
  frame: FrameSetting;
}

/**
 * One musical event produced by a mapping. Times are in beats so tempo can
 * change without regenerating events. Every event remembers which bases it
 * came from, so audio and visuals can share one playhead.
 */
export interface NoteEvent {
  /** Onset, in beats from the start of the piece. */
  time: number;
  /** Length, in beats. */
  duration: number;
  /** MIDI note number, or null for a rest. */
  midi: number | null;
  /** 0..1 */
  velocity: number;
  /** Index of the first source base. */
  start: number;
  /** Number of source bases (1 for base mode, 3 for codon modes). */
  length: number;
  /** Human-readable source, e.g. "A", "ATG", "Met". */
  label: string;
  kind?: 'start' | 'stop';
}

export interface MappingResult {
  events: NoteEvent[];
  totalBeats: number;
  /** Index of the first base the mapping reads from (the frame start for codon modes). */
  readingStart: number;
}
