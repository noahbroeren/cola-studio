'use strict';
/** GET /media/weibo?u=… and /media/img?u=… — cached proxy for Weibo media and Weidian product photos. */
const { sendError, serveFile } = require('../lib/http');
const { allowedMediaUrl } = require('../services/media');

function createMediaHandler({ media, log }) {
  return async function handleMedia(ctx) {
    const { req, res } = ctx;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendError(req, res, 405, 'Method not allowed');
    }
    const u = ctx.url.searchParams.get('u') || '';
    if (!allowedMediaUrl(u)) return sendError(req, res, 400, 'Only Weibo (*.sinaimg.cn, *.weibocdn.com) and Weidian (*.geilicdn.com) media can be proxied');
    let file = media.cachedFile(u);
    if (!file) {
      try {
        file = await media.ensure(u);
      } catch (err) {
        if (err.status !== 400) log.warn(`${err.message} (${u.slice(0, 100)})`);
        return sendError(req, res, err.status || 502, 'Could not fetch the media file');
      }
    }
    if (!serveFile(req, res, file, { cacheControl: 'public, max-age=31536000, immutable' })) {
      return sendError(req, res, 404, 'Not found');
    }
  };
}

module.exports = { createMediaHandler };
