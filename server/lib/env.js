'use strict';
/**
 * Minimal .env loader (no dependencies).
 *
 * Supports:
 *   KEY=value
 *   export KEY=value
 *   KEY="value with spaces and \n escapes"
 *   KEY='literal value'
 *   KEY=value # trailing comment
 *   # full-line comments and blank lines
 *
 * Variables that already exist in the environment are NOT overwritten, so real
 * environment variables (systemd, Docker, PaaS dashboards) always win over the
 * file.
 */
const fs = require('node:fs');

function parseEnv(text) {
  const out = {};
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)?\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2] == null ? '' : m[2];

    if (value.startsWith('"')) {
      // Double quoted: may span multiple lines, supports \n \t \" \\ escapes.
      let raw = value.slice(1);
      while (!/(^|[^\\])"\s*(#.*)?$/.test(raw) && i + 1 < lines.length) {
        raw += '\n' + lines[++i];
      }
      raw = raw.replace(/"\s*(#.*)?$/, '');
      value = raw.replace(/\\([nrt"\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }[c]));
    } else if (value.startsWith("'")) {
      value = value.slice(1).replace(/'\s*(#.*)?$/, '');
    } else {
      // Unquoted: strip trailing comment (a # preceded by whitespace).
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[key] = value;
  }
  return out;
}

/** Load a .env file into `target` (default process.env). Returns the keys that were set. */
function loadEnvFile(file, target = process.env) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const parsed = parseEnv(text);
  const set = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (target[k] === undefined) {
      target[k] = v;
      set.push(k);
    }
  }
  return set;
}

module.exports = { parseEnv, loadEnvFile };
