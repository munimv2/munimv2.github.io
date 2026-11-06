/* test_core.js: checks the in-browser PX4 log check with Node and Pyodide.
 *
 *   node test_core.js --unit             # no network: Markdown, names, page wiring, pins
 *   node test_core.js --real OUT_DIR     # the real thing, see below
 *
 * --real waits until px4-log-health v0.3.4 is on GitHub, downloads the two
 * public logs attached to PX4-Autopilot PR #24831 (logs_dynmodel.zip, checked
 * against the sha256 px4-gps-lag's paired job recorded; no Flight Review
 * download), unpacks them inside Pyodide, runs them through core.js exactly as
 * the page's worker does, and compares the report with v0.3.4's
 * studies/dynmodel/report.md, which checkup.py wrote on the same two logs in
 * v0.3.4's sealed check. Exit 1 on any failure.
 *
 * 0.2.0 (core.js 0.2.0, checkup 0.3.4). 0.1.0 compared three Flight Review
 * logs with v0.3.1's sample report.
 *
 * By MV2 of Munim, Inc.; written with AI agents. Apache-2.0. */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const core = require("./core.js");

const ZIP = "https://github.com/user-attachments/files/20456409/logs_dynmodel.zip";
const ZIP_SHA = "aa6997a9754d4a11149bb4aa23f9721e16450eba4dc4808c0644ed2e04343b49";
const LOGS = ["log_5_2025-5-27-11-50-34.ulg", "log_8_2025-5-27-12-55-02.ulg"];   // sorted, as checkup.py got them
const EXPECTED = "https://raw.githubusercontent.com/munimtechnologies/px4-log-health/v0.3.4/" +
                 "studies/dynmodel/report.md";
const UA = "px4-log-check-test/" + core.VERSION + " (MV2 of Munim, Inc.; mv2@munimtech.com)";
const NOTE = "**u-blox dynamic model 6.**";

function unit() {
  // Markdown as checkup.py writes it
  const md = ["# PX4 log health", "", "1 log, checked.", "", "## a<b>.ulg", "", "**No flags.**", "",
              "Notes:", "", "- vibration not banded: m/s^2", "",
              "| Figure | This flight | Among 208 |", "|---|---|---|",
              "| Accelerometer clipping | 0 events (0.00 per min) | p10-p75 (tied) |", "",
              "*(tied)*: many public flights have exactly this value.", "", "### GPS delay", "",
              "The GPS lags the IMU by **39 ms** (± 4.1); this vehicle's EKF2_GPS_DELAY is 110 ms (-71 ms).", "",
              NOTE + " This receiver runs GPS_UBX_DYNMODEL = 6 (airborne <1g).", ""].join("\n");
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
  assert.ok(html.includes("<p><strong>u-blox dynamic model 6.</strong> This receiver runs GPS_UBX_DYNMODEL = 6 (airborne &lt;1g).</p>"));
  assert.strictEqual((html.match(/<table>/g) || []).length, 1);

  // file names in /logs
  const taken = {};
  assert.strictEqual(core.safeName("C:\\logs\\flight 1.ulg", taken), "flight_1.ulg");
  assert.strictEqual(core.safeName("flight 1.ulg", taken), "flight_1-2.ulg");
  assert.strictEqual(core.safeName("../../etc/passwd", taken), "passwd");
  assert.strictEqual(core.safeName(LOGS[0], taken), LOGS[0]);
  assert.strictEqual(core.safeName(LOGS[1], taken), LOGS[1]);

  // the page and its worker load the files this folder ships
  const page = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "worker.js"), "utf8");
  assert.ok(page.includes('<script src="core.js"></script>') && page.includes('new Worker("worker.js")'));
  assert.ok(worker.includes('importScripts("core.js")') && worker.includes("PX4Check.PYODIDE_URL"));
  assert.ok(!/\bMIT\b/.test(page + worker + fs.readFileSync(path.join(__dirname, "core.js"), "utf8")));
  assert.ok(page.includes("v0.3.4"), "the page names the checkup it runs");
  core.SOURCES.forEach(function (s) {
    assert.ok(/^https:\/\/raw\.githubusercontent\.com\/munimtechnologies\/px4-(log-health|gps-lag)\//.test(s.url), s.url);
    assert.ok(s.must, s.name);
  });

  // the pins
  assert.strictEqual(core.VERSION, "0.2.0");
  const byName = {};
  core.SOURCES.forEach(function (s) { byName[s.name] = s; });
  assert.deepStrictEqual(Object.keys(byName), ["checkup.py", "health.py", "baseline.json", "gps_lag.py", "innov.py"]);
  ["checkup.py", "health.py", "baseline.json"].forEach(function (n) {
    assert.ok(byName[n].url.includes("/px4-log-health/v0.3.4/"), byName[n].url);
  });
  assert.strictEqual(byName["checkup.py"].must, '__version__ = "0.3.4"');
  assert.strictEqual(byName["health.py"].must, '__version__ = "0.2.2"');
  ["gps_lag.py", "innov.py"].forEach(function (n) {
    assert.ok(byName[n].url.includes("/px4-gps-lag/967b5ad92d04ca6ac7e29684b411fbf5df243e05/"), byName[n].url);
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
  for (let attempt = 0; attempt <= 100; attempt++) {
    try {
      const t = await text(core.SOURCES[0].url);
      if (t.includes(core.SOURCES[0].must)) {
        await text(EXPECTED);              // the report is in the same release
        return attempt * 90;
      }
    } catch (err) {
      if (err.status !== 404) {
        throw err;
      }
    }
    console.log("px4-log-health v0.3.4 not on GitHub yet; waiting 90 s");
    await sleep(90000);
  }
  throw new Error("px4-log-health v0.3.4 never appeared");
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

// Unpacks the wanted logs inside Pyodide (Python's zipfile; archive paths are
// never used as output paths) and returns [{name, data}] in LOGS order.
function unzipInPyodide(pyodide, bytes) {
  pyodide.FS.writeFile("/tmp/logs.zip", bytes);
  pyodide.globals.set("_want", pyodide.toPy(LOGS));
  const found = JSON.parse(pyodide.runPython([
    "import json, os, zipfile",
    "_found = []",
    "with zipfile.ZipFile('/tmp/logs.zip') as _z:",
    "    for _info in _z.infolist():",
    "        _base = os.path.basename(_info.filename.replace('\\\\', '/'))",
    "        if _base in list(_want) and _base not in _found:",
    "            with open('/tmp/' + _base, 'wb') as _f:",
    "                _f.write(_z.read(_info))",
    "            _found.append(_base)",
    "os.remove('/tmp/logs.zip')",
    "json.dumps(sorted(_found))"
  ].join("\n")));
  assert.deepStrictEqual(found, LOGS.slice().sort(), "the zip holds both logs");
  return LOGS.map(function (name) {
    const data = pyodide.FS.readFile("/tmp/" + name);
    pyodide.FS.unlink("/tmp/" + name);
    return {name: name, data: data};
  });
}

async function real(outDir) {
  fs.mkdirSync(outDir, {recursive: true});
  const result = {test: "0.2.0", core: core.VERSION, pyodide: core.PYODIDE, pyulog: core.PYULOG,
                  sources: core.SOURCES.map(function (s) { return s.url; }), zip: ZIP};
  const installed = require("pyodide/package.json").version;
  assert.strictEqual(installed, core.PYODIDE, "npm pyodide " + installed + " is not the page's " + core.PYODIDE);
  result.waited_s = await waitForRelease();
  const want = await text(EXPECTED);

  const resp = await fetch(ZIP, {headers: {"User-Agent": UA}});
  assert.ok(resp.ok, "zip: HTTP " + resp.status);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  result.zip_bytes = bytes.length;
  result.zip_sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.strictEqual(result.zip_sha256, ZIP_SHA, "logs_dynmodel.zip changed");

  const {loadPyodide} = require("pyodide");
  let t0 = Date.now();
  const pyodide = await loadPyodide();
  result.checkup = await core.prepare(pyodide, text, function (s) { console.log(s); });
  result.prepare_s = (Date.now() - t0) / 1000;
  const files = unzipInPyodide(pyodide, bytes);
  result.log_bytes = files.map(function (f) { return f.data.length; });
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
  result.dynmodel_notes = res.md.split(NOTE).length - 1;
  const rows = res.rows.trim().split("\n").map(function (l) { return JSON.parse(l); });
  result.gps_dynmodel = rows.map(function (r) { return r.gps_dynmodel; });
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));

  assert.strictEqual(result.checkup, "0.3.4");
  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual(result.logs_left, [], "logs are removed after the check");
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(result.dynmodel_notes, 1, "the note shows on the model-6 log only");
  assert.deepStrictEqual(result.gps_dynmodel.map(function (d) { return d && d.value; }), [7, 6]);
  assert.notStrictEqual(cmp.verdict, "different", "the browser report differs from checkup.py's");
  console.log("real: the browser report is " + cmp.verdict + " to checkup.py's v0.3.4 dynmodel report");
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
