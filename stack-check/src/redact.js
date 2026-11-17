'use strict';
// AI Stack Check: redact secrets from a config file before any of it can leave the device.
// Copyright 2026 Munim, Inc. Licensed under the Apache License, Version 2.0 (Apache-2.0).
// Made by MV2 of Munim, Inc. with AI agents.
//
// Runs in the browser (window.StackRedact) and under Node (module.exports) for the tests.
// It is deliberately conservative: when in doubt a value is replaced. Variable references
// such as ${OPENAI_API_KEY} are kept, because they hold no secret themselves.
(function (root) {
  const SECRET_NAME_RE = /(^|[_.-])(api[_-]?key|apikey|key|token|secret|password|passwd|pass|pwd|credentials?|auth|salt|private[_-]?key|access[_-]?key|session[_-]?key|jwt|cookie|dsn|connection[_-]?string)$/i;
  // Names that look secret by the rule above but are not (they hold names or switches).
  const NOT_SECRET_NAME_RE = /(^|[_.-])(key[_-]?(name|id|file|path)|token[_-]?(url|endpoint|type|ttl|expiry)|auth[_-]?(type|mode|provider|url|enabled))$|^(WEBUI_AUTH|ENABLE_AUTH|DISABLE_AUTH|N8N_BASIC_AUTH_ACTIVE)$/i;

  // Well-known token shapes, redacted wherever they appear.
  const TOKEN_PATTERNS = [
    ['openai-key', /\bsk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{20,}\b/g],
    ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g],
    ['huggingface-token', /\bhf_[A-Za-z0-9]{20,}\b/g],
    ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
    ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
    ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g],
    ['stripe-key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
    ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ];

  const URL_USERINFO_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s\/@"'<>]+)@/gi;
  const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
  // Public IPv4 addresses (private, loopback and unspecified ranges are kept: they explain the setup).
  const IPV4_RE = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;

  // KEY=value (env lists, .env files) and KEY: value (YAML maps), with optional "- " and quotes.
  const ASSIGN_RE = /^(\s*(?:-\s*)?["']?)([A-Za-z_][A-Za-z0-9_.-]*)(["']?\s*(?:=|:\s)\s*)(.*)$/;

  const MARK = '<redacted>';

  function isReference(value) {
    const v = String(value).trim().replace(/^["']|["']$/g, '');
    return v === '' || /^\$\{[^}]+\}$/.test(v) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v);
  }

  function isSecretName(name) {
    return SECRET_NAME_RE.test(name) && !NOT_SECRET_NAME_RE.test(name);
  }

  function isPublicIPv4(a, b, c, d) {
    const n = [a, b, c, d].map(Number);
    if (n.some((x) => x > 255)) return false;
    if (n[0] === 10 || n[0] === 127 || n[0] === 0) return false;
    if (n[0] === 172 && n[1] >= 16 && n[1] <= 31) return false;
    if (n[0] === 192 && n[1] === 168) return false;
    if (n[0] === 169 && n[1] === 254) return false;
    if (n[0] === 100 && n[1] >= 64 && n[1] <= 127) return false; // carrier-grade NAT / Tailscale
    if (n[0] >= 224) return false;
    return true;
  }

  /**
   * redact(text) -> { text, redactions: [{ line, kind }] }
   * kinds: secret-value, private-key, url-credentials, public-ip, and the TOKEN_PATTERNS names.
   */
  function redact(text) {
    const redactions = [];
    let src = String(text == null ? '' : text);

    // Private key blocks can span lines; replace them first and note the starting line.
    src = src.replace(PRIVATE_KEY_RE, (m, offset) => {
      redactions.push({ line: src.slice(0, offset).split('\n').length, kind: 'private-key' });
      return MARK;
    });

    const lines = src.split(/\r\n|\r|\n/);
    const out = lines.map((line, i) => {
      const n = i + 1;
      let l = line;
      if (/^\s*#/.test(l)) {
        // Comments can still hold pasted tokens; only the pattern rules apply to them.
      } else {
        const m = ASSIGN_RE.exec(l);
        if (m && isSecretName(m[2]) && !isReference(m[4])) {
          const raw = m[4];
          const comment = /\s+#.*$/.exec(raw);
          const quote = /^["']/.exec(raw.trim());
          const q = quote ? quote[0] : '';
          l = `${m[1]}${m[2]}${m[3]}${q}${MARK}${q}${comment ? comment[0] : ''}`;
          redactions.push({ line: n, kind: 'secret-value' });
        }
      }
      l = l.replace(URL_USERINFO_RE, (all, scheme) => {
        redactions.push({ line: n, kind: 'url-credentials' });
        return `${scheme}${MARK}@`;
      });
      for (const [kind, re] of TOKEN_PATTERNS) {
        re.lastIndex = 0;
        l = l.replace(re, () => {
          redactions.push({ line: n, kind });
          return MARK;
        });
      }
      l = l.replace(IPV4_RE, (all, a, b, c, d) => {
        if (!isPublicIPv4(a, b, c, d)) return all;
        redactions.push({ line: n, kind: 'public-ip' });
        return '<public-ip>';
      });
      return l;
    });
    return { text: out.join('\n'), redactions };
  }

  /** Short human summary: "3 values hidden (2 secret-value, 1 public-ip)". */
  function summarize(redactions) {
    if (!redactions || !redactions.length) return 'Nothing needed hiding.';
    const counts = {};
    for (const r of redactions) counts[r.kind] = (counts[r.kind] || 0) + 1;
    const parts = Object.keys(counts).sort().map((k) => `${counts[k]} ${k}`);
    return `${redactions.length} value${redactions.length === 1 ? '' : 's'} hidden (${parts.join(', ')}).`;
  }

  const api = { redact, summarize, isSecretName, isPublicIPv4, MARK };
  if (typeof module === 'object' && module && typeof require === 'function') module.exports = api;
  if (typeof window !== 'undefined') window.StackRedact = api;
  else if (root) root.StackRedact = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
