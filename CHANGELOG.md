# Changelog

## 0.2.0: Gene to protein

- New **Gene → protein** view, alongside the double helix. DNA unzips inside RNA polymerase, mRNA flows to the ribosome, and the ribosome reads one codon per note while the protein chain grows. At the stop codon the chain is released and settles into its folded shape, which you can drag to turn.
- Rough fold estimate for any sequence: a simplified Chou–Fasman guess at helices and strands, then a small simulation that packs water-avoiding amino acids into a core. It is illustrative, not a prediction, and the app says so.
- Protein coloured by amino-acid property (water-avoiding, water-loving, positive and negative charge), with a legend.
- "Show the biology" adds the estimated share of helix, strand and loop.
- When a piece finishes it now stays at the end, so the folded protein stays on screen. Press Play to start again.
- The app's version number is shown next to the title.

## 0.1.x: MVP

- FASTA import (paste, open or drop a file) and three built-in sample genes.
- Amino acid, codon and base mappings; key, scale, faithful mode, tempo and four instruments.
- 3D double helix and scrolling sequence strip, synced to playback.
- Fixes: playback keeps going when switching genes; the play button always matches playback; the first play no longer freezes or plays silently.
