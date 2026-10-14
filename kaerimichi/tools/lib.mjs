// lib.mjs - one feed's same-day hospital round trips, measured with Kaerimichi's own gtfs.js
// (passed in as `g`, so the numbers are the ones the app shows for the same feed and date).
// MV2 of Munim, Inc. - Apache-2.0 license. Made with AI agents working in MV2's name.

// The app's defaults: up to one transfer, 5 minutes to change, at least 30 minutes at the hospital.
export const SETTINGS = { transfers: 1, min_connection_s: 300, min_stay_s: 1800, hubs_per_feed: 3 };
// The app's 病院 one-click destination (PRESETS in app.js).
export const HOSPITAL = /病院|医院|クリニック|診療所|医療センター/;
// Best first: a stop's verdict is the best one over the feed's hospital stops.
export const RANK = ['ok', 'okx', 'noreturn', 'oneway', 'none', 'idle'];
export const STATUSES = ['hub', ...RANK];
// Open licences only: CC BY (any version), CC0, PDL 1.0.
export const LICENSES = /^\s*(CC[ -]?BY|CC0|PDL)/i;
export const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
  '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];

export const FEED_COLUMNS = ['organization_id', 'feed_id', 'organization_name', 'feed_name', 'pref_id', 'license', 'hubs',
  'places', 'places_with_departures', 'hub', 'ok', 'okx', 'noreturn', 'oneway', 'none', 'idle',
  'round_trip', 'share_round_trip', 'round_trip_sat', 'share_round_trip_sat', 'trips_wed', 'trips_sat', 'app_url'];
export const STOP_COLUMNS = ['organization_id', 'feed_id', 'stop_key', 'stop_name', 'lat', 'lon', 'status', 'status_sat',
  'hub_name', 'arrive', 'last_back', 'max_stay_min'];
export const SKIP_COLUMNS = ['organization_id', 'feed_id', 'feed_name', 'reason', 'detail'];
export const PREF_COLUMNS = ['pref_id', 'pref_name', 'feeds_analysed', 'places_with_departures', 'round_trip', 'share',
  'round_trip_sat', 'share_sat'];

export const ymd = d => String(d).replace(/-/g, '');
export const round3 = x => Math.round(x * 1000) / 1000;
const roundTrips = s => s === 'ok' || s === 'okx';

export function prefName(id) {
  return PREFS[id - 1] || 'その他・広域';
}

// Why a listed feed is not analysed on `day` (YYYYMMDD), or null.
export function skipReason(f, day) {
  if (f.discontinued) return 'discontinued';
  const end = ymd(f.end || '').slice(0, 8);
  if (/^\d{8}$/.test(end) && end < day) return 'ended';
  if (!LICENSES.test(f.license || '')) return 'license';
  return null;
}

export function zipUrl(f) {
  return `https://api.gtfs-data.jp/v2/organizations/${encodeURIComponent(f.org)}/feeds/${encodeURIComponent(f.feed)}/files/feed.zip?rid=current`;
}

// The same view in the app: the feed, the date and the service-gap map to the busiest hospital stop.
export function appUrl(f, date, hubKey) {
  const q = new URLSearchParams({ feed: `${f.org}/${f.feed}`, date, to: hubKey, map: 'gap' });
  return 'https://munimv2.github.io/kaerimichi/?' + q.toString();
}

// Hospital-named places that some trip calls at on the day, busiest first (as the app's 病院 button orders them).
export function hospitalHubs(model, view) {
  const list = [];
  model.places.forEach((p, i) => { if (HOSPITAL.test(p.name) && view.byPlace.has(i)) list.push(i); });
  list.sort((a, b) => (view.stat[b].n - view.stat[a].n) || (model.served[b] - model.served[a]));
  return list.slice(0, SETTINGS.hubs_per_feed);
}

// Per place: {status, hub, rt}, the best verdict over the hubs (a hub itself is 'hub').
function classify(g, model, view, hubs) {
  const per = hubs.map(h => g.serviceGaps(view, h, SETTINGS.transfers, SETTINGS.min_connection_s, SETTINGS.min_stay_s));
  const isHub = new Set(hubs);
  return model.places.map((p, i) => {
    if (isHub.has(i)) return { status: 'hub', hub: i, rt: null };
    let best = null;
    per.forEach((gaps, k) => {
      const s = gaps[i];
      if (!best || RANK.indexOf(s.status) < RANK.indexOf(best.status)) best = { status: s.status, hub: hubs[k], rt: s.rt };
    });
    return best;
  });
}

// One feed (zip ArrayBuffer) on a weekday `date` and a Saturday `sat` (YYYY-MM-DD).
// Returns {skip: reason} or the counts, shares and one row per place.
// The base of both shares is the same set of places: those with a departure on the weekday, hubs excluded.
export async function analyseFeed(g, buf, { date, sat }) {
  const { model } = await g.loadFeed(buf);
  if (!model) return { skip: 'flex_only' };
  const view = g.dayView(model, ymd(date));
  if (!view.trips.length) return { skip: 'no_service' };
  const hubs = hospitalHubs(model, view);
  if (!hubs.length) return { skip: 'no_hospital_stop' };
  const satView = g.dayView(model, ymd(sat));
  const wed = classify(g, model, view, hubs);
  const weekend = classify(g, model, satView, hubs);
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const c of wed) counts[c.status]++;
  let base = 0, roundTrip = 0, roundTripSat = 0;
  wed.forEach((c, i) => {
    if (c.status === 'hub' || c.status === 'idle') return;
    base++;
    if (roundTrips(c.status)) roundTrip++;
    if (roundTrips(weekend[i].status)) roundTripSat++;
  });
  const time = s => (s === null || s === undefined ? '' : g.fmtTime(s, 'en'));
  const stops = model.places.map((p, i) => {
    const c = wed[i];
    const rt = c.rt || {};
    const reached = roundTrips(c.status) || c.status === 'noreturn';
    const named = c.status !== 'none' && c.status !== 'idle';
    return {
      key: p.key, name: p.name,
      lat: p.lat === undefined ? '' : p.lat.toFixed(6), lon: p.lon === undefined ? '' : p.lon.toFixed(6),
      status: c.status, statusSat: weekend[i].status,
      hub: named ? model.places[c.hub].name : '',
      arrive: reached ? time(rt.firstArr) : '',
      lastBack: reached ? time(rt.lastBack) : '',
      maxStayMin: roundTrips(c.status) ? Math.floor(rt.maxStay / 60) : '',
    };
  });
  return {
    hubs: hubs.map(i => ({ key: model.places[i].key, name: model.places[i].name, departures: view.stat[i].n })),
    places: model.places.length, counts, base, roundTrip, roundTripSat,
    share: base ? round3(roundTrip / base) : null,
    shareSat: base ? round3(roundTripSat / base) : null,
    tripsWed: view.trips.length, tripsSat: satView.trips.length,
    stops,
  };
}

export function feedRow(f, r, date) {
  return {
    organization_id: f.org, feed_id: f.feed, organization_name: f.orgName, feed_name: f.feedName, pref_id: f.pref, license: f.license,
    hubs: r.hubs.map(h => h.name).join('／'), places: r.places, places_with_departures: r.base,
    ...r.counts,
    round_trip: r.roundTrip, share_round_trip: r.share === null ? '' : r.share,
    round_trip_sat: r.roundTripSat, share_round_trip_sat: r.shareSat === null ? '' : r.shareSat,
    trips_wed: r.tripsWed, trips_sat: r.tripsSat, app_url: appUrl(f, date, r.hubs[0].key),
  };
}

export function stopRows(f, r) {
  return r.stops.map(s => ({
    organization_id: f.org, feed_id: f.feed, stop_key: s.key, stop_name: s.name, lat: s.lat, lon: s.lon,
    status: s.status, status_sat: s.statusSat, hub_name: s.hub, arrive: s.arrive, last_back: s.lastBack, max_stay_min: s.maxStayMin,
  }));
}

// UTF-8 CSV with a BOM (so Excel in Japan opens it correctly) and CRLF line ends.
export function toCsv(columns, rows) {
  const q = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [columns.join(','), ...rows.map(r => columns.map(c => q(r[c])).join(','))].join('\r\n') + '\r\n';
}
