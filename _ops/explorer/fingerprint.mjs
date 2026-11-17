// Per-festival md5 of the page's lineup rows, in the same canonical form as
// the SQL in drift-report.md: artist_lower|night|stage|start|end|hl, sorted
// (byte order), newline-joined. Used to find which pages already match the DB.
import { createHash } from 'node:crypto';
import { festivalFiles, readPage, pageRows } from './pages.mjs';
export const canon = r => [r.artist_lower, r.night || '', r.stage || '', r.start || '', r.end || '', r.hl ? '1' : '0'].join('|');
const byte = (a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b)));
export function fingerprints() {
  const out = {};
  for (const { slug, file } of festivalFiles()) {
    const lines = pageRows(readPage(file)).map(canon).sort(byte);
    out[slug] = { n: lines.length, md5: createHash('md5').update(lines.join('\n')).digest('hex') };
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(fingerprints()));
