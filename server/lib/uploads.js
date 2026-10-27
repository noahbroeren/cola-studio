'use strict';
/**
 * Admin image uploads: JSON { filename, data } where data is base64 or a
 * data: URL. The real type is sniffed from magic bytes (the declared MIME and
 * extension are ignored), SVGs are scanned for active content, files are
 * content-addressed (<safe-name>-<hash>.<ext>) and written atomically.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { HttpError } = require('./http');
const { slugify, writeFileAtomic } = require('./util');

const TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/** Detect file type from magic bytes. → extension or null */
function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head6 = buf.subarray(0, 6).toString('latin1');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    // ISO-BMFF: check major + compatible brands within the ftyp box.
    const boxSize = Math.min(buf.readUInt32BE(0), buf.length, 256);
    const brands = [];
    for (let i = 8; i + 4 <= boxSize; i += 4) {
      if (i === 12) continue; // minor version
      brands.push(buf.subarray(i, i + 4).toString('latin1'));
    }
    if (brands.some((b) => b === 'avif' || b === 'avis')) return 'avif';
    return null;
  }
  // SVG: text that starts (after BOM/whitespace/XML prolog/comments/doctype) with <svg
  const text = buf.subarray(0, 4096).toString('utf8').replace(/^﻿/, '');
  const stripped = text
    .replace(/^\s*<\?xml[\s\S]*?\?>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '')
    .trimStart();
  if (/^<svg[\s>]/i.test(stripped)) return 'svg';
  return null;
}

/** Reject SVGs that could execute script or pull in external documents. → error message or null */
function svgProblem(buf) {
  const s = buf.toString('utf8');
  if (/<script[\s>/]/i.test(s)) return 'SVG contains <script>';
  if (/\son[a-z]+\s*=/i.test(s)) return 'SVG contains event handler attributes (on*)';
  if (/javascript\s*:/i.test(s) || /vbscript\s*:/i.test(s)) return 'SVG contains javascript: URLs';
  if (/<!ENTITY/i.test(s)) return 'SVG contains entity declarations';
  if (/<(foreignObject|iframe|embed|object|handler|listener)[\s>/]/i.test(s)) return 'SVG contains embedded documents';
  if (/(href|src)\s*=\s*["']?\s*data:(?!image\/(png|jpe?g|gif|webp|avif))/i.test(s)) return 'SVG contains non-image data URLs';
  if (/<set[^>]+attributeName\s*=\s*["']?(href|xlink:href)/i.test(s)) return 'SVG contains animated links';
  return null;
}

/** Decode base64 / data URL into a Buffer. */
function decodeData(data) {
  if (typeof data !== 'string' || !data) throw new HttpError(400, 'data is required (base64 or data URL)');
  let b64 = data;
  const m = /^data:([^;,]*)(;[^,]*)?,(.*)$/s.exec(data);
  if (m) {
    if (!/;base64/i.test(m[2] || '')) {
      // Non-base64 data URL (e.g. URL-encoded SVG)
      try {
        return Buffer.from(decodeURIComponent(m[3]), 'utf8');
      } catch {
        throw new HttpError(400, 'Invalid data URL');
      }
    }
    b64 = m[3];
  }
  b64 = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new HttpError(400, 'data is not valid base64');
  return Buffer.from(b64, 'base64');
}

function safeBaseName(filename) {
  const base = path.basename(String(filename || 'file')).replace(/\.[^.]*$/, '');
  return slugify(base, 40) || 'file';
}

/**
 * Validate + name an upload without storing it. → { buf, ext, name, size, type }
 * Shared by the disk backend and the Redis backend (Vercel).
 */
function prepareUpload({ filename, data } = {}, { maxBytes = 8 * 1024 * 1024 } = {}) {
  const buf = decodeData(data);
  if (!buf.length) throw new HttpError(400, 'File is empty');
  if (buf.length > maxBytes) throw new HttpError(413, `File too large (max ${Math.round((maxBytes / 1024 / 1024) * 10) / 10} MB)`);
  const ext = sniff(buf);
  if (!ext) throw new HttpError(415, 'Unsupported file type (allowed: jpg, png, webp, gif, avif, svg)');
  if (ext === 'svg') {
    const problem = svgProblem(buf);
    if (problem) throw new HttpError(400, `Rejected SVG: ${problem}`);
  }
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
  const name = `${safeBaseName(filename)}-${hash}.${ext}`;
  return { buf, ext, name, size: buf.length, type: TYPES[ext] };
}

/**
 * Save an upload to disk. → { url, name, size, type }
 */
function saveUpload(body, { dir, maxBytes = 8 * 1024 * 1024, urlPrefix = '/uploads/' }) {
  const { buf, name, size, type } = prepareUpload(body, { maxBytes });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) writeFileAtomic(file, buf);
  return { url: urlPrefix + name, name, size, type };
}

const UPLOAD_NAME = /^[a-z0-9][a-z0-9-]{0,80}\.(jpg|png|gif|webp|avif|svg)$/;

function listUploads(dir, urlPrefix = '/uploads/') {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      if (!st.isFile()) continue;
      const ext = path.extname(name).slice(1).toLowerCase();
      out.push({
        name,
        url: urlPrefix + encodeURIComponent(name),
        size: st.size,
        type: TYPES[ext === 'jpeg' ? 'jpg' : ext] || 'application/octet-stream',
        modifiedAt: st.mtime.toISOString(),
      });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function deleteUpload(dir, name) {
  const base = path.basename(String(name || ''));
  if (!base || base !== name || base.startsWith('.') || base.includes('\0')) throw new HttpError(400, 'Invalid file name');
  const file = path.join(dir, base);
  if (!fs.existsSync(file)) throw new HttpError(404, 'File not found');
  fs.unlinkSync(file);
  return true;
}

/** Disk backend with the async interface the routes use. */
function createDiskUploads({ dir, maxBytes }) {
  return {
    kind: 'disk',
    async save(body) {
      return saveUpload(body, { dir, maxBytes });
    },
    async list() {
      return listUploads(dir);
    },
    async remove(name) {
      return deleteUpload(dir, name);
    },
  };
}

module.exports = { sniff, svgProblem, decodeData, prepareUpload, saveUpload, listUploads, deleteUpload, createDiskUploads, TYPES, UPLOAD_NAME };
