'use strict';
// AI Stack Guard for Jira: core logic.
// Copyright 2026 Munim, Inc. Licensed under the Apache License, Version 2.0 (Apache-2.0).
// Made by MV2 of Munim, Inc. with AI agents.
//
// This file has no Forge imports, so it runs under plain Node for the tests. It finds self-hosted
// AI apps (Ollama, Open WebUI, vLLM, LiteLLM, n8n, Dify, Langflow, Flowise, RAGFlow, AnythingLLM,
// MCP Inspector) in compose files, Dockerfiles, requirements files, package.json and CycloneDX
// SBOMs, and matches their pinned versions against MV2's curated advisory feed
// (https://github.com/munimtechnologies/ai-stack-advisories). It is a JavaScript port of that
// repo's scan_stack.py, with the same matching rules.

const FEED_URL = 'https://raw.githubusercontent.com/munimtechnologies/ai-stack-advisories/main/advisories.json';
const FEED_HOME = 'https://github.com/munimtechnologies/ai-stack-advisories';

// Docker image name (registry host and tag removed, lowercase) -> curated product key.
const IMAGES = {
  'ollama/ollama': 'ollama',
  'open-webui/open-webui': 'openwebui',
  'vllm/vllm-openai': 'vllm',
  'n8nio/n8n': 'n8n',
  'langgenius/dify-api': 'dify',
  'langgenius/dify-web': 'dify',
  'infiniflow/ragflow': 'ragflow',
  'mintplexlabs/anythingllm': 'anythingllm',
  'langflowai/langflow': 'langflow',
  'flowiseai/flowise': 'flowise',
  'berriai/litellm': 'litellm',
  'berriai/litellm-database': 'litellm',
};
const PYPI = { 'open-webui': 'openwebui', vllm: 'vllm', langflow: 'langflow', litellm: 'litellm' };
const NPM = { n8n: 'n8n', flowise: 'flowise', '@modelcontextprotocol/inspector': 'mcpinspector' };

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1 };
const MAX_TEXT_BYTES = 2000000;

const IMAGE_LINE_RE = /^\s*-?\s*image:\s*["']?([^"'\s#]+)/;
const FROM_LINE_RE = /^\s*FROM\s+(?:--\S+\s+)*(\S+)/i;
const REQ_LINE_RE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*==\s*v?(\d[0-9A-Za-z.+-]*)/;
const VERSION_IN_TAG_RE = /(?<![0-9])v?(\d+\.\d+(?:\.\d+)?)/;
const NPM_SPEC_RE = /^\s*([\^~=v]*)\s*(\d+\.\d+(?:\.\d+)?)/;
const VAR_DEFAULT_RE = /\$\{[A-Za-z_][A-Za-z0-9_]*:?[-=]([^}]*)\}/g;

/** '1.2.3', 'v1.2', '2.0.0-rc.1' -> [1, 2, 3] style array, or null. */
function vtuple(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  return [m[1], m[2], m[3]].map((x) => parseInt(x || '0', 10));
}

function vcmp(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Curated advisories that affect this exact version (same rules as scan_stack.py). */
function affecting(items, version, skipWindows) {
  const v = vtuple(version);
  if (!v) return [];
  return (items || []).filter((item) => {
    if (skipWindows && item.kind === 'windows') return false;
    if (Array.isArray(item.only) && item.only.length) {
      return item.only.some((x) => {
        const t = vtuple(x);
        return t !== null && vcmp(t, v) === 0;
      });
    }
    if (item.introduced) {
      const t = vtuple(item.introduced);
      if (t && vcmp(v, t) < 0) return false;
    }
    if (item.fixed) {
      const t = vtuple(item.fixed);
      if (t && vcmp(v, t) >= 0) return false;
    }
    // Advisories with no fixed release name the last affected version instead.
    if (item.lastAffected) {
      const t = vtuple(item.lastAffected);
      if (t && vcmp(v, t) > 0) return false;
    }
    return true;
  });
}

/** 'ghcr.io/open-webui/open-webui:v0.11.2' -> ['open-webui/open-webui', 'v0.11.2']. */
function parseImage(ref) {
  const r = String(ref).trim().replace(VAR_DEFAULT_RE, (_, d) => d).split('@')[0];
  let name = r;
  let tag = null;
  if (r.lastIndexOf(':') > r.lastIndexOf('/')) {
    name = r.slice(0, r.lastIndexOf(':'));
    tag = r.slice(r.lastIndexOf(':') + 1);
  }
  let parts = name.toLowerCase().split('/');
  if (parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost')) {
    parts = parts.slice(1);
  }
  if (parts.length && parts[0] === 'library') parts = parts.slice(1);
  return [parts.join('/'), tag];
}

/** 'main-v1.74.0-stable' -> '1.74.0'; 'latest', 'main', 'cuda' or null -> null. */
function tagVersion(tag) {
  if (!tag || tag.includes('$')) return null;
  const m = VERSION_IN_TAG_RE.exec(tag);
  return m ? m[1] : null;
}

function severityRank(s) {
  return SEVERITY_RANK[String(s || '').toUpperCase()] || 0;
}

function makeFinding(data, file, line, kind, ref, key, version, isRange) {
  const product = data && data.products ? data.products[key] : undefined;
  if (!product) return null;
  const out = { file, line, kind, ref, product: key, name: product.name, version: version == null ? null : version, range: !!isRange };
  if (version == null) {
    return { ...out, status: 'unpinned', advisories: [], upgradeTo: null, noFixedRelease: 0 };
  }
  const hits = affecting(product.items, version, kind === 'image');
  const advisories = hits.map((h) => ({
    id: h.ids[0],
    aliases: h.ids.slice(1),
    severity: h.severity || null,
    fixedIn: h.fixed || null,
    summary: h.summary,
    url: h.url,
    notInPublicDatabases: h.inPublicDatabases === false,
    onlyIfFeatureUsed: h.kind === 'feature',
  }));
  advisories.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const fixes = advisories.map((a) => a.fixedIn).filter(Boolean);
  const upgradeTo = fixes.length
    ? fixes.reduce((best, x) => (vcmp(vtuple(x), vtuple(best)) > 0 ? x : best))
    : null;
  return {
    ...out,
    status: advisories.length ? 'affected' : 'ok',
    advisories,
    upgradeTo,
    noFixedRelease: advisories.filter((a) => !a.fixedIn).length,
  };
}

/** Which parser a file name needs: yaml, docker, req, npm, json (maybe an SBOM) or null. */
function fileKind(fileName) {
  const n = String(fileName || '').split(/[\\/]/).pop().toLowerCase();
  if (n.endsWith('.yml') || n.endsWith('.yaml')) return 'yaml';
  if (n === 'dockerfile' || n === 'containerfile' || n.startsWith('dockerfile.') || n.endsWith('.dockerfile')) return 'docker';
  if (/^(requirements|constraints).*\.txt$/.test(n)) return 'req';
  if (n === 'package.json') return 'npm';
  if (n.endsWith('.json')) return 'json';
  return null;
}

/** Kind for a Jira code block, from its language or (when there is none) its content. */
function codeBlockKind(language, text) {
  const lang = String(language || '').toLowerCase();
  if (lang === 'yaml' || lang === 'yml') return 'yaml';
  if (lang === 'dockerfile' || lang === 'docker') return 'docker';
  if (lang === 'json') return 'json';
  const t = String(text || '');
  if (/^\s*-?\s*image:/m.test(t)) return 'yaml';
  if (/^\s*FROM\s+\S/im.test(t)) return 'docker';
  if (/^\s*\{/.test(t)) return 'json';
  if (/^\s*[A-Za-z0-9][A-Za-z0-9._-]*\s*(\[[^\]]*\])?\s*==/m.test(t)) return 'req';
  return null;
}

function splitLines(text) {
  return String(text).split(/\r\n|\r|\n/);
}

/** Parse 'pkg:type/namespace/name@version?qualifiers#subpath' (enough of the purl spec for matching). */
function parsePurl(purl) {
  const m = /^pkg:([A-Za-z.+-]+)\/([^?#]+?)(?:@([^?#]+))?(?:\?([^#]*))?(?:#.*)?$/.exec(String(purl || '').trim());
  if (!m) return null;
  const type = m[1].toLowerCase();
  const segs = m[2].split('/').map((s) => decodeURIComponent(s));
  const name = segs.pop();
  const namespace = segs.join('/');
  const version = m[3] ? decodeURIComponent(m[3]) : null;
  const qualifiers = {};
  if (m[4]) {
    for (const pair of m[4].split('&')) {
      const i = pair.indexOf('=');
      if (i > 0) qualifiers[pair.slice(0, i).toLowerCase()] = decodeURIComponent(pair.slice(i + 1));
    }
  }
  return { type, namespace, name, version, qualifiers };
}

/** Map one CycloneDX component to [productKey, version, kind] or null. */
function componentToProduct(component) {
  const p = parsePurl(component && component.purl);
  if (!p) return null;
  if (p.type === 'docker' || p.type === 'oci') {
    let imageName = p.namespace ? `${p.namespace}/${p.name}` : p.name;
    if (p.type === 'oci' && p.qualifiers.repository_url) imageName = parseImage(p.qualifiers.repository_url)[0];
    else imageName = parseImage(imageName)[0];
    const key = IMAGES[imageName.toLowerCase()];
    if (!key) return null;
    const tag = p.qualifiers.tag || (p.version && !p.version.startsWith('sha256:') ? p.version : null);
    return [key, tagVersion(tag), 'image'];
  }
  if (p.type === 'pypi') {
    const key = PYPI[p.name.toLowerCase().replace(/_/g, '-')];
    return key ? [key, p.version && vtuple(p.version) ? p.version.replace(/^v/, '') : null, 'pypi'] : null;
  }
  if (p.type === 'npm') {
    const full = (p.namespace ? `${p.namespace}/${p.name}` : p.name).toLowerCase();
    const key = NPM[full];
    return key ? [key, p.version && vtuple(p.version) ? p.version.replace(/^v/, '') : null, 'npm'] : null;
  }
  return null;
}

function walkComponents(list, out) {
  for (const c of Array.isArray(list) ? list : []) {
    if (c && typeof c === 'object') {
      out.push(c);
      walkComponents(c.components, out);
    }
  }
  return out;
}

/** Findings for one text source. kind: yaml, docker, req, npm, json (package.json or CycloneDX). */
function scanText(data, file, kind, text) {
  const found = [];
  if (text == null || String(text).length > MAX_TEXT_BYTES) return found;
  const lines = splitLines(text);
  if (kind === 'yaml' || kind === 'docker') {
    const lineRe = kind === 'yaml' ? IMAGE_LINE_RE : FROM_LINE_RE;
    lines.forEach((line, i) => {
      const m = lineRe.exec(line);
      if (!m) return;
      const [name, tag] = parseImage(m[1]);
      const key = IMAGES[name];
      if (key) found.push(makeFinding(data, file, i + 1, 'image', m[1], key, tagVersion(tag)));
    });
  } else if (kind === 'req') {
    lines.forEach((line, i) => {
      const m = REQ_LINE_RE.exec(line);
      if (!m) return;
      const key = PYPI[m[1].toLowerCase().replace(/_/g, '-')];
      if (key) found.push(makeFinding(data, file, i + 1, 'pypi', line.trim(), key, m[2]));
    });
  } else if (kind === 'npm' || kind === 'json') {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      return [];
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];
    if (doc.bomFormat === 'CycloneDX' || (kind === 'json' && Array.isArray(doc.components))) {
      for (const c of walkComponents(doc.components, [])) {
        const hit = componentToProduct(c);
        if (hit) found.push(makeFinding(data, file, 1, hit[2], c.purl, hit[0], hit[1]));
      }
    } else {
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const deps = doc[section];
        if (!deps || typeof deps !== 'object') continue;
        for (const [name, spec] of Object.entries(deps)) {
          const key = NPM[name];
          if (!key || typeof spec !== 'string') continue;
          const m = NPM_SPEC_RE.exec(spec);
          const idx = lines.findIndex((x) => x.includes(`"${name}"`));
          const isRange = !!(m && (m[1].includes('^') || m[1].includes('~')));
          found.push(makeFinding(data, file, idx >= 0 ? idx + 1 : 1, 'npm', `${name}@${spec}`, key, m ? m[2] : null, isRange));
        }
      }
    }
  }
  return found.filter(Boolean);
}

/** sources: [{file, kind, text}] -> findings, skipping sources with no known kind. */
function scanSources(data, sources) {
  const findings = [];
  for (const s of sources || []) {
    if (!s || !s.kind) continue;
    findings.push(...scanText(data, s.file, s.kind, s.text));
  }
  return findings;
}

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Find a curated product by key, display name, image, PyPI or npm name ('Open WebUI', 'open-webui', 'ollama/ollama'). */
function findProduct(data, query) {
  const q = normalizeName(query);
  if (!q || !data || !data.products) return null;
  for (const [key, p] of Object.entries(data.products)) {
    if (normalizeName(key) === q || normalizeName(p.name) === q) return key;
  }
  const raw = String(query).trim().toLowerCase();
  const key = IMAGES[parseImage(raw)[0]] || PYPI[raw.replace(/_/g, '-')] || NPM[raw] || null;
  return key && data.products[key] ? key : null;
}

/** Check one product/version by hand (the Rovo and MCP 'check-component' tool). */
function checkComponent(data, product, version, platform) {
  const key = findProduct(data, product);
  if (!key) {
    return {
      status: 'unknown-product',
      message: `"${product}" is not in the curated list. Known products: ${Object.values(data.products).map((p) => p.name).join(', ')}.`,
    };
  }
  const v = version == null ? null : String(version).trim().replace(/^v/i, '');
  const pinned = v && vtuple(v) ? v : null;
  const windows = String(platform || '').toLowerCase().startsWith('win');
  // A manual check counts Windows-only advisories unless the platform says Linux/Docker.
  const kind = windows || !platform ? 'manual' : 'image';
  return makeFinding(data, 'manual check', 0, kind, 'manual check', key, pinned);
}

function describe(f) {
  const what = `${`${f.name} ${f.version || ''}`.trim()} (${f.ref})`;
  if (f.status === 'unpinned') return `${what}: no exact version, so it can't be checked. Pin a version and update it deliberately.`;
  if (f.status === 'ok') return `${what}: no known advisories in the curated list.`;
  const n = f.advisories.length;
  let msg = `${what}: ${n} known advisor${n === 1 ? 'y' : 'ies'}`;
  if (f.upgradeTo) msg += `; update to ${f.upgradeTo} or newer`;
  if (f.noFixedRelease) msg += `; ${f.noFixedRelease} with no fixed release yet (follow their mitigations)`;
  if (f.range) msg += '. This is a version range, so the lowest version it allows was checked; your lockfile may pin a newer one';
  return `${msg}.`;
}

function truncate(s, n) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Compact report for Rovo and MCP answers (keeps the reply small enough for an agent to read). */
function compactReport(data, findings, extra) {
  const affected = findings.filter((f) => f.status === 'affected');
  return {
    ...(extra || {}),
    curatedDataAsOf: data.checked || null,
    source: FEED_HOME,
    checked: findings.length,
    affected: affected.length,
    unpinned: findings.filter((f) => f.status === 'unpinned').length,
    findings: findings.map((f) => ({
      where: f.line ? `${f.file}:${f.line}` : f.file,
      component: f.name,
      version: f.version,
      status: f.status,
      updateTo: f.upgradeTo,
      noFixedRelease: f.noFixedRelease,
      versionRange: f.range,
      advisories: f.advisories.slice(0, 8).map((a) => ({
        id: a.id,
        severity: a.severity,
        fixedIn: a.fixedIn,
        summary: truncate(a.summary, 280),
        url: a.url,
        notInPublicDatabases: a.notInPublicDatabases || undefined,
        onlyIfFeatureUsed: a.onlyIfFeatureUsed || undefined,
      })),
      moreAdvisories: Math.max(0, f.advisories.length - 8),
      summary: describe(f),
    })),
  };
}

/** Stable identities for change detection: one per (component, version, advisory). */
function advisoryKeys(findings) {
  const keys = [];
  for (const f of findings) {
    for (const a of f.advisories) keys.push(`${f.product}@${f.version}:${a.id}`);
  }
  return Array.from(new Set(keys)).sort();
}

/** Findings reduced to the advisories whose keys are not in `seen`. */
function newSince(findings, seen) {
  const old = new Set(seen || []);
  return findings
    .map((f) => ({ ...f, advisories: f.advisories.filter((a) => !old.has(`${f.product}@${f.version}:${a.id}`)) }))
    .filter((f) => f.status === 'affected' && f.advisories.length);
}

// ---------- Atlassian Document Format (ADF) helpers ----------

function adfText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content || []).map(adfText).join('');
}

/** Code blocks in an ADF document: [{language, text}]. */
function adfCodeBlocks(doc) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'codeBlock') {
      out.push({ language: (node.attrs && node.attrs.language) || '', text: adfText(node) });
      return;
    }
    (node.content || []).forEach(walk);
  };
  walk(doc);
  return out;
}

const t = (text, href) => (href ? { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] } : { type: 'text', text });
const para = (...content) => ({ type: 'paragraph', content: content.filter((c) => c && c.text) });
const bullets = (items) => ({ type: 'bulletList', content: items.map((c) => ({ type: 'listItem', content: c })) });

/** ADF comment body listing affected components (findings already filtered to what should be reported). */
function findingsCommentAdf(data, findings, heading) {
  const affected = findings.filter((f) => f.status === 'affected');
  const unpinned = findings.filter((f) => f.status === 'unpinned');
  const content = [para({ type: 'text', text: heading || 'AI Stack Guard', marks: [{ type: 'strong' }] })];
  if (!affected.length) {
    content.push(para(t(`No known advisories affect the ${findings.length} pinned self-hosted AI component(s) found here.`)));
  } else {
    content.push(bullets(affected.map((f) => {
      const advs = f.advisories.slice(0, 10).map((a) => [para(
        t(a.id, a.url),
        t(` (${String(a.severity || 'unrated').toLowerCase()}${a.fixedIn ? `, fixed in ${a.fixedIn}` : ', no fixed release'}${a.onlyIfFeatureUsed ? ', only if that feature is used' : ''}${a.notInPublicDatabases ? ', not in OSV when checked' : ''}): `),
        t(truncate(a.summary, 300)),
      )]);
      if (f.advisories.length > 10) advs.push([para(t(`…and ${f.advisories.length - 10} more.`))]);
      return [para(t(describe(f))), bullets(advs)];
    })));
  }
  if (unpinned.length) {
    content.push(para(t(`Not checked (no exact version): ${unpinned.map((f) => f.name).join(', ')}.`)));
  }
  content.push(para(
    t(`Curated advisories as of ${data.checked || '?'} from `),
    t('ai-stack-advisories', FEED_HOME),
    t(', kept by MV2 of Munim, Inc. with AI agents; it includes advisories with no CVE ID. Version pins are read from this issue only; nothing connects to your servers.'),
  ));
  return { type: 'doc', version: 1, content };
}

/** Summary and ADF description for an upgrade task for one affected finding. */
function upgradeIssueFields(data, f, sourceKey) {
  const n = f.advisories.length;
  const summary = truncate(
    `Update ${f.name} ${f.version} to ${f.upgradeTo || 'a fixed release'} (${n} known advisor${n === 1 ? 'y' : 'ies'})`,
    250,
  );
  const description = findingsCommentAdf(data, [f], `Found by AI Stack Guard in ${sourceKey} (${f.line ? `${f.file}:${f.line}` : f.file}).`);
  return { summary, description };
}

module.exports = {
  FEED_URL,
  FEED_HOME,
  IMAGES,
  PYPI,
  NPM,
  vtuple,
  vcmp,
  affecting,
  parseImage,
  tagVersion,
  makeFinding,
  fileKind,
  codeBlockKind,
  parsePurl,
  componentToProduct,
  scanText,
  scanSources,
  findProduct,
  checkComponent,
  describe,
  compactReport,
  advisoryKeys,
  newSince,
  adfText,
  adfCodeBlocks,
  findingsCommentAdf,
  upgradeIssueFields,
};
