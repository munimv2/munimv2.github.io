"""Checks for Kaerimichi. Run: python test_kaerimichi.py (or pytest).

The wiring checks always run; the gtfs.js logic test (test_gtfs.mjs) runs when Node.js is installed.
MV2 of Munim, Inc. - Apache-2.0 license.
"""
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def read(name):
    return (HERE / name).read_text(encoding="utf-8")


def test_app_imports_exist_in_gtfs():
    app, gtfs = read("app.js"), read("gtfs.js")
    m = re.search(r"import \{([^}]*)\} from './gtfs.js'", app)
    assert m, "app.js does not import from ./gtfs.js"
    exported = set(re.findall(r"export (?:async )?function (\w+)", gtfs))
    for name in (n.strip() for n in m.group(1).split(",")):
        assert name in exported, "gtfs.js does not export " + name


def test_app_element_ids_exist_in_html():
    app, html = read("app.js"), read("index.html")
    ids = set(re.findall(r'id="([\w-]+)"', html))
    for i in set(re.findall(r"\$\('#([\w-]+)", app)):
        assert i in ids, "index.html has no element #" + i


def test_text_keys_in_both_languages():
    app = read("app.js")
    ja = app[app.index("\n  ja: {"):app.index("\n  en: {")]
    en = app[app.index("\n  en: {"):app.index("\n};", app.index("\n  en: {"))]
    data_keys = set(re.findall(r'data-(?:t|ph)="(\w+)"', read("index.html")))
    used = set(re.findall(r"(?<![\w.$])t\.(\w+)", app)) | data_keys
    for key in sorted(used):
        for name, block in (("ja", ja), ("en", en)):
            assert re.search(r"\b" + key + r"\s*:", block), "TEXT." + name + " has no key " + key


def test_flex_feeds():
    app = read("app.js")
    block = app[app.index("const FLEX_FEEDS = ["):app.index("];", app.index("const FLEX_FEEDS = ["))]
    ids = re.findall(r"\{ id: '([\w-]+)'", block)
    assert len(ids) == len(set(ids)) >= 10
    for url in re.findall(r"url: ([^,]+),", block):
        assert url.startswith("ODPT_DEMAND + '") or url.startswith("API + '"), url
    feeds = HERE / "feeds.txt"
    if feeds.exists():
        keys = {"/".join(line.split("|")[:2]) for line in feeds.read_text(encoding="utf-8").splitlines() if line and not line.startswith("#")}
        for bus in re.findall(r"bus: '([^']+)'", block):
            assert bus in keys, "feeds.txt has no " + bus


def test_print_layouts_exist_for_every_print_button():
    app, html = read("app.js"), read("index.html")
    assert "@media print" in html
    assert 'class="controls"' in html, "the controls wrapper (hidden when printing) is missing"
    kinds = re.findall(r"wireTools\(box, \w+, '(\w+)'\);", app)
    assert sorted(kinds) == ["card", "map"], kinds
    for kind in kinds:
        assert "body.print-" + kind in html, "index.html has no print layout for " + kind
    # Classes the print and copy code looks up must be the ones toolsHtml() writes.
    tools = app[app.index("function toolsHtml"):app.index("function wireTools")]
    for cls in ("tools", "copy", "print", "note"):
        assert re.search(r'class="[^"]*\b' + cls + r'\b', tools), "toolsHtml() writes no ." + cls


def test_printed_map_is_sized_before_the_dialog():
    # v0.6: the printed map came out cut off, because Leaflet had drawn it for its on-screen size.
    app, html = read("app.js"), read("index.html")
    screen = html[:html.index("@media print")]
    printed = html[html.index("@media print"):]
    size = re.search(r"body\.print-map #map \{ width: (\w+); height: (\w+);", screen)
    assert size, "the map's print size must also apply on screen (outside @media print)"
    assert "width: %s; height: %s;" % size.groups() in printed, "screen and print sizes of the map differ"
    body = app[app.index("function printAs"):app.index("// ---- one-click destinations")]
    assert body.index("map.invalidateSize()") < body.index("window.print()"), "printAs must resize the map before printing"
    assert "afterprint" in body


def test_stay_is_kept_in_the_url():
    # v0.6: a shared link (and the language switch) used to drop the minimum stay.
    app, html = read("app.js"), read("index.html")
    assert "q.set('stay'" in app
    assert "params.get('stay')" in app
    default = re.search(r"const DEFAULT_STAY = (\d+);", app).group(1)
    assert '<option value="%s" selected>' % default in html, "DEFAULT_STAY must match the selected stay option"


def test_version_constant():
    assert re.search(r"const VERSION = '\d+\.\d+'", read("app.js"))


def test_gtfs_logic_with_node():
    node = shutil.which("node")
    if not node:
        return
    with tempfile.TemporaryDirectory() as d:
        for f in ("gtfs.js", "test_gtfs.mjs"):
            shutil.copy(HERE / f, d)
        Path(d, "package.json").write_text('{"type": "module"}', encoding="utf-8")
        r = subprocess.run([node, "test_gtfs.mjs"], cwd=d, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=120)
        assert r.returncode == 0, r.stdout + r.stderr


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
