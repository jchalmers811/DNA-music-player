export interface FastaRecord {
  id: string;
  description: string;
  sequence: string;
}

export interface FastaParseResult {
  records: FastaRecord[];
  warnings: string[];
}

const AMBIGUOUS = new Set('RYKMSWBDHV');

/**
 * Parse FASTA text (or a bare sequence with no header) into cleaned DNA records.
 * - Case-insensitive; RNA U becomes T.
 * - IUPAC ambiguity codes become N.
 * - Whitespace, digits, gaps (-, .) and trailing '*' are dropped silently.
 * - Any other character is dropped with a warning.
 * Throws if no sequence data is found.
 */
export function parseFasta(text: string): FastaParseResult {
  const records: FastaRecord[] = [];
  const warnings: string[] = [];
  let current: { header: string; parts: string[] } | null = null;
  let invalid = 0;
  let ambiguous = 0;

  const finish = () => {
    if (!current) return;
    const sequence = current.parts.join('');
    const header = current.header.trim();
    const space = header.search(/\s/);
    const id = header === '' ? `sequence ${records.length + 1}` : space < 0 ? header : header.slice(0, space);
    const description = space < 0 ? '' : header.slice(space + 1).trim();
    if (sequence.length > 0) records.push({ id, description, sequence });
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith(';')) continue;
    if (line.startsWith('>')) {
      finish();
      current = { header: line.slice(1), parts: [] };
      continue;
    }
    if (!current) current = { header: '', parts: [] };
    let clean = '';
    for (const ch of line.toUpperCase()) {
      if (ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T' || ch === 'N') clean += ch;
      else if (ch === 'U') clean += 'T';
      else if (AMBIGUOUS.has(ch)) {
        clean += 'N';
        ambiguous++;
      } else if (/[\s\d\-.*]/.test(ch)) continue;
      else invalid++;
    }
    current.parts.push(clean);
  }
  finish();

  if (records.length === 0) throw new Error('No DNA sequence found. Paste FASTA text or plain A/C/G/T letters.');
  if (ambiguous > 0) warnings.push(`${ambiguous.toLocaleString()} ambiguous base code(s) treated as N (played as rests).`);
  if (invalid > 0)
    warnings.push(
      `${invalid.toLocaleString()} non-DNA character(s) were ignored. If this is a protein sequence, paste the DNA instead.`,
    );
  return { records, warnings };
}
