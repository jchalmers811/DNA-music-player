import { AMINO_ACIDS } from '../core/genetics';
import type { MutationEffect } from '../core/mutations';

const aaName = (aa: string) => (aa === '*' ? 'Stop' : (AMINO_ACIDS[aa]?.three ?? '?'));
const codonHtml = (codon: string) => [...codon].map((b) => `<span class="b-${b}">${b}</span>`).join('');
const baseHtml = (b: string) => `<b class="b-${b}">${b}</b>`;

/**
 * One line saying what the latest click did, e.g. "Base 20: A → T · GAG → GTG · Glu → Val".
 * `from` is the original base and `to` the base it is now; equal means it is back to the original.
 */
export function mutationHtml(position: number, from: string, to: string, effect: MutationEffect): string {
  const where = `Base ${(position + 1).toLocaleString()}`;
  if (from === to) return `${where}: back to the original ${baseHtml(to)}`;
  const swap = `${where}: ${baseHtml(from)} → ${baseHtml(to)}`;
  if (effect.kind === 'outside') return `${swap} · not part of the protein`;
  const codons = `<code>${codonHtml(effect.codonBefore)}</code> → <code>${codonHtml(effect.codonAfter)}</code>`;
  const before = aaName(effect.aaBefore);
  const after = aaName(effect.aaAfter);
  switch (effect.kind) {
    case 'silent':
      return `${swap} · ${codons} · still ${after} <span class="tag">silent</span>`;
    case 'new-stop':
      return `${swap} · ${codons} · ${before} → Stop <span class="tag tag-stop">protein ends early</span>`;
    case 'stop-lost':
      return `${swap} · ${codons} · Stop → ${after} <span class="tag tag-stop">protein runs on</span>`;
    case 'start-lost':
      return `${swap} · ${codons} <span class="tag tag-stop">start codon lost</span>`;
    default:
      return `${swap} · ${codons} · ${before} → ${after}`;
  }
}
