// test_gtfs.mjs - checks gtfs.js on a tiny made-up network.
// Run through test_kaerimichi.py (it copies this next to gtfs.js with {"type": "module"}).
// MV2 of Munim, Inc. - Apache-2.0 license.
import assert from 'node:assert/strict';
import { buildModel, buildFlex, dayView, journeys, serviceGaps, flexCover, flexLinks, flexOk, flexDay, inArea, addDays } from './gtfs.js';

// H is the hospital. Every trip runs on weekdays only.
const TRIPS = {
  T1: [['A', '8:00'], ['B', '8:10'], ['H', '8:30']],   // A and B: direct to H
  T2: [['H', '12:00'], ['B', '12:20'], ['A', '12:30']], // and direct back
  T3: [['C', '7:00'], ['B', '7:20']],                   // C: only by changing at B
  T4: [['B', '13:00'], ['C', '13:20']],
  T5: [['D', '9:00'], ['H', '9:30']],                   // D: no bus back at all
  T6: [['E', '6:00'], ['F', '6:30']],                   // E: never reaches H; F: no departures
  T7: [['G', '17:00'], ['H', '17:30']],                 // G: the last bus back leaves before you arrive
  T8: [['H', '16:00'], ['G', '16:30']],
};
const NAMES = { A: 'Aoba', B: 'Bashi', H: 'Hospital', C: 'Chuo', D: 'Daimon', E: 'Eki', F: 'Fuchi', G: 'Gakko' };
const CAL = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20271231\n';

// Stop k sits at (36 + k/100, 140 + k/100): A 0, B 1, H 2, C 3, D 4, E 5, F 6, G 7.
let stops = 'stop_id,stop_name,stop_lat,stop_lon\n';
Object.keys(NAMES).forEach((id, k) => { stops += `${id},${NAMES[id]},${36 + k * 0.01},${140 + k * 0.01}\n`; });
let trips = 'route_id,service_id,trip_id\n';
let times = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n';
for (const [id, calls] of Object.entries(TRIPS)) {
  trips += `R,WK,${id}\n`;
  calls.forEach(([stop, hm], k) => { times += `${id},${hm}:00,${hm}:00,${stop},${k + 1}\n`; });
}
const enc = new TextEncoder();
const files = obj => new Map(Object.entries(obj).map(([name, s]) => [name, enc.encode(s)]));
const model = buildModel(files({
  'stops.txt': stops,
  'routes.txt': 'route_id,route_short_name\nR,1\n',
  'trips.txt': trips,
  'stop_times.txt': times,
  'calendar.txt': CAL,
}));
const at = key => model.places.findIndex(p => p.key === key);
const hm = (h, m) => h * 3600 + m * 60;

assert.equal(model.places.length, 8);
assert.equal(model.served[at('F')], 1);

const view = dayView(model, '20261014'); // a Wednesday
assert.equal(view.trips.length, 8);
assert.equal(dayView(model, '20261018').trips.length, 0); // a Sunday
assert.equal(view.stat[at('F')].n, 0);
assert.equal(addDays('20261014', 4), '20261018');
assert.equal(addDays('20261231', 1), '20270101');

// Pair search: C -> H needs one change at B.
assert.equal(journeys(view, at('C'), at('H'), 0).length, 0);
const cToH = journeys(view, at('C'), at('H'), 1, 300);
assert.equal(cToH.length, 1);
assert.equal(cToH[0].via, at('B'));
assert.equal(cToH[0].arr, hm(8, 30));

// Service-gap map against H, 30 minutes minimum stay.
const statusOf = gaps => Object.fromEntries(model.places.map((p, i) => [p.key, gaps[i].status]));
const gaps = serviceGaps(view, at('H'), 1, 300, 30 * 60);
assert.deepEqual(statusOf(gaps), { A: 'ok', B: 'ok', H: 'hub', C: 'okx', D: 'oneway', E: 'none', F: 'idle', G: 'noreturn' });
assert.equal(gaps[at('A')].rt.firstArr, hm(8, 30));
assert.equal(gaps[at('A')].rt.lastBack, hm(12, 0));
assert.equal(gaps[at('C')].rt.lastBack, hm(12, 0));
assert.equal(gaps[at('C')].rt.maxStay, hm(3, 30));

// Without transfers C can't get there; with a 4-hour stay A can't get back in time.
assert.equal(serviceGaps(view, at('H'), 0, 300, 30 * 60)[at('C')].status, 'none');
assert.equal(serviceGaps(view, at('H'), 1, 300, 4 * 3600)[at('A')].status, 'noreturn');

// ---- GTFS-Flex ----
// Zone Z covers H, C, D and E (lat/lon 36.015-36.055) but has a hole around C.
// Trip FZ: book and ride anywhere inside Z, 8:00-17:00 on weekdays.
// Trip FG: from the stop group at G (pickup only) to the stop HX by H (drop-off only), 9:00-10:00.
const square = (a, b) => [[140 + a, 36 + a], [140 + b, 36 + a], [140 + b, 36 + b], [140 + a, 36 + b], [140 + a, 36 + a]];
const geo = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', id: 'Z', properties: { stop_name: 'Zone' }, geometry: { type: 'Polygon', coordinates: [square(0.015, 0.055), square(0.025, 0.035)] } }],
};
const flex = buildFlex(files({
  'locations.geojson': JSON.stringify(geo),
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nGX,Gakko pickup,36.0701,140.0701\nHX,Hospital door,36.0201,140.0199\n',
  'location_groups.txt': 'location_group_id,location_group_name\nLG,Gakko area\n',
  'location_group_stops.txt': 'location_group_id,stop_id\nLG,GX\n',
  'routes.txt': 'route_id,route_long_name\nDR,Demand ride\n',
  'trips.txt': 'route_id,service_id,trip_id\nDR,WK,FZ\nDR,WK,FG\n',
  'stop_times.txt': 'trip_id,stop_id,location_group_id,location_id,stop_sequence,start_pickup_drop_off_window,end_pickup_drop_off_window,pickup_type,drop_off_type,pickup_booking_rule_id\n'
    + 'FZ,,,Z,1,8:00:00,17:00:00,2,1,BR\nFZ,,,Z,2,8:00:00,17:00:00,1,2,BR\n'
    + 'FG,,LG,,1,9:00:00,10:00:00,2,1,BR\nFG,HX,,,2,9:00:00,10:00:00,1,2,BR\n',
  'booking_rules.txt': 'booking_rule_id,booking_type,prior_notice_last_day,prior_notice_last_time,phone_number\nBR,2,1,17:00:00,0120-000-000\n',
  'calendar.txt': CAL,
}));
assert.equal(flex.trips.length, 2);
assert.equal(flex.locations.get('z:Z').kind, 'zone');
assert.equal(flex.locations.get('g:LG').points.length, 1);
assert.equal(flex.rules.get('BR').type, '2');
assert.equal(flexDay(flex, '20261014').length, 2);
assert.equal(flexDay(flex, '20261018').length, 0);
assert.ok(inArea(140.045, 36.045, geo.features[0].geometry));
assert.ok(!inArea(140.03, 36.03, geo.features[0].geometry)); // the hole
assert.ok(!inArea(140.01, 36.01, geo.features[0].geometry));

const cover = flexCover(flex, model.places);
assert.deepEqual([...cover.get('z:Z')].sort(), [at('H'), at('D'), at('E')].sort());
assert.deepEqual([...cover.get('g:LG')], [at('G')]);
assert.deepEqual([...cover.get('s:HX')], [at('H')]);

const links = flexLinks(flex, '20261014', cover, at('H'), model.places.length);
assert.ok(flexOk(links[at('D')], 30 * 60));
assert.ok(flexOk(links[at('E')], 30 * 60));
assert.equal(links[at('D')].there.start, hm(8, 0));
assert.equal(links[at('D')].back.end, hm(17, 0));
assert.ok(!flexOk(links[at('C')]));             // in the hole
assert.ok(!flexOk(links[at('A')]));             // outside every area
assert.ok(links[at('G')].there && !links[at('G')].back); // the group trip only goes towards H
assert.ok(!flexOk(links[at('G')]));
assert.ok(!flexOk(links[at('D')], 10 * 3600)); // a 10-hour stay doesn't fit in 8:00-17:00
assert.equal(flexLinks(flex, '20261018', cover, at('H'), model.places.length)[at('D')].there, null);

// A plain GTFS feed has no flexible trips.
assert.equal(buildFlex(files({ 'stops.txt': stops, 'trips.txt': trips, 'stop_times.txt': times })).trips.length, 0);

// A BOM at the start of locations.geojson is tolerated.
const bom = buildFlex(files({ ...Object.fromEntries([['locations.geojson', '﻿' + JSON.stringify(geo)]]), 'trips.txt': 'route_id,service_id,trip_id\nDR,WK,FZ\n', 'stop_times.txt': 'trip_id,location_id,stop_sequence,start_pickup_drop_off_window,end_pickup_drop_off_window\nFZ,Z,1,8:00:00,17:00:00\nFZ,Z,2,8:00:00,17:00:00\n' }));
assert.ok(bom.locations.get('z:Z').geometry, 'locations.geojson with a BOM did not parse');

console.log('gtfs.js ok');
