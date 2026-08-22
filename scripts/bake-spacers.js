// Apply measured live spacer heights (captured at 1280px) to the content JSONs.
// Height scales with width as a percentage, matching Squarespace's behaviour.
// Usage: node bake-spacers.js <content-dir>
const fs = require('fs');
const path = require('path');
const live = require('./live-spacers-1280.json');
const DIR = process.argv[2];
let patched = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === '_index.json') continue;
  const slug = f.replace(/\.json$/, '');
  const measured = live[slug];
  if (!measured) continue;
  const page = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const spacers = [];
  const walk = b => { for (const x of b) { if (x.type === 'spacer' && !x.placeholder) spacers.push(x); if (x.cols) x.cols.forEach(c => walk(c.content)); } };
  for (const s of page.sections) walk(s.blocks);
  const n = Math.min(spacers.length, measured.length);
  for (let i = 0; i < n; i++) {
    const m = measured[i];
    if (m.sized && Math.abs(m.h - 68) <= 3) { spacers[i].ar = null; continue; }
    if (m.sized && Math.abs(m.h - 51) <= 3) { spacers[i].ar = null; continue; } // first-block, pad-top removed
    spacers[i].ar = Number((Math.max(0, m.h - 34) / Math.max(1, m.w - 34) * 100).toFixed(3));
    patched++;
  }
  fs.writeFileSync(path.join(DIR, f), JSON.stringify(page, null, 1));
}
console.log('baked', patched, 'spacer heights');
