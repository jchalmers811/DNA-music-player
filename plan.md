# Plan

What we're working on next, in order. The longer-term feature list is in section 9 of the [design write-up](DNA%20Music%20Player%20App%20Design%20Write-up.md).

## Done in 0.7.0 (not yet released): mutation playground

Change one base of the gene and hear and see what it does. Section 4.14 of the design write-up.

### Decided (16 November 2026)

- **Editing:** click a base and it changes to the next one; the fourth click brings back the original. Works on the letter strip and on the DNA in all three views. (First built as a popup offering the three other bases; changed to click-to-cycle the same day.)
- **Edit types:** swapping one base for another only. No inserting or deleting, so the length never changes and the original and mutated versions stay lined up.
- **Sound:** the key, scale, tempo, instrument and drums stay as the original gene chose them. Only the notes at the mutated spot change.
- **Comparing:** an Original / Mutated switch flips the song and the animation between the two, keeping your place.

### How it works for the viewer

1. Click a letter in the strip, or the DNA in the animation. The base changes to the next one in the cycle.
2. A line under the strip says what that did, e.g. `Base 20: A → T · GAG → GTG · Glu → Val`.
3. Playback restarts two codons before the change, so the new note is heard straight away.
4. Once there is at least one mutation, an **Original / Mutated** switch and a **Reset** button appear by the strip, with a count ("2 changes"). The switch can be used while playing.
5. On haemoglobin beta, a **Try the sickle-cell mutation** button makes the famous change (codon 7, GAG → GTG) and jumps to it.
6. Loading another gene clears the mutations. Your own FASTA works the same way; nothing leaves the device.

### How it is built

- **`src/core/mutations.ts`** (new, pure, unit-tested):
  - `applyMutations(original, mutations)` returns the mutated sequence. Mutations are a `Map<position, base>`; setting a base back to the original removes the entry.
  - `describeMutation(original, frameStart, position, base)` returns the codon and amino acid before and after, and the kind: silent, changed amino acid, new stop, lost stop, lost start, or outside the protein.
- **`src/main.ts`:** state has `original` (the sequence as loaded), `mutations` and `showing: 'original' | 'mutated'`. `state.sequence` stays "what is playing now", so the views, strip, drums and biology panel need no changes: they already follow `remap()`.
  - `applySignature()` reads `state.original`, and is not called on an edit, so any settings the viewer changed survive.
  - An edit calls `remap(true)`, which already keeps the playhead by base position.
- **`src/ui/strip.ts`:** one click handler on the track finds the clicked base and reports it. `nextBase` in `mutations.ts` gives the next base in the cycle; `src/ui/mutationText.ts` writes the line saying what changed.
- **Clicking the DNA in the views:** `BasePicker` in `src/visual/sceneUtils.ts`. Each scene tells it where its base pairs are each frame; a click (not a drag) in line with a base pair picks it. In the double helix view anywhere in line counts; in the other two views the click must be near the DNA, so clicks on the mRNA, ribosome or protein do nothing. A double-click on the DNA no longer resets the zoom.
- **Protein views:** the mutated protein is folded again by the existing `foldProtein` (cached per protein, as now).

### What the checks found

- **The fold did jump**, because each protein's random starting chain was seeded from its own letters. A mutant is now seeded from its original (`seedFrom` in `foldProtein`), which cut the shape difference for sickle-cell from about 4.5 Å to 1.3 Å. A test covers it.
- **Losing the start codon** moves the reading frame to the next ATG (frame on Auto); the line under the strip says "start codon lost".
- **Tapping:** a tap pauses playback, and each letter has a taller invisible tap area for fingers. Not yet tried on a real phone.
- **Keyboard:** the strip can be focused, and Enter mutates the base at the playhead.
- **Mutated letters are underlined** in the strip (added during the build).

### Not in this version

- Inserting and deleting bases (frameshifts).
- Automatically replaying the changed spot, original then mutated.
- A separate plain-words explanation beyond the one line under the strip.
- Marking mutated bases on the 3D views and the protein.
- Keeping mutations after a reload, or sharing them by link.

## Done (released in 0.5.0)

### 3D scene: a third view

The orbiting tower is now a third view, **3D scene**, next to the double helix and gene → protein. Code: [src/visual/towerScene.ts](src/visual/towerScene.ts).

- Current look (the defaults in `DEFAULT_TOWER_OPTIONS`): wiggly supercoiled DNA, **prism** ribosome, protein **grows up** (textbook orientation), **camera orbits**, **plain** building blocks, **dark ceiling** and **glowing floor** on.
- Looks are options, not hard-coded: `TowerOptions` holds them and `TowerScene.setOptions()` changes them at runtime. Ribosome looks and building-block effects are lists in [src/visual/towerLooks.ts](src/visual/towerLooks.ts), so adding one is one new entry. So far: ribosomes simple, ghost, prism; blocks off, plain. There are no controls for viewers yet.
- The protein uses the same code as the gene → protein view ([src/visual/proteinChain.ts](src/visual/proteinChain.ts)): the real fold estimate, tube and property colours, released after the stop codon.
- Still to port from the prototypes if wanted: cartoon, glass, hologram, cloud and aurora ribosomes; sparks, comet trails and fireflies; the "DNA spins, ribosome still" motion is already supported (`motion: 'spin'`).

Prototypes, kept for reference:

- [prototypes/tower-lab-2.html](prototypes/tower-lab-2.html): the lab the 3D scene came from (dark ceiling, eight ribosome looks, block effects, motion, protein direction)
- [prototypes/tower-lab.html](prototypes/tower-lab.html): first lab, with a black hole at the top and realistic or stylised ribosomes (not liked)
- [prototypes/gene-scenes.html](prototypes/gene-scenes.html): six compositions (flat diagram, DNA out of the screen, diagonal dive, protein into the camera, ribosome's-eye view, orbiting tower)
- [prototypes/orbiting-tower.html](prototypes/orbiting-tower.html): tower variations (straight, wiggly, supercoiled, beads on a string, the blends) and ready-made combinations

### UI redesign: layout A with the settings list

Chosen from the [layout mockups](https://claude.ai/artifact/5XHSNQE23pisQWxWBn4Nnt): **A · Slim sidebar** with **Panel 1 · Settings list**.

- **Always visible:** the animation with play/pause and progress; a slim sidebar with the gene picker and its description, "Use your own DNA (FASTA)", a one-line summary of the gene's sound, and "More settings".
- **Settings list:** grouped rows showing their current value; each opens its own page with a back button.
  - *The gene's sound:* key and scale, tempo, instrument, drums, drum volume, faithful mode (switch). Changed rows are marked, with "Back to the gene's sound".
  - *Reading the DNA:* mapping, reading frame.
  - *Display:* Show the biology (switch). The view picker moved to its own sidebar card in 0.6.0.
- **Phone:** the sidebar stacks under the animation; settings open as a sheet from the bottom.

## Open items

- **No-ATG protein view:** with no start codon (and the frame on Auto), the ribosome currently translates from base 1. It should stay idle with a "no start codon, no protein" message, and the yellow note should move so it doesn't cover the DNA. Try it with the telomere sample. Applies to both protein views.
- **Repo visibility:** kept public for now so the GitHub Pages site stays up.
