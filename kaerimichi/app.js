// app.js - Kaerimichi UI: pick a feed, a date and two stops; see if you can go and come back.
// The service-gap map colours every stop by whether that round trip works to the chosen destination,
// and can overlay demand-responsive transit (GTFS-Flex) to show where a booked ride fills the gap.
// A trip card (copy or print) and a printable service-gap summary carry the answer off the screen.
// MV2 of Munim, Inc. - MIT license.
import { loadFeed, loadFlex, dayView, journeys, roundTrip, serviceGaps, serviceRange, weekday, addDays, fmtTime, fmtSpan, parseFeedList, flexDay, flexCover, flexLinks, flexOk } from './gtfs.js';

const VERSION = '0.5';
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
const GAP_ORDER = ['ok', 'okx', 'flex', 'noreturn', 'oneway', 'none', 'idle'];
const GAP_COLOURS = { ok: '#1a9850', okx: '#91cf60', flex: '#4393c3', noreturn: '#fc8d59', oneway: '#d73027', none: '#762a83', idle: '#9e9e9e', hub: '#ffffff' };
// Bus verdicts that a demand-responsive ride can turn into "possible".
const FLEX_FILLS = new Set(['noreturn', 'oneway', 'none', 'idle']);
const ZONE_COLOUR = '#2166ac';
// Journeys listed per direction on the trip card.
const CARD_TRIPS = 20;

// Demand-responsive transit published as GTFS-Flex by the Public Transportation Open Data Center
// (ODPT, CC BY 4.0; most are public only during the Open Data Challenge 2026). `bus` is a
// GTFS Data Repository feed for the same town, loaded with it when no bus feed is open yet.
const ODPT_DEMAND = 'https://api-public.odpt.org/api/v4/files/Demand/data/';
const FLEX_FEEDS = [
  { id: 'goshogawara', pref: 2, name: '五所川原市 AIデマンド交通「ごしょくる」', pub: 'MONET Technologies', url: ODPT_DEMAND + 'goshogawara_gtfs.zip', page: 'https://ckan.odpt.org/dataset/monet_goshogawara_goshokuru', bus: 'goshogawaracity/goshogawara-communitybus' },
  { id: 'hirakawa', pref: 2, name: '平川市 デマンド交通「のらっさ」', pub: 'MONET Technologies', url: ODPT_DEMAND + 'hirakawa_gtfs.zip', page: 'https://ckan.odpt.org/dataset/monet_hirakawa_norassa', bus: 'hirakawacity/hirakwacitybus' },
  { id: 'maebashi', pref: 10, name: '前橋市 デマンド交通', pub: '未来シェア', url: ODPT_DEMAND + 'maebashi_gtfs.zip', page: 'https://ckan.odpt.org/dataset/miraishare_maebashi_demand' },
  { id: 'annaka', pref: 10, name: '安中市 AI新交通「あんなカー」', pub: 'MONET Technologies', url: ODPT_DEMAND + 'annaka_gtfs.zip', page: 'https://ckan.odpt.org/dataset/monet_annaka_ai_shinkotsu', bus: 'annakacity/annakashi-rosenbus' },
  { id: 'tomioka', pref: 10, name: '富岡市 デマンド型乗合タクシー「愛タク」', pub: 'MONET Technologies', url: ODPT_DEMAND + 'tomioka_gtfs.zip', page: 'https://ckan.odpt.org/dataset/monet_tomioka_ai_taku' },
  { id: 'showa', pref: 10, name: '昭和村 AIデマンドバス「ベジバス」', pub: 'MONET Technologies', url: ODPT_DEMAND + 'showa_gtfs.zip', page: 'https://ckan.odpt.org/dataset/ai-showa-village-ai-on-demand-bus-veggie-bus' },
  { id: 'tamamura', pref: 10, name: '玉村町 デマンドタクシー「たまGO」', pub: 'MONET Technologies', url: ODPT_DEMAND + 'tamamura_gtfs.zip', page: 'https://ckan.odpt.org/dataset/go-tamamura-town-on-demand-taxi-tama-go' },
  { id: 'kawagoe', pref: 11, name: '川越市 デマンド型交通「かわまる」', pub: '順風路', url: ODPT_DEMAND + 'kawagoe_gtfs.zip', page: 'https://ckan.odpt.org/dataset/junpuzi_kawagoe_kawamaru' },
  { id: 'mizuho', pref: 13, name: '瑞穂町デマンド交通「チョイソコみずほまち」', pub: '瑞穂町', url: API + '/organizations/mizuhotown/feeds/DemandResponsiveTransport/files/feed.zip?rid=current', page: 'https://gtfs-data.jp/', src: 'GTFSデータリポジトリ', bus: 'mizuhotown/communitybus' },
  { id: 'sakai', pref: 18, name: '坂井市 オンデマンド型交通「イータク」', pub: 'MONET Technologies', url: ODPT_DEMAND + 'sakai_gtfs.zip', page: 'https://ckan.odpt.org/dataset/sakai-city-on-demand-transportation-etaku' },
  { id: 'hakuba-day', pref: 20, name: '白馬村 デマンドタクシー「ふれAI号」', pub: 'SWAT Mobility', url: ODPT_DEMAND + 'hakuba_day_gtfs.zip', page: 'https://ckan.odpt.org/dataset/ai-hakuba-village-on-demand-taxi-fure-ai' },
  { id: 'hakuba-night', pref: 20, name: '白馬村 ナイトデマンドタクシー', pub: 'SWAT Mobility', url: ODPT_DEMAND + 'hakuba_night_gtfs.zip', page: 'https://ckan.odpt.org/dataset/swat_hakuba_demand_taxi' },
  { id: 'kinokawa', pref: 30, name: '紀の川市 デマンド乗合交通「のりのり交通」', pub: 'MONET Technologies', url: ODPT_DEMAND + 'kinokawa_gtfs.zip', page: 'https://ckan.odpt.org/dataset/kinokawa-city-demand-shared-transportation-norinori-transportation', bus: 'kinokawacity/kinokawa_bus' },
  { id: 'munakata', pref: 40, name: '宗像市 オンデマンドバス「のるーと」', pub: 'ネクスト・モビリティ', url: ODPT_DEMAND + 'munakata_gtfs.zip', page: 'https://ckan.odpt.org/dataset/munakata-city-on-demand-bus-knowroute', bus: 'munakatacity/MunakataCityCommunityBus' },
  { id: 'umi', pref: 40, name: '宇美町 AIオンデマンドバス「のるーと宇美」', pub: 'ネクスト・モビリティ', url: ODPT_DEMAND + 'umi_gtfs.zip', page: 'https://ckan.odpt.org/dataset/nextmobility_umi_knowroute' },
  { id: 'fukuchi', pref: 40, name: '福智町 予約型乗合バス「ふく～るバス」', pub: '未来シェア', url: ODPT_DEMAND + 'fukuchi_gtfs.zip', page: 'https://ckan.odpt.org/dataset/miraishare_fukuchi_fukurubus' },
];

// One-click destinations, found by stop name in the loaded feed.
const PRESETS = [
  { key: 'hospital', re: /病院|医院|クリニック|診療所|医療センター/ },
  { key: 'station', re: /駅/ },
  { key: 'office', re: /役場|役所|支所|庁舎/ },
  { key: 'shop', re: /イオン|スーパー|ショッピング|マート|モール|ストア|生協|コープ|ベイシア|ヤオコー|西友|ヨーカドー|ドラッグ|ホームセンター/ },
];

const MLIT_PLAN = 'https://www.mlit.go.jp/sogoseisaku/transport/content/002005758.pdf';

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
    stopInfo: (n, f, l) => `この日の発車 ${n}本（始発 ${f}・最終 ${l}）`,
    otherDays: 'この日の発車はありません（ほかの日には運行があります）', noTrips: '時刻表にこの停留所に止まる便がありません',
    legend: 'この日の発車本数', source: '出典', modified: '本アプリで加工（直通便・乗り継ぎの抽出、集計）',
    note: '時刻は公開GTFSデータの予定時刻です。予約制の便やダイヤ改正、運休は各事業者の情報をご確認ください。乗り継ぎは同じデータ内の便だけを対象にしています。',
    trips: n => `${n}本`, share: 'この条件のURL', ending: d => `（データは${d}まで）`,
    mapMode: '地図の色', modeCount: 'この日の発車本数', modeGap: '行き先へ日帰りで往復できるか（交通空白マップ）',
    gapNeedTo: '行き先（4.）を選ぶと、すべての停留所を「その行き先へ行って、その日のうちに帰ってこられるか」で色分けします。',
    gapHead: name => `「${name}」へ日帰りで往復できるか`,
    gap: {
      ok: '往復できる（直通）', okx: '往復できる（乗り換えあり）', flex: 'バスでは無理だが、デマンド交通（予約制）なら往復できる見込み',
      noreturn: '行けるが、帰りの最終に間に合わない', oneway: '行けるが、帰りの便がない', none: '行けない（便なし・乗り換え2回以上）',
      idle: 'この日は発車なし', hub: '行き先',
    },
    gapCount: n => `${n}か所`,
    gapFacts: (a, b, s) => `着 ${a}／帰りの最終 ${b}／最大 ${s}`,
    gapNote: '判定は上の「目的地での最低滞在」と「乗り換え」の設定に従います。CSVは路線の見直しや交通空白の把握にお使いください（出典の表示をお願いします）。',
    csv: 'CSVでダウンロード（停留所ごとの判定）',
    presets: 'ワンタッチで行き先（停留所名から）', preset: { hospital: '病院', station: '駅', office: '役場', shop: '買い物' },
    presetMore: n => `（${n}か所。もう一度押すと次の候補）`,
    week: 'この週の曜日別（バスで往復できる停留所）', weekDay: (wd, md) => `${wd} ${md}`, weekOut: '期間外',
    flexHead: '5. デマンド交通（予約制）を重ねる（任意）', flexPick: 'デマンド交通のデータを選ぶ…', flexOff: '重ねない',
    flexOrFile: 'またはGTFS-Flexのzipを開く', flexWithBus: '（路線バスも読み込みます）',
    flexLoaded: (name, n, z) => `「${name}」を重ねました（便 ${n}・区域と乗降ポイント ${z}）。`,
    flexEmpty: 'このファイルにはデマンド交通（GTFS-Flex）のデータが見つかりませんでした。',
    flexIdle: 'この日はデマンド交通の運行がありません。', flexOnly: 'デマンド交通のデータを重ねました。路線バスのデータを「1.」で選ぶと交通空白マップと組み合わせられます。',
    flexFetchFail: url => `デマンド交通のデータを直接取得できませんでした。<a href="${url}" target="_blank" rel="noopener">zipをダウンロード</a>して「GTFS-Flexのzipを開く」から読み込んでください。`,
    flexArea: (name, w, b) => `デマンド交通「${name}」の区域内（${w}${b ? '・' + b : ''}）`,
    flexPair: (name, w, b) => `デマンド交通「${name}」（予約制）なら往復できる見込みです: ${w}${b ? '。' + b : ''}`,
    flexThere: '行きのみ', flexBack: '帰りのみ',
    window: (a, b) => `運行 ${a}–${b}`, anyTime: '運行時間はデータにありません',
    book: {
      now: '予約: 当日すぐ', before: m => `予約: 乗車の${m}分前まで`, sameDay: '予約: 当日まで',
      days: (d, tm) => `予約: ${d}日前${tm ? 'の' + tm : ''}まで`, phone: p => `電話 ${p}`,
    },
    flexNote: 'デマンド交通は、区域・乗降ポイントと運行時間帯だけで判定しています。予約の締切や定員、利用登録などの条件は各自治体・事業者の案内をご確認ください。',
    flexSource: '出典（デマンド交通）', odpt: '公共交通オープンデータセンター',
    copy: 'コピー（LINE・メール用）', copied: 'コピーしました。', copyFail: '自動でコピーできませんでした。下の文を選んでコピーしてください。',
    print: '印刷・PDFで保存',
    cardTitle: '【かえりみち】バスの往復メモ', cardFrom: '出発', cardTo: '行き先',
    dateLine: (ymd, wd) => `${+ymd.slice(0, 4)}年${+ymd.slice(4, 6)}月${+ymd.slice(6, 8)}日（${wd}）`,
    settings: (stay, x) => `目的地での最低滞在${stay}分・${x ? '乗り換え1回まで' : '直通のみ'}`,
    plansLine: '行きの便', backsLine: '帰りの便', more: n => `ほか${n}本`,
    gapTitle: '【かえりみち 交通空白マップ】', gapCopy: '集計をコピー', gapPrint: '地図と集計を印刷',
    aboutHead: '「交通空白」について',
    aboutBody: `国土交通省は2024年7月に「交通空白」解消本部を設け、地域の人の移動手段が足りない「交通空白」の解消に取り組んでいます。2025〜2027年度は集中対策期間で、対象は全国で2,000地区を超えます（<a href="${MLIT_PLAN}" target="_blank" rel="noopener">「交通空白」解消に向けた取組方針2026</a>）。この地図は、公開されている時刻表データ（GTFS）から、停留所ごとに「行き先へ行って、その日のうちに帰ってこられるか」を判定して見える化します。デマンド交通を重ねると、予約制の乗合交通で埋まっている所も分かります。正式な「交通空白」の判断は自治体や運輸局が行うもので、この地図はその検討の材料です。`,
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
    stopInfo: (n, f, l) => `${n} departures this day (first ${f}, last ${l})`,
    otherDays: 'No departures this day (buses run here on other days)', noTrips: 'No trip in the timetable stops here',
    legend: 'Departures this day', source: 'Source', modified: 'processed by this app (direct trips and connections extracted and counted)',
    note: 'Times are the scheduled times in the published GTFS data. Check with the operator for on-demand trips, timetable changes and cancellations. Connections only use trips in the same data set.',
    trips: n => `${n} trips`, share: 'Link to this view', ending: d => `(data until ${d})`,
    mapMode: 'Map colours', modeCount: 'Departures this day', modeGap: 'Same-day round trip to the destination (service-gap map)',
    gapNeedTo: 'Choose a destination (4.) to colour every stop by whether you can get there and back the same day.',
    gapHead: name => `Same-day round trip to ${name}`,
    gap: {
      ok: 'Round trip, direct buses', okx: 'Round trip with a transfer', flex: 'Not by bus, but likely by demand-responsive ride (booking needed)',
      noreturn: 'Can go, but the last bus back leaves too early', oneway: 'Can go, but no bus back', none: "Can't get there (no bus, or 2+ transfers)",
      idle: 'No departures this day', hub: 'Destination',
    },
    gapCount: n => `${n} stops`,
    gapFacts: (a, b, s) => `arrive ${a}, last bus back ${b}, stay up to ${s}`,
    gapNote: 'Uses the minimum stay and transfer settings above. The CSV is meant for route reviews and service-gap planning (please credit the data source).',
    csv: 'Download CSV (verdict per stop)',
    presets: 'One-click destinations (by stop name)', preset: { hospital: 'Hospital', station: 'Station', office: 'Town hall', shop: 'Shops' },
    presetMore: n => `(${n} matches; press again for the next one)`,
    week: 'This week by day (stops with a bus round trip)', weekDay: (wd, md) => `${wd} ${md}`, weekOut: 'outside data',
    flexHead: '5. Overlay demand-responsive transit (optional)', flexPick: 'Choose a demand-responsive service…', flexOff: 'none',
    flexOrFile: 'or open a GTFS-Flex zip', flexWithBus: '(also loads the town\'s buses)',
    flexLoaded: (name, n, z) => `Overlaid ${name} (${n} trips, ${z} zones and pickup points).`,
    flexEmpty: 'No demand-responsive (GTFS-Flex) service found in this file.',
    flexIdle: 'No demand-responsive service on this date.', flexOnly: 'Demand-responsive data overlaid. Choose the bus data in 1. to combine it with the service-gap map.',
    flexFetchFail: url => `Could not fetch the demand-responsive data directly. <a href="${url}" target="_blank" rel="noopener">Download the zip</a> and open it with the GTFS-Flex file button.`,
    flexArea: (name, w, b) => `Inside the ${name} demand-responsive area (${w}${b ? ', ' + b : ''})`,
    flexPair: (name, w, b) => `A round trip looks possible by the ${name} demand-responsive service (booking needed): ${w}${b ? '. ' + b : ''}`,
    flexThere: 'there only', flexBack: 'back only',
    window: (a, b) => `runs ${a}–${b}`, anyTime: 'hours not in the data',
    book: {
      now: 'book: any time', before: m => `book ${m} min ahead`, sameDay: 'book the same day',
      days: (d, tm) => `book ${d} day(s) ahead${tm ? ' by ' + tm : ''}`, phone: p => `phone ${p}`,
    },
    flexNote: 'Demand-responsive service is judged only by its areas, pickup points and hours. Check booking deadlines, capacity and registration with the town or operator.',
    flexSource: 'Source (demand-responsive)', odpt: 'Public Transportation Open Data Center',
    copy: 'Copy (for messages and email)', copied: 'Copied.', copyFail: 'Could not copy automatically. Select the text below and copy it.',
    print: 'Print / save as PDF',
    cardTitle: 'Kaerimichi bus round-trip note', cardFrom: 'From', cardTo: 'To',
    dateLine: (ymd, wd) => `${wd} ${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
    settings: (stay, x) => `(minimum stay ${stay} min, ${x ? 'up to one transfer' : 'direct buses only'})`,
    plansLine: 'Buses there', backsLine: 'Buses back', more: n => `${n} more`,
    gapTitle: 'Kaerimichi service-gap map:', gapCopy: 'Copy the counts', gapPrint: 'Print the map and counts',
    aboutHead: 'About "transport gaps" (交通空白)',
    aboutBody: `In July 2024 Japan's Ministry of Land, Infrastructure, Transport and Tourism (MLIT) set up a headquarters to close "transport gaps" (交通空白), places where residents lack a way to get around. FY2025–2027 is its intensive period, covering more than 2,000 districts nationwide (<a href="${MLIT_PLAN}" target="_blank" rel="noopener">MLIT action plan 2026, in Japanese</a>). This map uses the published timetables (GTFS) to check, stop by stop, whether you can reach the destination and get back the same day. With a demand-responsive service overlaid, it also shows where a booked ride fills the gap. Official decisions on transport gaps are made by municipalities and MLIT's regional bureaus; this map is input for that work.`,
  },
};

const params = new URLSearchParams(location.search);
let lang = params.get('lang') || ((navigator.language || 'ja').startsWith('ja') ? 'ja' : 'en');
if (!TEXT[lang]) lang = 'ja';
const t = TEXT[lang];

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  model: null, view: null, from: null, to: null, ymd: null, stay: 30, transfer: true, mode: 'count', meta: null, feedKey: null, feeds: [],
  gaps: null, gapKey: null, week: null, weekKey: null, presetAt: {},
  flex: null, flexMeta: null, flexId: null, cover: null, coverFor: null,
};

// ---- map ----

const map = L.map('map', { preferCanvas: true }).setView([36.5, 138], 5);
L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
}).addTo(map);
const flexLayer = L.layerGroup().addTo(map);
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

// One line about a stop's departures on the chosen day.
function stopLine(i) {
  const s = state.view.stat[i];
  if (s.n) return t.stopInfo(s.n, fmtTime(s.first, lang), fmtTime(s.last, lang));
  return state.model.served[i] ? t.otherDays : t.noTrips;
}

// ---- demand-responsive transit ----

// Which bus places each Flex zone or pickup point covers (cached per bus model and Flex feed).
function cover() {
  if (!state.flex || !state.model) return null;
  if (!state.coverFor || state.coverFor.model !== state.model || state.coverFor.flex !== state.flex) {
    state.cover = flexCover(state.flex, state.model.places);
    state.coverFor = { model: state.model, flex: state.flex };
  }
  return state.cover;
}

function flexName(trip) {
  const r = state.flex.routes.get(trip.route) || {};
  return r.long || r.short || (state.flexMeta && state.flexMeta.short) || state.flex.agencies[0] || 'GTFS-Flex';
}

function windowText(start, end) {
  if (start === null || end === null) return t.anyTime;
  return t.window(fmtTime(start, lang), fmtTime(end, lang));
}

function bookingText(trip) {
  const call = trip.calls.find(c => c.rule);
  const r = call && state.flex.rules.get(call.rule);
  if (!r) return '';
  let s = '';
  if (r.type === '0') s = t.book.now;
  else if (r.type === '1') s = r.minBefore ? t.book.before(r.minBefore) : t.book.sameDay;
  else if (r.type === '2') s = t.book.days(r.lastDay || '1', r.lastTime ? fmtTime(toSec(r.lastTime), lang) : '');
  if (r.phone) s += (s ? (lang === 'ja' ? '・' : ', ') : '') + t.book.phone(r.phone);
  return s;
}

function toSec(hms) {
  const m = /^(\d+):(\d\d)(?::(\d\d))?$/.exec(hms || '');
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 : 0;
}

// Demand-responsive links of every place with the destination, or null.
function linksTo(hub) {
  const c = cover();
  if (!c || hub === null || !state.ymd) return null;
  return flexLinks(state.flex, state.ymd, c, hub, state.model.places.length);
}

// Line for a stop popup: the demand-responsive services whose area covers it today.
function flexStopLine(i) {
  const c = cover();
  if (!c) return '';
  const seen = new Map();
  for (const trip of flexDay(state.flex, state.ymd)) {
    for (const call of trip.calls) {
      const set = c.get(call.loc);
      if (!set || !set.has(i)) continue;
      const name = flexName(trip);
      const cur = seen.get(name) || { start: call.start, end: call.end, trip };
      cur.start = cur.start === null || call.start === null ? null : Math.min(cur.start, call.start);
      cur.end = cur.end === null || call.end === null ? null : Math.max(cur.end, call.end);
      seen.set(name, cur);
    }
  }
  return [...seen].map(([name, w]) => t.flexArea(name, windowText(w.start, w.end), bookingText(w.trip))).join(' / ');
}

function drawFlex() {
  flexLayer.clearLayers();
  const f = state.flex;
  if (!f) return;
  const bounds = [];
  for (const loc of f.locations.values()) {
    if (loc.kind === 'zone' && loc.geometry) {
      const g = L.geoJSON({ type: 'Feature', geometry: loc.geometry, properties: {} }, {
        style: { color: ZONE_COLOUR, weight: 2, dashArray: '6 4', fillColor: ZONE_COLOUR, fillOpacity: 0.07 },
      });
      g.bindTooltip(loc.name);
      g.addTo(flexLayer);
      bounds.push([loc.bbox[1], loc.bbox[0]], [loc.bbox[3], loc.bbox[2]]);
    }
    for (const q of loc.points) {
      L.circleMarker([q.lat, q.lon], { radius: 3, color: ZONE_COLOUR, weight: 1, fillColor: ZONE_COLOUR, fillOpacity: 1 })
        .bindTooltip(q.name || loc.name).addTo(flexLayer);
      bounds.push([q.lat, q.lon]);
    }
  }
  return bounds;
}

function useFlex(flex, meta, id) {
  const box = $('#flexstatus');
  if (!flex || !flex.trips.length) { box.innerHTML = esc(t.flexEmpty); return; }
  state.flex = flex;
  state.flexMeta = meta;
  state.flexId = id;
  state.gapKey = state.weekKey = null;
  const bounds = drawFlex();
  const name = meta ? meta.name : (flex.agencies[0] || 'GTFS-Flex');
  box.innerHTML = esc(t.flexLoaded(name, flex.trips.length, flex.locations.size)) + (state.model || state.feedKey ? '' : '<br>' + esc(t.flexOnly));
  if (!state.model && bounds && bounds.length) map.fitBounds(bounds, { padding: [20, 20] });
  showSource();
  render();
}

function clearFlex() {
  state.flex = state.flexMeta = state.flexId = null;
  state.gapKey = state.weekKey = null;
  flexLayer.clearLayers();
  $('#flexstatus').innerHTML = '';
  showSource();
  render();
}

async function loadFlexFeed(id) {
  const f = FLEX_FEEDS.find(x => x.id === id);
  if (!f) return;
  const box = $('#flexstatus');
  box.textContent = t.loading;
  if (f.bus && !state.model && !state.feedKey && state.feeds.some(x => x.org + '/' + x.feed === f.bus)) {
    $('#feed').value = f.bus;
    loadFromRepo(f.bus);
  }
  let flex;
  try {
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(res.status);
    flex = await loadFlex(await res.arrayBuffer());
  } catch (e) {
    box.innerHTML = t.flexFetchFail(esc(f.url));
    return;
  }
  useFlex(flex, { name: f.name, short: f.name.replace(/^.*「(.+)」$/, '$1'), pub: f.pub, page: f.page, src: f.src }, f.id);
}

function fillFlexList() {
  const sel = $('#flex');
  const groups = new Map();
  for (const f of FLEX_FEEDS) {
    const pref = PREFS[f.pref - 1];
    if (!groups.has(pref)) {
      const g = document.createElement('optgroup');
      g.label = pref;
      groups.set(pref, g);
      sel.appendChild(g);
    }
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.name + (f.bus ? ' ' + t.flexWithBus : '');
    groups.get(pref).appendChild(o);
  }
}

// ---- service gaps ----

// Round-trip verdict of every stop against the destination, or null when the map shows departures.
// With a demand-responsive overlay, stops the buses can't serve but a booked ride can become 'flex'.
function gapView() {
  if (state.mode !== 'gap' || state.to === null || !state.view) return null;
  const key = [state.ymd, state.to, state.transfer, state.stay, state.flexId, !!state.flex].join('|');
  if (state.gapKey !== key) {
    const gaps = serviceGaps(state.view, state.to, state.transfer ? 1 : 0, MIN_CONNECTION, state.stay * 60);
    const links = linksTo(state.to);
    if (links) gaps.forEach((g, i) => {
      g.flex = links[i];
      if (FLEX_FILLS.has(g.status) && flexOk(links[i], state.stay * 60)) { g.bus = g.status; g.status = 'flex'; }
    });
    state.gaps = gaps;
    state.gapKey = key;
  }
  return state.gaps;
}

// Bus round trips to the destination on the Wednesday, Saturday and Sunday of the chosen week.
function weekCounts() {
  const key = [state.ymd, state.to, state.transfer, state.stay].join('|');
  if (state.weekKey === key) return state.week;
  const monday = addDays(state.ymd, -((weekday(state.ymd) + 6) % 7));
  const r = state.range;
  state.week = [2, 5, 6].map(off => {
    const ymd = addDays(monday, off);
    if (r && r.start && (ymd < r.start || ymd > r.end)) return { ymd, n: null };
    const gaps = serviceGaps(dayView(state.model, ymd), state.to, state.transfer ? 1 : 0, MIN_CONNECTION, state.stay * 60);
    return { ymd, n: gaps.filter(g => g.status === 'ok' || g.status === 'okx').length };
  });
  state.weekKey = key;
  return state.week;
}

function weekdayName(ymd) {
  return lang === 'ja' ? '日月火水木金土'[weekday(ymd)] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(ymd)];
}

// "2026年10月14日（水） 目的地での最低滞在30分・乗り換え1回まで": the conditions behind a verdict.
function conditions() {
  return `${t.dateLine(state.ymd, weekdayName(state.ymd))} ${t.settings(state.stay, state.transfer)}`;
}

function gapLine(i) {
  const gaps = gapView();
  if (!gaps || i === state.to) return '';
  const g = gaps[i];
  let line = t.gap[g.status];
  if (g.status === 'ok' || g.status === 'okx') line += ' — ' + t.gapFacts(fmtTime(g.rt.firstArr, lang), fmtTime(g.rt.lastBack, lang), fmtSpan(g.rt.maxStay, lang));
  if (g.status === 'flex') line += ' — ' + windowText(g.flex.there.start, g.flex.back.end);
  return line;
}

function popup(i) {
  const p = state.model.places[i];
  const el = document.createElement('div');
  el.className = 'pop';
  const gap = gapLine(i);
  const fx = flexStopLine(i);
  el.innerHTML = `<b>${esc(placeName(p))}</b><br>${esc(stopLine(i))}<br>` + (gap ? `<b>${esc(gap)}</b><br>` : '') + (fx ? `<span class="fx">${esc(fx)}</span><br>` : '');
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
  const gaps = gapView();
  model.places.forEach((p, i) => {
    if (p.lat === undefined) return;
    const picked = i === state.from || i === state.to;
    const m = L.circleMarker([p.lat, p.lon], {
      radius: picked ? 10 : 6,
      color: picked ? (i === state.from ? '#1565c0' : '#6a1b9a') : '#424242',
      weight: picked ? 4 : 1,
      fillColor: gaps ? GAP_COLOURS[gaps[i].status] : colour(view.stat[i].n),
      fillOpacity: 0.9,
    });
    m.bindTooltip(placeName(p));
    m.bindPopup(() => popup(i));
    m.addTo(layer);
  });
}

// The legend: departures per day, or the service-gap counts with a weekly comparison, copy, print and CSV.
function drawLegend() {
  const gapMode = state.mode === 'gap';
  $('#legend-count').hidden = gapMode;
  const box = $('#legend-gap');
  box.hidden = !gapMode;
  if (!gapMode) return;
  const about = `<details class="noprint"><summary>${esc(t.aboutHead)}</summary><p class="small">${t.aboutBody}</p></details>`;
  const gaps = gapView();
  if (!gaps) { box.innerHTML = `<p class="muted small">${t.gapNeedTo}</p>` + about; return; }
  const n = {};
  for (const g of gaps) n[g.status] = (n[g.status] || 0) + 1;
  const head = t.gapHead(placeName(state.model.places[state.to]));
  const lines = [`${t.gapTitle} ${head}`, conditions()];
  if (state.meta) lines.push(`${t.source}: ${state.meta.org}「${state.meta.feed}」`);
  if (state.flex) lines.push(`${t.flexSource}: ${state.flexMeta ? state.flexMeta.name : state.flex.agencies.join('、')}`);
  let html = `<b>${esc(head)}</b><p class="small">${esc(conditions())}</p><ul>`;
  for (const k of GAP_ORDER) {
    if (k === 'okx' && !state.transfer) continue;
    if (k === 'flex' && !state.flex) continue;
    html += `<li><i style="background:${GAP_COLOURS[k]}"></i>${esc(t.gap[k])}: <b>${t.gapCount(n[k] || 0)}</b></li>`;
    lines.push(`- ${t.gap[k]}: ${t.gapCount(n[k] || 0)}`);
  }
  html += '</ul>';
  const week = weekCounts();
  const days = week.map(w => {
    const label = t.weekDay(weekdayName(w.ymd), `${+w.ymd.slice(4, 6)}/${+w.ymd.slice(6, 8)}`);
    return { w, label, count: w.n === null ? t.weekOut : t.gapCount(w.n) };
  });
  const sep = lang === 'ja' ? '・' : ', ';
  html += `<p class="small week">${esc(t.week)}: ` + days.map(({ w, label, count }) => {
    const cls = w.ymd === state.ymd ? ' class="now"' : '';
    return `<a href="#" data-day="${w.ymd}"${cls}>${esc(label)}</a> <b>${esc(count)}</b>`;
  }).join(sep) + '</p>';
  lines.push(`${t.week}: ` + days.map(d => `${d.label} ${d.count}`).join(sep), location.href);
  html += toolsHtml(t.gapCopy, t.gapPrint);
  html += `<p class="muted small">${t.gapNote}</p>`;
  if (state.flex) html += `<p class="muted small">${t.flexNote}</p>`;
  html += about;
  box.innerHTML = html;
  const text = lines.join('\n');
  wireTools(box, text, 'map');
  for (const a of box.querySelectorAll('a[data-day]')) {
    a.onclick = e => { e.preventDefault(); setDate(a.dataset.day); render(); };
  }
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = t.csv;
  a.onclick = e => { e.preventDefault(); downloadCsv(gaps); };
  const p = document.createElement('p');
  p.className = 'small noprint';
  p.appendChild(a);
  box.appendChild(p);
}

function downloadCsv(gaps) {
  const { model, view } = state;
  const q = v => /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const hub = model.places[state.to];
  const header = ['stop_id', 'stop_name', 'lat', 'lon', 'departures_this_day', 'status', 'earliest_arrival', 'last_bus_back', 'max_stay_min', 'destination', 'date', 'min_stay_min', 'transfers'];
  if (state.flex) header.push('bus_status', 'demand_responsive');
  const lines = [header.join(',')];
  model.places.forEach((p, i) => {
    const g = gaps[i];
    const ok = g.status === 'ok' || g.status === 'okx';
    const row = [
      p.key, p.name, p.lat !== undefined ? p.lat.toFixed(6) : '', p.lon !== undefined ? p.lon.toFixed(6) : '',
      view.stat[i].n, g.status,
      ok ? fmtTime(g.rt.firstArr, 'en') : '', ok ? fmtTime(g.rt.lastBack, 'en') : '', ok ? Math.floor(g.rt.maxStay / 60) : '',
      hub.name, dashed(state.ymd), state.stay, state.transfer ? 1 : 0,
    ];
    if (state.flex) {
      const l = g.flex;
      const fx = !l ? '' : flexOk(l, state.stay * 60) ? 'round_trip' : l.there ? 'there_only' : l.back ? 'back_only' : '';
      row.push(g.bus || g.status, fx);
    }
    lines.push(row.map(v => q(String(v))).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kaerimichi-${state.ymd}-${hub.key.replace(/[^\w.-]/g, '_')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- copy and print ----

function toolsHtml(copyLabel, printLabel) {
  return `<p class="tools noprint"><button type="button" class="copy">${esc(copyLabel)}</button><button type="button" class="print">${esc(printLabel)}</button><span class="small muted note"></span></p>`;
}

// Hooks up the copy and print buttons inside box; kind picks the print layout (body.print-card / body.print-map).
function wireTools(box, text, kind) {
  const p = box.querySelector('.tools');
  p.querySelector('.copy').onclick = () => copyText(text, p);
  p.querySelector('.print').onclick = () => printAs(kind);
}

// Copies text to the clipboard; where the browser refuses, shows it selected for copying by hand.
async function copyText(text, p) {
  const note = p.querySelector('.note');
  try {
    await navigator.clipboard.writeText(text);
    note.textContent = t.copied;
  } catch (e) {
    note.textContent = t.copyFail;
    const area = document.createElement('textarea');
    area.className = 'copybox noprint';
    area.rows = Math.min(16, text.split('\n').length + 1);
    area.value = text;
    p.after(area);
    area.select();
  }
}

function printAs(kind) {
  document.body.classList.add('print-' + kind);
  window.addEventListener('afterprint', () => document.body.classList.remove('print-' + kind), { once: true });
  window.print();
}

// ---- one-click destinations ----

function presetMatches(re) {
  const { model, view } = state;
  const list = [];
  model.places.forEach((p, i) => { if (re.test(p.name)) list.push(i); });
  list.sort((a, b) => (view.stat[b].n - view.stat[a].n) || (model.served[b] - model.served[a]));
  return list;
}

function drawPresets() {
  const box = $('#presets');
  box.innerHTML = '';
  if (!state.model) return;
  let any = false;
  for (const pr of PRESETS) {
    const list = presetMatches(pr.re);
    if (!list.length) continue;
    any = true;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${t.preset[pr.key]} (${list.length})`;
    b.title = t.presetMore(list.length);
    b.onclick = () => {
      const k = (state.presetAt[pr.key] === undefined ? -1 : state.presetAt[pr.key]) + 1;
      state.presetAt[pr.key] = k % list.length;
      choose('to', list[state.presetAt[pr.key]]);
      const p = state.model.places[state.to];
      if (p.lat !== undefined) map.panTo([p.lat, p.lon]);
    };
    box.appendChild(b);
  }
  if (any) box.insertAdjacentHTML('afterbegin', `<span class="small muted">${esc(t.presets)}: </span>`);
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
  state.feedKey = key;
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
  let feed;
  try {
    feed = await loadFeed(buf);
  } catch (e) {
    status(esc(String(e.message || e)));
    return;
  }
  // A zip that holds only demand-responsive service is shown as the overlay.
  if (!feed.model) {
    status('');
    useFlex(feed.flex, meta ? { name: meta.feed, short: meta.feed, pub: meta.org } : null, key || 'file');
    return;
  }
  state.model = feed.model;
  state.meta = meta;
  state.feedKey = key;
  state.from = state.to = null;
  state.gaps = state.gapKey = state.weekKey = null;
  state.presetAt = {};
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
  drawPresets();
  // A bus feed that also carries GTFS-Flex trips overlays them, unless another overlay is open.
  if (feed.flex && !state.flex) useFlex(feed.flex, meta ? { name: meta.feed, short: meta.feed, pub: meta.org } : null, key || 'file');
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
  const wd = lang === 'ja' ? weekdayName(ymd) + '曜日' : weekdayName(ymd);
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
  let html = '';
  if (state.model) {
    const agencies = state.model.agencies.join('、');
    if (m) {
      const lic = m.licenseUrl ? `<a href="${esc(m.licenseUrl)}" target="_blank" rel="noopener">${esc(m.license || '')}</a>` : esc(m.license || '');
      html = `${t.source}: ${esc(m.org)}「${esc(m.feed)}」（${lic}）／<a href="https://gtfs-data.jp/" target="_blank" rel="noopener">GTFSデータリポジトリ</a> — ${t.modified}`;
    } else {
      html = `${t.source}: ${esc(agencies)} — ${t.modified}`;
    }
  }
  const fm = state.flexMeta;
  if (state.flex) {
    const who = fm ? `${esc(fm.pub || '')}「${esc(fm.name)}」` : esc(state.flex.agencies.join('、'));
    const where = fm && fm.page ? `（<a href="${esc(fm.page)}" target="_blank" rel="noopener">${esc(fm.src || t.odpt)}</a>, CC BY 4.0）` : '';
    html += (html ? '<br>' : '') + `${t.flexSource}: ${who}${where} — ${t.modified}`;
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
  if (state.mode === 'gap') q.set('map', 'gap');
  if (state.flexId && FLEX_FEEDS.some(f => f.id === state.flexId)) q.set('flex', state.flexId);
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

// One journey as plain text for the trip card: "8:00 発 → 8:30 着 (乗換 ○○)".
function journeyText(j) {
  const via = j.via !== null && j.via !== undefined ? ` (${t.via} ${placeName(state.model.places[j.via])})` : '';
  return `${fmtTime(j.dep, lang)} ${t.dep} → ${fmtTime(j.arr, lang)} ${t.arr}${via}`;
}

function journeyList(list) {
  const shown = list.slice(0, CARD_TRIPS).map(journeyText);
  if (list.length > CARD_TRIPS) shown.push(t.more(list.length - CARD_TRIPS));
  return shown.join(lang === 'ja' ? '、' : '; ');
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

// When the buses can't do the round trip: can the demand-responsive service? Plain text, or ''.
function flexPairText() {
  const links = linksTo(state.to);
  if (!links) return '';
  const l = links[state.from];
  if (!flexOk(l, state.stay * 60)) return '';
  const trip = l.there.trip;
  return t.flexPair(flexName(trip), windowText(l.there.start, l.back.end), bookingText(trip));
}

function render() {
  const box = $('#result');
  const { model } = state;
  // The URL first: the legend's copied summary and the trip card both quote it.
  if (model) updateUrl();
  drawLegend();
  if (!model) { box.innerHTML = ''; return; }
  drawStops();
  const r = state.range;
  const rangeText = r && r.start ? `${dashed(r.start)} – ${dashed(r.end)}` : '?';
  const notes = [];
  if (r && r.start && (state.ymd < r.start || state.ymd > r.end)) notes.push(t.outside(rangeText));
  else if (!state.view.trips.length) notes.push(t.noService(rangeText));
  if (state.flex && !flexDay(state.flex, state.ymd).length) notes.push(t.flexIdle);
  let html = notes.map(n => `<p class="warn">${esc(n)}</p>`).join('');
  if (state.from === null || state.to === null) {
    const one = state.from !== null ? state.from : state.to;
    if (one !== null) html += `<p><b>${esc(placeName(model.places[one]))}</b>: ${esc(stopLine(one))}</p>`;
    box.innerHTML = html + `<p class="muted">${t.pickBoth}</p>`;
    return;
  }
  if (state.from === state.to) { box.innerHTML = html + `<p class="warn">${t.same}</p>`; return; }
  // The trip card: the same answer as plain text, for copying into a message or printing.
  const fromLine = `${t.cardFrom}: ${placeName(model.places[state.from])}`;
  const toLine = `${t.cardTo}: ${placeName(model.places[state.to])}`;
  const card = [t.cardTitle, conditions(), fromLine, toLine, ...notes];
  html = `<div class="printonly"><b>${esc(t.cardTitle)}</b><br>${esc(conditions())}<br>${esc(fromLine)}<br>${esc(toLine)}</div>` + html;
  const transfers = state.transfer ? 1 : 0;
  const outs = journeys(state.view, state.from, state.to, transfers, MIN_CONNECTION);
  const backs = journeys(state.view, state.to, state.from, transfers, MIN_CONNECTION);
  const rt = roundTrip(outs, backs, state.stay * 60);
  let verdict = '';
  if (rt.status === 'none') verdict = state.transfer ? t.none : t.noneDirect;
  else if (rt.status === 'oneway') verdict = t.oneway;
  else if (rt.status === 'noreturn') verdict = t.noreturn(fmtTime(rt.firstArr, lang), fmtTime(rt.lastBack, lang));
  if (verdict) {
    html += `<div class="verdict no">✕ ${esc(verdict)}</div>`;
    card.push('✕ ' + verdict);
  } else {
    const lo = rt.latestOut;
    const loVia = lo.via !== null ? ` (${t.via} ${placeName(model.places[lo.via])})` : '';
    const facts = [
      [t.arrive, fmtTime(rt.firstArr, lang)],
      [t.lastBack, fmtTime(rt.lastBack, lang)],
      [t.maxStay, fmtSpan(rt.maxStay, lang)],
      [t.latest, `${fmtTime(lo.dep, lang)} ${t.dep}${loVia}`],
    ];
    html += `<div class="verdict ok">◯ ${t.ok}</div><dl class="facts">` + facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>';
    card.push('◯ ' + t.ok, ...facts.map(([k, v]) => `${k}: ${v}`));
  }
  const fx = rt.status !== 'ok' ? flexPairText() : '';
  if (fx) {
    html += `<div class="verdict fx">◯ ${esc(fx)}</div>`;
    card.push('◯ ' + fx);
  }
  if (outs.length) card.push(`${t.plansLine}: ${journeyList(outs)}`);
  if (backs.length) card.push(`${t.backsLine}: ${journeyList(backs)}`);
  card.push(t.note, location.href);
  html += toolsHtml(t.copy, t.print);
  if (outs.length || backs.length) {
    html += `<h3>${t.goTable} <small>${t.trips(outs.length)}</small></h3>${table(rt.plans, true)}`;
    html += `<h3>${t.backTable} <small>${t.trips(backs.length)}</small></h3>${table(backs, false)}`;
  }
  html += `<p class="muted small">${t.note}</p><p class="small noprint"><a href="${esc(location.href)}">${t.share}</a></p><p class="printonly small">${esc(location.href)}</p>`;
  box.innerHTML = html;
  const text = card.join('\n');
  wireTools(box, text, 'card');
}

// ---- wiring ----

function applyText() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t[el.dataset.t];
  for (const el of document.querySelectorAll('[data-ph]')) el.placeholder = t[el.dataset.ph];
  $('#feed option[value=""]').textContent = t.pickFeed;
  $('#flex option[value=""]').textContent = t.flexPick;
  $('#flex option[value="off"]').textContent = t.flexOff;
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
$('#flex').addEventListener('change', e => {
  if (e.target.value === 'off') clearFlex();
  else if (e.target.value) loadFlexFeed(e.target.value);
});
$('#flexfile').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  $('#flexstatus').textContent = t.loading;
  try {
    useFlex(await loadFlex(await f.arrayBuffer()), null, 'file');
  } catch (err) {
    $('#flexstatus').textContent = String(err.message || err);
  }
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
if (params.get('map') === 'gap') state.mode = 'gap';
for (const r of document.querySelectorAll('input[name=mode]')) {
  r.checked = r.value === state.mode;
  r.addEventListener('change', e => { if (e.target.checked) { state.mode = e.target.value; render(); } });
}
applyText();
fillFlexList();
drawLegend();
loadFeedList().then(() => {
  const want = params.get('flex');
  if (want && FLEX_FEEDS.some(f => f.id === want)) {
    $('#flex').value = want;
    loadFlexFeed(want);
  }
});
