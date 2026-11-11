import * as Tone from 'tone';
import { firstEventAtOrAfter } from '../core/playhead';
import type { DrumHit } from '../core/drums';
import type { NoteEvent } from '../core/types';
import { DrumKit } from './drums';
import { createInstrument, type Instrument, type InstrumentId } from './instruments';

export type PlayState = 'stopped' | 'playing' | 'paused';

/** Scheduling grid in beats (a sixteenth note). Event onsets may fall anywhere inside a cell. */
const GRID = 0.25;

/**
 * Plays note events against Tone's transport. The transport is the single
 * clock: visuals read `currentBeat()` every frame instead of using timers.
 *
 * Events are looked up lazily, one grid cell ahead at a time, so long
 * sequences don't have to be scheduled up front.
 */
export class AudioEngine {
  private _state: PlayState = 'stopped';
  /** Called whenever the play state changes, for any reason (user action, end of piece, reload). */
  onStateChange: (state: PlayState) => void = () => {};

  get state(): PlayState {
    return this._state;
  }

  private setState(next: PlayState): void {
    if (next === this._state) return;
    this._state = next;
    this.onStateChange(next);
  }

  private events: NoteEvent[] = [];
  private drums: DrumHit[] = [];
  private drumLevel = 0.7;
  private kit: DrumKit | null = null;
  private totalBeats = 0;
  private instrumentId: InstrumentId;
  private instrument: Instrument | null = null;
  private bus: Tone.ToneAudioNode | null = null;
  private repeatId: number | null = null;
  private readonly transport = Tone.getTransport();

  constructor(instrumentId: InstrumentId, bpm: number) {
    this.instrumentId = instrumentId;
    // Set once, before anything is scheduled. Changing lookAhead later moves "now" backwards,
    // so a start could land before an earlier stop and be cancelled (frozen, silent first play).
    Tone.getContext().lookAhead = 0.06;
    this.transport.bpm.value = bpm;
    // Register the scheduler up front. Registering it on the first play, just before
    // transport.start(), meant it never fired and the first play was silent.
    this.repeatId = this.transport.scheduleRepeat((time) => this.tick(time), '16n', 0);
  }

  load(events: NoteEvent[], totalBeats: number): void {
    // Callers re-seek after loading; a position past the new end is handled by tick() → finish().
    this.events = events;
    this.totalBeats = totalBeats;
  }

  /** Drum hits to play alongside the notes (empty = no percussion). */
  loadDrums(hits: DrumHit[]): void {
    this.drums = hits;
  }

  /** Drum volume, 0..1. */
  setDrumLevel(level: number): void {
    this.drumLevel = level;
    this.kit?.setLevel(level);
  }

  get duration(): number {
    return this.totalBeats;
  }

  setTempo(bpm: number): void {
    this.transport.bpm.value = bpm;
  }

  get tempo(): number {
    return this.transport.bpm.value;
  }

  setInstrument(id: InstrumentId): void {
    this.instrumentId = id;
    if (!this.bus) return; // created on first play
    this.instrument?.retire();
    this.instrument = createInstrument(id, this.bus);
  }

  async play(): Promise<void> {
    if (this.state === 'playing' || this.events.length === 0) return;
    // Finished pieces wait at the end (so the visuals keep the final state); play restarts them.
    if (this.state === 'paused' && this.transport.ticks >= this.totalBeats * this.transport.PPQ) this.transport.ticks = 0;
    await Tone.start();
    this.ensureAudio();
    this.transport.start();
    this.setState('playing');
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.transport.pause();
    this.setState('paused');
  }

  stop(): void {
    // Only stop a transport that is running or paused. Before the first play the AudioContext
    // is suspended at time 0, and a stop scheduled then can cancel the first start.
    if (this.transport.state !== 'stopped') this.transport.stop();
    this.transport.ticks = 0;
    this.instrument && this.releaseSoon();
    this.setState('stopped');
  }

  seek(beat: number): void {
    const clamped = Math.max(0, Math.min(beat, this.totalBeats));
    this.transport.ticks = Math.round(clamped * this.transport.PPQ);
    if (this.state === 'stopped') this.setState('paused');
  }

  /** Audible position in beats. */
  currentBeat(): number {
    if (this.state === 'stopped') return 0;
    const ticks = this.state === 'playing' ? this.transport.getTicksAtTime(Tone.immediate()) : this.transport.ticks;
    return ticks / this.transport.PPQ;
  }

  private releaseSoon(): void {
    // Re-create the instrument so held notes cut off cleanly on stop.
    if (!this.bus) return;
    this.instrument?.retire();
    this.instrument = createInstrument(this.instrumentId, this.bus);
  }

  private ensureAudio(): void {
    if (this.bus) return;
    const limiter = new Tone.Limiter(-1).toDestination();
    const reverb = new Tone.Reverb({ decay: 2.6, wet: 0.22 }).connect(limiter);
    this.bus = reverb;
    this.instrument = createInstrument(this.instrumentId, reverb);
    // Drums stay dry (no reverb) so they sound tight.
    this.kit = new DrumKit(limiter);
    this.kit.setLevel(this.drumLevel);
  }

  private tick(time: number): void {
    const ppq = this.transport.PPQ;
    const beat = Math.round(this.transport.getTicksAtTime(time)) / ppq;
    if (beat >= this.totalBeats) {
      Tone.getDraw().schedule(() => this.finish(), time);
      return;
    }
    const spb = 60 / this.transport.bpm.value;
    const { events } = this;
    for (let i = firstEventAtOrAfter(events, beat); i < events.length && events[i].time < beat + GRID - 1e-9; i++) {
      const ev = events[i];
      if (ev.midi === null || !this.instrument) continue;
      this.instrument.play(ev.midi, ev.duration * spb, time + (ev.time - beat) * spb, ev.velocity);
    }
    const { drums, kit } = this;
    if (!kit) return;
    for (let i = firstEventAtOrAfter(drums, beat); i < drums.length && drums[i].time < beat + GRID - 1e-9; i++) {
      const h = drums[i];
      kit.play(h, time + (h.time - beat) * spb);
    }
  }

  private finish(): void {
    if (this.state !== 'playing') return;
    // Hold at the end rather than jumping back to the start.
    this.transport.pause();
    this.transport.ticks = Math.round(this.totalBeats * this.transport.PPQ);
    this.releaseSoon();
    this.setState('paused');
  }

  dispose(): void {
    if (this.repeatId !== null) this.transport.clear(this.repeatId);
    this.transport.stop();
  }
}
