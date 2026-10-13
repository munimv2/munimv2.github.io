// gtfs.js - a small GTFS reader that runs in the browser.
// Reads a GTFS (or GTFS-JP) zip, works out which trips run on a date,
// and finds direct and one-transfer journeys and same-day round trips between two stops.
// MV2 of Munim, Inc. - MIT license.

// ---- zip ----

// ArrayBuffer -> Map(basename -> Uint8Array) for every *.txt in the zip.
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
    if (!base.endsWith('.txt') || base.startsWith('.') || name.includes('__MACOSX')) continue;
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

  const agency = readTable(files, 'agency.txt');
  return {
    places,
    routes,
    trips,
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
