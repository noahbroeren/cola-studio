'use strict';
/**
 * Three-way merge for JSON documents, used when two serverless instances
 * changed the same collection at the same time.
 *
 *   merge3(base, ours, theirs)
 *     base   = what this request loaded
 *     ours   = what this request wants to write
 *     theirs = what another request wrote in the meantime
 *
 * Rules
 *  - Only one side changed a value → take that side.
 *  - Both changed a plain object → merge key by key (recursively).
 *  - Arrays whose items all carry an `id` (or `sku`) → merged per item:
 *    additions from both sides are kept, a deletion on either side wins,
 *    items changed on both sides are merged recursively. Order follows
 *    `theirs`, our new items are appended.
 *  - Other arrays → set union of both sides' additions minus deletions
 *    (inventory event log, tag lists).
 *  - Anything else changed on both sides → ours wins (last writer).
 */

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
  return true;
}

/** Identity field shared by every item of the array ('id' or 'sku'), else null. */
function keyField(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  for (const f of ['id', 'sku']) {
    if (arr.every((x) => isObj(x) && (typeof x[f] === 'string' || typeof x[f] === 'number'))) return f;
  }
  return null;
}

function mergeKeyedArrays(base, ours, theirs, f) {
  const idx = (arr) => new Map(arr.map((x) => [String(x[f]), x]));
  const B = idx(base);
  const O = idx(ours);
  const T = idx(theirs);
  const out = [];
  const seen = new Set();
  for (const t of theirs) {
    const id = String(t[f]);
    seen.add(id);
    const inBase = B.has(id);
    const inOurs = O.has(id);
    if (inBase && !inOurs) continue; // we deleted it
    if (!inBase && !inOurs) {
      out.push(t); // they added it
      continue;
    }
    out.push(inBase ? merge3(B.get(id), O.get(id), t) : merge3(undefined, O.get(id), t));
  }
  for (const o of ours) {
    const id = String(o[f]);
    if (seen.has(id)) continue;
    if (B.has(id) && !T.has(id)) continue; // they deleted it
    out.push(o); // we added it
  }
  return out;
}

function merge3(base, ours, theirs) {
  if (deepEqual(ours, theirs)) return theirs;
  if (deepEqual(base, ours)) return theirs; // only they changed
  if (deepEqual(base, theirs)) return ours; // only we changed
  if (isObj(ours) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out = {};
    const keys = new Set([...Object.keys(theirs), ...Object.keys(ours)]);
    for (const k of keys) {
      const inO = Object.prototype.hasOwnProperty.call(ours, k);
      const inT = Object.prototype.hasOwnProperty.call(theirs, k);
      const inB = Object.prototype.hasOwnProperty.call(b, k);
      if (inO && inT) out[k] = merge3(b[k], ours[k], theirs[k]);
      else if (inO) {
        // they removed it (keep ours only if we changed it) or we added it
        if (!inB || !deepEqual(b[k], ours[k])) out[k] = ours[k];
      } else if (inT) {
        if (!inB || !deepEqual(b[k], theirs[k])) out[k] = theirs[k];
      }
    }
    return out;
  }
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    const b = Array.isArray(base) ? base : [];
    const f = keyField(ours.length ? ours : theirs) || keyField(theirs);
    if (f && (!ours.length || keyField(ours) === f) && (!theirs.length || keyField(theirs) === f) && (!b.length || keyField(b) === f)) {
      return mergeKeyedArrays(b, ours, theirs, f);
    }
    return mergeSets(b, ours, theirs);
  }
  return ours;
}

/** Arrays without an identity field (append-only logs, tag lists): union of both sides' additions minus deletions. */
function mergeSets(base, ours, theirs) {
  const sig = (x) => JSON.stringify(x);
  const B = new Set(base.map(sig));
  const O = new Set(ours.map(sig));
  const T = new Set(theirs.map(sig));
  const out = theirs.filter((x) => {
    const s = sig(x);
    return !(B.has(s) && !O.has(s)); // drop what we deleted
  });
  for (const x of ours) {
    const s = sig(x);
    if (!B.has(s) && !T.has(s)) out.push(x); // our additions
  }
  return out;
}

module.exports = { merge3, deepEqual, isObj };
