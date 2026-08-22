// Re-encode the scraped Squarespace media for the web: cap the long edge at
// 2000px and compress. Filenames and extensions are kept, so nothing that
// references an image needs to change. Animated GIFs are copied untouched.
import { readdir, mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SRC = process.argv[2];
const OUT = process.argv[3];
const MAX = 2000;

await mkdir(OUT, { recursive: true });
const files = await readdir(SRC);
let before = 0, after = 0, done = 0, copied = 0;

async function one(name) {
  const from = path.join(SRC, name);
  const to = path.join(OUT, name);
  const src = await stat(from);
  before += src.size;
  const ext = path.extname(name).toLowerCase();

  if (ext === '.gif') {                    // animated — re-encoding would break it
    await copyFile(from, to);
    after += src.size; copied++;
    return;
  }
  try {
    const img = sharp(from, { failOn: 'none' });
    const meta = await img.metadata();
    const pipe = meta.width > MAX || meta.height > MAX
      ? img.resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
      : img;
    if (ext === '.png') await pipe.png({ compressionLevel: 9, palette: true }).toFile(to);
    else await pipe.jpeg({ quality: 82, mozjpeg: true, progressive: true }).toFile(to);
    after += (await stat(to)).size;
  } catch (e) {
    await copyFile(from, to);              // anything sharp can't read passes through
    after += src.size; copied++;
  }
  if (++done % 100 === 0) console.log(`${done}/${files.length}`);
}

const queue = files.slice();
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) await one(queue.shift());
}));

const mb = n => (n / 1048576).toFixed(1) + ' MB';
console.log(`\n${files.length} files | ${mb(before)} -> ${mb(after)} (${(100 - after / before * 100).toFixed(0)}% smaller), ${copied} copied as-is`);
