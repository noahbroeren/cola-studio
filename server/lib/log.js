'use strict';
/**
 * Tiny logger: writes to the console and keeps the last N lines in a ring
 * buffer that the admin panel can read via GET /api/admin/logs.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function fmt(arg) {
  if (arg instanceof Error) return arg.message;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function createLogger({ size = 300, silent = false, minLevel = 'info' } = {}) {
  const buffer = [];
  const min = LEVELS[minLevel] || LEVELS.info;

  function write(level, scope, args) {
    if (LEVELS[level] < min && level !== 'error') return;
    const entry = {
      at: new Date().toISOString(),
      level,
      scope: scope || 'app',
      message: args.map(fmt).join(' '),
    };
    buffer.push(entry);
    if (buffer.length > size) buffer.splice(0, buffer.length - size);
    if (!silent) {
      const line = `${entry.at} ${level.toUpperCase().padEnd(5)} [${entry.scope}] ${entry.message}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    }
    return entry;
  }

  function make(scope, sink) {
    const api = {};
    for (const level of Object.keys(LEVELS)) {
      api[level] = (...args) => {
        const e = write(level, scope, args);
        if (sink && e) sink(e);
        return e;
      };
    }
    /** Child logger with its own scope. */
    api.child = (childScope) => make(childScope, sink);
    /**
     * Logger that additionally collects lines into `lines` (used to return a
     * per-run log to the admin, e.g. for "Fetch Weibo now").
     */
    api.capture = (lines, captureScope = scope) =>
      make(captureScope, (e) => {
        lines.push(`${e.level === 'info' ? '' : e.level.toUpperCase() + ': '}${e.message}`);
        if (sink) sink(e);
      });
    api.lines = () => buffer.slice();
    return api;
  }

  return make('app');
}

module.exports = { createLogger };
