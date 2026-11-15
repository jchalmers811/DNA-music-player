# Changelog

## 0.6.0: Easier views, DNA that keeps flowing, and zoom

- The view picker (Gene → protein, 3D scene, Double helix) is back in the sidebar as its own card, instead of being tucked away in More settings.
- The DNA no longer runs out before the music ends. A gene is part of a longer chromosome, so the gene → protein and 3D scene views now show the DNA on either side of the gene in grey, flowing through the RNA polymerase for the whole song. The mRNA ends at the gene's last base and slides on into the ribosome while the last notes play.
- Zoom in and out of any view with the scroll wheel, a trackpad pinch or a two-finger pinch on a phone. Double-click or double-tap to go back to the default framing.

## 0.5.0: 3D scene and a simpler layout

- New **3D scene** view: the gene-to-protein story as a tower. The DNA stands upright as a wiggly supercoil and feeds up through the RNA polymerase, the mRNA spirals down to an iridescent ribosome, and the protein grows upwards and folds, using the same fold estimate as the gene → protein view. A glowing floor, a dark ceiling and drifting building blocks complete it, and the camera slowly circles. Drag to look around.
- Simpler layout: a slim sidebar with the gene, "Use your own DNA" and a one-line summary of the gene's sound. Everything else is under **More settings**, a list of settings that each open on their own page (a sheet from the bottom on phones). The view switch has moved there too.

## 0.4.0: Every gene has its own sound

- Each sequence now chooses its own key, scale, instrument, drum beat and tempo, so every gene has a sound of its own. Load the same sequence again and you hear the same sound.
- Similar sequences sound similar. The choices come from properties of the DNA and its protein, not a checksum: GC content sets how bright the scale is, the balance of G and C sets the key, charged amino acids set the tempo, water-avoiding ones make the drums heavier, and the protein's estimated shape picks the instrument. A one-base change, like the sickle-cell mutation, barely changes the sound.
- Each choice is compared with 795 real human genes, so genes spread evenly across every key, scale, instrument, beat and tempo instead of bunching up.
- Sequences without a real protein (no ATG, or under 30 amino acids) use properties of the DNA bases alone.
- Four new drum beats: **Boom bap** (90s hip-hop with swung hi-hats), **Dembow** (the reggaeton 3-3-2 rhythm), **Drum and bass** (a double-speed two-step) and **Tom groove** (rolling toms tuned to the key). Each has its own intro and outro fill. The "808 trap (slices)" beat has been removed; the plain 808 trap beat stays.
- A new sound card shows the gene's sound. **Make it your own** opens the controls; anything you change is highlighted and overrides the gene's sound, and **Back to the gene's sound** undoes it. Loading a sequence always starts from its own sound.
- "Show the biology" explains why the gene sounds the way it does.
- Seven more sample genes, from NCBI RefSeq: haemoglobin alpha, myoglobin, p53, lysozyme, the SARS-CoV-2 spike protein, and **human and mouse cytochrome c**. The cytochrome c pair is 91% identical, and they sound almost the same, which shows similar sequences getting similar sounds.
- The protein view's note now says you can drag to turn the protein once it is complete.

## 0.3.0: Percussion and modes

- All seven modes in the Scale menu: Ionian (major), Dorian, Phrygian, Lydian, Mixolydian, Aeolian (natural minor) and Locrian.
- Percussion with a drum volume slider and a choice of beats: Steady (the default), Backbeat, Half-time, Breakbeat, Shuffle, **808 trap** (booming 808 tuned to the key, clap on 3, hi-hat rolls), **808 trap (slices)** (adds occasional stuttering hi-hat bursts that sweep in tone) and **From the sequence**, where the amino acids or bases play the drums. Choose Off for none. All drums are synthesised; nothing is downloaded.
- Every beat opens with its own intro fill and closes with its own outro fill and a final crash, using toms tuned to the key. In "From the sequence", the fills play the gene's first and last bases on the toms.

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
