import './style.css';
import { version } from '../package.json';
import { AudioEngine } from './audio/engine';
import { INSTRUMENTS, type InstrumentId } from './audio/instruments';
import { BEATS, DEFAULT_BEAT, drumHits, type BeatId } from './core/drums';
import { parseFasta, type FastaRecord } from './core/fasta';
import { AMINO_ACIDS, BASE_NAMES, complement, gcContent, translate, translateCodon } from './core/genetics';
import { getMapping, MAPPINGS, resolveReadingStart, type MappingId } from './core/mappings';
import { KEY_NAMES, midiToName, SCALES } from './core/music';
import { eventIndexAt, eventIndexForBase, positionAt } from './core/playhead';
import { foldProtein, type FoldResult } from './core/fold';
import {
  PROPERTY_LABELS,
  predictSecondaryStructure,
  proteinFrom,
  structureSummary,
  type PropertyClass,
  type ProteinChain,
} from './core/protein';
import { SAMPLES } from './core/samples';
import type { Base, FrameSetting, MappingResult, MusicSettings, ScaleId } from './core/types';
import { SequenceStrip } from './ui/strip';
import { GeneScene, PROPERTY_COLORS } from './visual/geneScene';
import { HelixView, type HelixHighlight } from './visual/helix';

type ViewId = 'helix' | 'protein';
const VIEW_KEY = 'dna-music-player:view';
const CAVEATS: Record<ViewId, string> = {
  helix: 'Idealised B-DNA diagram, not a measured structure',
  protein: 'Simplified view. The protein shape is a rough estimate, not a prediction. Drag to turn it.',
};

/** Longer inputs are truncated for now; window summarisation arrives in V2. */
const MAX_BASES = 200_000;
const START_MARK = 0xffffff;
const STOP_MARK = 0xf472b6;

// ---------- DOM ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  helix: $('helix'),
  nowPlaying: $('now-playing'),
  play: $<HTMLButtonElement>('play'),
  stop: $<HTMLButtonElement>('stop'),
  progress: $('progress'),
  progressFill: $('progress-fill'),
  time: $('time'),
  bioPanel: $('bio-panel'),
  bioNow: $('bio-now'),
  bioStats: $('bio-stats'),
  bioMapping: $('bio-mapping'),
  sample: $<HTMLSelectElement>('sample'),
  sampleAbout: $('sample-about'),
  importBox: $<HTMLDetailsElement>('import'),
  fastaInput: $<HTMLTextAreaElement>('fasta-input'),
  fastaLoad: $<HTMLButtonElement>('fasta-load'),
  fastaFile: $<HTMLInputElement>('fasta-file'),
  recordField: $('record-field'),
  record: $<HTMLSelectElement>('record'),
  seqMessage: $('seq-message'),
  seqMeta: $('seq-meta'),
  mapping: $('mapping'),
  mappingSummary: $('mapping-summary'),
  frameField: $('frame-field'),
  frame: $<HTMLSelectElement>('frame'),
  key: $<HTMLSelectElement>('key'),
  scale: $<HTMLSelectElement>('scale'),
  faithful: $<HTMLInputElement>('faithful'),
  tempo: $<HTMLInputElement>('tempo'),
  tempoOut: $('tempo-out'),
  instrument: $<HTMLSelectElement>('instrument'),
  beat: $<HTMLSelectElement>('beat'),
  beatAbout: $('beat-about'),
  drumLevelField: $('drum-level-field'),
  drumLevel: $<HTMLInputElement>('drum-level'),
  drumLevelOut: $('drum-level-out'),
  showBio: $<HTMLInputElement>('show-bio'),
  dropOverlay: $('drop-overlay'),
  viewSwitch: $('view-switch'),
  caveat: $('caveat'),
  legend: $('legend'),
  sceneNote: $('scene-note'),
};

// ---------- State ----------
const state = {
  name: '',
  sequence: '',
  records: [] as FastaRecord[],
  mappingId: 'aminoAcid' as MappingId,
  settings: { key: 0, scale: 'majorPentatonic', faithful: false, frame: 'auto' } as MusicSettings,
  tempo: 110,
  instrument: 'keys' as InstrumentId,
  beat: DEFAULT_BEAT as BeatId,
  drumLevel: 0.7,
  showBiology: false,
};
let result: MappingResult = { events: [], totalBeats: 0, readingStart: 0 };
let frameStart = 0; // reading frame shown in biology views
let lastBioIndex = -2;
let view: ViewId = readStoredView();
let chain: ProteinChain = { residues: '', stopFound: false, truncated: false };
const foldCache = new Map<string, FoldResult>();

const isSmall = window.matchMedia('(max-width: 860px)').matches;
const engine = new AudioEngine(state.instrument, state.tempo);
const helix = new HelixView(ui.helix, isSmall ? 110 : 170);
const geneScene = new GeneScene(ui.helix, $('scene-labels'), { small: isSmall });
const strip = new SequenceStrip($('strip'));

$('version').textContent = `v${version}`;

// ---------- Views ----------
function readStoredView(): ViewId {
  try {
    return localStorage.getItem(VIEW_KEY) === 'protein' ? 'protein' : 'helix';
  } catch {
    return 'helix';
  }
}

function setView(next: ViewId) {
  view = next;
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
  helix.setVisible(next === 'helix');
  geneScene.setVisible(next === 'protein');
  for (const btn of ui.viewSwitch.querySelectorAll<HTMLButtonElement>('button'))
    btn.setAttribute('aria-checked', String(btn.dataset.view === next));
  ui.caveat.textContent = CAVEATS[next];
  ui.legend.hidden = next !== 'protein';
  ui.helix.classList.toggle('view-protein', next === 'protein');
  updateProtein();
}

/** Work out the protein for the current reading frame; fold it only when the protein view needs it. */
function updateProtein() {
  chain = proteinFrom(state.sequence, frameStart);
  geneScene.setSequence(state.sequence, frameStart);
  const note = proteinNote(chain);
  ui.sceneNote.textContent = note;
  ui.sceneNote.hidden = view !== 'protein' || note === '';
  if (view !== 'protein') return;
  if (!chain.residues) {
    geneScene.setProtein(null);
    return;
  }
  let fold = foldCache.get(chain.residues);
  if (!fold) {
    fold = foldProtein(chain.residues);
    if (foldCache.size > 8) foldCache.clear();
    foldCache.set(chain.residues, fold);
  }
  geneScene.setProtein({ residues: chain.residues, fold, stopFound: chain.stopFound });
}

function proteinNote(c: ProteinChain): string {
  if (!c.residues) return 'No protein here: the reading frame has no complete codons before a stop codon.';
  if (c.truncated) return `This protein is very long, so only the first ${c.residues.length.toLocaleString()} amino acids are shown.`;
  if (!c.stopFound) return 'No stop codon in this reading frame, so the chain is never released from the ribosome.';
  return '';
}

ui.legend.innerHTML = (Object.keys(PROPERTY_LABELS) as PropertyClass[])
  .map(
    (k) =>
      `<span><i style="background:#${PROPERTY_COLORS[k].toString(16).padStart(6, '0')}"></i>${PROPERTY_LABELS[k]}</span>`,
  )
  .join('');

// ---------- Populate controls ----------
for (const s of SAMPLES) ui.sample.add(new Option(s.name, s.id));
ui.sample.add(new Option('Your sequence', 'custom'));
ui.sample.options[ui.sample.options.length - 1].hidden = true;

for (const m of MAPPINGS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.role = 'radio';
  btn.dataset.id = m.id;
  btn.textContent = m.name;
  btn.addEventListener('click', () => {
    state.mappingId = m.id;
    remap(true);
  });
  ui.mapping.append(btn);
}
KEY_NAMES.forEach((k, i) => ui.key.add(new Option(k, String(i))));
for (const [id, s] of Object.entries(SCALES)) ui.scale.add(new Option(s.name, id));
for (const inst of INSTRUMENTS) ui.instrument.add(new Option(inst.name, inst.id));
for (const b of BEATS) ui.beat.add(new Option(b.name, b.id));
ui.beat.value = state.beat;
ui.scale.value = state.settings.scale;
ui.instrument.value = state.instrument;

// ---------- Sequence loading ----------
function setMessage(text: string, kind: '' | 'warn' | 'error' = '') {
  ui.seqMessage.textContent = text;
  ui.seqMessage.className = `message ${kind}`;
}

function loadRecord(record: FastaRecord, name: string) {
  let seq = record.sequence;
  if (seq.length > MAX_BASES) {
    seq = seq.slice(0, MAX_BASES);
    setMessage(
      `This sequence is ${record.sequence.length.toLocaleString()} bases; playing the first ${MAX_BASES.toLocaleString()}. Genome-scale summaries are coming in a later version.`,
      'warn',
    );
  }
  // Switching sequence starts it from the top, and keeps playing if it was playing.
  const wasPlaying = engine.state === 'playing';
  engine.stop();
  state.sequence = seq;
  state.name = name;
  helix.setSequence(seq);
  remap(false);
  if (wasPlaying) void engine.play();
}

function loadSample(id: string) {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) return;
  ui.sample.value = id;
  ui.sampleAbout.textContent = sample.about;
  ui.recordField.hidden = true;
  setMessage('');
  const { records } = parseFasta(sample.fasta);
  loadRecord(records[0], sample.name);
}

function loadText(text: string, sourceName: string) {
  try {
    const { records, warnings } = parseFasta(text);
    state.records = records;
    setMessage(warnings.join(' '), warnings.length ? 'warn' : '');
    ui.sample.value = 'custom';
    ui.sampleAbout.textContent = `Loaded from ${sourceName}.`;
    ui.record.replaceChildren(
      ...records.map(
        (r, i) => new Option(`${r.id} (${r.sequence.length.toLocaleString()} bases)`, String(i)),
      ),
    );
    ui.recordField.hidden = records.length < 2;
    const r = records[0];
    loadRecord(r, r.description ? `${r.id} ${r.description}` : r.id);
    // loadRecord may add a truncation warning; keep parse warnings too
    if (warnings.length && !ui.seqMessage.textContent.includes(warnings[0]))
      setMessage(`${warnings.join(' ')} ${ui.seqMessage.textContent}`, 'warn');
  } catch (err) {
    setMessage((err as Error).message, 'error');
  }
}

async function loadFile(file: File) {
  if (file.size > 300 * 1024 * 1024) {
    setMessage('That file is too large for this version (over 300 MB).', 'error');
    return;
  }
  loadText(await file.text(), file.name);
}

// ---------- Mapping ----------
function remap(keepPosition: boolean) {
  const mapping = getMapping(state.mappingId);
  const basePos = keepPosition ? currentPosition().pos : -1;
  result = mapping.map(state.sequence, state.settings);
  engine.load(result.events, result.totalBeats);
  frameStart = mapping.usesFrame ? result.readingStart : resolveReadingStart(state.sequence, 'auto');

  if (keepPosition && engine.state !== 'stopped' && result.events.length) {
    const idx = eventIndexForBase(result.events, basePos);
    engine.seek(result.events[Math.max(0, idx)].time);
  }

  // markers for the helix: start codon + in-frame stops
  const markers = new Map<number, number>();
  if (state.showBiology) {
    const seq = state.sequence;
    if (seq.slice(frameStart, frameStart + 3) === 'ATG')
      for (let j = 0; j < 3; j++) markers.set(frameStart + j, START_MARK);
    for (let i = frameStart; i + 3 <= seq.length; i += 3)
      if (translateCodon(seq.slice(i, i + 3)) === '*') for (let j = 0; j < 3; j++) markers.set(i + j, STOP_MARK);
  }
  helix.setMarkers(markers);
  strip.setData(state.sequence, frameStart, state.showBiology);
  updateDrums();
  updateProtein();
  lastBioIndex = -2;
  syncControls();
}

/** Percussion follows the mapping, sequence and key, so it's rebuilt whenever they change. */
function updateDrums() {
  engine.loadDrums(drumHits(state.beat, result.events, result.totalBeats, state.sequence, state.settings.key));
}

function syncControls() {
  const mapping = getMapping(state.mappingId);
  for (const btn of ui.mapping.querySelectorAll<HTMLButtonElement>('button'))
    btn.setAttribute('aria-checked', String(btn.dataset.id === state.mappingId));
  ui.mappingSummary.textContent = mapping.summary;
  ui.frameField.hidden = !mapping.usesFrame;
  ui.scale.disabled = state.settings.faithful;
  ui.beatAbout.textContent = BEATS.find((b) => b.id === state.beat)?.description ?? '';
  ui.drumLevelField.hidden = state.beat === 'off';
  ui.bioPanel.hidden = !state.showBiology;
  ui.bioMapping.textContent = mapping.biology;

  const seq = state.sequence;
  const seconds = (result.totalBeats * 60) / state.tempo;
  ui.seqMeta.textContent = `${state.name} · ${seq.length.toLocaleString()} bases · ${formatTime(seconds)} at ${state.tempo} BPM`;

  if (state.showBiology) {
    const atg = resolveReadingStart(seq, 'auto');
    const hasAtg = seq.slice(atg, atg + 3) === 'ATG';
    const frameText = mapping.usesFrame
      ? state.settings.frame === 'auto'
        ? hasAtg
          ? `From first ATG, base ${(atg + 1).toLocaleString()}`
          : 'No ATG found; from base 1'
        : `Frame ${state.settings.frame + 1}, from base ${state.settings.frame + 1}`
      : 'Not used (one base at a time)';
    const protein = translate(seq, frameStart);
    const firstStop = protein.indexOf('*');
    const proteinLen = firstStop < 0 ? protein.length : firstStop;
    const stops = (protein.match(/\*/g) ?? []).length;
    const ss = structureSummary(predictSecondaryStructure(chain.residues));
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    ui.bioStats.innerHTML = [
      ['Length', `${seq.length.toLocaleString()} bases`],
      ['GC content', `${Math.round(gcContent(seq) * 100)}%`],
      ['Reading frame', frameText],
      ['Protein', `${proteinLen.toLocaleString()} amino acids before the first stop`],
      ['Stop codons in frame', stops.toLocaleString()],
      [
        'Shape (rough estimate)',
        chain.residues ? `${pct(ss.helix)} helix · ${pct(ss.strand)} strand · ${pct(ss.coil)} loop` : '—',
      ],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');
  }
}

// ---------- Playback ----------
function currentPosition() {
  return positionAt(result.events, engine.currentBeat(), result.readingStart);
}

async function togglePlay() {
  if (engine.state === 'playing') engine.pause();
  else await engine.play();
}

function renderTransport() {
  const playing = engine.state === 'playing';
  ui.play.classList.toggle('playing', playing);
  ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

// The button always mirrors the engine, whatever changed its state.
engine.onStateChange = () => renderTransport();

function seekToFraction(frac: number) {
  if (!result.events.length) return;
  const beat = Math.max(0, Math.min(1, frac)) * result.totalBeats;
  const idx = Math.max(0, eventIndexAt(result.events, beat));
  engine.seek(result.events[idx].time);
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- Now-playing text ----------
function describeEvent(index: number): { short: string; long: string } {
  const ev = result.events[index];
  if (!ev) return { short: '', long: '<span class="hint">Press play to start.</span>' };
  const note = ev.midi === null ? 'rest' : midiToName(ev.midi);
  const pos = `base ${(ev.start + 1).toLocaleString()}`;
  if (ev.length === 1) {
    const b = ev.label as Base;
    return {
      short: `<b>${b}</b> · ${note}`,
      long: `<code class="b-${b}">${b}</code> ${BASE_NAMES[b]}, pairs with <code class="b-${complement(b)}">${complement(b)}</code> · ♪ ${note} · ${pos}`,
    };
  }
  const codon = state.sequence.slice(ev.start, ev.start + 3);
  const aa = translateCodon(codon);
  const info = AMINO_ACIDS[aa];
  const aaText = aa === '*' ? 'stop' : info ? `${info.three} (${info.name})` : 'unknown';
  const tag =
    ev.kind === 'start'
      ? '<span class="tag tag-start">start codon</span>'
      : ev.kind === 'stop'
        ? '<span class="tag tag-stop">stop codon</span>'
        : '';
  const coloured = [...codon].map((b) => `<span class="b-${b}">${b}</span>`).join('');
  return {
    short: `<b>${codon}</b> → ${aa === '*' ? 'Stop' : (info?.three ?? '?')} · ${note}`,
    long: `<code>${coloured}</code> → ${aaText}${tag} · ♪ ${note} · ${pos}`,
  };
}

// ---------- Render loop ----------
function frame(now: number) {
  const beat = engine.currentBeat();
  const ph = positionAt(result.events, beat, result.readingStart);
  const ev = ph.index >= 0 ? result.events[ph.index] : null;
  const spb = 60 / state.tempo;
  const sounding = engine.state === 'playing' && ev !== null && ev.midi !== null;
  const pulse = sounding ? Math.exp(-ph.sinceOnset * spb * 5) : 0;
  const hl: HelixHighlight | null = ev && engine.state !== 'stopped' ? { start: ev.start, length: ev.length, pulse } : null;

  if (view === 'helix') helix.render(ph.pos, hl, now / 1000);
  else geneScene.render(ph.pos, hl, now / 1000);
  strip.update(ph.pos, hl);

  const shownBeat = Math.min(beat, result.totalBeats);
  const frac = result.totalBeats > 0 ? shownBeat / result.totalBeats : 0;
  ui.progressFill.style.width = `${frac * 100}%`;
  ui.progress.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  ui.time.textContent = `${formatTime(shownBeat * spb)} / ${formatTime(result.totalBeats * spb)}`;

  const shownIndex = engine.state === 'stopped' ? -1 : ph.index;
  if (shownIndex !== lastBioIndex) {
    lastBioIndex = shownIndex;
    const d = describeEvent(shownIndex);
    ui.nowPlaying.innerHTML = d.short;
    if (state.showBiology) ui.bioNow.innerHTML = d.long;
  }
  requestAnimationFrame(frame);
}

// ---------- Events ----------
ui.play.addEventListener('click', togglePlay);
ui.stop.addEventListener('click', () => engine.stop());
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.code !== 'Space' || t.closest('textarea, input, select, button, [role="slider"]')) return;
  e.preventDefault();
  togglePlay();
});

let scrubbing = false;
const scrub = (e: PointerEvent) => {
  const rect = ui.progress.getBoundingClientRect();
  seekToFraction((e.clientX - rect.left) / rect.width);
};
ui.progress.addEventListener('pointerdown', (e) => {
  scrubbing = true;
  ui.progress.setPointerCapture(e.pointerId);
  scrub(e);
});
ui.progress.addEventListener('pointermove', (e) => scrubbing && scrub(e));
ui.progress.addEventListener('pointerup', () => (scrubbing = false));
ui.progress.addEventListener('keydown', (e) => {
  const step = e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowLeft' ? -0.05 : 0;
  if (!step || !result.totalBeats) return;
  e.preventDefault();
  seekToFraction(engine.currentBeat() / result.totalBeats + step);
});

ui.sample.addEventListener('change', () => ui.sample.value !== 'custom' && loadSample(ui.sample.value));
ui.fastaLoad.addEventListener('click', () => loadText(ui.fastaInput.value, 'pasted text'));
ui.fastaFile.addEventListener('change', () => {
  const file = ui.fastaFile.files?.[0];
  if (file) loadFile(file);
  ui.fastaFile.value = '';
});
ui.record.addEventListener('change', () => {
  const r = state.records[Number(ui.record.value)];
  if (r) loadRecord(r, r.description ? `${r.id} ${r.description}` : r.id);
});

ui.frame.addEventListener('change', () => {
  const v = ui.frame.value;
  state.settings.frame = (v === 'auto' ? 'auto' : Number(v)) as FrameSetting;
  remap(true);
});
ui.key.addEventListener('change', () => {
  state.settings.key = Number(ui.key.value);
  remap(true);
});
ui.scale.addEventListener('change', () => {
  state.settings.scale = ui.scale.value as ScaleId;
  remap(true);
});
ui.faithful.addEventListener('change', () => {
  state.settings.faithful = ui.faithful.checked;
  remap(true);
});
ui.tempo.addEventListener('input', () => {
  state.tempo = Number(ui.tempo.value);
  ui.tempoOut.textContent = ui.tempo.value;
  engine.setTempo(state.tempo);
  syncControls();
});
ui.instrument.addEventListener('change', () => {
  state.instrument = ui.instrument.value as InstrumentId;
  engine.setInstrument(state.instrument);
});
ui.beat.addEventListener('change', () => {
  state.beat = ui.beat.value as BeatId;
  updateDrums();
  syncControls();
});
ui.drumLevel.addEventListener('input', () => {
  state.drumLevel = Number(ui.drumLevel.value) / 100;
  ui.drumLevelOut.textContent = ui.drumLevel.value;
  engine.setDrumLevel(state.drumLevel);
});
ui.showBio.addEventListener('change', () => {
  state.showBiology = ui.showBio.checked;
  remap(true);
});

// Drag and drop anywhere
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  ui.dropOverlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) ui.dropOverlay.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  ui.dropOverlay.hidden = true;
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

for (const btn of ui.viewSwitch.querySelectorAll<HTMLButtonElement>('button'))
  btn.addEventListener('click', () => setView(btn.dataset.view as ViewId));

// ---------- Start ----------
loadSample(SAMPLES[0].id);
setView(view);
renderTransport();
requestAnimationFrame(frame);
