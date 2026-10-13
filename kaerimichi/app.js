// app.js - Kaerimichi UI: pick a feed, a date and two stops; see if you can go and come back.
// MV2 of Munim, Inc. - MIT license.
import { loadGTFS, dayView, journeys, roundTrip, serviceRange, weekday, fmtTime, fmtSpan, parseFeedList } from './gtfs.js';

const VERSION = '0.2';
const API = 'https://api.gtfs-data.jp/v2';
// The repository's feed list has no CORS header, so a snapshot ships with the app (feeds.txt).
// The zip files themselves are served with CORS and are fetched live.
const FEED_LIST_SOURCES = ['./feeds.txt', API + '/feeds'];
const MIN_CONNECTION = 5 * 60;
const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
  '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];

const TEXT = {
  ja: {
    title: 'かえりみち', tagline: 'バスで行って、その日のうちに帰ってこられる？',
    feed: '1. 路線データ', pickFeed: '都道府県・事業者を選ぶ…', listFail: 'GTFSデータリポジトリの一覧を読み込めませんでした。下の「ファイルを開く」でGTFSのzipを読み込めます。',
    orFile: 'またはGTFS zipファイルを開く', loading: '読み込み中…', loaded: n => `${n}か所の停留所を読み込みました。`,
    fetchFail: url => `データを直接取得できませんでした。<a href="${url}" target="_blank" rel="noopener">zipをダウンロード</a>して「ファイルを開く」から読み込んでください。`,
    when: '2. 日付', stay: '目的地での最低滞在', from: '3. 出発（自宅の近く）', to: '4. 行き先（病院・駅・買い物など）',
    search: '停留所名で検索、または地図をクリック', swap: '入れ替え', setFrom: 'ここから出発', setTo: 'ここへ行く',
    transfer: '乗り換え1回まで探す（乗り継ぎ5分以上）',
    noService: r => `この日は運行がありません。データの期間: ${r}`, outside: r => `データの期間外です（${r}）。`,
    pickBoth: '出発と行き先の停留所を選んでください。', same: '出発と行き先が同じです。',
    none: '行きのバスがありません（この日は運行なし、または乗り換えが2回以上必要）。',
    noneDirect: '直通のバスはありません。「乗り換え1回まで探す」をオンにすると乗り継ぎも探します。',
    oneway: '行きのバスはありますが、この日の帰りのバスはありません。',
    noreturn: (a, b) => `行きの最初の到着は${a}ですが、帰りの最終は${b}発です。この日に往復はできません。`,
    ok: '往復できます', arrive: '最も早い到着', lastBack: '帰りの最終', maxStay: '最大の滞在時間', latest: '帰ってこられる最後の行き便',
    goTable: '行き', backTable: '帰り', dep: '発', arr: '着', backOn: '帰り', cantReturn: '帰れません',
    via: '乗換', direct: '直通',
    stopInfo: (n, f, l) => `この日の発車 ${n}本（始発 ${f}・最終 ${l}）`, noDep: 'この日の発車はありません',
    legend: 'この日の発車本数', source: '出典', modified: '本アプリで加工（直通便・乗り継ぎの抽出、集計）',
    note: '時刻は公開GTFSデータの予定時刻です。予約制の便やダイヤ改正、運休は各事業者の情報をご確認ください。乗り継ぎは同じデータ内の便だけを対象にしています。',
    trips: n => `${n}本`, share: 'この条件のURL', ending: d => `（データは${d}まで）`,
  },
  en: {
    title: 'Kaerimichi', tagline: 'Can you get there by bus and back the same day?',
    feed: '1. Transit data', pickFeed: 'Choose a prefecture and operator…', listFail: 'Could not load the GTFS Data Repository list. You can still open a GTFS zip file below.',
    orFile: 'or open a GTFS zip file', loading: 'Loading…', loaded: n => `Loaded ${n} stops.`,
    fetchFail: url => `Could not fetch the data directly. <a href="${url}" target="_blank" rel="noopener">Download the zip</a> and open it with the file button.`,
    when: '2. Date', stay: 'Minimum time at destination', from: '3. From (near home)', to: '4. To (hospital, station, shops…)',
    search: 'Search a stop name, or click the map', swap: 'Swap', setFrom: 'Start here', setTo: 'Go here',
    transfer: 'Allow one transfer (5 min minimum connection)',
    noService: r => `No service on this date. Data covers ${r}.`, outside: r => `Outside the data period (${r}).`,
    pickBoth: 'Choose a start stop and a destination stop.', same: 'Start and destination are the same stop.',
    none: 'No bus there (no service this day, or more than one transfer needed).',
    noneDirect: 'No direct bus. Turn on "Allow one transfer" to search connections too.',
    oneway: 'There is a bus there, but no bus back this day.',
    noreturn: (a, b) => `The first arrival is ${a}, but the last bus back leaves at ${b}. No same-day round trip.`,
    ok: 'Round trip possible', arrive: 'Earliest arrival', lastBack: 'Last bus back', maxStay: 'Longest stay', latest: 'Last bus there that still gets you home',
    goTable: 'There', backTable: 'Back', dep: 'dep', arr: 'arr', backOn: 'back', cantReturn: 'no way back',
    via: 'change at', direct: 'direct',
    stopInfo: (n, f, l) => `${n} departures this day (first ${f}, last ${l})`, noDep: 'No departures this day',
    legend: 'Departures this day', source: 'Source', modified: 'processed by this app (direct trips and connections extracted and counted)',
    note: 'Times are the scheduled times in the published GTFS data. Check with the operator for on-demand trips, timetable changes and cancellations. Connections only use trips in the same data set.',
    trips: n => `${n} trips`, share: 'Link to this view', ending: d => `(data until ${d})`,
  },
};

const params = new URLSearchParams(location.search);
let lang = params.get('lang') || ((navigator.language || 'ja').startsWith('ja') ? 'ja' : 'en');
if (!TEXT[lang]) lang = 'ja';
const t = TEXT[lang];

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { model: null, view: null, from: null, to: null, ymd: null, stay: 30, transfer: true, meta: null, feedKey: null, feeds: [] };

// ---- map ----

const map = L.map('map', { preferCanvas: true }).setView([36.5, 138], 5);
L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
}).addTo(map);
const layer = L.layerGroup().addTo(map);

function colour(n) {
  if (!n) return '#9e9e9e';
  if (n < 5) return '#d73027';
  if (n < 15) return '#fc8d59';
  if (n < 40) return '#fee08b';
  if (n < 100) return '#91cf60';
  return '#1a9850';
}

function placeName(p) {
  return lang === 'en' && p.en ? `${p.en} (${p.name})` : p.name;
}

function popup(i) {
  const p = state.model.places[i];
  const s = state.view.stat[i];
  const el = document.createElement('div');
  el.className = 'pop';
  const info = s.n ? t.stopInfo(s.n, fmtTime(s.first, lang), fmtTime(s.last, lang)) : t.noDep;
  el.innerHTML = `<b>${esc(placeName(p))}</b><br>${esc(info)}<br>`;
  for (const [label, which] of [[t.setFrom, 'from'], [t.setTo, 'to']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { choose(which, i); map.closePopup(); };
    el.appendChild(b);
  }
  return el;
}

function drawStops() {
  layer.clearLayers();
  const { model, view } = state;
  if (!model) return;
  model.places.forEach((p, i) => {
    if (p.lat === undefined) return;
    const picked = i === state.from || i === state.to;
    const m = L.circleMarker([p.lat, p.lon], {
      radius: picked ? 10 : 6,
      color: picked ? (i === state.from ? '#1565c0' : '#6a1b9a') : '#424242',
      weight: picked ? 4 : 1,
      fillColor: colour(view.stat[i].n),
      fillOpacity: 0.9,
    });
    m.bindTooltip(placeName(p));
    m.bindPopup(() => popup(i));
    m.addTo(layer);
  });
}

// ---- feed list ----

async function fetchFeedList() {
  let lastErr = null;
  for (const url of FEED_LIST_SOURCES) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(url + ' ' + res.status);
      const list = parseFeedList(await res.text());
      if (list.length) return list;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('no feed list');
}

async function loadFeedList() {
  const sel = $('#feed');
  try {
    const feeds = (await fetchFeedList()).filter(f => !f.discontinued);
    feeds.sort((a, b) => (a.pref - b.pref) || a.orgName.localeCompare(b.orgName, 'ja') || a.feedName.localeCompare(b.feedName, 'ja'));
    state.feeds = feeds;
    const groups = new Map();
    const soon = ymdOf(new Date(Date.now() + 45 * 86400000));
    for (const f of feeds) {
      const pref = PREFS[f.pref - 1] || 'その他・広域';
      if (!groups.has(pref)) {
        const g = document.createElement('optgroup');
        g.label = pref;
        groups.set(pref, g);
        sel.appendChild(g);
      }
      const o = document.createElement('option');
      o.value = f.org + '/' + f.feed;
      let label = f.orgName === f.feedName ? f.feedName : `${f.orgName}：${f.feedName}`;
      if (f.end && f.end.replace(/-/g, '') < soon) label += ' ' + t.ending(f.end);
      o.textContent = label;
      groups.get(pref).appendChild(o);
    }
    const want = params.get('feed');
    if (want && feeds.some(f => f.org + '/' + f.feed === want)) {
      sel.value = want;
      loadFromRepo(want);
    }
  } catch (e) {
    status(t.listFail);
  }
}

function zipUrl(key) {
  const [org, feed] = key.split('/');
  return `${API}/organizations/${encodeURIComponent(org)}/feeds/${encodeURIComponent(feed)}/files/feed.zip?rid=current`;
}

async function loadFromRepo(key) {
  const f = state.feeds.find(x => x.org + '/' + x.feed === key);
  const meta = f ? { org: f.orgName, feed: f.feedName, license: f.license, licenseUrl: f.licenseUrl } : null;
  const url = zipUrl(key);
  status(t.loading);
  let buf;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    buf = await res.arrayBuffer();
  } catch (e) {
    status(t.fetchFail(esc(url)));
    return;
  }
  await useZip(buf, meta, key);
}

async function useZip(buf, meta, key) {
  status(t.loading);
  try {
    state.model = await loadGTFS(buf);
  } catch (e) {
    status(esc(String(e.message || e)));
    return;
  }
  state.meta = meta;
  state.feedKey = key;
  state.from = state.to = null;
  const range = serviceRange(state.model);
  state.range = range;
  const today = ymdOf(new Date());
  let day = params.get('date') && params.get('date').replace(/-/g, '');
  if (!day || !/^\d{8}$/.test(day)) day = today;
  if (range.start && (day < range.start || day > range.end)) {
    if (today < range.start) day = range.start;
    else if (today > range.end) day = range.end;
    else day = today;
  }
  setDate(day);
  fillSearch();
  const pts = state.model.places.filter(p => p.lat !== undefined).map(p => [p.lat, p.lon]);
  if (pts.length) map.fitBounds(pts, { padding: [20, 20] });
  status(t.loaded(state.model.places.length));
  const fromKey = params.get('from'), toKey = params.get('to');
  $('#from').value = $('#to').value = '';
  if (fromKey) choose('from', state.model.places.findIndex(p => p.key === fromKey), true);
  if (toKey) choose('to', state.model.places.findIndex(p => p.key === toKey), true);
  for (const k of ['from', 'to', 'date']) params.delete(k);
  showSource();
  render();
}

// ---- controls ----

function ymdOf(d) {
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

function dashed(ymd) {
  return ymd ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : '';
}

function setDate(ymd) {
  state.ymd = ymd;
  $('#date').value = dashed(ymd);
  const wd = lang === 'ja' ? '日月火水木金土'[weekday(ymd)] + '曜日' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(ymd)];
  $('#weekday').textContent = wd;
  if (state.model) state.view = dayView(state.model, ymd);
}

function fillSearch() {
  const list = $('#places');
  list.innerHTML = '';
  const seen = new Map();
  state.labels = new Map();
  state.model.places.forEach((p, i) => {
    let label = placeName(p);
    const n = (seen.get(label) || 0) + 1;
    seen.set(label, n);
    if (n > 1) label += ` (${n})`;
    state.labels.set(label, i);
    p.label = label;
    const o = document.createElement('option');
    o.value = label;
    list.appendChild(o);
  });
}

function choose(which, i, quiet) {
  if (i === undefined || i === null || i < 0) return;
  state[which] = i;
  $('#' + which).value = state.model.places[i].label || placeName(state.model.places[i]);
  if (!quiet) render();
}

function status(html) {
  $('#status').innerHTML = html;
}

function showSource() {
  const m = state.meta;
  const agencies = state.model.agencies.join('、');
  let html;
  if (m) {
    const lic = m.licenseUrl ? `<a href="${esc(m.licenseUrl)}" target="_blank" rel="noopener">${esc(m.license || '')}</a>` : esc(m.license || '');
    html = `${t.source}: ${esc(m.org)}「${esc(m.feed)}」（${lic}）／<a href="https://gtfs-data.jp/" target="_blank" rel="noopener">GTFSデータリポジトリ</a> — ${t.modified}`;
  } else {
    html = `${t.source}: ${esc(agencies)} — ${t.modified}`;
  }
  $('#source').innerHTML = html;
}

function updateUrl() {
  const q = new URLSearchParams();
  if (state.feedKey) q.set('feed', state.feedKey);
  if (state.ymd) q.set('date', dashed(state.ymd));
  if (state.from !== null) q.set('from', state.model.places[state.from].key);
  if (state.to !== null) q.set('to', state.model.places[state.to].key);
  if (!state.transfer) q.set('transfer', '0');
  if (lang !== 'ja') q.set('lang', lang);
  history.replaceState(null, '', '?' + q.toString());
  q.set('lang', lang === 'ja' ? 'en' : 'ja');
  $('#lang').href = '?' + q.toString();
}

// ---- result ----

function routeChip(trip) {
  const r = state.model.routes.get(trip.route) || {};
  const name = r.short || r.long || trip.route;
  const bg = /^[0-9a-fA-F]{6}$/.test(r.color || '') ? '#' + r.color : '#eeeeee';
  const fg = /^[0-9a-fA-F]{6}$/.test(r.text || '') ? '#' + r.text : '#000000';
  const head = trip.headsign ? ` ${esc(trip.headsign)}` : '';
  return `<span class="chip" style="background:${bg};color:${fg}">${esc(name)}</span>${head}`;
}

// One journey's route cell: a chip per leg, with the change stop and times in between.
function journeyCell(j) {
  if (j.legs.length === 1) return routeChip(j.trip);
  const [a, b] = j.legs;
  const via = placeName(state.model.places[j.via]);
  return `${routeChip(a.trip)}<div class="via">↓ ${t.via} <b>${esc(via)}</b> ${fmtTime(a.arr, lang)}${t.arr} → ${fmtTime(b.dep, lang)}${t.dep}</div>${routeChip(b.trip)}`;
}

function table(rows, withBack) {
  if (!rows.length) return '<p class="muted">—</p>';
  let html = '<table><tbody>';
  for (const row of rows) {
    const x = withBack ? row.out : row;
    html += `<tr><td class="time">${fmtTime(x.dep, lang)} ${t.dep}</td><td class="time">${fmtTime(x.arr, lang)} ${t.arr}</td><td>${journeyCell(x)}</td>`;
    if (withBack) html += `<td class="back">${row.back ? `${t.backOn} ${fmtTime(row.back.dep, lang)}` : `<span class="bad">${t.cantReturn}</span>`}</td>`;
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

function render() {
  const box = $('#result');
  const { model } = state;
  if (!model) { box.innerHTML = ''; return; }
  drawStops();
  updateUrl();
  const r = state.range;
  const rangeText = r && r.start ? `${dashed(r.start)} – ${dashed(r.end)}` : '?';
  const notes = [];
  if (r && r.start && (state.ymd < r.start || state.ymd > r.end)) notes.push(t.outside(rangeText));
  else if (!state.view.trips.length) notes.push(t.noService(rangeText));
  let html = notes.map(n => `<p class="warn">${esc(n)}</p>`).join('');
  if (state.from === null || state.to === null) {
    const one = state.from !== null ? state.from : state.to;
    if (one !== null) {
      const s = state.view.stat[one];
      html += `<p><b>${esc(placeName(model.places[one]))}</b>: ${esc(s.n ? t.stopInfo(s.n, fmtTime(s.first, lang), fmtTime(s.last, lang)) : t.noDep)}</p>`;
    }
    box.innerHTML = html + `<p class="muted">${t.pickBoth}</p>`;
    return;
  }
  if (state.from === state.to) { box.innerHTML = html + `<p class="warn">${t.same}</p>`; return; }
  const transfers = state.transfer ? 1 : 0;
  const outs = journeys(state.view, state.from, state.to, transfers, MIN_CONNECTION);
  const backs = journeys(state.view, state.to, state.from, transfers, MIN_CONNECTION);
  const rt = roundTrip(outs, backs, state.stay * 60);
  if (rt.status === 'none') html += `<div class="verdict no">✕ ${state.transfer ? t.none : t.noneDirect}</div>`;
  else if (rt.status === 'oneway') html += `<div class="verdict no">✕ ${t.oneway}</div>`;
  else if (rt.status === 'noreturn') html += `<div class="verdict no">✕ ${esc(t.noreturn(fmtTime(rt.firstArr, lang), fmtTime(rt.lastBack, lang)))}</div>`;
  else {
    const lo = rt.latestOut;
    const loVia = lo.via !== null ? ` (${t.via} ${esc(placeName(model.places[lo.via]))})` : '';
    html += `<div class="verdict ok">◯ ${t.ok}</div><dl class="facts">
      <dt>${t.arrive}</dt><dd>${fmtTime(rt.firstArr, lang)}</dd>
      <dt>${t.lastBack}</dt><dd>${fmtTime(rt.lastBack, lang)}</dd>
      <dt>${t.maxStay}</dt><dd>${fmtSpan(rt.maxStay, lang)}</dd>
      <dt>${t.latest}</dt><dd>${fmtTime(lo.dep, lang)} ${t.dep}${loVia}</dd></dl>`;
  }
  if (outs.length || backs.length) {
    html += `<h3>${t.goTable} <small>${t.trips(outs.length)}</small></h3>${table(rt.plans, true)}`;
    html += `<h3>${t.backTable} <small>${t.trips(backs.length)}</small></h3>${table(backs, false)}`;
  }
  html += `<p class="muted small">${t.note}</p><p class="small"><a href="${esc(location.href)}">${t.share}</a></p>`;
  box.innerHTML = html;
}

// ---- wiring ----

function applyText() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t[el.dataset.t];
  for (const el of document.querySelectorAll('[data-ph]')) el.placeholder = t[el.dataset.ph];
  $('#feed option[value=""]').textContent = t.pickFeed;
  const other = lang === 'ja' ? 'en' : 'ja';
  const q = new URLSearchParams(location.search);
  q.set('lang', other);
  $('#lang').href = '?' + q.toString();
  $('#lang').textContent = other === 'en' ? 'English' : '日本語';
  $('#version').textContent = 'v' + VERSION;
}

$('#feed').addEventListener('change', e => { if (e.target.value) loadFromRepo(e.target.value); });
$('#file').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (f) await useZip(await f.arrayBuffer(), null, null);
});
$('#date').addEventListener('change', e => {
  if (!e.target.value) return;
  setDate(e.target.value.replace(/-/g, ''));
  render();
});
$('#stay').addEventListener('change', e => { state.stay = +e.target.value; render(); });
$('#transfer').addEventListener('change', e => { state.transfer = e.target.checked; render(); });
for (const which of ['from', 'to']) {
  $('#' + which).addEventListener('change', e => {
    if (!state.model) return;
    const i = state.labels.get(e.target.value);
    if (i !== undefined) choose(which, i);
  });
}
$('#swap').addEventListener('click', () => {
  if (!state.model) return;
  [state.from, state.to] = [state.to, state.from];
  $('#from').value = state.from !== null ? state.model.places[state.from].label : '';
  $('#to').value = state.to !== null ? state.model.places[state.to].label : '';
  render();
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && f.name.toLowerCase().endsWith('.zip')) await useZip(await f.arrayBuffer(), null, null);
});

if (params.get('transfer') === '0') { state.transfer = false; $('#transfer').checked = false; }
applyText();
loadFeedList();
