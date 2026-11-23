import '@jchalmers811/tokens/css';
import '@jchalmers811/web/button';
import '@jchalmers811/web/select';
import '@jchalmers811/web/segmented-control';
import '@jchalmers811/web/slider';
import '@jchalmers811/web/switch';
import '@jchalmers811/web/text-area';
import { brands, modes } from '@jchalmers811/tokens';
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
import { predictSecondaryStructure, proteinFrom, structureSummary, type ProteinChain } from './core/protein';
import { SAMPLES } from './core/samples';
import { soundSignature, type SignatureSetting, type SoundSignature } from './core/signature';
import type { Base, FrameSetting, MappingResult, MusicSettings, ScaleId } from './core/types';
import { SequenceStrip } from './ui/strip';
import { GeneScene } from './visual/geneScene';
import { HelixView, type HelixHighlight } from './visual/helix';
import { baseCssColors, setLook, setLookTime } from './visual/look';
import { TowerScene } from './visual/towerScene';

type ViewId = 'helix' | 'protein' | 'tower';
// v2: earlier versions saved the view on every load, not just when chosen.
const VIEW_KEY = 'dna-music-player:view-choice';
const VIEWS: ViewId[] = ['helix', 'protein', 'tower'];

/** Longer inputs are truncated for now; window summarisation arrives in V2. */
const MAX_BASES = 200_000;
const START_MARK = 0xffffff;
const STOP_MARK = 0xf472b6;

// ---------- Look ----------
// The look comes from the component library's tokens. `?brand=gallery` tries another brand, and
// `?theme=light` its light theme (the 3D scenes are drawn for dark, so dark is the default).
const params = new URLSearchParams(location.search);
const requestedBrand = params.get('brand');
if (requestedBrand && brands.includes(requestedBrand)) document.documentElement.dataset.brand = requestedBrand;
const requestedTheme = params.get('theme');
if (requestedTheme && modes.includes(requestedTheme)) document.documentElement.dataset.theme = requestedTheme;

// How the DNA itself is coloured. Spectral suits the black gallery wall; `?look=` overrides it.
const requestedLook = params.get('look');
setLook(
  requestedLook === 'spectral' || requestedLook === 'classic'
    ? requestedLook
    : document.documentElement.dataset.brand === 'gallery'
      ? 'spectral'
      : 'classic',
);
for (const [base, color] of Object.entries(baseCssColors())) document.documentElement.style.setProperty(`--${base}`, color);

// ---------- DOM ----------
type Tag = HTMLElementTagNameMap;
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
  sample: $<Tag['ts-select']>('sample'),
  sampleAbout: $('sample-about'),
  importToggle: $<Tag['ts-button']>('import-toggle'),
  importBox: $('import'),
  fastaInput: $<Tag['ts-text-area']>('fasta-input'),
  fastaLoad: $<Tag['ts-button']>('fasta-load'),
  fastaFile: $<HTMLInputElement>('fasta-file'),
  record: $<Tag['ts-select']>('record'),
  seqMessage: $('seq-message'),
  seqMeta: $('seq-meta'),
  mapping: $<Tag['ts-segmented-control']>('mapping'),
  mappingSummary: $('mapping-summary'),
  frameField: $('frame-field'),
  frame: $<Tag['ts-select']>('frame'),
  key: $<Tag['ts-select']>('key'),
  scale: $<Tag['ts-select']>('scale'),
  faithful: $<Tag['ts-switch']>('faithful'),
  tempo: $<Tag['ts-slider']>('tempo'),
  instrument: $<Tag['ts-select']>('instrument'),
  beat: $<Tag['ts-select']>('beat'),
  beatAbout: $('beat-about'),
  drumLevelField: $('drum-level-field'),
  drumLevel: $<Tag['ts-slider']>('drum-level'),
  showBio: $<Tag['ts-switch']>('show-bio'),
  soundSummaryTitle: $('sound-summary-title'),
  soundSummaryText: $('sound-summary-text'),
  soundGroupTitle: $('sound-group-title'),
  soundNote: $('sound-note'),
  sigReset: $<Tag['ts-button']>('sig-reset'),
  settings: $('settings'),
  settingsBackdrop: $('settings-backdrop'),
  settingsOpen: $<HTMLButtonElement>('settings-open'),
  settingsClose: $<HTMLButtonElement>('settings-close'),
  settingsBack: $<HTMLButtonElement>('settings-back'),
  settingsTitle: $('settings-title'),
  settingsList: $('settings-list'),
  vKeyscale: $('v-keyscale'),
  vTempo: $('v-tempo'),
  vInstrument: $('v-instrument'),
  vBeat: $('v-beat'),
  vDrumLevel: $('v-drum-level'),
  vMapping: $('v-mapping'),
  vFrame: $('v-frame'),
  bioWhy: $('bio-why'),
  dropOverlay: $('drop-overlay'),
  viewSwitch: $<Tag['ts-segmented-control']>('view-switch'),
  sceneNote: $('scene-note'),
};

// ---------- State ----------
const state = {
  name: '',
  /** Short name for the sound card, e.g. "Insulin". */
  soundName: '',
  /** The sound this sequence chose for itself; the controls can override it. */
  signature: null as SoundSignature | null,
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
const towerScene = new TowerScene(ui.helix, $('scene-labels'), { small: isSmall });
/** The views that show the gene being made into a protein. */
const proteinScenes = [geneScene, towerScene];
const strip = new SequenceStrip($('strip'));

$('version').textContent = `v${version}`;

// ---------- Views ----------
/** Gene → protein is the default; the helix is used only if the viewer chose it. */
function readStoredView(): ViewId {
  try {
    const stored = localStorage.getItem(VIEW_KEY) as ViewId | null;
    return stored && VIEWS.includes(stored) ? stored : 'protein';
  } catch {
    return 'protein';
  }
}

/** Remember a view only when the viewer picks it, so the default can change later. */
function chooseView(next: ViewId) {
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
  setView(next);
}

function setView(next: ViewId) {
  view = next;
  helix.setVisible(next === 'helix');
  geneScene.setVisible(next === 'protein');
  towerScene.setVisible(next === 'tower');
  ui.viewSwitch.value = next;
  ui.helix.classList.toggle('view-protein', next !== 'helix');
  updateProtein();
}

/** Work out the protein for the current reading frame; fold it only when the protein view needs it. */
function updateProtein() {
  chain = proteinFrom(state.sequence, frameStart);
  for (const s of proteinScenes) s.setSequence(state.sequence, frameStart);
  const note = proteinNote(chain);
  ui.sceneNote.textContent = note;
  ui.sceneNote.hidden = view === 'helix' || note === '';
  if (view === 'helix') return;
  if (!chain.residues) {
    for (const s of proteinScenes) s.setProtein(null);
    return;
  }
  let fold = foldCache.get(chain.residues);
  if (!fold) {
    fold = foldProtein(chain.residues);
    if (foldCache.size > 8) foldCache.clear();
    foldCache.set(chain.residues, fold);
  }
  const protein = { residues: chain.residues, fold, stopFound: chain.stopFound };
  for (const s of proteinScenes) s.setProtein(protein);
}

function proteinNote(c: ProteinChain): string {
  if (!c.residues) return 'No protein here: the reading frame has no complete codons before a stop codon.';
  if (c.truncated) return `This protein is very long, so only the first ${c.residues.length.toLocaleString()} amino acids are shown.`;
  if (!c.stopFound) return 'No stop codon in this reading frame, so the chain is never released from the ribosome.';
  return '';
}

// ---------- Populate controls ----------
const sampleOptions = SAMPLES.map((s) => ({ value: s.id, label: s.name }));
/** "Your sequence" is listed only while a pasted or dropped sequence is loaded. */
function setSampleOptions(withCustom: boolean) {
  ui.sample.options = withCustom ? [...sampleOptions, { value: 'custom', label: 'Your sequence' }] : sampleOptions;
}
setSampleOptions(false);

ui.mapping.options = MAPPINGS.map((m) => ({ value: m.id, label: m.name }));
ui.key.options = KEY_NAMES.map((k, i) => ({ value: String(i), label: k }));
ui.scale.options = Object.entries(SCALES).map(([id, s]) => ({ value: id, label: s.name }));
ui.instrument.options = INSTRUMENTS.map((inst) => ({ value: inst.id, label: inst.name }));
ui.beat.options = BEATS.map((b) => ({ value: b.id, label: b.name }));
ui.tempo.format = (v) => `${v} BPM`;
ui.drumLevel.format = (v) => `${v}%`;
ui.beat.value = state.beat;
ui.scale.value = state.settings.scale;
ui.instrument.value = state.instrument;

// ---------- Sequence loading ----------
function setMessage(text: string, kind: '' | 'warn' | 'error' = '') {
  ui.seqMessage.textContent = text;
  ui.seqMessage.className = `message ${kind}`;
}

function loadRecord(record: FastaRecord, name: string, soundName: string) {
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
  state.soundName = soundName;
  helix.setSequence(seq);
  applySignature(); // every load starts from the sequence's own sound
  remap(false);
  if (wasPlaying) void engine.play();
}

function loadSample(id: string) {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) return;
  setSampleOptions(false);
  ui.sample.value = id;
  ui.sampleAbout.textContent = sample.about;
  ui.record.hidden = true;
  setMessage('');
  const { records } = parseFasta(sample.fasta);
  loadRecord(records[0], sample.name, sample.soundName ?? sample.name.replace(/\s*\(.*\)$/, ''));
}

function loadText(text: string, sourceName: string) {
  try {
    const { records, warnings } = parseFasta(text);
    state.records = records;
    setMessage(warnings.join(' '), warnings.length ? 'warn' : '');
    setSampleOptions(true);
    ui.sample.value = 'custom';
    ui.sampleAbout.textContent = `Loaded from ${sourceName}.`;
    ui.record.options = records.map((r, i) => ({
      value: String(i),
      label: `${r.id} (${r.sequence.length.toLocaleString()} bases)`,
    }));
    ui.record.value = '0';
    ui.record.hidden = records.length < 2;
    const r = records[0];
    loadRecord(r, r.description ? `${r.id} ${r.description}` : r.id, r.id);
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

// ---------- Sound signature ----------
const SETTING_LABELS: Record<SignatureSetting, string> = {
  key: 'Key',
  scale: 'Scale',
  tempo: 'Tempo',
  instrument: 'Instrument',
  beat: 'Drums',
};

/** Set key, scale, tempo, instrument and beat to the current sequence's own sound. */
function applySignature() {
  const sig = soundSignature(state.sequence);
  state.signature = sig;
  state.settings.key = sig.key;
  state.settings.scale = sig.scale;
  state.tempo = sig.tempo;
  state.instrument = sig.instrument;
  state.beat = sig.beat;
  engine.setTempo(sig.tempo);
  engine.setInstrument(sig.instrument);
  ui.key.value = String(sig.key);
  ui.scale.value = sig.scale;
  ui.tempo.value = sig.tempo;
  ui.instrument.value = sig.instrument;
  ui.beat.value = sig.beat;
}

/** Which of the five signature settings the user has changed. */
function overrides(): Set<SignatureSetting> {
  const sig = state.signature;
  const changed = new Set<SignatureSetting>();
  if (!sig) return changed;
  if (state.settings.key !== sig.key) changed.add('key');
  if (state.settings.scale !== sig.scale) changed.add('scale');
  if (state.tempo !== sig.tempo) changed.add('tempo');
  if (state.instrument !== sig.instrument) changed.add('instrument');
  if (state.beat !== sig.beat) changed.add('beat');
  return changed;
}

const possessive = (name: string) => (name.endsWith('s') ? `${name}’` : `${name}’s`);
const scaleShort = (id: ScaleId) => SCALES[id].name.replace(/\s*\(.*\)$/, '');
const instrumentName = (id: InstrumentId) => INSTRUMENTS.find((i) => i.id === id)?.name ?? id;
const beatName = (id: BeatId) => BEATS.find((b) => b.id === id)?.name ?? id;

/** The sidebar's one-line sound summary, and the values shown on the settings rows. */
function renderSignature() {
  const changed = overrides();
  const mixed = changed.size > 0;
  const name = state.soundName || 'This sequence';
  const title = mixed ? `Your mix, based on ${name}` : `${possessive(name)} sound`;
  ui.soundSummaryTitle.textContent = title;
  ui.soundGroupTitle.textContent = title;
  ui.soundNote.textContent = mixed
    ? `You’ve changed ${changed.size} of the 5 settings the DNA chose.`
    : state.signature?.dnaOnly
      ? 'Chosen by the DNA itself (no protein found, so from the bases alone). Change any of these to make it your own.'
      : 'Chosen by the DNA itself. Change any of these to make it your own.';
  ui.sigReset.hidden = !mixed;
  ui.sigReset.textContent = `↺ Back to ${possessive(name)} sound`;

  const s = state.settings;
  const keyScale = `${KEY_NAMES[s.key]} ${s.faithful ? '· all 12 notes' : scaleShort(s.scale)}`;
  const drums = state.beat === 'off' ? 'No drums' : beatName(state.beat);
  ui.soundSummaryText.textContent = `${keyScale} · ${state.tempo} BPM · ${instrumentName(state.instrument)} · ${drums}`;
  ui.vKeyscale.textContent = keyScale;
  ui.vTempo.textContent = `${state.tempo} BPM`;
  ui.vInstrument.textContent = instrumentName(state.instrument);
  ui.vBeat.textContent = drums;
  ui.vDrumLevel.textContent = `${Math.round(state.drumLevel * 100)}%`;
  ui.soundSummaryTitle.closest('.sound-summary')?.classList.toggle('mixed', mixed);
  for (const row of ui.settingsList.querySelectorAll<HTMLElement>('[data-sig]')) {
    const isChanged = row.dataset.sig!.split(' ').some((k) => changed.has(k as SignatureSetting));
    row.classList.toggle('changed', isChanged);
    row.title = isChanged ? 'Changed by you' : '';
  }
}

/** The gene's own choice for a setting, as display text. */
function signatureValue(sig: SoundSignature, setting: SignatureSetting): string {
  switch (setting) {
    case 'key':
      return KEY_NAMES[sig.key];
    case 'scale':
      return scaleShort(sig.scale);
    case 'tempo':
      return `${sig.tempo} BPM`;
    case 'instrument':
      return instrumentName(sig.instrument);
    case 'beat':
      return beatName(sig.beat);
  }
}

function renderWhy() {
  const sig = state.signature;
  if (!sig) return;
  const changed = overrides();
  const order: SignatureSetting[] = ['scale', 'key', 'tempo', 'instrument', 'beat'];
  const items = order
    .map((setting) => {
      const r = sig.reasons.find((x) => x.setting === setting)!;
      const mine = changed.has(setting) ? ' <span class="why-mine">you changed this</span>' : '';
      return `<li><b>${SETTING_LABELS[setting]}: ${signatureValue(sig, setting)}</b>${mine}<br>${r.measure}, ${r.comparison} → ${r.effect}.</li>`;
    })
    .join('');
  const note = sig.dnaOnly
    ? '<p class="why-note">This sequence doesn’t code for a protein of 30 or more amino acids, so tempo, drums and instrument come from the DNA bases alone.</p>'
    : '';
  ui.bioWhy.innerHTML = `<h3>Why it sounds like this</h3><ul>${items}</ul>${note}<p class="why-note">Similar sequences get similar sounds: each choice comes from a measurable property, compared with typical human genes.</p>`;
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
  ui.mapping.value = state.mappingId;
  ui.mappingSummary.textContent = mapping.summary;
  ui.vMapping.textContent = mapping.name;
  ui.frameField.hidden = !mapping.usesFrame;
  ui.vFrame.textContent = state.settings.frame === 'auto' ? 'Auto' : `Frame ${state.settings.frame + 1}`;
  ui.scale.disabled = state.settings.faithful;
  ui.beatAbout.textContent = BEATS.find((b) => b.id === state.beat)?.description ?? '';
  ui.drumLevelField.hidden = state.beat === 'off';
  ui.bioPanel.hidden = !state.showBiology;
  ui.bioMapping.textContent = mapping.biology;

  const seq = state.sequence;
  const seconds = (result.totalBeats * 60) / state.tempo;
  ui.seqMeta.textContent = `${state.name} · ${seq.length.toLocaleString()} bases · ${formatTime(seconds)} at ${state.tempo} BPM`;
  renderSignature();
  if (state.showBiology) renderWhy();

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
  setLookTime(now / 1000);
  const beat = engine.currentBeat();
  const ph = positionAt(result.events, beat, result.readingStart);
  const ev = ph.index >= 0 ? result.events[ph.index] : null;
  const spb = 60 / state.tempo;
  const sounding = engine.state === 'playing' && ev !== null && ev.midi !== null;
  const pulse = sounding ? Math.exp(-ph.sinceOnset * spb * 5) : 0;
  const hl: HelixHighlight | null = ev && engine.state !== 'stopped' ? { start: ev.start, length: ev.length, pulse } : null;

  if (view === 'helix') helix.render(ph.pos, hl, now / 1000);
  else if (view === 'protein') geneScene.render(ph.pos, hl, now / 1000);
  else towerScene.render(ph.pos, hl, now / 1000);
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
  // Library components are custom elements, so the event's target is the component, not its
  // inner control: any `ts-*` element keeps Space for itself.
  const t = e.target as HTMLElement;
  if (e.code !== 'Space' || t.tagName.startsWith('TS-') || t.closest('textarea, input, select, button, [role="slider"]'))
    return;
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
ui.fastaLoad.addEventListener('ts-press', () => loadText(ui.fastaInput.value, 'pasted text'));
ui.fastaFile.addEventListener('change', () => {
  const file = ui.fastaFile.files?.[0];
  if (file) loadFile(file);
  ui.fastaFile.value = '';
});
ui.record.addEventListener('change', () => {
  const r = state.records[Number(ui.record.value)];
  if (r) loadRecord(r, r.description ? `${r.id} ${r.description}` : r.id, r.id);
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
  state.tempo = ui.tempo.value;
  engine.setTempo(state.tempo);
  syncControls();
});
ui.instrument.addEventListener('change', () => {
  state.instrument = ui.instrument.value as InstrumentId;
  engine.setInstrument(state.instrument);
  syncControls();
});
ui.sigReset.addEventListener('ts-press', () => {
  applySignature();
  remap(true);
});
ui.beat.addEventListener('change', () => {
  state.beat = ui.beat.value as BeatId;
  updateDrums();
  syncControls();
});
ui.drumLevel.addEventListener('input', () => {
  state.drumLevel = ui.drumLevel.value / 100;
  ui.vDrumLevel.textContent = `${ui.drumLevel.value}%`;
  engine.setDrumLevel(state.drumLevel);
});

// ---------- Your own DNA ----------
ui.importToggle.addEventListener('ts-press', () => {
  const open = ui.importBox.hidden;
  ui.importBox.hidden = !open;
  ui.importToggle.setAttribute('aria-expanded', String(open));
  if (open) ui.fastaInput.focus();
});

// ---------- Settings panel: a list of rows; each row opens its own page ----------
function showSettingsPage(page: string | null) {
  ui.settingsList.hidden = page !== null;
  for (const p of ui.settings.querySelectorAll<HTMLElement>('.settings-page')) p.hidden = p.dataset.page !== page;
  const current = page ? ui.settings.querySelector<HTMLElement>(`.settings-page[data-page="${page}"]`) : null;
  ui.settingsTitle.textContent = current?.dataset.title ?? 'Settings';
  ui.settingsBack.hidden = page === null;
  const firstControl = current?.querySelector<HTMLElement>('ts-select, ts-slider, ts-segmented-control, select, input, button');
  (firstControl ?? (page ? ui.settingsBack : ui.settingsClose)).focus();
}
function openSettings() {
  ui.settings.hidden = false;
  ui.settingsBackdrop.hidden = false;
  document.body.classList.add('settings-open');
  showSettingsPage(null);
}
function closeSettings() {
  ui.settings.hidden = true;
  ui.settingsBackdrop.hidden = true;
  document.body.classList.remove('settings-open');
  ui.settingsOpen.focus();
}
ui.settingsOpen.addEventListener('click', openSettings);
ui.settingsClose.addEventListener('click', closeSettings);
ui.settingsBackdrop.addEventListener('click', closeSettings);
ui.settingsBack.addEventListener('click', () => {
  const from = ui.settings.querySelector<HTMLElement>('.settings-page:not([hidden])')?.dataset.page;
  showSettingsPage(null);
  ui.settingsList.querySelector<HTMLElement>(`.set-row[data-page="${from}"]`)?.focus();
});
for (const row of ui.settingsList.querySelectorAll<HTMLButtonElement>('button.set-row'))
  row.addEventListener('click', () => showSettingsPage(row.dataset.page!));
window.addEventListener('keydown', (e) => {
  // A component that used Escape itself (closing a select's list) prevents the default.
  if (e.key !== 'Escape' || e.defaultPrevented || ui.settings.hidden) return;
  if (!ui.settingsBack.hidden) ui.settingsBack.click();
  else closeSettings();
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

ui.viewSwitch.addEventListener('change', () => chooseView(ui.viewSwitch.value as ViewId));
ui.mapping.addEventListener('change', () => {
  state.mappingId = ui.mapping.value as MappingId;
  remap(true);
});

// ---------- Start ----------
loadSample(SAMPLES[0].id);
setView(view);
renderTransport();
requestAnimationFrame(frame);
