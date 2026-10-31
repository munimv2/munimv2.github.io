/* core.js: px4-log-health's checkup, run in the browser with Pyodide.
 *
 * Shared by the page (index.html), its worker (worker.js) and the test
 * (test_core.js, Node). prepare() loads numpy and pyulog into Pyodide and
 * fetches checkup.py, health.py and baseline.json from px4-log-health and
 * gps_lag.py and innov.py from px4-gps-lag, at pinned refs. run() writes the
 * logs into Pyodide's in-memory file system and calls checkup.main exactly as
 * the command line does, so the report is the same one checkup.py writes.
 * No log is uploaded anywhere.
 *
 * By MV2 of Munim, Inc.; written with AI agents. Apache-2.0.
 */
(function (root) {
  "use strict";

  var VERSION = "0.1.0";
  var PYODIDE = "314.0.7";
  var PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE + "/full/";
  var PYULOG = "1.3.0";
  var RAW = "https://raw.githubusercontent.com/munimtechnologies/";
  var HEALTH_REF = "v0.3.1";
  var GPS_LAG_REF = "967b5ad92d04ca6ac7e29684b411fbf5df243e05";   // the pin checkup's Action uses

  var SOURCES = [
    {name: "checkup.py", url: RAW + "px4-log-health/" + HEALTH_REF + "/checkup.py", must: '__version__ = "0.3.1"'},
    {name: "health.py", url: RAW + "px4-log-health/" + HEALTH_REF + "/health.py", must: '__version__ = "0.2.1"'},
    {name: "baseline.json", url: RAW + "px4-log-health/" + HEALTH_REF + "/baseline.json", must: '"fields"'},
    {name: "gps_lag.py", url: RAW + "px4-gps-lag/" + GPS_LAG_REF + "/gps_lag.py", must: '__version__ = "0.1.0"'},
    {name: "innov.py", url: RAW + "px4-gps-lag/" + GPS_LAG_REF + "/innov.py", must: '__version__ = "0.2.0"'}
  ];

  // Runs in Pyodide. _paths is set from JavaScript; the report goes to /out.
  var DRIVER = [
    "import os, sys",
    "if '/px4' not in sys.path:",
    "    sys.path.insert(0, '/px4')",
    "import checkup",
    "os.makedirs('/out', exist_ok=True)",
    "for _p in ('/out/report.md', '/out/rows.jsonl'):",
    "    if os.path.exists(_p):",
    "        os.remove(_p)",
    "_code = checkup.main(list(_paths) + ['--md', '/out/report.md', '--json', '/out/rows.jsonl'])",
    "_code"
  ].join("\n");

  function fetchText(url) {
    return fetch(url, {cache: "no-cache"}).then(function (resp) {
      if (!resp.ok) {
        throw new Error(url + ": HTTP " + resp.status);
      }
      return resp.text();
    });
  }

  // Loads numpy and pyulog and writes the checker's files to /px4.
  // Returns checkup's version. say(text) reports progress.
  async function prepare(pyodide, getText, say) {
    getText = getText || fetchText;
    say = say || function () {};
    say("Loading numpy");
    await pyodide.loadPackage(["numpy", "micropip"]);
    say("Installing pyulog " + PYULOG);
    var micropip = pyodide.pyimport("micropip");
    await micropip.install("pyulog==" + PYULOG);
    pyodide.FS.mkdirTree("/px4");
    for (var i = 0; i < SOURCES.length; i++) {
      var s = SOURCES[i];
      say("Fetching " + s.name);
      var text = await getText(s.url);
      if (s.must && text.indexOf(s.must) < 0) {
        throw new Error(s.name + " at " + s.url + " is not the expected version");
      }
      pyodide.FS.writeFile("/px4/" + s.name, text);
    }
    return pyodide.runPython(
      "import sys\nif '/px4' not in sys.path:\n    sys.path.insert(0, '/px4')\nimport checkup\ncheckup.__version__");
  }

  // A file name that is safe in /logs and unique among names.
  function safeName(name, taken) {
    var base = String(name).split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, "_") || "log.ulg";
    var out = base, n = 2;
    while (taken[out]) {
      out = base.replace(/(\.[^.]*)?$/, "-" + n + "$1");
      n += 1;
    }
    taken[out] = true;
    return out;
  }

  // files: [{name, data: Uint8Array}]. Returns {md, rows, code}; the logs
  // are removed from the in-memory file system afterwards.
  async function run(pyodide, files) {
    pyodide.FS.mkdirTree("/logs");
    var paths = [], taken = {};
    for (var i = 0; i < files.length; i++) {
      var p = "/logs/" + safeName(files[i].name, taken);
      pyodide.FS.writeFile(p, files[i].data);
      paths.push(p);
    }
    try {
      pyodide.globals.set("_paths", pyodide.toPy(paths));
      var code = await pyodide.runPythonAsync(DRIVER);
      return {
        md: pyodide.FS.readFile("/out/report.md", {encoding: "utf8"}),
        rows: pyodide.FS.readFile("/out/rows.jsonl", {encoding: "utf8"}),
        code: code
      };
    } finally {
      paths.forEach(function (q) {
        try { pyodide.FS.unlink(q); } catch (e) { /* already gone */ }
      });
    }
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function inline(s) {
    return escapeHtml(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function cells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); });
  }

  // The Markdown checkup.py writes (headings, paragraphs, lists, tables,
  // bold, italics, code) as HTML. Everything is escaped first.
  function mdToHtml(md) {
    var lines = md.replace(/\r\n/g, "\n").split("\n");
    var out = [], para = [], i = 0;

    function flush() {
      if (para.length) {
        out.push("<p>" + inline(para.join(" ")) + "</p>");
        para = [];
      }
    }
    while (i < lines.length) {
      var line = lines[i];
      var h = /^(#{1,3}) (.*)$/.exec(line);
      if (h) {
        flush();
        out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">");
        i += 1;
      } else if (/^- /.test(line)) {
        flush();
        out.push("<ul>");
        while (i < lines.length && /^- /.test(lines[i])) {
          out.push("<li>" + inline(lines[i].slice(2)) + "</li>");
          i += 1;
        }
        out.push("</ul>");
      } else if (/^\|/.test(line)) {
        flush();
        var rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) {
          rows.push(cells(lines[i]));
          i += 1;
        }
        out.push("<table>");
        rows.forEach(function (r, k) {
          if (k === 1 && r.every(function (c) { return /^:?-+:?$/.test(c); })) {
            return;
          }
          var tag = k === 0 ? "th" : "td";
          out.push("<tr>" + r.map(function (c) { return "<" + tag + ">" + inline(c) + "</" + tag + ">"; }).join("") + "</tr>");
        });
        out.push("</table>");
      } else if (line.trim() === "") {
        flush();
        i += 1;
      } else {
        para.push(line.trim());
        i += 1;
      }
    }
    flush();
    return out.join("\n");
  }

  var api = {
    VERSION: VERSION, PYODIDE: PYODIDE, PYODIDE_URL: PYODIDE_URL, PYULOG: PYULOG,
    SOURCES: SOURCES, prepare: prepare, run: run, mdToHtml: mdToHtml, safeName: safeName,
    fetchText: fetchText
  };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.PX4Check = api;
  }
})(typeof self !== "undefined" ? self : this);
