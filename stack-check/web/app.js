// AI Stack Check: page logic.
// Copyright 2026 Munim, Inc. Licensed under the Apache License, Version 2.0 (Apache-2.0).
// Made by MV2 of Munim, Inc. with AI agents.
import { aiConfigured, deviceModelStatus, explain } from './ai.js';

const FEED_URL = 'https://raw.githubusercontent.com/munimtechnologies/ai-stack-advisories/main/advisories.json';
const core = window.StackCore;
const R = window.StackRedact;
const X = window.StackExposure;
const P = window.StackPrompt;

const $ = (id) => document.getElementById(id);
let feed = null;
let last = null;

function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v;
    else if (k === 'href') {
      // Only http(s) links from the curated feed are rendered as links.
      if (/^https?:\/\//i.test(v)) n.setAttribute('href', v);
    } else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

async function loadFeed() {
  if (feed) return feed;
  const res = await fetch(FEED_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`advisory list: HTTP ${res.status}`);
  feed = await res.json();
  $('feed-date').textContent = feed.checked || 'unknown';
  return feed;
}

function guessKind(text, name) {
  return core.fileKind(name || '') || core.codeBlockKind('', text) || 'yaml';
}

function renderFindings(versionFindings, exposures) {
  const box = $('findings');
  box.replaceChildren();
  const affected = versionFindings.filter((f) => f.status === 'affected');
  const unpinned = versionFindings.filter((f) => f.status === 'unpinned');
  const ok = versionFindings.filter((f) => f.status === 'ok');
  $('counts').textContent = `${exposures.length} exposure problem(s), ${affected.length} component(s) with known advisories, ${unpinned.length} without an exact version, ${ok.length} with none known.`;

  if (!exposures.length && !affected.length && !unpinned.length) {
    box.append(el('p', { class: 'ok' }, versionFindings.length
      ? 'No known problems in the self-hosted AI components found here.'
      : 'No self-hosted AI components were recognised. Paste a docker-compose file, Dockerfile, requirements.txt, package.json or CycloneDX SBOM.'));
  }
  for (const e of exposures) {
    box.append(el('div', { class: `card sev-${e.severity}` },
      el('div', { class: 'tag' }, `${e.severity} · ${e.service} · line ${e.line}`),
      el('h3', {}, e.title),
      el('p', {}, e.detail),
      el('p', { class: 'fix' }, 'Fix: ', e.fix)));
  }
  for (const f of affected) {
    const list = el('ul', {});
    for (const a of f.advisories.slice(0, 12)) {
      list.append(el('li', {},
        el('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer' }, a.id),
        ` (${String(a.severity || 'unrated').toLowerCase()}${a.fixedIn ? `, fixed in ${a.fixedIn}` : ', no fixed release'}${a.onlyIfFeatureUsed ? ', only if that feature is used' : ''}${a.notInPublicDatabases ? ', not in OSV when checked' : ''}): `,
        a.summary));
    }
    if (f.advisories.length > 12) list.append(el('li', {}, `…and ${f.advisories.length - 12} more.`));
    box.append(el('div', { class: 'card sev-version' },
      el('div', { class: 'tag' }, `version · line ${f.line}`),
      el('h3', {}, core.describe(f)),
      list));
  }
  if (unpinned.length) {
    box.append(el('div', { class: 'card sev-low' },
      el('div', { class: 'tag' }, 'not checked'),
      el('h3', {}, `No exact version: ${unpinned.map((f) => `${f.name} (line ${f.line})`).join(', ')}`),
      el('p', {}, 'Tags like latest or main change on every pull, so nobody can say which advisories apply. Pin an exact version and update it on purpose.')));
  }
}

async function runCheck() {
  const text = $('input').value;
  $('status').textContent = 'Checking…';
  $('ai-out').replaceChildren();
  try {
    const data = await loadFeed();
    const kind = guessKind(text, $('filename').value);
    const versionFindings = core.scanText(data, $('filename').value || 'pasted file', kind, text);
    const exposures = kind === 'yaml' ? X.checks(text) : [];
    const red = R.redact(text);
    last = { versionFindings, exposures, red, feedDate: data.checked };
    renderFindings(versionFindings, exposures);
    $('redacted').textContent = red.text;
    $('redact-summary').textContent = R.summarize(red.redactions);
    $('results').hidden = false;
    $('status').textContent = 'Done. Everything above ran in this browser; your file was not uploaded.';
  } catch (e) {
    $('status').textContent = `Could not run the check: ${e.message}`;
  }
}

function renderAnswer(ans, source, inventedIds) {
  const out = $('ai-out');
  out.replaceChildren();
  const where = P.sourceOf(source);
  out.append(el('div', { class: `badge src-${where}` },
    where === 'device' ? 'Answered on this device by Gemini Nano: nothing left your computer'
      : where === 'cloud' ? 'Answered in the cloud by Gemini: only the redacted prompt shown below was sent'
        : 'Answered'));
  if (!ans.ok) {
    out.append(el('pre', { class: 'plain' }, ans.text));
  } else {
    out.append(el('h3', {}, ans.headline));
    const ol = el('ol', {});
    for (const s of ans.steps) ol.append(el('li', {}, el('strong', {}, s.title), el('p', {}, s.why), el('p', { class: 'fix' }, s.how)));
    out.append(ol);
    if (ans.patchedCompose) {
      out.append(el('h4', {}, 'Suggested compose file (check it before use; secrets stay as <redacted>)'));
      out.append(el('pre', {}, ans.patchedCompose));
    }
  }
  if (inventedIds.length) {
    out.append(el('p', { class: 'warn' }, `Ignore these IDs in the answer: they are not in the curated findings (${inventedIds.join(', ')}).`));
  }
}

async function runExplain() {
  if (!last) await runCheck();
  if (!last) return;
  const privacy = document.querySelector('input[name=privacy]:checked').value;
  const prompt = P.buildPrompt({ versionFindings: last.versionFindings, exposures: last.exposures, redactedText: last.red.text, feedDate: last.feedDate });
  $('prompt-preview').textContent = prompt;
  $('ai-status').textContent = privacy === 'device-only' ? 'Asking Gemini Nano on this device…' : 'Asking Gemini Nano on this device (cloud if it is not available)…';
  try {
    const { text, source } = await explain(prompt, P.SYSTEM, P.ANSWER_SCHEMA, privacy, (p) => {
      $('ai-status').textContent = `Downloading the on-device model: ${(p * 100).toFixed(0)}%`;
    });
    const ans = P.parseAnswer(text);
    renderAnswer(ans, source, P.inventedIds(text, last.versionFindings));
    $('ai-status').textContent = '';
  } catch (e) {
    $('ai-status').textContent = privacy === 'device-only'
      ? `The on-device model is not available here (${e.message}). Choose "on-device first" to allow the cloud fallback, or use Chrome on a desktop that supports Gemini Nano.`
      : `The explanation failed: ${e.message}`;
  }
}

async function init() {
  $('check').addEventListener('click', runCheck);
  $('sample').addEventListener('click', async () => {
    const res = await fetch('demo/compose.yaml');
    $('input').value = await res.text();
    $('filename').value = 'compose.yaml';
    runCheck();
  });
  if (aiConfigured()) {
    $('ai-panel').hidden = false;
    $('explain').addEventListener('click', runExplain);
    const st = await deviceModelStatus();
    $('device-status').textContent = {
      available: 'Gemini Nano is ready on this device.',
      downloadable: 'Gemini Nano can be downloaded to this device on first use.',
      downloading: 'Gemini Nano is downloading.',
      unavailable: 'This device cannot run Gemini Nano; explanations will come from the cloud.',
      'no-api': 'This browser has no on-device model; explanations will come from the cloud.',
    }[st] || `On-device model: ${st}`;
  } else {
    $('ai-off').hidden = false;
  }
  loadFeed().catch(() => { $('feed-date').textContent = 'not loaded'; });
}

init();
