// feed_worker.mjs - analyses one downloaded feed in its own process, so a huge feed can be stopped
// at the time limit without stopping the national run.
// Usage: node feed_worker.mjs <gtfs module> <feed.zip> <date> <saturday> <result.json>
// MV2 of Munim, Inc. - Apache-2.0 license.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { analyseFeed } from './lib.mjs';

const [gtfsPath, zipPath, date, sat, outPath] = process.argv.slice(2);
const g = await import(pathToFileURL(gtfsPath).href);
const b = readFileSync(zipPath);
const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
let result;
try {
  result = await analyseFeed(g, buf, { date, sat });
} catch (e) {
  result = { skip: 'error', detail: String((e && e.message) || e).slice(0, 200) };
}
writeFileSync(outPath, JSON.stringify(result));
