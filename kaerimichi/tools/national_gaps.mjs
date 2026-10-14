// national_gaps.mjs - which stops in Japan's open GTFS feeds can reach a hospital by bus and get back
// the same day. Runs Kaerimichi's own gtfs.js (../gtfs.js) over every feed in the GTFS Data Repository,
// one feed at a time (each in its own process with a time and memory limit), and writes CSVs, a summary and a README.
// Usage: node tools/national_gaps.mjs --date 2026-10-21 --sat 2026-10-24 --out out [--limit N] [--budget-min 160] [--commit SHA] [--heap-mb 3072]
// MV2 of Munim, Inc. - Apache-2.0 license. Made with AI agents working in MV2's name.
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import {
  SETTINGS, HOSPITAL, STATUSES, FEED_COLUMNS, STOP_COLUMNS, SKIP_COLUMNS, PREF_COLUMNS,
  ymd, round3, prefName, skipReason, zipUrl, feedRow, stopRows, toCsv,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UA = 'Kaerimichi national analysis - MV2 of Munim, Inc. (munimversion2@gmail.com)';
const REPO = 'munimtechnologies/kaerimichi';
const FEED_LIMIT_MS = 120000;

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const date = arg('date', '2026-10-21');
const sat = arg('sat', '2026-10-24');
const outRoot = arg('out', 'out');
const limit = +arg('limit', 0) || Infinity;
const budgetMs = (+arg('budget-min', 160)) * 60000;
const commit = arg('commit', process.env.GITHUB_SHA || null);
// Heap of each feed's process; a feed that needs more is recorded as 'crashed' and the run goes on.
const heapMb = +arg('heap-mb', 3072) || 3072;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, as = 'text') {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  if (as === 'buffer') return res.arrayBuffer();
  if (as === 'json') return res.json();
  return res.text();
}

// The app's gtfs.js from this checkout, saved as .mjs so Node loads it as a module; its hash goes in summary.json.
function gtfsModule() {
  const text = readFileSync(join(HERE, '..', 'gtfs.js'), 'utf8');
  const path = join(outRoot, 'gtfs-used.mjs');
  writeFileSync(path, text);
  return { path, info: { source: 'gtfs.js', sha256: createHash('sha256').update(text).digest('hex'), commit } };
}

async function feedList(g) {
  try {
    const feeds = g.parseFeedList(await get('https://api.gtfs-data.jp/v2/feeds'));
    if (feeds.length < 100) throw new Error('only ' + feeds.length + ' feeds in the API list');
    return { feeds, source: 'https://api.gtfs-data.jp/v2/feeds' };
  } catch (e) {
    console.log('feed list API: ' + (e.message || e) + '; using feeds.txt');
    const local = join(HERE, '..', 'feeds.txt');
    if (existsSync(local)) return { feeds: g.parseFeedList(readFileSync(local, 'utf8')), source: 'feeds.txt' };
    const url = `https://raw.githubusercontent.com/${REPO}/main/feeds.txt`;
    return { feeds: g.parseFeedList(await get(url)), source: url };
  }
}

const skipRow = (f, reason, detail = '') => ({ organization_id: f.org, feed_id: f.feed, feed_name: f.feedName, reason, detail: String(detail).slice(0, 200) });

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pct = x => (x === null || x === undefined ? '–' : (x * 100).toFixed(1) + '%');

async function main() {
  const started = Date.now();
  const out = join(outRoot, 'national', date);
  mkdirSync(join(out, 'stops'), { recursive: true });
  const { path: gtfsPath, info: gtfsInfo } = gtfsModule();
  const g = await import(pathToFileURL(gtfsPath).href);
  console.log('gtfs.js', JSON.stringify(gtfsInfo));
  const { feeds, source } = await feedList(g);
  console.log(`feeds listed: ${feeds.length} (${source})`);
  const day = ymd(date);
  const done = [];
  const skipped = [];
  const stopsByPref = new Map();
  const zipPath = join(tmpdir(), 'kaerimichi-feed.zip');
  const resPath = join(tmpdir(), 'kaerimichi-result.json');
  let tried = 0;

  for (const f of feeds) {
    const why = skipReason(f, day);
    if (why) { skipped.push(skipRow(f, why)); continue; }
    if (tried >= limit || Date.now() - started > budgetMs) { skipped.push(skipRow(f, 'not_reached')); continue; }
    if (tried++) await sleep(2000);
    let buf;
    try {
      buf = await get(zipUrl(f), 'buffer');
    } catch (e) {
      try {
        await sleep(5000);
        buf = await get(zipUrl(f), 'buffer');
      } catch (e2) {
        skipped.push(skipRow(f, 'download_failed', e2.message || e2));
        continue;
      }
    }
    writeFileSync(zipPath, Buffer.from(buf));
    if (existsSync(resPath)) unlinkSync(resPath);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [`--max-old-space-size=${heapMb}`, join(HERE, 'feed_worker.mjs'), gtfsPath, zipPath, date, sat, resPath],
      { timeout: FEED_LIMIT_MS, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.error && r.error.code === 'ETIMEDOUT') { skipped.push(skipRow(f, 'timeout', `${FEED_LIMIT_MS / 1000} s`)); console.log(`timeout ${f.org}/${f.feed}`); continue; }
    if (r.status !== 0 || !existsSync(resPath)) { skipped.push(skipRow(f, 'crashed', (r.signal || '') + ' ' + (r.stderr || '').slice(-180))); console.log(`crashed ${f.org}/${f.feed}`); continue; }
    const res = JSON.parse(readFileSync(resPath, 'utf8'));
    if (res.skip) { skipped.push(skipRow(f, res.skip, res.detail || '')); console.log(`skip ${res.skip} ${f.org}/${f.feed}`); continue; }
    done.push({ f, r: res });
    const pref = String(f.pref || 0).padStart(2, '0');
    if (!stopsByPref.has(pref)) stopsByPref.set(pref, []);
    stopsByPref.get(pref).push(...stopRows(f, res));
    console.log(`ok ${f.org}/${f.feed} ${secs}s places=${res.places} base=${res.base} share=${res.share} sat=${res.shareSat} bytes=${buf.byteLength}`);
  }

  // ---- outputs ----
  done.sort((a, b) => (a.f.pref - b.f.pref) || a.f.org.localeCompare(b.f.org) || a.f.feed.localeCompare(b.f.feed));
  const rows = done.map(({ f, r }) => feedRow(f, r, date));
  writeFileSync(join(out, 'feeds.csv'), toCsv(FEED_COLUMNS, rows));
  writeFileSync(join(out, 'skipped.csv'), toCsv(SKIP_COLUMNS, skipped));
  for (const [pref, list] of stopsByPref) writeFileSync(join(out, 'stops', pref + '.csv'), toCsv(STOP_COLUMNS, list));

  const prefs = new Map();
  for (const { f, r } of done) {
    const p = prefs.get(f.pref) || { pref_id: f.pref, pref_name: prefName(f.pref), feeds_analysed: 0, places_with_departures: 0, round_trip: 0, round_trip_sat: 0 };
    p.feeds_analysed++;
    p.places_with_departures += r.base;
    p.round_trip += r.roundTrip;
    p.round_trip_sat += r.roundTripSat;
    prefs.set(f.pref, p);
  }
  const prefRows = [...prefs.values()].sort((a, b) => a.pref_id - b.pref_id).map(p => ({
    ...p,
    share: p.places_with_departures ? round3(p.round_trip / p.places_with_departures) : '',
    share_sat: p.places_with_departures ? round3(p.round_trip_sat / p.places_with_departures) : '',
  }));
  writeFileSync(join(out, 'prefectures.csv'), toCsv(PREF_COLUMNS, prefRows));

  const totals = Object.fromEntries(STATUSES.map(s => [s, 0]));
  let base = 0, rt = 0, rtSat = 0;
  for (const { r } of done) {
    for (const s of STATUSES) totals[s] += r.counts[s];
    base += r.base; rt += r.roundTrip; rtSat += r.roundTripSat;
  }
  const byReason = {};
  for (const s of skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
  const shares = done.filter(d => d.r.share !== null).map(d => d.r.share);
  const weekdayOnly = done.filter(d => d.r.roundTrip > 0 && d.r.roundTripSat === 0);
  const noSatService = done.filter(d => d.r.tripsSat === 0);
  const summary = {
    title: 'Same-day hospital round trips by bus, from every stop in Japan\'s open GTFS feeds',
    date, saturday: sat, settings: SETTINGS, hospital_stop_names: HOSPITAL.source,
    feed_list: source, feeds_listed: feeds.length, feeds_analysed: done.length, skipped_by_reason: byReason,
    national: {
      places_with_departures: base, round_trip: rt, share: base ? round3(rt / base) : null,
      round_trip_sat: rtSat, share_sat: base ? round3(rtSat / base) : null, status_totals: totals,
    },
    feeds: {
      median_share: median(shares),
      share_below_half: shares.filter(s => s < 0.5).length,
      share_zero: shares.filter(s => s === 0).length,
      round_trip_weekday_but_not_saturday: weekdayOnly.length,
      no_saturday_service: noSatService.length,
    },
    gtfs_js: gtfsInfo,
    generated_at: new Date().toISOString(), runtime_s: Math.round((Date.now() - started) / 1000),
    by: 'MV2 of Munim, Inc. (made with AI agents working in MV2\'s name)',
  };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(join(out, 'findings.md'), findings(summary, done, prefRows));
  writeFileSync(join(out, 'README.md'), readme(summary));
  console.log(JSON.stringify(summary, null, 2));
}

function findings(s, done, prefRows) {
  const n = s.national;
  const low = done.filter(d => d.r.base >= 20 && d.r.share !== null).sort((a, b) => a.r.share - b.r.share).slice(0, 25);
  const satDrop = done.filter(d => d.r.base >= 20 && d.r.roundTrip > 0).map(d => ({ d, drop: (d.r.roundTrip - d.r.roundTripSat) / d.r.base }))
    .sort((a, b) => b.drop - a.drop).slice(0, 15);
  const lines = [
    `# Findings: same-day hospital round trips by bus (${s.date}, Saturday ${s.saturday})`,
    '',
    `Feeds analysed: ${s.feeds_analysed} of ${s.feeds_listed} listed. Skipped: ${Object.entries(s.skipped_by_reason).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`,
    `Stops with a departure on ${s.date} (hospital stops excluded): ${n.places_with_departures}.`,
    `Of these, ${n.round_trip} (${pct(n.share)}) can reach one of their feed's three busiest hospital-named stops and get back the same day with at least 30 minutes there (up to one transfer); on Saturday ${n.round_trip_sat} (${pct(n.share_sat)}).`,
    `Status totals (weekday): ${STATUSES.map(k => `${k} ${n.status_totals[k]}`).join(', ')}.`,
    `Per feed: median share ${pct(s.feeds.median_share)}; ${s.feeds.share_below_half} feeds below 50%; ${s.feeds.share_zero} at 0%; ${s.feeds.round_trip_weekday_but_not_saturday} feeds have round trips on the weekday but none on Saturday; ${s.feeds.no_saturday_service} have no Saturday service at all.`,
    '',
    '## Lowest weekday shares (feeds with at least 20 stops)',
    '',
    '| feed | prefecture | stops | round trip | share | Saturday | hospital stops | map |',
    '|---|---|---|---|---|---|---|---|',
    ...low.map(({ f, r }) => `| ${f.orgName}「${f.feedName}」 | ${prefName(f.pref)} | ${r.base} | ${r.roundTrip} | ${pct(r.share)} | ${pct(r.shareSat)} | ${r.hubs.map(h => h.name).join('／')} | [open](${feedRow(f, r, s.date).app_url}) |`),
    '',
    '## Largest weekday-to-Saturday drops (feeds with at least 20 stops)',
    '',
    '| feed | prefecture | weekday | Saturday |',
    '|---|---|---|---|',
    ...satDrop.map(({ d }) => `| ${d.f.orgName}「${d.f.feedName}」 | ${prefName(d.f.pref)} | ${pct(d.r.share)} | ${pct(d.r.shareSat)} |`),
    '',
    '## By prefecture',
    '',
    '| prefecture | feeds | stops | weekday | Saturday |',
    '|---|---|---|---|---|',
    ...prefRows.map(p => `| ${p.pref_name} | ${p.feeds_analysed} | ${p.places_with_departures} | ${pct(p.share === '' ? null : p.share)} | ${pct(p.share_sat === '' ? null : p.share_sat)} |`),
    '',
  ];
  return lines.join('\n');
}

function readme(s) {
  const n = s.national;
  return `# 全国の公開GTFSで見る「バスで病院へ行って、その日のうちに帰ってこられるか」（${s.date}）

GTFSデータリポジトリ（https://gtfs-data.jp/ ）で公開されている全国のバス等のGTFSデータについて、すべての停留所から
「そのデータ内の病院名の停留所へ行き、30分以上いて、その日のうちに戻ってこられるか」を、かえりみち（https://munimv2.github.io/kaerimichi/ ）と同じ計算で判定した結果です。
一覧と地図: https://munimv2.github.io/kaerimichi/national.html

- 対象日: ${s.date}（水）と ${s.saturday}（土）
- 分析したデータ: ${s.feeds_analysed}件（一覧 ${s.feeds_listed}件。対象外の理由は skipped.csv）
- 平日に発車がある停留所（病院の停留所を除く）: ${n.places_with_departures}か所
- そのうち日帰りで往復できる: ${n.round_trip}か所（${pct(n.share)}）、土曜は ${n.round_trip_sat}か所（${pct(n.share_sat)}）

## ファイル

- feeds.csv: データごとの集計（区分ごとの停留所数、往復できる割合、土曜の割合、かえりみちで同じ地図を開くURL）
- prefectures.csv: 都道府県ごとの集計
- stops/NN.csv: 停留所ごとの判定（NNは都道府県番号）。status は ok（直通で往復）、okx（乗り換えありで往復）、noreturn（行けるが帰りに間に合わない）、oneway（帰りの便がない）、none（行けない）、idle（その日は発車なし）、hub（病院の停留所）
- skipped.csv: 分析しなかったデータと理由
- summary.json: 設定と全国の合計

## 方法

- 各データの病院の停留所は、停留所名に「病院・医院・クリニック・診療所・医療センター」を含むもの（かえりみちの「病院」ボタンと同じ）のうち、その日に便が止まるものを発車本数の多い順に最大3か所選びます。停留所ごとに、そのうち最も良い判定を採ります。
- 判定は、直通または同じデータ内での乗り換え1回（乗り継ぎ5分以上）、病院での滞在30分以上です。
- 割合の分母は、平日に発車がある停留所（病院の停留所を除く）です。土曜の割合も同じ分母で計算します。
- 同じ停留所名で400m以内のポールは1か所にまとめます。

## 限界

- 病院は停留所名だけで見つけています。病院名の停留所は病院の近さの目安であり、病院名の停留所がないデータは対象外です。
- 時刻表データだけを使っています。運賃、停留所までの歩行、遅れ・運休、別のデータ（別事業者・鉄道）との乗り継ぎは考慮していません。
- デマンド交通（予約制）は含みません。
- 同じ地域の停留所が複数のデータに含まれる場合、別々に数えています。
- 正式な「交通空白」の判断は自治体や運輸局が行うもので、この結果はその検討の材料です。

## 出典とライセンス

データ: GTFSデータリポジトリと、feeds.csv に記載の各データの提供者（ライセンスは各行の license 列、多くは CC BY 4.0）。本データはそれらを加工して作成しました。
この集計（CSV・JSON・本文）は CC BY 4.0、集計スクリプト（tools/）は Apache-2.0 です。

制作: MV2 of Munim, Inc.（munimversion2@gmail.com）。この分析はMV2の名のもと、AIエージェントが作成しました。

---

# Same-day hospital round trips by bus from every stop in Japan's open GTFS feeds (${s.date})

For every feed in Japan's GTFS Data Repository, every stop is checked for one question: can you get from it to one of the
feed's hospital-named stops, stay at least 30 minutes and get back the same day? The calculation is the one the Kaerimichi
app shows (same code, gtfs.js). Tables and map: https://munimv2.github.io/kaerimichi/national.html?lang=en

- Dates: Wednesday ${s.date} and Saturday ${s.saturday}
- Feeds analysed: ${s.feeds_analysed} of ${s.feeds_listed} listed (reasons for the rest in skipped.csv)
- Stops with a weekday departure (hospital stops excluded): ${n.places_with_departures}
- Same-day round trip possible: ${n.round_trip} (${pct(n.share)}); on Saturday ${n.round_trip_sat} (${pct(n.share_sat)})

Method: hospital stops are the stops whose names contain 病院, 医院, クリニック, 診療所 or 医療センター and that some trip
serves that day, the three busiest per feed; each stop takes its best verdict over them. Direct buses or one transfer within
the same feed (at least 5 minutes to change), at least 30 minutes at the hospital. Both shares use the same base: stops with a
weekday departure, hospital stops excluded.

Limits: hospitals are found only by stop names, so a hospital-named stop is a proxy and feeds without one are skipped;
timetables only (no fares, walking, delays or connections to other feeds or rail); demand-responsive transit is not included;
stops that appear in more than one feed are counted once per feed. Official decisions on transport gaps (交通空白) are made by
municipalities and MLIT's regional bureaus; this is input for that work.

Data: the GTFS Data Repository and each feed's publisher, under the licence in each row of feeds.csv (mostly CC BY 4.0),
processed by MV2. This dataset is CC BY 4.0; the scripts are Apache-2.0. Made by MV2 of Munim, Inc.
(munimversion2@gmail.com) with AI agents working in MV2's name.
`;
}

main().catch(e => { console.error(e); process.exit(1); });
