# Plan

What we're working on next, in order. The longer-term feature list is in section 9 of the [design write-up](DNA%20Music%20Player%20App%20Design%20Write-up.md).

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
  - *Display:* view (gene → protein, 3D scene, double helix), Show the biology (switch).
- **Phone:** the sidebar stacks under the animation; settings open as a sheet from the bottom.

## Open items

- **No-ATG protein view:** with no start codon (and the frame on Auto), the ribosome currently translates from base 1. It should stay idle with a "no start codon, no protein" message, and the yellow note should move so it doesn't cover the DNA. Try it with the telomere sample. Applies to both protein views.
- **Repo visibility:** kept public for now so the GitHub Pages site stays up.
