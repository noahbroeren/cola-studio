'use strict';
/**
 * Vercel serverless entry point. vercel.json rewrites /api/*, /products/:slug,
 * /uploads/*, /media/weibo, /sitemap.xml and /robots.txt to this function.
 * Everything else (pages, assets) is served statically from dist/.
 */
const { getVercelApp } = require('../server/vercel/app');

module.exports = async function handler(req, res) {
  await getVercelApp().handle(req, res);
};
