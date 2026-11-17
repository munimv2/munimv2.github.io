'use strict';
// AI Stack Check: exposure checks for Docker Compose files of self-hosted AI apps.
// Copyright 2026 Munim, Inc. Licensed under the Apache License, Version 2.0 (Apache-2.0).
// Made by MV2 of Munim, Inc. with AI agents.
//
// core.js answers "is this version known to be vulnerable?". This module answers the other
// half: "is this service reachable by people who should not reach it?". It reads the compose
// file line by line (no YAML library, so it also works on partial pastes) and reports:
//   - an AI API with no built-in login (Ollama, vLLM without --api-key) published on every interface;
//   - logins switched off (Open WebUI WEBUI_AUTH=False);
//   - secrets written into the file instead of referenced (${VAR});
//   - the Docker socket mounted into a container, and privileged containers.
(function (root) {
  const core = (typeof require === 'function' && typeof module === 'object') ? require('./core') : root.StackCore;

  // Default container port of each product's HTTP API and whether it has its own login.
  const API_PORTS = {
    ollama: { port: 11434, login: 'none' },
    vllm: { port: 8000, login: 'optional' }, // --api-key / VLLM_API_KEY
    openwebui: { port: 8080, login: 'yes' },
    litellm: { port: 4000, login: 'optional' }, // LITELLM_MASTER_KEY
    n8n: { port: 5678, login: 'yes' },
    langflow: { port: 7860, login: 'optional' }, // LANGFLOW_AUTO_LOGIN
    flowise: { port: 3000, login: 'optional' },
    anythingllm: { port: 3001, login: 'optional' },
    ragflow: { port: 80, login: 'yes' },
    dify: { port: 5001, login: 'yes' },
    comfyui: { port: 8188, login: 'none' },
  };

  const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 };

  function indentOf(line) {
    return /^(\s*)/.exec(line)[1].length;
  }

  function stripComment(line) {
    // Good enough for compose files: a # that starts a comment follows whitespace or starts the line.
    const m = /(^|\s)#/.exec(line);
    return m ? line.slice(0, m.index) : line;
  }

  function unquote(s) {
    return String(s).trim().replace(/^["']|["']$/g, '');
  }

  /**
   * parseCompose(text) -> [{ name, line, image, imageLine, ports: [{spec, line, hostIp, published, target}],
   *   env: {KEY: {value, line}}, volumes: [{spec, line}], privileged: line|null, command: string }]
   * Only the parts the checks need. Unknown structure is skipped, never fatal.
   */
  function parseCompose(text) {
    const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
    const services = [];
    let inServices = false;
    let serviceIndent = -1;
    let svc = null;
    let section = null; // ports | environment | volumes | command | null
    let sectionIndent = -1;
    let longPort = null;

    const finishLongPort = () => {
      if (longPort && svc) svc.ports.push(longPort);
      longPort = null;
    };

    lines.forEach((raw, i) => {
      const n = i + 1;
      const line = stripComment(raw).replace(/\s+$/, '');
      if (!line.trim()) return;
      const ind = indentOf(line);
      const body = line.trim();

      if (ind === 0) {
        finishLongPort();
        inServices = /^services:\s*$/.test(body);
        svc = null;
        section = null;
        serviceIndent = -1;
        return;
      }
      if (!inServices) return;

      // A service key: the first indented key under services: sets the service indent.
      const keyOnly = /^([A-Za-z0-9._-]+):\s*$/.exec(body);
      if (serviceIndent === -1 && keyOnly) serviceIndent = ind;
      if (ind === serviceIndent && keyOnly) {
        finishLongPort();
        svc = { name: keyOnly[1], line: n, image: null, imageLine: null, ports: [], env: {}, volumes: [], privileged: null, command: '' };
        services.push(svc);
        section = null;
        return;
      }
      if (!svc || ind <= serviceIndent) return;

      // Leaving a section when we are back at (or above) its key's indent.
      // YAML also allows list items at the same indent as their key ("ports:\n- 80:80").
      if (section && (ind < sectionIndent || (ind === sectionIndent && !body.startsWith('-')))) {
        finishLongPort();
        section = null;
      }

      if (!section) {
        const kv = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(body);
        if (!kv) return;
        const key = kv[1];
        const val = kv[2];
        if (key === 'image') {
          svc.image = unquote(val);
          svc.imageLine = n;
        } else if (key === 'privileged' && /^(true|yes)$/i.test(unquote(val))) {
          svc.privileged = n;
        } else if (key === 'ports' || key === 'environment' || key === 'volumes' || key === 'command' || key === 'entrypoint') {
          const name = key === 'entrypoint' ? 'command' : key;
          if (/^\[.*\]$/.test(val)) {
            // Flow sequence on one line: ports: ["3000:8080"]
            const items = val.slice(1, -1).split(',').map(unquote).filter(Boolean);
            for (const it of items) addItem(svc, name, it, n);
          } else if (val && name === 'command') {
            svc.command += ` ${unquote(val)}`;
          } else if (!val) {
            section = name;
            sectionIndent = ind;
          }
        }
        return;
      }

      // Inside a section.
      const item = /^-\s*(.*)$/.exec(body);
      if (section === 'ports' && item && /^[A-Za-z_]+:/.test(item[1])) {
        // Long syntax: "- target: 11434" then "published:", "host_ip:" lines.
        finishLongPort();
        longPort = { spec: '', line: n, hostIp: null, published: null, target: null };
        applyLongPortKey(longPort, item[1]);
        return;
      }
      if (section === 'ports' && longPort && !item) {
        applyLongPortKey(longPort, body);
        return;
      }
      if (item) {
        addItem(svc, section, unquote(item[1]), n);
      } else if (section === 'environment') {
        const kv = /^["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*:\s*(.*)$/.exec(body);
        if (kv) svc.env[kv[1]] = { value: unquote(kv[2]), line: n };
      } else if (section === 'command') {
        svc.command += ` ${unquote(body)}`;
      }
    });
    finishLongPort();
    return services;
  }

  function applyLongPortKey(p, text) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(String(text).trim());
    if (!kv) return;
    const v = unquote(kv[2]);
    if (kv[1] === 'target') p.target = parseInt(v, 10);
    else if (kv[1] === 'published') p.published = v;
    else if (kv[1] === 'host_ip') p.hostIp = v;
    p.spec = `${p.hostIp ? `${p.hostIp}:` : ''}${p.published || ''}${p.published ? ':' : ''}${p.target || ''}`;
  }

  function addItem(svc, section, text, n) {
    if (section === 'ports') svc.ports.push(parsePortSpec(text, n));
    else if (section === 'volumes') svc.volumes.push({ spec: text, line: n });
    else if (section === 'command') svc.command += ` ${text}`;
    else if (section === 'environment') {
      const eq = text.indexOf('=');
      if (eq > 0) svc.env[text.slice(0, eq).trim()] = { value: text.slice(eq + 1), line: n };
      else svc.env[text.trim()] = { value: null, line: n };
    }
  }

  /** "127.0.0.1:11434:11434/tcp" -> {hostIp, published, target}; IPv6 hosts in [brackets]. */
  function parsePortSpec(spec, line) {
    let s = String(spec).trim().replace(/\/(tcp|udp|sctp)$/i, '');
    let hostIp = null;
    const v6 = /^\[([^\]]+)\]:(.*)$/.exec(s);
    if (v6) {
      hostIp = v6[1];
      s = v6[2];
    }
    const parts = s.split(':');
    let published = null;
    let target = null;
    if (parts.length === 1) target = parts[0];
    else if (parts.length === 2) [published, target] = parts;
    else {
      hostIp = parts.slice(0, parts.length - 2).join(':');
      published = parts[parts.length - 2];
      target = parts[parts.length - 1];
    }
    const t = parseInt(String(target).split('-')[0], 10);
    return { spec: String(spec).trim(), line, hostIp, published, target: Number.isNaN(t) ? null : t };
  }

  function isAllInterfaces(hostIp) {
    if (hostIp == null || hostIp === '') return true;
    const h = hostIp.replace(/^\[|\]$/g, '');
    return h === '0.0.0.0' || h === '::' || h === '*';
  }

  function productOf(image) {
    if (!image || !core) return null;
    const [name] = core.parseImage(image);
    return core.IMAGES[name] || null;
  }

  function envOn(env, key) {
    return env[key] && env[key].value != null && /^(false|0|no|off)$/i.test(unquote(env[key].value)) ? env[key] : null;
  }

  function hasEnvValue(env, key) {
    return !!(env[key] && env[key].value != null && unquote(env[key].value) !== '');
  }

  /** checks(text) -> [{ id, severity, service, line, title, detail, fix }] sorted by severity. */
  function checks(text) {
    const out = [];
    const RedactLib = (typeof require === 'function' && typeof module === 'object') ? require('./redact') : root.StackRedact;
    for (const s of parseCompose(text)) {
      const product = productOf(s.image);
      const api = product ? API_PORTS[product] : null;

      for (const p of s.ports) {
        if (!api || p.target !== api.port || !isAllInterfaces(p.hostIp)) continue;
        const where = `port ${p.published || '(random)'} on every network interface`;
        if (product === 'ollama' || product === 'comfyui') {
          out.push({
            id: `${product}-open-api`, severity: 'high', service: s.name, line: p.line,
            title: `${product === 'ollama' ? 'Ollama' : 'ComfyUI'} API published on ${where}`,
            detail: `${product === 'ollama' ? 'Ollama' : 'ComfyUI'} has no login of its own, so anyone who can reach this port can use it. On Ollama that means running and pulling models, and deleting them.`,
            fix: `Bind it to localhost ("127.0.0.1:${p.published || api.port}:${api.port}"), or drop the ports entry and reach it only from other containers on the same network. Put a proxy that requires a login in front if other machines need it.`,
          });
        } else if (product === 'vllm') {
          const keyed = /--api-key(\s|=)/.test(s.command) || hasEnvValue(s.env, 'VLLM_API_KEY');
          if (!keyed) {
            out.push({
              id: 'vllm-open-api', severity: 'high', service: s.name, line: p.line,
              title: `vLLM's OpenAI-compatible API published on ${where} with no API key`,
              detail: 'Without --api-key (or VLLM_API_KEY) vLLM answers anyone who can reach the port.',
              fix: `Start vLLM with --api-key \${VLLM_API_KEY} and bind the port to 127.0.0.1 unless other machines must reach it.`,
            });
          }
        } else if (product === 'litellm' && !hasEnvValue(s.env, 'LITELLM_MASTER_KEY')) {
          out.push({
            id: 'litellm-no-master-key', severity: 'medium', service: s.name, line: p.line,
            title: `LiteLLM proxy published on ${where} with no LITELLM_MASTER_KEY set here`,
            detail: 'Without a master key the proxy does not check who is calling, and it holds your model provider keys.',
            fix: 'Set LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY} (from a .env file or secret) and bind the port to 127.0.0.1 if only this machine needs it.',
          });
        } else if (product === 'langflow' && !envOn(s.env, 'LANGFLOW_AUTO_LOGIN')) {
          out.push({
            id: 'langflow-auto-login', severity: 'medium', service: s.name, line: p.line,
            title: `Langflow published on ${where} without LANGFLOW_AUTO_LOGIN=False`,
            detail: 'Langflow logs every visitor in automatically unless LANGFLOW_AUTO_LOGIN is false, and its flows can run code.',
            fix: 'Set LANGFLOW_AUTO_LOGIN=False with LANGFLOW_SUPERUSER and LANGFLOW_SUPERUSER_PASSWORD from secrets.',
          });
        }
      }

      const noAuth = product === 'openwebui' ? envOn(s.env, 'WEBUI_AUTH') : null;
      if (noAuth) {
        out.push({
          id: 'openwebui-auth-off', severity: s.ports.some((p) => isAllInterfaces(p.hostIp)) ? 'high' : 'medium',
          service: s.name, line: noAuth.line,
          title: 'Open WebUI login is switched off (WEBUI_AUTH=False)',
          detail: 'Everyone who opens the page is an admin, with your models, chats, documents and connected tools.',
          fix: 'Remove WEBUI_AUTH=False. It is meant for single-user setups that nobody else can reach.',
        });
      }

      for (const [key, v] of Object.entries(s.env)) {
        if (v.value == null || !RedactLib || !RedactLib.isSecretName(key)) continue;
        const val = unquote(v.value);
        if (!val || /^\$\{[^}]+\}$/.test(val) || /^\$[A-Za-z_]/.test(val)) continue;
        out.push({
          id: 'secret-in-file', severity: 'medium', service: s.name, line: v.line,
          title: `${key} is written into the file`,
          detail: 'Anyone with the file (a repo, a ticket, a backup, this paste) has the secret.',
          fix: `Use ${key}=\${${key}} and keep the value in a .env file that is not committed, or in Docker secrets.`,
        });
      }

      for (const v of s.volumes) {
        if (/(^|:)\/?(var\/)?run\/docker\.sock(:|$)/.test(v.spec.replace(/^\/+/, '/'))) {
          out.push({
            id: 'docker-socket', severity: 'high', service: s.name, line: v.line,
            title: 'Docker socket mounted into the container',
            detail: 'Whoever controls this container controls Docker, and so the whole host. AI apps that run tools or code make that more likely.',
            fix: 'Remove the mount. If the app needs Docker, give it a socket proxy that only allows the calls it needs.',
          });
        }
      }
      if (s.privileged) {
        out.push({
          id: 'privileged', severity: 'medium', service: s.name, line: s.privileged,
          title: 'Container runs privileged',
          detail: 'privileged: true turns off most of the isolation between the container and the host.',
          fix: 'Remove it. For GPUs use deploy.resources.reservations.devices (driver: nvidia) instead.',
        });
      }
    }
    out.sort((a, b) => (SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]) || (a.line - b.line));
    return out;
  }

  const api = { parseCompose, parsePortSpec, isAllInterfaces, checks, API_PORTS };
  if (typeof module === 'object' && module && typeof require === 'function') module.exports = api;
  if (typeof window !== 'undefined') window.StackExposure = api;
  else if (root) root.StackExposure = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
