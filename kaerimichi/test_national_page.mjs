// test_national_page.mjs - checks national.js on CSVs written by the national tools' own writer (tools/lib.mjs),
// so the page reads exactly the columns the analysis writes. Run from a folder with package.json {"type": "module"}
// (test_national.py does this).
// MV2 of Munim, Inc. - Apache-2.0 license.
import assert from 'node:assert/strict';
import { rows, pct, num, sortRows, leadHtml, prefTableHtml, feedTableHtml, popupHtml, onMap, TEXT, STATUSES, COLOURS } from './national.js';
import { toCsv, FEED_COLUMNS, PREF_COLUMNS, STOP_COLUMNS, STATUSES as TOOL_STATUSES } from './tools/lib.mjs';

assert.deepEqual(STATUSES.slice().sort(), TOOL_STATUSES.slice().sort());
for (const s of STATUSES) assert.ok(COLOURS[s], 'no colour for ' + s);

// Both languages have the same keys, statuses and columns.
assert.deepEqual(Object.keys(TEXT.ja).sort(), Object.keys(TEXT.en).sort());
for (const k of ['status', 'cols']) assert.deepEqual(Object.keys(TEXT.ja[k]).sort(), Object.keys(TEXT.en[k]).sort());
for (const s of STATUSES) assert.ok(TEXT.ja.status[s] && TEXT.en.status[s], 'no label for ' + s);
assert.equal(TEXT.ja.method.length, TEXT.en.method.length);

assert.equal(pct(0.253), '25.3%');
assert.equal(pct(null), '–');
assert.equal(num(12345), '12,345');

const prefs = rows(toCsv(PREF_COLUMNS, [
  { pref_id: 6, pref_name: '山形県', feeds_analysed: 2, places_with_departures: 200, round_trip: 50, share: 0.25, round_trip_sat: 10, share_sat: 0.05 },
  { pref_id: 13, pref_name: '東京都', feeds_analysed: 1, places_with_departures: 100, round_trip: 80, share: 0.8, round_trip_sat: 70, share_sat: 0.7 },
  { pref_id: 0, pref_name: 'その他・広域', feeds_analysed: 1, places_with_departures: 0, round_trip: 0, share: '', round_trip_sat: 0, share_sat: '' },
]));
assert.equal(prefs.length, 3);
assert.equal(prefs[0].share, 0.25);
assert.equal(prefs[0].pref_name, '山形県');
assert.equal(prefs[2].share, null);
assert.deepEqual(sortRows(prefs, 'share', true).map(p => p.pref_id), [13, 6, 0]);
assert.deepEqual(sortRows(prefs, 'share', false).map(p => p.pref_id), [6, 13, 0]);
const pt = prefTableHtml(prefs, TEXT.ja, { key: 'pref_id', desc: false });
assert.ok(pt.includes('data-pref="6"') && pt.includes('山形県'), pt);
assert.ok(pt.includes('25.0%') && pt.includes('width:25%'), pt);
assert.ok(pt.includes('data-sort="share"'));

const app = 'https://munimv2.github.io/kaerimichi/?feed=yamagata%2Fcity&date=2026-10-21&to=S1&map=gap';
const base = { organization_id: 'yamagata', feed_id: 'city', organization_name: '山形市', feed_name: '市営バス<b>', pref_id: 6,
  license: 'CC BY 4.0', hubs: '山形済生病院／市立病院', places: 160, places_with_departures: 146, hub: 2, ok: 35, okx: 12, noreturn: 0,
  oneway: 0, none: 79, idle: 14, round_trip: 47, share_round_trip: 0.322, round_trip_sat: 0, share_round_trip_sat: 0,
  trips_wed: 300, trips_sat: 0, app_url: app };
const feeds = rows(toCsv(FEED_COLUMNS, [
  base,
  { ...base, organization_id: 'tokyo', feed_id: 'b', organization_name: '東京', feed_name: 'B', pref_id: 13, share_round_trip: 0.9, share_round_trip_sat: 0.8, app_url: 'https://example.org/b' },
]));
assert.equal(feeds[0].app_url, app);
assert.equal(feeds[0].share_round_trip_sat, 0);
assert.equal(feeds[0].hubs, '山形済生病院／市立病院');
const ft = feedTableHtml(feeds, TEXT.ja, { key: 'share_round_trip', desc: false }, null);
assert.ok(ft.includes('市営バス&lt;b&gt;'), 'feed names are escaped');
assert.ok(ft.includes('href="https://munimv2.github.io/kaerimichi/?feed=yamagata%2Fcity&amp;date=2026-10-21&amp;to=S1&amp;map=gap"'), ft);
assert.ok(ft.indexOf('山形市') < ft.indexOf('東京'), 'lowest share first');
const only13 = feedTableHtml(feeds, TEXT.en, { key: 'share_round_trip', desc: true }, 13);
assert.ok(only13.includes('東京') && !only13.includes('山形市'));
assert.ok(only13.includes('Open in the app'));

const summary = {
  date: '2026-10-21', saturday: '2026-10-24', settings: { transfers: 1, min_connection_s: 300, min_stay_s: 1800, hubs_per_feed: 3 },
  feeds_listed: 600, feeds_analysed: 400,
  national: { places_with_departures: 50000, round_trip: 20000, share: 0.4, round_trip_sat: 12000, share_sat: 0.24 },
  feeds: { median_share: 0.35, share_zero: 12, round_trip_weekday_but_not_saturday: 40, no_saturday_service: 55 },
};
for (const lang of ['ja', 'en']) {
  const l = leadHtml(summary, TEXT[lang]);
  for (const s of ['40.0%', '24.0%', '50,000', '20,000', '35.0%', '2026-10-24']) assert.ok(l.includes(s), lang + ' lead lacks ' + s + ': ' + l);
}
assert.ok(leadHtml(summary, TEXT.ja).includes('30分以上'));

const stops = rows(toCsv(STOP_COLUMNS, [
  { organization_id: 'yamagata', feed_id: 'city', stop_key: 'A1', stop_name: '県営鈴川アパート', lat: '38.250000', lon: '140.350000',
    status: 'ok', status_sat: 'none', hub_name: '山形済生病院', arrive: '8:41', last_back: '15:54', max_stay_min: 433 },
  { organization_id: 'yamagata', feed_id: 'city', stop_key: 'A2', stop_name: '奥', lat: '', lon: '', status: 'idle', status_sat: 'idle',
    hub_name: '', arrive: '', last_back: '', max_stay_min: '' },
  // As in the 2026-10-21 data: one source feed lists this stop with latitude and longitude swapped.
  { organization_id: 'awajicity', feed_id: 'awajinawahimebus', stop_key: '131_01', stop_name: '禅坊靖寧前', lat: '134.985379', lon: '34.579240',
    status: 'idle', status_sat: 'okx', hub_name: '', arrive: '', last_back: '', max_stay_min: '' },
]));
assert.equal(stops[0].lat, 38.25);
assert.equal(stops[1].lat, null);
assert.equal(stops[1].max_stay_min, null);
assert.deepEqual(stops.map(onMap), [true, false, false], 'only stops inside Japan go on the map');
assert.ok(onMap({ lat: 24.34, lon: 124.15 }) && onMap({ lat: 45.4, lon: 141.7 }), 'Ishigaki and Wakkanai are on the map');
const pop = popupHtml(stops[0], feeds[0], 'wed', TEXT.ja);
for (const s of ['県営鈴川アパート', '直通で往復できる', '病院の停留所へ行けない', '8:41', '15:54', '433分', '山形済生病院']) assert.ok(pop.includes(s), pop);
const pop2 = popupHtml(stops[1], undefined, 'sat', TEXT.en);
assert.ok(pop2.includes('No departures that day') && !pop2.includes('min'), pop2);

console.log('national page ok');
