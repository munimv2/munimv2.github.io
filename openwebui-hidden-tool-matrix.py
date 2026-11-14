# Copyright 2026 Munim, Inc.
# SPDX-License-Identifier: Apache-2.0
# MV2 of Munim, Inc. (made with AI agents).
#
# Which model chat templates accept the message layout Open WebUI 0.13.1+ sends with native function calling, where
# memory recall / the skills list / attached knowledge arrive as a hidden tool round AFTER the user's message
# (release notes v0.13.1, "Context as hidden tool results"), instead of inside the system prompt (0.13.0)?
#
# For each public chat template (fetched from Hugging Face, not gated) and each message shape, render it the way
# transformers' apply_chat_template does (jinja2 sandbox; transformers' own renderer when importable) and record:
#   ok / the exact exception text, and whether the user text and the hidden context text appear in the prompt.
# This is the template alone: real servers (llama.cpp minja, vLLM, Ollama's Go renderers) may convert messages first.
#
# v2: the transformers renderer must pass a smoke render first, else the jinja2 fallback is used (so a renderer
# API mismatch can never be recorded as a template failure).
#
# usage: matrix.py run <out_dir>      (network)
#        matrix.py render <template_file> <shape> [args] [id]   (debug)
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

USER_MARK = "MV2USER hello, what do you remember about me?"
CTX_MARK = "MV2CTX memory: the user likes short answers"
SYS_TEXT = "You are a helpful assistant."
TOOL_NAME = "recall_context"  # placeholder; the real hidden tool name comes from the source capture (src/)

ID_VARIANTS = {
    "call_hex24": "call_" + "0123456789abcdef01234567",
    "uuid4": "3f2b8c1e-9a47-4d2e-b6f1-0c5d7e8a9b10",
    "alnum9": "a1B2c3D4e",
}

TOOLS = [{"type": "function", "function": {
    "name": TOOL_NAME, "description": "Recall saved memories.",
    "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": []}}}]

REPOS = [
    "Qwen/Qwen3-8B", "Qwen/Qwen3-30B-A3B", "Qwen/Qwen3-4B-Instruct-2507", "Qwen/Qwen3.5-9B", "Qwen/Qwen3.5-35B-A3B",
    "Qwen/Qwen2.5-7B-Instruct", "Qwen/QwQ-32B",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", "deepseek-ai/DeepSeek-V3.1", "deepseek-ai/DeepSeek-R1-0528",
    "unsloth/gemma-3-4b-it", "unsloth/gemma-3n-E4B-it",
    "unsloth/Llama-3.1-8B-Instruct", "unsloth/Llama-3.2-3B-Instruct",
    "unsloth/mistral-7b-instruct-v0.3", "unsloth/Mistral-Small-3.2-24B-Instruct-2506", "mistralai/Devstral-Small-2507",
    "microsoft/Phi-4-mini-instruct", "openai/gpt-oss-20b", "zai-org/GLM-4.5-Air",
    "NousResearch/Hermes-3-Llama-3.1-8B", "ibm-granite/granite-3.3-8b-instruct", "moonshotai/Kimi-K2-Instruct",
]


def tool_call(args_form, id_key):
    args = {"query": "user"}
    return {"id": ID_VARIANTS[id_key], "type": "function",
            "function": {"name": TOOL_NAME, "arguments": json.dumps(args) if args_form == "str" else args}}


def shape(name, args_form="dict", id_key="call_hex24"):
    """Message lists. A = 0.13.0 layout; B..E = 0.13.1+ hidden tool round variants."""
    sysmsg = {"role": "system", "content": SYS_TEXT}
    user = {"role": "user", "content": USER_MARK}
    tc = tool_call(args_form, id_key)
    asst = {"role": "assistant", "content": "", "tool_calls": [tc]}
    tool = {"role": "tool", "tool_call_id": tc["id"], "name": TOOL_NAME, "content": CTX_MARK}
    if name == "A_0130_system_prompt":
        return [{"role": "system", "content": SYS_TEXT + "\n\n" + CTX_MARK}, user]
    if name == "B_0131_hidden_tool":
        return [sysmsg, user, asst, tool]
    if name == "C_0131_no_system":
        return [user, asst, tool]
    if name == "D_0131_content_null":
        return [sysmsg, user, dict(asst, content=None), tool]
    if name == "E_0131_empty_user":
        return [sysmsg, {"role": "user", "content": ""}, asst, tool]
    raise ValueError(name)


PLAN = ([("A_0130_system_prompt", "dict", "call_hex24")]
        + [("B_0131_hidden_tool", a, i) for a in ("dict", "str") for i in ID_VARIANTS]
        + [(s, "dict", "call_hex24") for s in ("C_0131_no_system", "D_0131_content_null", "E_0131_empty_user")])

SMOKE_TPL = "{% for m in messages %}[{{ m['role'] }}]{{ m['content'] }}{% endfor %}"
SMOKE_MSGS = [{"role": "user", "content": "smoke"}]


def _renderer():
    try:
        from transformers.utils.chat_template_utils import render_jinja_template  # noqa: F401
        import transformers

        def r(tpl, messages, tools):
            res = render_jinja_template(conversations=[messages], tools=tools, chat_template=tpl,
                                        add_generation_prompt=True, bos_token="<s>", eos_token="</s>")
            out = res[0] if isinstance(res, tuple) else res
            return out[0] if isinstance(out, list) else out
        got = r(SMOKE_TPL, SMOKE_MSGS, None)
        if not isinstance(got, str) or "[user]smoke" not in got:
            raise RuntimeError("transformers smoke render returned %r" % (got,))
        return r, "transformers " + transformers.__version__
    except Exception as e:  # fall back to the same jinja2 setup transformers uses
        import jinja2
        from jinja2.ext import loopcontrols
        from jinja2.sandbox import ImmutableSandboxedEnvironment

        def raise_exception(message):
            raise jinja2.exceptions.TemplateError(message)

        def tojson(x, ensure_ascii=False, indent=None, separators=None, sort_keys=False):
            return json.dumps(x, ensure_ascii=ensure_ascii, indent=indent, separators=separators, sort_keys=sort_keys)

        env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True, extensions=[loopcontrols])
        env.filters["tojson"] = tojson
        env.globals["raise_exception"] = raise_exception
        env.globals["strftime_now"] = lambda f: time.strftime(f)

        def r(tpl, messages, tools):
            return env.from_string(tpl).render(messages=messages, tools=tools, add_generation_prompt=True,
                                               bos_token="<s>", eos_token="</s>")
        return r, "jinja2 %s fallback (%s: %s)" % (jinja2.__version__, type(e).__name__, str(e)[:120])


def render_one(render, tpl, messages, tools):
    try:
        out = render(tpl, messages, tools)
    except Exception as e:
        return {"ok": False, "error_type": type(e).__name__, "error": str(e)[:400]}
    return {"ok": True, "user_in_prompt": USER_MARK in out, "ctx_in_prompt": CTX_MARK in out,
            "tail": out[-700:]}


def templates_from(raw_name, raw):
    """chat_template.jinja text, or tokenizer_config.json with chat_template as str or [{name, template}]."""
    if raw_name.endswith(".jinja"):
        return {"default": raw}
    ct = json.loads(raw).get("chat_template")
    if isinstance(ct, str):
        return {"default": ct}
    if isinstance(ct, list):
        return {d["name"]: d["template"] for d in ct if isinstance(d, dict) and "template" in d}
    return {}


def fetch(repo, tpl_dir, log):
    for fn in ("chat_template.jinja", "tokenizer_config.json"):
        url = "https://huggingface.co/%s/resolve/main/%s" % (repo, fn)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "mv2-matrix"}),
                                        timeout=60) as r:
                raw = r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            log.write("%s %s HTTP %s\n" % (repo, fn, e.code))
            continue
        except Exception as e:
            log.write("%s %s %s\n" % (repo, fn, type(e).__name__))
            continue
        tpls = templates_from(fn, raw)
        if not tpls:
            log.write("%s %s no chat_template\n" % (repo, fn))
            continue
        safe = repo.replace("/", "__")
        with open(os.path.join(tpl_dir, safe + "__" + fn), "w", encoding="utf-8") as f:
            f.write(raw)
        log.write("%s %s OK %s\n" % (repo, fn, ",".join(tpls)))
        return fn, url, tpls
    return None, None, {}


def run(out_dir):
    tpl_dir = os.path.join(out_dir, "templates")
    os.makedirs(tpl_dir, exist_ok=True)
    render, how = _renderer()
    rows = []
    with open(os.path.join(out_dir, "fetch_log.txt"), "w", encoding="utf-8") as log:
        for repo in REPOS:
            fn, url, tpls = fetch(repo, tpl_dir, log)
            if not tpls:
                rows.append({"repo": repo, "fetched": False})
                continue
            for tname, tpl in sorted(tpls.items()):
                sha = hashlib.sha256(tpl.encode("utf-8")).hexdigest()[:16]
                for s, a, i in PLAN:
                    res = render_one(render, tpl, shape(s, a, i), TOOLS)
                    rows.append(dict({"repo": repo, "fetched": True, "file": fn, "url": url, "template": tname,
                                      "sha16": sha, "shape": s, "args": a, "id": i}, **res))
    with open(os.path.join(out_dir, "matrix.json"), "w", encoding="utf-8") as f:
        json.dump({"renderer": how, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "user_mark": USER_MARK, "ctx_mark": CTX_MARK, "tool_name_placeholder": TOOL_NAME,
                   "ids": ID_VARIANTS, "rows": rows}, f, indent=1, ensure_ascii=False)
    write_md(out_dir, how, rows)
    return rows


def cell(r):
    if not r["ok"]:
        return "FAIL: " + r["error"].replace("|", "/").replace("\n", " ")[:120]
    bits = []
    if not r["user_in_prompt"]:
        bits.append("user text DROPPED")
    if not r["ctx_in_prompt"]:
        bits.append("context DROPPED")
    return "ok" + (" (" + ", ".join(bits) + ")" if bits else "")


def write_md(out_dir, how, rows):
    cols = ["%s/%s/%s" % (s[:1], a, i) if s.startswith("B") else s[:1] for s, a, i in PLAN]
    lines = ["# Chat templates x Open WebUI message layouts", "", "renderer: " + how, "",
             "A = 0.13.0 (context in system prompt); B = 0.13.1+ hidden tool round (args form / tool_call id); "
             "C = B without system; D = B with assistant content null; E = B with empty user text", "",
             "| repo | template | sha16 | " + " | ".join(cols) + " |",
             "|" + "---|" * (3 + len(cols))]
    seen = {}
    for r in rows:
        if not r.get("fetched"):
            lines.append("| %s | not fetched | | %s" % (r["repo"], "| " * len(cols)))
            continue
        seen.setdefault((r["repo"], r["template"], r["sha16"]), {})[(r["shape"], r["args"], r["id"])] = r
    for (repo, t, sha), cells in seen.items():
        lines.append("| %s | %s | %s | %s |" % (repo, t, sha, " | ".join(cell(cells[k]) for k in PLAN)))
    with open(os.path.join(out_dir, "matrix.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    if sys.argv[1] == "run":
        rows = run(sys.argv[2])
        fetched = len({r["repo"] for r in rows if r.get("fetched")})
        fails = sum(1 for r in rows if r.get("fetched") and not r["ok"])
        print("REPOS fetched %d of %d; renders %d; failures %d" % (
            fetched, len(REPOS), sum(1 for r in rows if r.get("fetched")), fails))
    elif sys.argv[1] == "render":
        render, how = _renderer()
        with open(sys.argv[2], encoding="utf-8") as f:
            raw = f.read()
        tpl = list(templates_from(sys.argv[2], raw).values())[0]
        print(how)
        print(json.dumps(render_one(render, tpl, shape(*sys.argv[3:]), TOOLS), indent=1))


if __name__ == "__main__":
    main()
