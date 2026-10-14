// test_national_gaps.mjs - checks lib.mjs on a tiny made-up feed zipped in memory.
// Run: node tools/test_national_gaps.mjs (uses the app's ../gtfs.js).
// MV2 of Munim, Inc. - Apache-2.0 license.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyseFeed, feedRow, stopRows, toCsv, skipReason, FEED_COLUMNS, STOP_COLUMNS } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// gtfs.js is an ES module without a package.json beside it, so load a .mjs copy.
const copy = join(tmpdir(), 'kaerimichi-gtfs-test.mjs');
writeFileSync(copy, readFileSync(join(HERE, '..', 'gtfs.js'), 'utf8'));
const g = await import(pathToFileURL(copy).href);

// A stored (uncompressed) zip: enough for gtfs.js's reader, which skips CRC checks.
function zip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), d = enc.encode(text);
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
    lv.setUint32(18, d.length, true); lv.setUint32(22, d.length, true); lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const cd = new Uint8Array(46 + n.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(20, d.length, true); cv.setUint32(24, d.length, true); cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    cd.set(n, 46);
    parts.push(local, d);
    central.push(cd);
    offset += local.length + d.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const all = new Uint8Array(offset + size + 22);
  let p = 0;
  for (const x of [...parts, ...central, end]) { all.set(x, p); p += x.length; }
  return all.buffer;
}

// H (中央病院) is the busiest hospital stop, K (東クリニック) the other one.
// A: there and back (also on Saturday); B: the last bus back leaves before you arrive; C: no bus back;
// D: never reaches a hospital; F: no trips at all.
const STOPS = { H: '中央病院', K: '東クリニック', A: 'Aoba', B: 'Bashi', C: 'Chuo', D: 'Daimon', E: 'Eki', F: 'Fuchi' };
const TRIPS = {
  T1: ['ALL', [['A', '8:00'], ['H', '8:30']]],
  T2: ['ALL', [['H', '12:00'], ['A', '12:30']]],
  T3: ['WK', [['C', '9:00'], ['H', '9:30']]],
  T4: ['WK', [['B', '17:00'], ['H', '17:30']]],
  T5: ['WK', [['H', '16:00'], ['B', '16:30']]],
  T6: ['WK', [['K', '10:00'], ['A', '10:20']]],
  T7: ['WK', [['D', '7:00'], ['E', '7:30']]],
};
function feed(names) {
  let stops = 'stop_id,stop_name,stop_lat,stop_lon\n';
  Object.entries(names).forEach(([id, name], k) => { stops += `${id},${name},${36 + k * 0.01},${140 + k * 0.01}\n`; });
  let trips = 'route_id,service_id,trip_id\n';
  let times = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n';
  for (const [id, [service, calls]] of Object.entries(TRIPS)) {
    trips += `R,${service},${id}\n`;
    calls.forEach(([stop, hm], k) => { times += `${id},${hm}:00,${hm}:00,${stop},${k + 1}\n`; });
  }
  return zip({
    'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\nX,Test Bus,https://example.org/,Asia/Tokyo\n',
    'stops.txt': stops,
    'routes.txt': 'route_id,route_short_name,route_type\nR,1,3\n',
    'trips.txt': trips,
    'stop_times.txt': times,
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n'
      + 'WK,1,1,1,1,1,0,0,20260101,20271231\nALL,1,1,1,1,1,1,0,20260101,20271231\n',
  });
}

const dates = { date: '2026-10-21', sat: '2026-10-24' };
const r = await analyseFeed(g, feed(STOPS), dates);
assert.ok(!r.skip, JSON.stringify(r));
assert.deepEqual(r.hubs.map(h => h.name), ['中央病院', '東クリニック']);
const by = Object.fromEntries(r.stops.map(s => [s.key, s]));
assert.deepEqual(Object.fromEntries(r.stops.map(s => [s.key, s.status])),
  { H: 'hub', K: 'hub', A: 'ok', B: 'noreturn', C: 'oneway', D: 'none', E: 'idle', F: 'idle' });
assert.equal(by.A.statusSat, 'ok');
assert.equal(by.C.statusSat, 'idle'); // no Saturday departures at C
assert.equal(by.A.arrive, '8:30');
assert.equal(by.A.lastBack, '12:00');
assert.equal(by.A.maxStayMin, 210);
assert.equal(by.A.hub, '中央病院');
assert.equal(by.B.arrive, '17:30');
assert.equal(by.B.lastBack, '16:00');
assert.equal(by.B.maxStayMin, '');
assert.equal(by.D.hub, '');
// Base: A, B, C, D (stops with a weekday departure, hospitals excluded); round trip: A.
assert.equal(r.base, 4);
assert.equal(r.roundTrip, 1);
assert.equal(r.share, 0.25);
assert.equal(r.roundTripSat, 1);
assert.equal(r.shareSat, 0.25);
assert.equal(r.tripsWed, 7);
assert.equal(r.tripsSat, 2);
assert.equal(r.counts.hub, 2);
assert.equal(r.counts.idle, 2);

// Skips.
assert.equal((await analyseFeed(g, feed(STOPS), { date: '2026-10-25', sat: '2026-10-24' })).skip, 'no_service');
const plain = { ...STOPS, H: 'Hiroba', K: 'Kita' };
assert.equal((await analyseFeed(g, feed(plain), dates)).skip, 'no_hospital_stop');
assert.equal(skipReason({ discontinued: true, end: '', license: 'CC BY 4.0' }, '20261021'), 'discontinued');
assert.equal(skipReason({ discontinued: false, end: '2026-10-20', license: 'CC BY 4.0' }, '20261021'), 'ended');
assert.equal(skipReason({ discontinued: false, end: '2027-03-31', license: 'All rights reserved' }, '20261021'), 'license');
assert.equal(skipReason({ discontinued: false, end: '2027-03-31', license: 'CC0 1.0' }, '20261021'), null);
assert.equal(skipReason({ discontinued: false, end: '', license: 'PDL1.0' }, '20261021'), null);

// Rows and CSV.
const f = { org: 'testorg', feed: 'test-bus', orgName: 'テスト町', feedName: 'テストバス', pref: 6, license: 'CC BY 4.0' };
const row = feedRow(f, r, dates.date);
assert.deepEqual(Object.keys(row).sort(), FEED_COLUMNS.slice().sort());
assert.equal(row.hubs, '中央病院／東クリニック');
assert.equal(row.app_url, 'https://munimv2.github.io/kaerimichi/?feed=testorg%2Ftest-bus&date=2026-10-21&to=H&map=gap');
const csv = toCsv(STOP_COLUMNS, stopRows(f, r));
assert.equal(csv.charCodeAt(0), 0xfeff);
const lines = csv.slice(1).trim().split('\r\n');
assert.equal(lines[0], STOP_COLUMNS.join(','));
assert.equal(lines.length, 1 + 8);
assert.ok(lines.includes('testorg,test-bus,A,Aoba,36.020000,140.020000,ok,ok,中央病院,8:30,12:00,210'), lines.join('\n'));
assert.equal(toCsv(['a'], [{ a: 'x,"y"' }]).slice(1), 'a\r\n"x,""y"""\r\n');

console.log('national lib ok');
