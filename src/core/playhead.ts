import type { NoteEvent } from './types';

/** Index of the last event with time <= beat, or -1. Events must be sorted by time. */
export function eventIndexAt(events: NoteEvent[], beat: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].time <= beat + 1e-9) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Index of the first event (note or drum hit) with time >= beat. Returns events.length if none. */
export function firstEventAtOrAfter(events: { time: number }[], beat: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].time < beat - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the event whose source contains basePos (or the nearest before it). Events must be sorted by start. */
export function eventIndexForBase(events: NoteEvent[], basePos: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let ans = events.length > 0 ? 0 : -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].start <= basePos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface PlayheadPosition {
  /** Continuous position in bases; glides through each event's source bases. */
  pos: number;
  /** Current event index, or -1 before the first event. */
  index: number;
  /** Beats since the current event's onset. */
  sinceOnset: number;
}

/** Shared playhead: turn a transport beat into a position on the sequence. */
export function positionAt(events: NoteEvent[], beat: number, fallbackPos = 0): PlayheadPosition {
  const index = eventIndexAt(events, beat);
  if (index < 0) return { pos: events[0]?.start ?? fallbackPos, index: -1, sinceOnset: Infinity };
  const ev = events[index];
  const next = events[index + 1];
  const span = next ? next.time - ev.time : ev.duration;
  const frac = span > 0 ? Math.min(1, Math.max(0, (beat - ev.time) / span)) : 0;
  return { pos: ev.start + frac * ev.length, index, sinceOnset: beat - ev.time };
}
