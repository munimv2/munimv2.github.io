"""Checks for the national results page (national.html, national.js) and the national analysis (tools/).
Run: python test_national.py (or pytest). The Node.js tests run when Node.js is installed.
MV2 of Munim, Inc. - Apache-2.0 license.
"""
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = ("lib.mjs", "national_gaps.mjs", "feed_worker.mjs", "test_national_gaps.mjs")


def read(name):
    return (HERE / name).read_text(encoding="utf-8")


def test_page_imports_exist_in_gtfs():
    page, gtfs = read("national.js"), read("gtfs.js")
    m = re.search(r"import \{([^}]*)\} from './gtfs.js'", page)
    assert m, "national.js does not import from ./gtfs.js"
    exported = set(re.findall(r"export (?:async )?function (\w+)", gtfs))
    for name in (n.strip() for n in m.group(1).split(",")):
        assert name in exported, "gtfs.js does not export " + name


def test_page_element_ids_exist_in_html():
    page, html = read("national.js"), read("national.html")
    ids = set(re.findall(r'id="([\w-]+)"', html))
    for i in set(re.findall(r"\$\('#([\w-]+)", page)):
        assert i in ids, "national.html has no element #" + i
    assert "L.map('map'" in page and 'id="map"' in html


def test_text_keys_used_by_the_html_exist():
    page, html = read("national.js"), read("national.html")
    ja = page[page.index("\n  ja: {"):page.index("\n  en: {")]
    en = page[page.index("\n  en: {"):page.index("\n};", page.index("\n  en: {"))]
    for key in set(re.findall(r'data-t="(\w+)"', html)):
        for name, block in (("ja", ja), ("en", en)):
            assert re.search(r"\n    " + key + r"\s*:", block), "TEXT." + name + " has no key " + key


def test_page_reads_columns_the_tools_write():
    page, lib = read("national.js"), read("tools/lib.mjs")
    written = set()
    for const in ("FEED_COLUMNS", "STOP_COLUMNS", "PREF_COLUMNS"):
        block = lib[lib.index("export const " + const):lib.index("];", lib.index("export const " + const))]
        written |= set(re.findall(r"'(\w+)'", block))
    # The table and popup builders read CSV rows as p (prefecture), f / feed (feed) and s (stop).
    body = page[page.index("export function prefTableHtml"):page.index("// ---- page ----")]
    used = set(re.findall(r"\b(?:[fps]|feed)\.(\w+)", body))
    assert {"pref_name", "share_round_trip", "stop_name", "status_sat", "app_url"} <= used, used
    for col in used:
        assert col in written, "national.js reads a column the tools never write: " + col


def test_licence_and_disclosure():
    for name in ("national.js", "national.html", *("tools/" + t for t in TOOLS)):
        assert not re.search(r"\bMIT\b", read(name)), name + " mentions MIT"
        assert "Apache-2.0" in read(name), name + " has no Apache-2.0 notice"
    assert "munimversion2@gmail.com" in read("national.html")
    page = read("national.js")
    assert "AIエージェント" in page and "AI agents" in page


def test_node():
    node = shutil.which("node")
    if not node:
        return
    with tempfile.TemporaryDirectory() as d:
        for f in ("gtfs.js", "national.js", "test_national_page.mjs"):
            shutil.copy(HERE / f, d)
        Path(d, "tools").mkdir()
        for f in TOOLS:
            shutil.copy(HERE / "tools" / f, Path(d, "tools"))
        Path(d, "package.json").write_text('{"type": "module"}', encoding="utf-8")
        for script in ("test_national_page.mjs", "tools/test_national_gaps.mjs"):
            r = subprocess.run([node, script], cwd=d, capture_output=True,
                               text=True, encoding="utf-8", errors="replace", timeout=120)
            assert r.returncode == 0, script + "\n" + r.stdout + r.stderr


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
