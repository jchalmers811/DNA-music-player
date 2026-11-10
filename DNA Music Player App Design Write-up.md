# DNA Music Player: App Design Write-up

*Draft design document · 9 November 2026*

## 1. The idea

An app that lets you import DNA files and play them as music, while a 3D double helix scrolls and pulses in time with the sound. You pick a gene, a chromosome region, or a set of variants from your own data, choose how the sequence is turned into notes, and then listen and watch.

DNA is a four-letter alphabet with no built-in pitch or rhythm, so the whole product is a set of **mapping choices** between biology and music. The app treats those mappings as swappable "instruments" rather than hardcoding one.

## 2. Has this been done before?

Yes, the space is established but fragmented. Existing work includes:

- **dnasonification.org** (Mark Temple, Western Sydney University): a browser tool that plays pasted or uploaded sequences, with base, dinucleotide, codon and three-reading-frame modes.
- **BioMus**: converts Ensembl gene sequences to MIDI piano chords, aimed partly at visually impaired users.
- **Takahashi and Miller (UCLA)**: amino-acid sequences turned into chords.
- **Rhapsody of Genetics**: an art-science project with a web-based genetic music browser and a large palette of pitches, instruments and rhythms.
- **dna2music, ProteinMusic, Sonic Pi scripts**: command-line and desktop tools for FASTA-to-MIDI.
- **Prelude in ACGT**: an art piece built from one person's own DNA.

Most of these are research prototypes, scripts or one-off artworks with a single mapping. A gap remains for a polished, general-purpose app that combines consumer raw-data import, swappable mappings, local-only processing, a synced 3D visual, comparison mode and MIDI export.

## 3. Inputs

| Format | Source | Notes |
|---|---|---|
| FASTA | Reference or gene sequences | Easiest; build this first |
| GenBank / GFF | Annotated sequences | Provides genes, exons and CDS for biology-driven mapping |
| VCF | Variant calls | Sparse events; good for rhythm |
| 23andMe / Ancestry raw TXT | Consumer tests | Tab-separated SNP lists |
| FASTQ / BAM | Raw reads | Large; defer to later |

Start with FASTA plus consumer raw data. Together they cover "paste a gene" and "import my own DNA".

## 4. Sonification methods

These are the mapping strategies the app should offer. Each is a pure function from sequence and settings to a list of note events, so they can be tested and swapped independently.

### 4.1 Base to note (4 notes)

Each of A, C, G and T maps to one note, usually degrees of a pentatonic scale. It is the simplest mode and gives a four-tone landscape. It tends to sound random unless the scale is constrained.

### 4.2 Dinucleotide to note (16 notes)

Read the sequence in pairs, giving 16 possible combinations, each mapped to a pitch. More variety than single bases, still easy to follow by ear.

### 4.3 Codon to note (64 notes)

Read triplets, giving 64 codons mapped across two to three octaves of a chosen scale. This reflects the real unit of the genetic code.

### 4.4 Degenerate codon to note (20 notes)

Collapse the 64 codons to the 20 amino acids they encode and map each amino acid to a pitch. Synonymous codons land on the same note, which creates natural repetition and makes the output more melodic.

### 4.5 Three reading frames in parallel

Parse the sequence as codons in all three reading frames at once, producing three concurrent audio streams (often arpeggios). Start and stop codons can switch each frame's audio on and off independently. Temple's work found this the most informative mode for hearing sequence structure.

### 4.6 Two reading frames from dinucleotides

A lighter variant of the above: parse nucleotide pairs as two separate frames, giving two concurrent streams.

### 4.7 Amino-acid pair chords

Map pairs of amino acids to chords rather than single notes (the approach used by Takahashi and Miller). Pairing adds harmony and rhythm while staying fully determined by the protein sequence.

### 4.8 Biology-driven mapping

Use real sequence structure to shape the music:

- GC content controls tempo or brightness
- Exons, introns and UTRs switch instruments or registers
- Start and stop codons mark phrase boundaries
- Reading frame sets harmony
- Annotated gene features from GenBank or GFF drive sections of the piece

### 4.9 Music-theory hierarchical mapping

Read the DNA in layers: one stretch sets the frame (key, mode, tempo), another the phrase structure, another the specific melody. This keeps the output inside music theory (major or minor tonalities, for example) so it sounds composed rather than random, while still varying between sequences.

### 4.10 Protein-property mapping

Map physical properties of each amino acid to timbre and dynamics, with the residue setting pitch. Hydrophobicity might control brightness, charge might control stereo position or filter, and size might control note length.

### 4.11 Variant-driven mapping (SNP and VCF files)

Each variant becomes a musical event. Chromosome position sets timing, heterozygous versus homozygous calls change velocity or add a harmony note, and variant type can select the instrument. Sparse data produces rhythm rather than melody.

### 4.12 Window summarisation (genome-scale)

For very long sequences, summarise fixed windows (for example GC content per 1 kb) into one note each, or sample every Nth base. This turns a chromosome into a playable piece instead of hours of audio.

### 4.13 Comparison mode

Play two sequences in parallel, such as the same gene from two species. Matching bases are consonant and mismatches are dissonant, so conservation and difference become audible.

### 4.14 Mutation playground

Let the user edit a base and hear the change immediately, for example a point mutation in a codon, to build intuition about what changes and what doesn't.

### Making it sound like music

Across all modes, quantise to a chosen scale and key, fix a time signature, and let the user pick the scale (minor pentatonic, Dorian and so on). Constraints are what turn a stream of data into something listenable. Offer MIDI export so results can be taken into a DAW.

## 5. The 3D double helix visual

A 3D double helix that plays along with the music is a strong centrepiece, and it is reasonably easy to build.

### Geometry

Generate an idealised B-DNA helix procedurally from the sequence, since the data has no real 3D coordinates:

- About 10.5 base pairs per turn (roughly 34 degrees of twist per pair)
- About 0.34 nm rise per base pair
- About 1 nm backbone radius
- Second strand offset by roughly 140 degrees, giving visible major and minor grooves

For each base, compute the angle and height, place a backbone sphere on each strand, and join them with a rung. The complementary base is determined by pairing (A with T, C with G).

### Rendering

- Use Three.js with instanced meshes for backbone spheres and rungs, so thousands of bases render in a few draw calls
- Colour each base (four colours), with rungs split into two half-colours
- Render only a window of a few hundred bases around the playhead and recycle instances as it slides, so long sequences stay smooth
- Optional polish: emissive glow, bloom, a tube-geometry backbone

### Sync with the audio

- Each note event keeps the index of the base or codon it came from
- Drive visuals from the audio clock (the transport time), read every animation frame, never from timers or frame counts
- Scroll the helix along its axis so the playing base stays at a fixed point, or move the camera along the axis
- Pulse the active base pair when its note fires; in codon modes, highlight all three bases of the triplet

### Biology-aware visuals

- Tint stretches by reading frame and flag start and stop codons
- Mark variant positions with a distinct glow in SNP and VCF modes
- In comparison mode, show two helices side by side and colour mismatches to match the dissonance heard

### Caveats

- An idealised helix is a diagram, not a measured structure; a short note in the UI should say so
- Cap the visible window and instance count on mobile
- Keep the helix renderer independent of audio: it takes the sequence, a playhead position and a set of highlights

## 6. Architecture

Everything can run in the browser:

- **Parsing:** streaming parsers in a Web Worker so large files do not freeze the interface
- **Mapping engine:** pure functions that turn sequence and configuration into note events; the core of the app and easy to unit-test
- **Audio:** Tone.js or raw Web Audio for synthesis and scheduling; MIDI export through a library such as @tonejs/midi
- **Visuals:** Three.js (or react-three-fiber if using React) for the helix, plus a sequence strip and piano-roll view synced to the playhead
- **State:** a single playhead position shared by audio and visuals

### Handling scale

A human genome is about 3 billion bases. To keep playback practical:

- Let users choose a gene, chromosome or position range
- Use window summarisation or sampling for long regions
- Generate note events lazily, in chunks just ahead of the playhead

## 7. Privacy

Genetic data is among the most sensitive data a person has. Processing everything locally, with no upload and no server storage, simplifies the architecture and is a strong selling point. State it prominently in the interface. Shareable links should carry settings and gene identifiers only, never personal data.

## 8. Roadmap

**MVP**

- FASTA import
- Base, codon and degenerate-codon mappings
- Scale, key, tempo and instrument controls
- Play and pause with a scrolling sequence view
- Basic 3D helix synced to playback

**Version 2**

- Consumer raw-data and VCF import with an overview mode
- Three-reading-frame, biology-driven and variant-driven mappings
- Pulse and codon highlighting on the helix
- MIDI and WAV export

**Version 3**

- Comparison mode with two parallel sequences and side-by-side helices
- Mutation playground
- Protein-property and chord-based mappings
- Shareable settings links and extra visualisers such as a circular genome view

## 9. Open decisions

1. **Audience:** a general-audience curiosity and art toy, or an educational tool for students? This decides how much biology to surface.
2. **Primary input:** the user's own consumer DNA data, or reference genes? The first is more personal; the second is simpler and safer for demos.
3. **Platform:** web first for easy sharing, or mobile for a "play my genome" experience?
4. **Sound design:** how much to favour pleasant, constrained music versus faithful, unconstrained sonification?

## 10. Suggested next step

Build a small prototype: paste a FASTA sequence, choose from three mappings, and watch a Three.js helix scroll and pulse in sync with Web Audio playback. That quickly shows which mappings sound good and whether the visual works.
