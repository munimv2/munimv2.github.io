/* worker.js: runs Pyodide and the checkup off the page's main thread.
 * Messages in: {type: "check", files: [{name, data: ArrayBuffer}]}.
 * Messages out: {type: "status", text}, {type: "ready", version},
 * {type: "done", md, rows}, {type: "error", text}.
 * By MV2 of Munim, Inc.; written with AI agents. Apache-2.0. */
importScripts("core.js");
importScripts(PX4Check.PYODIDE_URL + "pyodide.js");

var ready = null;

function say(text) {
  postMessage({type: "status", text: text});
}

function start() {
  if (!ready) {
    ready = (async function () {
      say("Loading Python (Pyodide " + PX4Check.PYODIDE + ")");
      var pyodide = await loadPyodide({indexURL: PX4Check.PYODIDE_URL});
      var version = await PX4Check.prepare(pyodide, null, say);
      postMessage({type: "ready", version: version});
      return pyodide;
    })();
  }
  return ready;
}

function message(err) {
  return String((err && err.message) || err);
}

onmessage = async function (e) {
  var pyodide;
  try {
    pyodide = await start();
  } catch (err) {
    ready = null;                       // let the next message try again
    postMessage({type: "error", text: "Could not load the checker: " + message(err)});
    return;
  }
  if (e.data.type !== "check") {
    return;
  }
  try {
    say("Checking " + e.data.files.length + " log" + (e.data.files.length === 1 ? "" : "s") +
        " (a large log can take a minute or two)");
    var files = e.data.files.map(function (f) { return {name: f.name, data: new Uint8Array(f.data)}; });
    var res = await PX4Check.run(pyodide, files);
    postMessage({type: "done", md: res.md, rows: res.rows});
  } catch (err) {
    postMessage({type: "error", text: message(err)});
  }
};
