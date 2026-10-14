// gtfs.js - a small GTFS reader that runs in the browser.
// Reads a GTFS (or GTFS-JP) zip, works out which trips run on a date,
// and finds direct and one-transfer journeys and same-day round trips between two stops,
// or from every stop to one destination (the service-gap map).
// Also reads demand-responsive transit in GTFS-Flex (zones, stop groups, pickup windows).
// MV2 of Munim, Inc. - Apache-2.0 license.

// ---- zip ----

// ArrayBuffer -> Map(basename -> Uint8Array) for every *.txt and *.geojson in the zip.
export async function unzip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  const stop = Math.max(0, buf.byteLength - 22 - 65535);
  for (let i = buf.byteLength - 22; i >= stop; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const names = new TextDecoder();
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('broken zip directory');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = names.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const base = name.split('/').pop();
    if (!(base.endsWith('.txt') || base.endsWith('.geojson')) || base.startsWith('.') || name.includes('__MACOSX')) continue;
    if (out.has(base)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + csize);
    if (method === 0) out.set(base, data);
    else if (method === 8) out.set(base, await inflate(data));
    else throw new Error('unsupported zip compression (' + method + ') in ' + base);
  }
  return out;
}

async function inflate(data) {
  const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// ---- csv ----

// RFC 4180 CSV -> array of rows (arrays of strings). Handles quotes, "" escapes, CRLF and a BOM.
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  const n = text.length;
  let row = [];
  let i = 0;
  while (i < n) {
    let field;
    if (text.charCodeAt(i) === 34) {
      let j = i + 1;
      field = '';
      for (;;) {
        const k = text.indexOf('"', j);
        if (k < 0) { field += text.slice(j); i = n; break; }
        field += text.slice(j, k);
        if (text.charCodeAt(k + 1) === 34) { field += '"'; j = k + 2; continue; }
        i = k + 1;
        break;
      }
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10 || c === 13) break;
        i++;
      }
    } else {
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 44 || c === 10 || c === 13) break;
        j++;
      }
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);
    if (i >= n) break;
    const c = text.charCodeAt(i);
    if (c === 44) {
      i++;
      if (i >= n) row.push('');
      continue;
    }
    i += (c === 13 && text.charCodeAt(i + 1) === 10) ? 2 : 1;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  return rows;
}

// One GTFS file -> {col: {name: index}, rows}. Values are trimmed; blank lines dropped.
export function readTable(files, name) {
  const data = files.get(name);
  if (!data) return null;
  const rows = parseCSV(new TextDecoder('utf-8').decode(data));
  const header = (rows.shift() || []).map(h => h.trim());
  const col = {};
  header.forEach((h, k) => { col[h] = k; });
  const kept = [];
  for (const r of rows) {
    if (r.length === 1 && r[0].trim() === '') continue;
    for (let k = 0; k < r.length; k++) r[k] = r[k].trim();
    kept.push(r);
  }
  return { col, rows: kept };
}

function cell(t, r, name) {
  const k = t.col[name];
  return k === undefined ? '' : (r[k] || '');
}

// ---- time and dates ----

// "8:05:00" or "25:10:00" -> seconds after midnight of the service day.
export function toSeconds(s) {
  const m = /^(\d+):(\d\d):(\d\d)$/.exec(s || '');
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
}

// seconds -> "8:05"; past midnight -> "翌0:30" (or "0:30+1" in English).
export function fmtTime(sec, lang = 'ja') {
  let h = Math.floor(sec / 3600);
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  if (h >= 24) {
    h -= 24;
    return lang === 'ja' ? '翌' + h + ':' + m : h + ':' + m + '+1';
  }
  return h + ':' + m;
}

// seconds -> "3時間20分" / "3 h 20 min"
export function fmtSpan(sec, lang = 'ja') {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (lang === 'ja') return (h ? h + '時間' : '') + m + '分';
  return (h ? h + ' h ' : '') + m + ' min';
}

// "20261013" -> 0 (Sunday) .. 6 (Saturday)
export function weekday(ymd) {
  return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay();
}

// "20261014" plus n days -> "YYYYMMDD"
export function addDays(ymd, n) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) + n * 86400000);
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// service_ids running on ymd, from calendar.txt plus calendar_dates.txt exceptions.
export function activeServices(model, ymd) {
  const on = new Set();
  const cal = model.calendar;
  if (cal) {
    const day = DAYS[weekday(ymd)];
    for (const r of cal.rows) {
      if (cell(cal, r, 'start_date') <= ymd && ymd <= cell(cal, r, 'end_date') && cell(cal, r, day) === '1') {
        on.add(cell(cal, r, 'service_id'));
      }
    }
  }
  const cd = model.calendarDates;
  if (cd) {
    for (const r of cd.rows) {
      if (cell(cd, r, 'date') !== ymd) continue;
      const type = cell(cd, r, 'exception_type');
      if (type === '1') on.add(cell(cd, r, 'service_id'));
      else if (type === '2') on.delete(cell(cd, r, 'service_id'));
    }
  }
  return on;
}

// First and last date the feed has any service, as "YYYYMMDD" (null if unknown).
export function serviceRange(model) {
  let lo = null, hi = null;
  const see = d => {
    if (!/^\d{8}$/.test(d)) return;
    if (lo === null || d < lo) lo = d;
    if (hi === null || d > hi) hi = d;
  };
  if (model.calendar) for (const r of model.calendar.rows) { see(cell(model.calendar, r, 'start_date')); see(cell(model.calendar, r, 'end_date')); }
  if (model.calendarDates) for (const r of model.calendarDates.rows) if (cell(model.calendarDates, r, 'exception_type') === '1') see(cell(model.calendarDates, r, 'date'));
  return { start: lo, end: hi };
}

// ---- model ----

function metres(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos((a.lat + b.lat) * rad / 2);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
}

// Groups boarding points (poles) into places: same stop_name within 400 m is one place.
function buildPlaces(stops, nameEn, idEn) {
  const places = [];
  const byName = new Map();
  const placeOf = new Map();
  const poles = stops.rows.filter(r => {
    const t = cell(stops, r, 'location_type');
    return t === '' || t === '0';
  });
  for (const r of poles) {
    const id = cell(stops, r, 'stop_id');
    const name = cell(stops, r, 'stop_name') || id;
    const lat = parseFloat(cell(stops, r, 'stop_lat'));
    const lon = parseFloat(cell(stops, r, 'stop_lon'));
    const pt = (isFinite(lat) && isFinite(lon) && (lat || lon)) ? { lat, lon } : null;
    const same = byName.get(name) || [];
    let place = same.find(p => !pt || !p.at || metres(p.at, pt) < 400);
    if (!place) {
      place = { i: places.length, key: id, name, en: idEn.get(id) || nameEn.get(name) || '', at: pt, sum: { lat: 0, lon: 0, n: 0 }, stopIds: [] };
      places.push(place);
      same.push(place);
      byName.set(name, same);
    }
    if (pt) {
      place.sum.lat += pt.lat; place.sum.lon += pt.lon; place.sum.n++;
      if (!place.at) place.at = pt;
    }
    place.stopIds.push(id);
    placeOf.set(id, place.i);
  }
  for (const p of places) {
    if (p.sum.n) { p.lat = p.sum.lat / p.sum.n; p.lon = p.sum.lon / p.sum.n; }
    delete p.sum;
    delete p.at;
  }
  return { places, placeOf };
}

// English names from translations.txt (GTFS-JP v2 trans_id/lang or GTFS table_name/field_name/language).
function englishNames(tr) {
  const nameEn = new Map(), idEn = new Map();
  if (!tr) return { nameEn, idEn };
  for (const r of tr.rows) {
    if ('trans_id' in tr.col) {
      if (cell(tr, r, 'lang') === 'en') nameEn.set(cell(tr, r, 'trans_id'), cell(tr, r, 'translation'));
      continue;
    }
    if (cell(tr, r, 'language') !== 'en' || cell(tr, r, 'field_name') !== 'stop_name') continue;
    if (cell(tr, r, 'table_name') && cell(tr, r, 'table_name') !== 'stops') continue;
    const text = cell(tr, r, 'translation');
    if (cell(tr, r, 'record_id')) idEn.set(cell(tr, r, 'record_id'), text);
    if (cell(tr, r, 'field_value')) nameEn.set(cell(tr, r, 'field_value'), text);
  }
  return { nameEn, idEn };
}

// zip ArrayBuffer -> model used by the app.
export async function loadGTFS(buf) {
  const files = await unzip(buf);
  for (const f of ['stops.txt', 'trips.txt', 'stop_times.txt']) {
    if (!files.has(f)) throw new Error('missing ' + f);
  }
  return buildModel(files);
}

// zip ArrayBuffer -> {model, flex}: the fixed-route model (null if the zip has only
// demand-responsive service) and the GTFS-Flex part (null if there is none).
export async function loadFeed(buf) {
  const files = await unzip(buf);
  // Only look for Flex trips when the feed has a Flex file or column (stop_times.txt can be large).
  const st = files.get('stop_times.txt');
  const head = st ? new TextDecoder('utf-8').decode(st.subarray(0, 2048)).split(/\r?\n/)[0] : '';
  const maybe = ['locations.geojson', 'location_groups.txt', 'booking_rules.txt'].some(f => files.has(f)) || /pickup_drop_off_window|location_id/.test(head);
  const flex = maybe ? buildFlex(files) : { trips: [] };
  const hasFlex = flex.trips.length > 0;
  for (const f of ['stops.txt', 'trips.txt', 'stop_times.txt']) {
    if (!files.has(f)) {
      if (hasFlex) return { model: null, flex };
      throw new Error('missing ' + f);
    }
  }
  const model = buildModel(files);
  if (hasFlex && !model.trips.length) return { model: null, flex };
  return { model, flex: hasFlex ? flex : null };
}

export function buildModel(files) {
  const stops = readTable(files, 'stops.txt');
  const { nameEn, idEn } = englishNames(readTable(files, 'translations.txt'));
  const { places, placeOf } = buildPlaces(stops, nameEn, idEn);

  const routes = new Map();
  const rt = readTable(files, 'routes.txt');
  if (rt) for (const r of rt.rows) {
    routes.set(cell(rt, r, 'route_id'), {
      id: cell(rt, r, 'route_id'),
      short: cell(rt, r, 'route_short_name'),
      long: cell(rt, r, 'route_long_name'),
      color: cell(rt, r, 'route_color'),
      text: cell(rt, r, 'route_text_color'),
    });
  }

  const tt = readTable(files, 'trips.txt');
  const tripInfo = new Map();
  for (const r of tt.rows) {
    tripInfo.set(cell(tt, r, 'trip_id'), {
      id: cell(tt, r, 'trip_id'),
      route: cell(tt, r, 'route_id'),
      service: cell(tt, r, 'service_id'),
      headsign: cell(tt, r, 'trip_headsign'),
    });
  }

  const st = readTable(files, 'stop_times.txt');
  const byTrip = new Map();
  for (const r of st.rows) {
    const id = cell(st, r, 'trip_id');
    let list = byTrip.get(id);
    if (!list) byTrip.set(id, list = []);
    list.push(r);
  }
  const trips = [];
  for (const [id, list] of byTrip) {
    const info = tripInfo.get(id);
    if (!info) continue;
    list.sort((a, b) => (+cell(st, a, 'stop_sequence')) - (+cell(st, b, 'stop_sequence')));
    const place = [], arr = [], dep = [];
    for (const r of list) {
      const p = placeOf.get(cell(st, r, 'stop_id'));
      if (p === undefined) continue;
      const a = toSeconds(cell(st, r, 'arrival_time'));
      const d = toSeconds(cell(st, r, 'departure_time'));
      place.push(p);
      arr.push(a !== null ? a : d);
      dep.push(d !== null ? d : a);
    }
    if (place.length >= 2) trips.push({ ...info, place, arr, dep });
  }

  // served[p]: how many trips call at place p on any day (0 = the timetable never stops there).
  const served = places.map(() => 0);
  for (const t of trips) for (const p of new Set(t.place)) served[p]++;

  const agency = readTable(files, 'agency.txt');
  return {
    places,
    routes,
    trips,
    served,
    calendar: readTable(files, 'calendar.txt'),
    calendarDates: readTable(files, 'calendar_dates.txt'),
    agencies: agency ? agency.rows.map(r => cell(agency, r, 'agency_name')).filter(Boolean) : [],
  };
}

// ---- questions ----

// What runs on ymd: the trips, per place the departures (count, first, last, routes),
// and byPlace: place index -> the trips that call there (for fast searches).
export function dayView(model, ymd) {
  const on = activeServices(model, ymd);
  const trips = model.trips.filter(t => on.has(t.service));
  const stat = model.places.map(() => ({ n: 0, first: null, last: null, routes: new Set() }));
  const byPlace = new Map();
  for (const t of trips) {
    const seen = new Set();
    for (let k = 0; k < t.place.length; k++) {
      const p = t.place[k];
      if (!seen.has(p)) {
        seen.add(p);
        let list = byPlace.get(p);
        if (!list) byPlace.set(p, list = []);
        list.push(t);
      }
      if (k === t.place.length - 1) continue;
      const d = t.dep[k];
      if (d === null) continue;
      const s = stat[p];
      s.n++;
      if (s.first === null || d < s.first) s.first = d;
      if (s.last === null || d > s.last) s.last = d;
      s.routes.add(t.route);
    }
  }
  return { ymd, trips, stat, byPlace };
}

// A journey: {dep, arr, trip (first leg's trip), via (place index or null), legs: [{trip, from, to, dep, arr}]}.
function leg(trip, from, to, dep, arr) {
  return { trip, from, to, dep, arr };
}

// Direct trips from place `from` to place `to` on the day, sorted by departure.
// A trip that passes `from` twice before `to` counts from the later visit (the shorter ride).
export function directTrips(view, from, to) {
  const out = [];
  const list = view.byPlace ? (view.byPlace.get(from) || []) : view.trips;
  for (const t of list) {
    let a = -1;
    for (let k = 0; k < t.place.length; k++) {
      const p = t.place[k];
      if (p === from && t.dep[k] !== null) a = k;
      else if (p === to && a >= 0 && t.arr[k] !== null) {
        out.push({ trip: t, dep: t.dep[a], arr: t.arr[k], via: null, legs: [leg(t, from, to, t.dep[a], t.arr[k])] });
        a = -1;
      }
    }
  }
  out.sort((x, y) => x.dep - y.dep || x.arr - y.arr);
  return out;
}

// Keeps the journeys that are not dominated (another leaves no earlier and arrives no later).
// Direct journeys are only pruned by other direct journeys, so a direct bus is never hidden
// behind a transfer; transfer journeys are pruned by any journey.
export function pareto(list) {
  const prune = js => {
    const s = js.slice().sort((x, y) => y.dep - x.dep || x.arr - y.arr || x.legs.length - y.legs.length);
    const keep = [];
    let best = Infinity;
    for (const j of s) {
      if (j.arr < best) { keep.push(j); best = j.arr; }
    }
    return keep;
  };
  const direct = prune(list.filter(j => j.legs.length === 1));
  const withTransfer = prune(list.filter(j => j.legs.length > 1).concat(direct)).filter(j => j.legs.length > 1);
  return direct.concat(withTransfer).sort((x, y) => x.dep - y.dep || x.arr - y.arr || x.legs.length - y.legs.length);
}

// Journeys from `from` to `to` on the day: direct trips, plus (if transfers > 0) one change
// at any stop on the way with at least minConn seconds between arrival and departure.
export function journeys(view, from, to, transfers = 1, minConn = 300) {
  const direct = directTrips(view, from, to);
  if (!transfers || !view.byPlace) return direct;
  const out = direct.slice();
  const second = new Map(); // via place -> direct trips via -> to
  for (const t of view.byPlace.get(from) || []) {
    let a = -1;
    for (let k = 0; k < t.place.length; k++) {
      const p = t.place[k];
      if (p === from) { if (t.dep[k] !== null) a = k; continue; }
      if (a < 0) continue;
      if (p === to) break;
      if (t.arr[k] === null) continue;
      let conn = second.get(p);
      if (!conn) { conn = directTrips(view, p, to); second.set(p, conn); }
      if (!conn.length) continue;
      const ready = t.arr[k] + minConn;
      let best = null;
      for (const c of conn) {
        if (c.dep >= ready && c.trip !== t && (best === null || c.arr < best.arr)) best = c;
      }
      if (!best) continue;
      out.push({
        trip: t, dep: t.dep[a], arr: best.arr, via: p,
        legs: [leg(t, from, p, t.dep[a], t.arr[k]), leg(best.trip, p, to, best.dep, best.arr)],
      });
    }
  }
  return pareto(out);
}

// Same-day round trip: go on `outs`, come back on `backs`, staying at least minStay seconds.
// status: 'none' (no way there), 'oneway' (no way back at all),
// 'noreturn' (every way back leaves too early), 'ok'.
export function roundTrip(outs, backs, minStay) {
  if (!outs.length) return { status: 'none', plans: [] };
  const plans = outs.map(o => ({ out: o, back: backs.find(b => b.dep >= o.arr + minStay) || null }));
  if (!backs.length) return { status: 'oneway', plans };
  const lastBack = backs[backs.length - 1].dep;
  const firstArr = Math.min(...outs.map(o => o.arr));
  const ok = plans.filter(p => p.back);
  if (!ok.length) return { status: 'noreturn', firstArr, lastBack, plans };
  const arrive = Math.min(...ok.map(p => p.out.arr));
  return {
    status: 'ok',
    firstArr: arrive,
    lastBack,
    maxStay: lastBack - arrive,
    latestOut: ok[ok.length - 1].out,
    plans,
  };
}

// ---- service gaps (every stop against one destination) ----

// Keeps the journeys {dep, arr, n (legs), trip} that are not dominated, sorted by departure;
// arrivals then rise too. On a tie the journey with fewer legs wins.
function frontier(list) {
  const s = list.slice().sort((x, y) => y.dep - x.dep || x.arr - y.arr || x.n - y.n);
  const keep = [];
  let best = Infinity;
  for (const j of s) {
    if (j.arr < best) { keep.push(j); best = j.arr; }
  }
  return keep.reverse();
}

// First index in list (sorted ascending by key) whose key is >= x.
function lowerBound(list, key, x) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m][key] < x) lo = m + 1; else hi = m;
  }
  return lo;
}

// Journeys from every place to `hub` and back on the day, direct plus (if transfers > 0)
// one change with at least minConn seconds. Per place index: frontier lists of {dep, arr, n}.
// {to, from} include transfers; {toDirect, fromDirect} are direct only.
export function hubJourneys(view, hub, transfers = 1, minConn = 300) {
  const count = view.stat.length;
  const toD = Array.from({ length: count }, () => []);
  const fromD = Array.from({ length: count }, () => []);
  for (const t of view.byPlace.get(hub) || []) {
    for (let h = 0; h < t.place.length; h++) {
      if (t.place[h] !== hub) continue;
      if (t.arr[h] !== null) {
        for (let k = h - 1; k >= 0 && t.place[k] !== hub; k--) {
          if (t.dep[k] !== null) toD[t.place[k]].push({ dep: t.dep[k], arr: t.arr[h], n: 1, trip: t });
        }
      }
      if (t.dep[h] !== null) {
        for (let k = h + 1; k < t.place.length && t.place[k] !== hub; k++) {
          if (t.arr[k] !== null) fromD[t.place[k]].push({ dep: t.dep[h], arr: t.arr[k], n: 1, trip: t });
        }
      }
    }
  }
  const toDirect = toD.map(frontier);
  const fromDirect = fromD.map(frontier);
  if (!transfers) return { to: toDirect, from: fromDirect, toDirect, fromDirect };

  const toAll = toDirect.map(l => l.slice());
  const fromAll = fromDirect.map(l => l.slice());
  for (let q = 0; q < count; q++) {
    // To the hub: ride any trip to q, then the earliest direct bus q -> hub.
    const toConn = toDirect[q];
    if (toConn.length) {
      for (const t of view.byPlace.get(q) || []) {
        for (let kq = 1; kq < t.place.length; kq++) {
          if (t.place[kq] !== q || t.arr[kq] === null) continue;
          let i = lowerBound(toConn, 'dep', t.arr[kq] + minConn);
          while (i < toConn.length && toConn[i].trip === t) i++;
          if (i >= toConn.length) continue;
          const c = toConn[i];
          for (let k = kq - 1; k >= 0 && t.place[k] !== q && t.place[k] !== hub; k--) {
            if (t.dep[k] !== null) toAll[t.place[k]].push({ dep: t.dep[k], arr: c.arr, n: 2, trip: t });
          }
        }
      }
    }
    // From the hub: the latest direct bus hub -> q that still makes a trip leaving q.
    const fromConn = fromDirect[q];
    if (fromConn.length) {
      for (const t of view.byPlace.get(q) || []) {
        for (let kq = 0; kq < t.place.length - 1; kq++) {
          if (t.place[kq] !== q || t.dep[kq] === null) continue;
          let i = lowerBound(fromConn, 'arr', t.dep[kq] - minConn + 1) - 1;
          while (i >= 0 && fromConn[i].trip === t) i--;
          if (i < 0) continue;
          const c = fromConn[i];
          for (let k = kq + 1; k < t.place.length && t.place[k] !== q && t.place[k] !== hub; k++) {
            if (t.arr[k] !== null) fromAll[t.place[k]].push({ dep: c.dep, arr: t.arr[k], n: 2, trip: t });
          }
        }
      }
    }
  }
  return { to: toAll.map(frontier), from: fromAll.map(frontier), toDirect, fromDirect };
}

// Same-day round trip from every place to `hub`. Per place: {status, rt} where status is
// 'ok' (works with direct buses), 'okx' (works only with a transfer), 'noreturn', 'oneway',
// 'none', 'idle' (no departures there this day) or 'hub'; rt is the roundTrip() result.
export function serviceGaps(view, hub, transfers = 1, minConn = 300, minStay = 0) {
  const hj = hubJourneys(view, hub, transfers, minConn);
  return view.stat.map((s, p) => {
    if (p === hub) return { status: 'hub', rt: null };
    const rt = roundTrip(hj.to[p], hj.from[p], minStay);
    let status = rt.status;
    if (status === 'ok' && transfers && roundTrip(hj.toDirect[p], hj.fromDirect[p], minStay).status !== 'ok') status = 'okx';
    if (status === 'none' && !s.n) status = 'idle';
    return { status, rt };
  });
}

// ---- demand-responsive transit (GTFS-Flex) ----

// Ray casting on one ring of [lon, lat] points.
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Is (lon, lat) inside a GeoJSON Polygon or MultiPolygon? Holes count as outside.
export function inArea(lon, lat, geometry) {
  if (!geometry) return false;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.some(rings => rings.length > 0 && inRing(lon, lat, rings[0]) && !rings.slice(1).some(h => inRing(lon, lat, h)));
}

// [minLon, minLat, maxLon, maxLat] of a geometry's coordinates.
function bbox(geometry) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = c => {
    if (typeof c[0] === 'number') {
      if (c[0] < b[0]) b[0] = c[0];
      if (c[1] < b[1]) b[1] = c[1];
      if (c[0] > b[2]) b[2] = c[0];
      if (c[1] > b[3]) b[3] = c[1];
    } else for (const x of c) walk(x);
  };
  walk(geometry.coordinates || []);
  return b;
}

// The GTFS-Flex part of a feed: trips whose calls are zones (locations.geojson), stop groups
// (location_groups.txt + location_group_stops.txt) or stops with a pickup/drop-off window.
// trips: [{id, route, service, calls: [{loc, start, end, pickup, drop, rule}]}] (start/end in
// seconds or null); locations: Map(loc -> {kind: 'zone'|'group'|'stop', name, geometry, bbox, points}).
export function buildFlex(files) {
  const stops = new Map();
  const st = readTable(files, 'stops.txt');
  if (st) for (const r of st.rows) {
    const lat = parseFloat(cell(st, r, 'stop_lat')), lon = parseFloat(cell(st, r, 'stop_lon'));
    const ok = isFinite(lat) && isFinite(lon) && !!(lat || lon);
    stops.set(cell(st, r, 'stop_id'), { name: cell(st, r, 'stop_name'), lat, lon, ok });
  }

  const zones = new Map();
  const gj = files.get('locations.geojson');
  if (gj) {
    let data = null;
    try { data = JSON.parse(new TextDecoder('utf-8').decode(gj).replace(/^﻿/, '')); } catch (e) { data = null; }
    for (const f of (data && data.features) || []) {
      const props = f.properties || {};
      const id = String(f.id !== undefined && f.id !== null ? f.id : (props.location_id || props.id || ''));
      const g = f.geometry;
      if (!id || !g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
      zones.set(id, { name: props.stop_name || props.name || '', desc: props.stop_desc || '', geometry: g, bbox: bbox(g) });
    }
  }

  const groups = new Map();
  const group = id => {
    if (!groups.has(id)) groups.set(id, { name: '', stopIds: [] });
    return groups.get(id);
  };
  const lg = readTable(files, 'location_groups.txt');
  if (lg) for (const r of lg.rows) {
    const g = group(cell(lg, r, 'location_group_id'));
    g.name = g.name || cell(lg, r, 'location_group_name');
    // Older Flex drafts listed the member stops in this file.
    const member = cell(lg, r, 'stop_id') || cell(lg, r, 'location_id');
    if (member) g.stopIds.push(member);
  }
  const lgs = readTable(files, 'location_group_stops.txt');
  if (lgs) for (const r of lgs.rows) group(cell(lgs, r, 'location_group_id')).stopIds.push(cell(lgs, r, 'stop_id'));

  const rules = new Map();
  const br = readTable(files, 'booking_rules.txt');
  if (br) for (const r of br.rows) {
    const get = k => cell(br, r, k);
    rules.set(get('booking_rule_id'), {
      type: get('booking_type'), minBefore: get('prior_notice_duration_min'),
      lastDay: get('prior_notice_last_day'), lastTime: get('prior_notice_last_time'),
      message: get('message') || get('pickup_message'), phone: get('phone_number'),
      url: get('booking_url') || get('info_url'),
    });
  }

  const routes = new Map();
  const rt = readTable(files, 'routes.txt');
  if (rt) for (const r of rt.rows) {
    routes.set(cell(rt, r, 'route_id'), { short: cell(rt, r, 'route_short_name'), long: cell(rt, r, 'route_long_name') });
  }

  const tripInfo = new Map();
  const tt = readTable(files, 'trips.txt');
  if (tt) for (const r of tt.rows) {
    tripInfo.set(cell(tt, r, 'trip_id'), { id: cell(tt, r, 'trip_id'), route: cell(tt, r, 'route_id'), service: cell(tt, r, 'service_id') });
  }

  const byTrip = new Map();
  const stt = readTable(files, 'stop_times.txt');
  if (stt) for (const r of stt.rows) {
    const get = k => cell(stt, r, k);
    const zone = get('location_id'), grp = get('location_group_id'), stopId = get('stop_id');
    const start = toSeconds(get('start_pickup_drop_off_window'));
    const end = toSeconds(get('end_pickup_drop_off_window'));
    // Fixed-time calls belong to the ordinary timetable; keep only the flexible ones.
    if (!zone && !grp && start === null && end === null) continue;
    const loc = zone ? 'z:' + zone : grp ? 'g:' + grp : 's:' + stopId;
    const id = get('trip_id');
    if (!byTrip.has(id)) byTrip.set(id, []);
    byTrip.get(id).push({
      seq: +get('stop_sequence') || 0, loc, start, end,
      pickup: get('pickup_type') !== '1', drop: get('drop_off_type') !== '1',
      rule: get('pickup_booking_rule_id') || get('drop_off_booking_rule_id'),
    });
  }
  const trips = [];
  for (const [id, calls] of byTrip) {
    const info = tripInfo.get(id);
    if (!info) continue;
    calls.sort((a, b) => a.seq - b.seq);
    trips.push({ ...info, calls });
  }

  const locations = new Map();
  for (const t of trips) for (const c of t.calls) {
    if (locations.has(c.loc)) continue;
    const kind = c.loc[0], id = c.loc.slice(2);
    if (kind === 'z') {
      const z = zones.get(id);
      locations.set(c.loc, { kind: 'zone', name: (z && z.name) || id, geometry: z ? z.geometry : null, bbox: z ? z.bbox : null, points: [] });
    } else {
      const g = kind === 'g' ? (groups.get(id) || { name: '', stopIds: [] }) : null;
      const ids = g ? g.stopIds : [id];
      const points = ids.map(s => stops.get(s)).filter(s => s && s.ok);
      const name = g ? (g.name || id) : ((stops.get(id) || {}).name || id);
      locations.set(c.loc, { kind: g ? 'group' : 'stop', name, geometry: null, bbox: null, points });
    }
  }

  const agency = readTable(files, 'agency.txt');
  return {
    trips,
    locations,
    routes,
    rules,
    calendar: readTable(files, 'calendar.txt'),
    calendarDates: readTable(files, 'calendar_dates.txt'),
    agencies: agency ? agency.rows.map(r => cell(agency, r, 'agency_name')).filter(Boolean) : [],
  };
}

export async function loadFlex(buf) {
  return buildFlex(await unzip(buf));
}

// The demand-responsive trips that run on ymd (all of them if the feed has no calendar).
export function flexDay(flex, ymd) {
  if (!flex.calendar && !flex.calendarDates) return flex.trips;
  const on = activeServices(flex, ymd);
  return flex.trips.filter(t => on.has(t.service));
}

// Which places each Flex location covers: inside a zone, or within `radius` metres of
// one of a group's (or a single flexible stop's) points. Map(loc -> Set of place indices).
export function flexCover(flex, places, radius = 300) {
  const cover = new Map();
  for (const [key, loc] of flex.locations) {
    const set = new Set();
    places.forEach((p, i) => {
      if (p.lat === undefined) return;
      if (loc.kind === 'zone') {
        const b = loc.bbox;
        if (b && p.lon >= b[0] && p.lon <= b[2] && p.lat >= b[1] && p.lat <= b[3] && inArea(p.lon, p.lat, loc.geometry)) set.add(i);
      } else if (loc.points.some(q => metres(p, q) <= radius)) set.add(i);
    });
    cover.set(key, set);
  }
  return cover;
}

const lo = (a, b) => (a === null || b === null ? null : Math.min(a, b));
const hi = (a, b) => (a === null || b === null ? null : Math.max(a, b));

// Demand-responsive links between every place and `hub` on the day. Per place index:
// {there, back}, each null or {start, end, trip}: the widest pickup-to-drop-off window
// (null start/end = not limited in the data). A place links to the hub when a trip picks
// up at a call covering it and drops off at the same or a later call covering the hub.
export function flexLinks(flex, ymd, cover, hub, count) {
  const links = Array.from({ length: count }, () => ({ there: null, back: null }));
  const widen = (cur, start, end, trip) => (cur ? { start: lo(cur.start, start), end: hi(cur.end, end), trip: cur.trip } : { start, end, trip });
  for (const t of flexDay(flex, ymd)) {
    const c = t.calls;
    for (let j = 0; j < c.length; j++) {
      const sj = cover.get(c[j].loc);
      if (!sj || !sj.size || !c[j].drop) continue;
      for (let i = 0; i <= j; i++) {
        const si = cover.get(c[i].loc);
        if (!si || !si.size || !c[i].pickup) continue;
        if (sj.has(hub)) for (const p of si) if (p !== hub) links[p].there = widen(links[p].there, c[i].start, c[j].end, t);
        if (si.has(hub)) for (const p of sj) if (p !== hub) links[p].back = widen(links[p].back, c[i].start, c[j].end, t);
      }
    }
  }
  return links;
}

// A same-day demand-responsive round trip: a way there and back, with the service open
// long enough for a stay of minStay seconds (when the data gives the windows).
export function flexOk(link, minStay = 0) {
  if (!link || !link.there || !link.back) return false;
  if (link.there.start === null || link.back.end === null) return true;
  return link.back.end - link.there.start >= minStay;
}

// Parses feeds.txt (pipe-separated snapshot of the GTFS Data Repository list) or the
// repository API's JSON ({body: [...]}) into a plain list of feeds.
export function parseFeedList(text) {
  const out = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed);
    for (const f of (Array.isArray(data) ? data : data.body) || []) {
      out.push({
        org: f.organization_id, feed: f.feed_id, orgName: f.organization_name, feedName: f.feed_name,
        pref: +f.feed_pref_id || 0, license: f.feed_license || '', licenseUrl: f.feed_license_url || '',
        end: f.latest_feed_end_date || '', discontinued: !!f.feed_is_discontinued,
      });
    }
    return out;
  }
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const c = l.split('|');
    if (c.length < 8) continue;
    out.push({
      org: c[0], feed: c[1], orgName: c[2], feedName: c[3], pref: +c[4] || 0, license: c[5], licenseUrl: '',
      end: c[6], discontinued: c[7] === 'true',
    });
  }
  return out;
}
