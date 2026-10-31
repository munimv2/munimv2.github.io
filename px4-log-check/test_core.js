/* test_core.js: checks the in-browser PX4 log check with Node and Pyodide.
 *
 *   node test_core.js --unit             # no network: Markdown, names, page wiring
 *   node test_core.js --real OUT_DIR     # the real thing, see below
 *
 * --real waits until px4-log-health v0.3.1 is on GitHub, downloads the three
 * public Flight Review logs of v0.3.1's sealed check (6 s apart, stop on
 * 403/444), runs them through core.js exactly as the page's worker does, and
 * compares the report with studies/fleet-health-2026/sample-report.md, which
 * checkup.py wrote on the same logs in that sealed check. Exit 1 on any
 * failure.
 *
 * By MV2 of Munim, Inc.; written with AI agents. Apache-2.0. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const core = require("./core.js");

const LOGS = ["1702bde1-d47f-45a3-b003-22b4f213c961", "04f407d5-40a5-417f-9a07-9884f784028b",
              "884a84f2-d491-4729-b3b4-49701c98b93e"];
const EXPECTED = "https://raw.githubusercontent.com/munimtechnologies/px4-log-health/v0.3.1/" +
                 "studies/fleet-health-2026/sample-report.md";
const UA = "px4-log-check-test/" + core.VERSION + " (MV2 of Munim, Inc.; mv2@munimtech.com)";

function unit() {
  // Markdown as checkup.py writes it
  const md = ["# PX4 log health", "", "1 log, checked.", "", "## a<b>.ulg", "", "**No flags.**", "",
              "Notes:", "", "- vibration not banded: m/s^2", "",
              "| Figure | This flight | Among 208 |", "|---|---|---|",
              "| Accelerometer clipping | 0 events (0.00 per min) | p10-p75 (tied) |", "",
              "*(tied)*: many public flights have exactly this value.", "", "### GPS delay", "",
              "The GPS lags the IMU by **39 ms** (± 4.1); this vehicle's EKF2_GPS_DELAY is 110 ms (-71 ms).", ""].join("\n");
  const html = core.mdToHtml(md);
  assert.ok(html.includes("<h1>PX4 log health</h1>"), html);
  assert.ok(html.includes("<h2>a&lt;b&gt;.ulg</h2>"), "names are escaped");
  assert.ok(!html.includes("<b>"), "no raw HTML from the Markdown");
  assert.ok(html.includes("<p><strong>No flags.</strong></p>"));
  assert.ok(html.includes("<ul>\n<li>vibration not banded: m/s^2</li>\n</ul>"));
  assert.ok(html.includes("<tr><th>Figure</th><th>This flight</th><th>Among 208</th></tr>"));
  assert.ok(!html.includes("---"), "separator row dropped");
  assert.ok(html.includes("<td>p10-p75 (tied)</td>"));
  assert.ok(html.includes("<p><em>(tied)</em>: many public flights"));
  assert.ok(html.includes("<h3>GPS delay</h3>"));
  assert.ok(html.includes("<strong>39 ms</strong> (± 4.1)"));
  assert.strictEqual((html.match(/<table>/g) || []).length, 1);

  // file names in /logs
  const taken = {};
  assert.strictEqual(core.safeName("C:\\logs\\flight 1.ulg", taken), "flight_1.ulg");
  assert.strictEqual(core.safeName("flight 1.ulg", taken), "flight_1-2.ulg");
  assert.strictEqual(core.safeName("../../etc/passwd", taken), "passwd");
  assert.strictEqual(core.safeName(LOGS[0] + ".ulg", taken), LOGS[0] + ".ulg");

  // the page and its worker load the files this folder ships
  const page = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "worker.js"), "utf8");
  assert.ok(page.includes('<script src="core.js"></script>') && page.includes('new Worker("worker.js")'));
  assert.ok(worker.includes('importScripts("core.js")') && worker.includes("PX4Check.PYODIDE_URL"));
  assert.ok(!/\bMIT\b/.test(page + worker + fs.readFileSync(path.join(__dirname, "core.js"), "utf8")));
  core.SOURCES.forEach(function (s) {
    assert.ok(/^https:\/\/raw\.githubusercontent\.com\/munimtechnologies\/px4-(log-health|gps-lag)\//.test(s.url), s.url);
    assert.ok(s.must, s.name);
  });
  console.log("unit: all checks passed");
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function text(url) {
  const resp = await fetch(url, {headers: {"Cache-Control": "no-cache"}});
  if (!resp.ok) {
    const err = new Error(url + ": HTTP " + resp.status);
    err.status = resp.status;
    throw err;
  }
  return resp.text();
}

async function waitForRelease() {
  for (let attempt = 0; attempt <= 50; attempt++) {
    try {
      const t = await text(core.SOURCES[0].url);
      if (t.includes(core.SOURCES[0].must)) {
        return attempt * 90;
      }
    } catch (err) {
      if (err.status !== 404) {
        throw err;
      }
    }
    console.log("px4-log-health v0.3.1 not on GitHub yet; waiting 90 s");
    await sleep(90000);
  }
  throw new Error("px4-log-health v0.3.1 never appeared");
}

async function download(id) {
  const resp = await fetch("https://review.px4.io/download?log=" + id, {headers: {"User-Agent": UA}});
  if (resp.status === 403 || resp.status === 444) {
    throw new Error("Flight Review answered " + resp.status + "; stopping");
  }
  if (!resp.ok) {
    throw new Error("download " + id + ": HTTP " + resp.status);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

// Lines that differ only in a last displayed digit (a float rounding at the
// edge) are "within rounding"; anything else is a real difference.
function compare(got, want) {
  const a = got.replace(/\r\n/g, "\n").split("\n"), b = want.replace(/\r\n/g, "\n").split("\n");
  if (a.join("\n") === b.join("\n")) {
    return {verdict: "identical", differences: []};
  }
  const diffs = [];
  let real = a.length !== b.length;
  const num = /-?\d+(?:\.\d+)?/g;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) {
      continue;
    }
    diffs.push({line: i + 1, got: a[i], want: b[i]});
    if (a[i] === undefined || b[i] === undefined || a[i].replace(num, "#") !== b[i].replace(num, "#")) {
      real = true;
      continue;
    }
    const x = a[i].match(num), y = b[i].match(num);
    for (let k = 0; k < x.length; k++) {
      const places = (y[k].split(".")[1] || "").length;
      if (Math.abs(parseFloat(x[k]) - parseFloat(y[k])) > Math.pow(10, -places) + 1e-9) {
        real = true;
      }
    }
  }
  return {verdict: real ? "different" : "within rounding", differences: diffs};
}

async function real(outDir) {
  fs.mkdirSync(outDir, {recursive: true});
  const result = {test: core.VERSION, pyodide: core.PYODIDE, pyulog: core.PYULOG,
                  sources: core.SOURCES.map(function (s) { return s.url; })};
  const installed = require("pyodide/package.json").version;
  assert.strictEqual(installed, core.PYODIDE, "npm pyodide " + installed + " is not the page's " + core.PYODIDE);
  result.waited_s = await waitForRelease();
  const want = await text(EXPECTED);

  const files = [];
  for (let i = 0; i < LOGS.length; i++) {
    if (i) {
      await sleep(6000);
    }
    const data = await download(LOGS[i]);
    files.push({name: LOGS[i] + ".ulg", data: data});
    console.log("downloaded", LOGS[i], data.length, "bytes");
  }
  result.log_bytes = files.map(function (f) { return f.data.length; });

  const {loadPyodide} = require("pyodide");
  let t0 = Date.now();
  const pyodide = await loadPyodide();
  result.checkup = await core.prepare(pyodide, text, function (s) { console.log(s); });
  result.prepare_s = (Date.now() - t0) / 1000;
  t0 = Date.now();
  const res = await core.run(pyodide, files);
  result.run_s = (Date.now() - t0) / 1000;
  result.exit_code = res.code;
  result.logs_left = pyodide.FS.readdir("/logs").filter(function (n) { return n !== "." && n !== ".."; });

  fs.writeFileSync(path.join(outDir, "report.md"), res.md);
  fs.writeFileSync(path.join(outDir, "rows.jsonl"), res.rows);
  fs.writeFileSync(path.join(outDir, "report.html"), core.mdToHtml(res.md));
  const cmp = compare(res.md, want);
  result.compare = cmp;
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));

  assert.strictEqual(result.checkup, "0.3.1");
  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual(result.logs_left, [], "logs are removed after the check");
  assert.strictEqual(res.rows.trim().split("\n").length, 3);
  assert.notStrictEqual(cmp.verdict, "different", "the browser report differs from checkup.py's");
  console.log("real: the browser report is " + cmp.verdict + " to checkup.py's sealed sample report");
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--unit") {
    unit();
  } else if (args[0] === "--real" && args[1]) {
    await real(args[1]);
  } else {
    throw new Error("usage: node test_core.js --unit | --real OUT_DIR");
  }
}

main().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
