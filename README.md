# DNA Music Player

Play DNA as music while a 3D double helix scrolls and pulses in time. Everything runs locally in the browser; no sequence data is uploaded.

See [the design write-up](DNA%20Music%20Player%20App%20Design%20Write-up.md) for the full plan and [the changelog](CHANGELOG.md) for what's in each version. Current version: 0.2.0 (gene-to-protein view).

## Commands

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the core engine
npm run build      # typecheck + production build into dist/
```

## Layout

| Path | What it is |
|---|---|
| `src/core/` | Pure, unit-tested logic: FASTA parsing, genetic code, scales, mappings, playhead maths, sample genes |
| `src/core/mappings.ts` | The mapping engine. Each mapping is `(sequence, settings) → NoteEvent[]`; add new ones to `MAPPINGS` |
| `src/audio/` | Tone.js playback. The transport clock is the single source of time |
| `src/core/protein.ts` | Protein from the reading frame, Chou–Fasman-style secondary structure estimate, amino-acid property classes |
| `src/core/fold.ts` | Rough, deterministic fold: one bead per residue, ideal helices/strands, then a small simulation; records a trajectory |
| `src/visual/helix.ts` | Three.js helix: idealised B-DNA, instanced meshes, sliding window around the playhead |
| `src/visual/geneScene.ts` | Gene-to-protein scene: DNA → RNA polymerase → mRNA → ribosome → folding protein, all a function of the playhead |
| `src/ui/strip.ts` | Scrolling sequence strip with optional amino-acid row |
| `src/main.ts` | Wires state, controls, audio and visuals together |

## How sync works

Every `NoteEvent` stores the bases it came from (`start`, `length`). Each animation frame reads the audible transport beat, converts it to a base position with `positionAt()`, and gives that position to the helix and the strip. No timers or frame counters are used.
