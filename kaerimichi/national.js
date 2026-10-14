// national.js - the national results page (national.html). For every feed in Japan's GTFS Data Repository:
// the share of stops from which a hospital-named stop can be reached, with time there, and left again the same day
// (data/national/<date>/, written by tools/national_gaps.mjs with the app's own gtfs.js).
// Tables by prefecture and by feed, and a map of every stop's verdict for one prefecture.
// MV2 of Munim, Inc. - Apache-2.0 license.
import { parseCSV } from './gtfs.js';

export const EDITIONS = ['2026-10-21'];
const REPO = 'munimtechnologies/kaerimichi';
// The data is read from beside the page, else from the repository (raw.githubusercontent.com allows CORS).
const DATA_ROOTS = ['./data/national/', `https://raw.githubusercontent.com/${REPO}/main/data/national/`];
export const STATUSES = ['ok', 'okx', 'noreturn', 'oneway', 'none', 'idle', 'hub'];
export const COLOURS = { ok: '#1a9850', okx: '#91cf60', noreturn: '#fc8d59', oneway: '#d73027', none: '#762a83', idle: '#9e9e9e', hub: '#ffffff' };
const NUMBERS = new Set(['pref_id', 'feeds_analysed', 'places_with_departures', 'round_trip', 'share', 'round_trip_sat', 'share_sat',
  'places', 'hub', 'ok', 'okx', 'noreturn', 'oneway', 'none', 'idle', 'share_round_trip', 'share_round_trip_sat',
  'trips_wed', 'trips_sat', 'lat', 'lon', 'max_stay_min']);

export const num = n => (n === null || n === undefined ? '–' : n.toLocaleString('en-US'));
export const pct = x => (x === null || x === undefined || Number.isNaN(x) ? '–' : (x * 100).toFixed(1) + '%');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only stops with coordinates inside Japan go on the map (one source feed lists a stop with latitude and longitude swapped).
export const onMap = s => s.lat !== null && s.lon !== null && s.lat >= 20 && s.lat <= 46 && s.lon >= 122 && s.lon <= 154;

export const TEXT = {
  ja: {
    title: 'かえりみち 全国版',
    tagline: 'バスで病院へ行って、その日のうちに帰ってこられる停留所は？',
    app: 'アプリで調べる',
    loading: '読み込み中…',
    missing: 'この日付の集計はまだ公開されていません。',
    lead: (s, n) => `全国の公開GTFS ${num(s.feeds_analysed)}件（GTFSデータリポジトリの一覧 ${num(s.feeds_listed)}件のうち、病院名の停留所があり対象日に運行するもの）で、平日に発車がある停留所 ${num(n.places_with_departures)}か所（病院の停留所を除く）を調べました。`
      + `病院名の停留所へ行って${Math.round(s.settings.min_stay_s / 60)}分以上いて、その日のうちに戻ってこられるのは<b>平日 ${pct(n.share)}</b>（${num(n.round_trip)}か所）、<b>土曜 ${pct(n.share_sat)}</b>（${num(n.round_trip_sat)}か所）です。`,
    perFeed: f => `データごとの割合の中央値は ${pct(f.median_share)}。どの停留所からも往復できないデータが ${num(f.share_zero)}件、平日は往復できるのに土曜はできないデータが ${num(f.round_trip_weekday_but_not_saturday)}件あり、土曜に運行がないデータは ${num(f.no_saturday_service)}件です。`,
    dateLine: s => `対象日: ${s.date}（水）と ${s.saturday}（土）・乗り換え${s.settings.transfers}回まで（乗り継ぎ${Math.round(s.settings.min_connection_s / 60)}分以上）・病院での滞在${Math.round(s.settings.min_stay_s / 60)}分以上`,
    prefHead: '都道府県別',
    feedHead: 'データ（事業者）別',
    mapHead: '停留所ごとの判定',
    sortHint: '見出しをクリックすると並べ替えます。',
    all: '全国',
    pickPref: '都道府県を選ぶと、その停留所ごとの判定を地図に表示します。',
    weekday: '平日（水）',
    saturday: '土曜',
    shown: (n, name) => `${name}: ${num(n)}か所の停留所`,
    cols: {
      pref_name: '都道府県', feeds_analysed: 'データ数', places_with_departures: '停留所', round_trip: '往復できる',
      share: '平日', share_sat: '土曜', feed_name: '事業者・データ', share_round_trip: '平日', share_round_trip_sat: '土曜',
      hubs: '病院の停留所', app_url: '地図',
    },
    open: 'アプリで開く',
    status: {
      ok: '直通で往復できる', okx: '乗り換えありで往復できる', noreturn: '行けるが帰りに間に合わない',
      oneway: '行けるが帰りの便がない', none: '病院の停留所へ行けない', idle: 'この日は発車なし', hub: '病院の停留所',
    },
    arrive: '最初に着く', lastBack: '帰りの最終', maxStay: '最大の滞在', minutes: m => `${m}分`, to: '行き先',
    methodHead: '方法と限界',
    method: [
      '病院の停留所は、停留所名に「病院・医院・クリニック・診療所・医療センター」を含むもの（アプリの「病院」ボタンと同じ）のうち、その日に便が止まるものを、データごとに発車本数の多い順に最大3か所選びます。停留所ごとに、そのうち最も良い判定を採ります。',
      '計算はアプリと同じコード（gtfs.js）です。直通または同じデータ内での乗り換え1回、病院での滞在30分以上。割合の分母は平日に発車がある停留所（病院の停留所を除く）で、土曜も同じ分母です。',
      '限界: 病院は停留所名だけで見つけているため、病院名の停留所は病院の近さの目安にすぎず、病院名の停留所がないデータは対象外です。時刻表だけを使い、運賃・歩行・遅れ・別データ（鉄道や他の事業者）との乗り継ぎは含みません。デマンド交通（予約制）も含みません。複数のデータに入っている停留所は、データごとに数えています。',
      '割合が低く出やすい場合: 病院の停留所はデータごとに最大3か所なので、地区ごとに別の病院へ向かう路線が多い大きなデータ（例: 鹿児島市「あいばす」）では低めに出ます。到着用と出発用で名前が違う停留所（「（着）」「（発）」など）は別の停留所として扱うため、往復できないと判定されることがあります（例: 八重瀬町バス）。また、停留所名のパターンは歯科医院にも一致し、20件のデータで病院の停留所の1つが歯科医院でした（この集計ではそのまま含めています）。座標がデータ上で入れ替わっている停留所は地図に表示しません。',
      '正式な「交通空白」の判断は自治体や運輸局が行うものです。この結果は、その検討や地域公共交通会議の材料としてお使いください。',
    ],
    filesHead: 'データのダウンロード（CC BY 4.0）',
    files: 'feeds.csv（データ別）・prefectures.csv（都道府県別）・stops/NN.csv（停留所別）・skipped.csv（対象外と理由）・summary.json・README.md',
    repo: 'GitHubで一覧を見る',
    credit: 'データ: GTFSデータリポジトリと各データの提供者（ライセンスは feeds.csv の license 列、多くは CC BY 4.0）、地理院タイル。集計は CC BY 4.0、コードは Apache-2.0。',
    by: 'この分析とページは、MV2（Munim, Inc.）の名のもと、AIエージェントが作成しました。お問い合わせはデータ提供事業者ではなく、下記へお願いします。',
  },
  en: {
    title: 'Kaerimichi: all of Japan',
    tagline: 'From which bus stops can you get to hospital and back the same day?',
    app: 'Check a trip in the app',
    loading: 'Loading…',
    missing: 'The results for this date have not been published yet.',
    lead: (s, n) => `${num(s.feeds_analysed)} open GTFS feeds (of the ${num(s.feeds_listed)} in Japan's GTFS Data Repository; those with a hospital-named stop and service on the day) and their ${num(n.places_with_departures)} stops with a weekday departure (hospital stops excluded) were checked. `
      + `From <b>${pct(n.share)} on a weekday</b> (${num(n.round_trip)} stops) and <b>${pct(n.share_sat)} on Saturday</b> (${num(n.round_trip_sat)}) you can reach a hospital-named stop, stay at least ${Math.round(s.settings.min_stay_s / 60)} minutes and get back the same day.`,
    perFeed: f => `The median share per feed is ${pct(f.median_share)}. In ${num(f.share_zero)} feeds no stop can make the round trip; ${num(f.round_trip_weekday_but_not_saturday)} feeds allow it on the weekday but not on Saturday; ${num(f.no_saturday_service)} feeds have no Saturday service.`,
    dateLine: s => `Dates: Wed ${s.date} and Sat ${s.saturday}; up to ${s.settings.transfers} transfer (at least ${Math.round(s.settings.min_connection_s / 60)} min to change); at least ${Math.round(s.settings.min_stay_s / 60)} min at the hospital`,
    prefHead: 'By prefecture',
    feedHead: 'By feed (operator)',
    mapHead: 'Every stop\'s verdict',
    sortHint: 'Click a heading to sort.',
    all: 'All of Japan',
    pickPref: 'Choose a prefecture to map the verdict for each of its stops.',
    weekday: 'Weekday (Wed)',
    saturday: 'Saturday',
    shown: (n, name) => `${name}: ${num(n)} stops`,
    cols: {
      pref_name: 'Prefecture', feeds_analysed: 'Feeds', places_with_departures: 'Stops', round_trip: 'Round trip',
      share: 'Weekday', share_sat: 'Saturday', feed_name: 'Operator / feed', share_round_trip: 'Weekday', share_round_trip_sat: 'Saturday',
      hubs: 'Hospital stops', app_url: 'Map',
    },
    open: 'Open in the app',
    status: {
      ok: 'Round trip, direct', okx: 'Round trip with a transfer', noreturn: 'Can get there, but the last bus back leaves too early',
      oneway: 'Can get there, but no bus back', none: 'No way to a hospital stop', idle: 'No departures that day', hub: 'Hospital stop',
    },
    arrive: 'First arrival', lastBack: 'Last bus back', maxStay: 'Longest stay', minutes: m => `${m} min`, to: 'Destination',
    methodHead: 'Method and limits',
    method: [
      'Hospital stops are the stops whose names contain 病院, 医院, クリニック, 診療所 or 医療センター (the app\'s Hospital button) and that a trip serves that day: up to three per feed, busiest first. Each stop takes its best verdict over them.',
      'The calculation is the app\'s own code (gtfs.js): direct buses or one transfer within the same feed, at least 30 minutes at the hospital. Both shares use the same base, the stops with a weekday departure (hospital stops excluded).',
      'Limits: hospitals are found only by stop names, so a hospital-named stop is a proxy, and feeds without one are left out. Timetables only: no fares, walking, delays or connections to other feeds (rail or other operators). Demand-responsive transit is not included. A stop that appears in several feeds is counted once per feed.',
      'Where shares come out low: with at most three hospital stops per feed, large feeds whose routes serve a different hospital in each district (for example Kagoshima\'s Aibus) score lower. Stops named separately for arriving and departing (（着） and （発）) count as different stops, so a round trip through them can be missed (for example Yaese town bus). The name pattern also matches dentists: in 20 feeds one of the three hospital stops is a dentist\'s (kept as is in these results). Stops whose coordinates are swapped in the source data are left off the map.',
      'Official decisions on transport gaps (交通空白) are made by municipalities and MLIT\'s regional bureaus; use this as input for that work.',
    ],
    filesHead: 'Download the data (CC BY 4.0)',
    files: 'feeds.csv (per feed), prefectures.csv, stops/NN.csv (per stop), skipped.csv (left out, with reasons), summary.json, README.md',
    repo: 'See the files on GitHub',
    credit: 'Data: the GTFS Data Repository and each feed\'s publisher (licence in the license column of feeds.csv, mostly CC BY 4.0); GSI tiles. Results CC BY 4.0, code Apache-2.0.',
    by: 'This analysis and page were made by AI agents working in the name of MV2 (Munim, Inc.). Please send questions to the address below, not to the transit operators.',
  },
};

// CSV text with a header row -> objects; number columns become numbers ('' -> null).
export function rows(text) {
  const all = parseCSV(text);
  const head = (all.shift() || []).map(h => h.trim());
  return all.filter(r => r.length > 1 || (r[0] || '').trim()).map(r => {
    const o = {};
    head.forEach((h, k) => {
      const v = (r[k] || '').trim();
      o[h] = NUMBERS.has(h) ? (v === '' ? null : +v) : v;
    });
    return o;
  });
}

// Sorted copy; empty values last in either direction.
export function sortRows(list, key, desc = false) {
  const empty = v => v === null || v === undefined || v === '';
  return list.slice().sort((a, b) => {
    const x = a[key], y = b[key];
    if (empty(x) || empty(y)) return empty(x) - empty(y);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ja');
    return desc ? -c : c;
  });
}

export function leadHtml(s, t) {
  return `<p class="lead">${t.lead(s, s.national)}</p><p>${t.perFeed(s.feeds)}</p><p class="muted small">${esc(t.dateLine(s))}</p>`;
}

const shareCell = x => `<td class="share"><span class="bar"><i style="width:${x === null ? 0 : Math.round(x * 100)}%"></i></span>${pct(x)}</td>`;

function head(cols, t, sort) {
  return '<tr>' + cols.map(c => {
    const mark = sort.key === c ? (sort.desc ? ' ▼' : ' ▲') : '';
    return c === 'app_url' || c === 'hubs' ? `<th>${esc(t.cols[c])}</th>` : `<th data-sort="${c}" tabindex="0">${esc(t.cols[c])}${mark}</th>`;
  }).join('') + '</tr>';
}

export function prefTableHtml(prefs, t, sort) {
  const cols = ['pref_name', 'feeds_analysed', 'places_with_departures', 'round_trip', 'share', 'share_sat'];
  const body = sortRows(prefs, sort.key, sort.desc).map(p => `<tr><td><a href="#map" data-pref="${p.pref_id}">${esc(p.pref_name)}</a></td>`
    + `<td class="n">${num(p.feeds_analysed)}</td><td class="n">${num(p.places_with_departures)}</td><td class="n">${num(p.round_trip)}</td>`
    + shareCell(p.share) + shareCell(p.share_sat) + '</tr>').join('');
  return `<table><thead>${head(cols, t, sort)}</thead><tbody>${body}</tbody></table>`;
}

// pref: a prefecture id to show only its feeds, or null for all.
export function feedTableHtml(feeds, t, sort, pref) {
  const cols = ['feed_name', 'places_with_departures', 'round_trip', 'share_round_trip', 'share_round_trip_sat', 'hubs', 'app_url'];
  const list = pref === null ? feeds : feeds.filter(f => f.pref_id === pref);
  const body = sortRows(list, sort.key, sort.desc).map(f => `<tr><td>${esc(f.organization_name)}<br><span class="small">${esc(f.feed_name)}</span></td>`
    + `<td class="n">${num(f.places_with_departures)}</td><td class="n">${num(f.round_trip)}</td>`
    + shareCell(f.share_round_trip) + shareCell(f.share_round_trip_sat)
    + `<td class="small">${esc(f.hubs)}</td><td><a href="${esc(f.app_url)}" target="_blank" rel="noopener">${esc(t.open)}</a></td></tr>`).join('');
  return `<table><thead>${head(cols, t, sort)}</thead><tbody>${body}</tbody></table>`;
}

// The popup of one stop on the map; `feed` is its feeds.csv row (or undefined).
export function popupHtml(s, feed, day, t) {
  const status = day === 'sat' ? s.status_sat : s.status;
  let html = `<b>${esc(s.stop_name)}</b><br><span class="small">${esc(feed ? feed.organization_name + ' ' + feed.feed_name : s.feed_id)}</span>`;
  html += `<br>${esc(t.weekday)}: ${esc(t.status[s.status] || s.status)}<br>${esc(t.saturday)}: ${esc(t.status[s.status_sat] || s.status_sat)}`;
  if (s.hub_name && s.status !== 'hub') html += `<br>${esc(t.to)}: ${esc(s.hub_name)}`;
  if (s.arrive) html += `<br>${esc(t.weekday)}: ${esc(t.arrive)} ${esc(s.arrive)}・${esc(t.lastBack)} ${esc(s.last_back)}`;
  if (s.max_stay_min !== null && s.max_stay_min !== undefined) html += `・${esc(t.maxStay)} ${esc(t.minutes(s.max_stay_min))}`;
  if (feed && status !== undefined) html += `<br><a href="${esc(feed.app_url)}" target="_blank" rel="noopener">${esc(t.open)}</a>`;
  return html;
}

// ---- page ----

async function start() {
  const $ = s => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  let lang = params.get('lang') || ((navigator.language || 'ja').startsWith('ja') ? 'ja' : 'en');
  if (!TEXT[lang]) lang = 'ja';
  const t = TEXT[lang];
  const date = EDITIONS.includes(params.get('date')) ? params.get('date') : EDITIONS[EDITIONS.length - 1];

  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t[el.dataset.t];
  $('#method').innerHTML = t.method.map(p => `<p>${esc(p)}</p>`).join('');
  const other = lang === 'ja' ? 'en' : 'ja';
  const q = new URLSearchParams(location.search);
  q.set('lang', other);
  $('#lang').href = '?' + q.toString();
  $('#lang').textContent = other === 'en' ? 'English' : '日本語';
  $('#applink').href = './' + (lang === 'ja' ? '' : '?lang=en');
  $('#lead').textContent = t.loading;

  let root = null, summary;
  for (const r of DATA_ROOTS) {
    try {
      const res = await fetch(r + date + '/summary.json');
      if (res.ok) { summary = await res.json(); root = r + date + '/'; break; }
    } catch (e) { /* try the next place */ }
  }
  if (!root) { $('#lead').textContent = t.missing; return; }
  const text = async name => { const res = await fetch(root + name); if (!res.ok) throw new Error(res.status + ' ' + name); return res.text(); };
  const [prefs, feeds] = await Promise.all([text('prefectures.csv').then(rows), text('feeds.csv').then(rows)]);
  const feedOf = new Map(feeds.map(f => [f.organization_id + '/' + f.feed_id, f]));

  $('#lead').innerHTML = leadHtml(summary, t);
  $('#files').innerHTML = ['feeds.csv', 'prefectures.csv', 'skipped.csv', 'summary.json', 'README.md']
    .map(f => `<a href="${esc(root + f)}">${f}</a>`).join('・')
    + `・<a href="https://github.com/${REPO}/tree/main/data/national/${date}" target="_blank" rel="noopener">${esc(t.repo)}</a>`;

  const state = {
    prefSort: { key: 'pref_id', desc: false }, feedSort: { key: 'share_round_trip', desc: false },
    pref: null, day: 'wed', stops: new Map(),
  };
  const sel = $('#pref');
  sel.innerHTML = `<option value="">${esc(t.all)}</option>` + prefs.map(p => `<option value="${p.pref_id}">${esc(p.pref_name)}</option>`).join('');

  const map = L.map('map', { preferCanvas: true }).setView([36.5, 138], 5);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);

  const drawTables = () => {
    $('#prefs').innerHTML = prefTableHtml(prefs, t, state.prefSort);
    $('#feeds').innerHTML = feedTableHtml(feeds, t, state.feedSort, state.pref);
  };
  const drawMap = () => {
    layer.clearLayers();
    const list = state.pref === null ? null : state.stops.get(state.pref);
    if (!list) { $('#maplegend').textContent = t.pickPref; return; }
    const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
    const bounds = [];
    for (const s of list) {
      if (!onMap(s)) continue;
      const status = state.day === 'sat' ? s.status_sat : s.status;
      counts[status] = (counts[status] || 0) + 1;
      bounds.push([s.lat, s.lon]);
      L.circleMarker([s.lat, s.lon], {
        radius: status === 'hub' ? 7 : 4, color: '#424242', weight: status === 'hub' ? 2 : 0.5,
        fillColor: COLOURS[status] || '#000', fillOpacity: 0.9,
      }).bindPopup(popupHtml(s, feedOf.get(s.organization_id + '/' + s.feed_id), state.day, t)).addTo(layer);
    }
    const name = (prefs.find(p => p.pref_id === state.pref) || {}).pref_name || '';
    $('#maplegend').innerHTML = `<p>${esc(t.shown(list.length, name))}（${esc(state.day === 'sat' ? t.saturday : t.weekday)}）</p><ul>`
      + STATUSES.map(s => `<li><i style="background:${COLOURS[s]}"></i>${esc(t.status[s])}: ${num(counts[s])}</li>`).join('') + '</ul>';
    if (bounds.length) map.fitBounds(bounds, { padding: [20, 20] });
  };
  const choose = async id => {
    state.pref = id;
    sel.value = id === null ? '' : String(id);
    const u = new URLSearchParams(location.search);
    if (id === null) u.delete('pref'); else u.set('pref', String(id));
    history.replaceState(null, '', '?' + u.toString());
    drawTables();
    if (id !== null && !state.stops.has(id)) {
      $('#maplegend').textContent = t.loading;
      try {
        state.stops.set(id, rows(await text('stops/' + String(id).padStart(2, '0') + '.csv')));
      } catch (e) {
        $('#maplegend').textContent = String(e.message || e);
        return;
      }
    }
    if (id === null) map.setView([36.5, 138], 5);
    drawMap();
  };

  const sortBy = (which, key) => {
    const s = state[which];
    if (s.key === key) s.desc = !s.desc; else { s.key = key; s.desc = /share|round_trip|places|feeds/.test(key); }
    drawTables();
  };
  for (const [id, which] of [['#prefs', 'prefSort'], ['#feeds', 'feedSort']]) {
    $(id).addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]');
      if (th) { sortBy(which, th.dataset.sort); return; }
      const a = e.target.closest('a[data-pref]');
      if (a) { e.preventDefault(); choose(+a.dataset.pref); $('#map').scrollIntoView({ behavior: 'smooth' }); }
    });
    $(id).addEventListener('keydown', e => {
      const th = e.target.closest('th[data-sort]');
      if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sortBy(which, th.dataset.sort); }
    });
  }
  sel.addEventListener('change', () => choose(sel.value === '' ? null : +sel.value));
  for (const r of document.querySelectorAll('input[name=day]')) {
    r.addEventListener('change', () => { state.day = r.value; drawMap(); });
  }

  const want = +params.get('pref');
  if (want && prefs.some(p => p.pref_id === want)) await choose(want);
  else { drawTables(); drawMap(); }
}

if (typeof document !== 'undefined') start();
