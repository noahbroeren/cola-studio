#!/usr/bin/env node
'use strict';
/**
 * Cola Studio — backend entry point.
 *
 *   node server.js            (or: npm start)
 *
 * Zero dependencies: only Node.js built-ins (Node >= 18.17).
 * Configuration: environment variables or a .env file next to this script
 * (see .env.example and docs/BACKEND.md).
 */
const path = require('node:path');
const { loadEnvFile } = require('./server/lib/env');

loadEnvFile(path.join(__dirname, '.env'));

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) {
  console.error(`Cola Studio needs Node.js >= 18.17 (found ${process.versions.node}).`);
  process.exit(1);
}

const { createApp } = require('./server/app');

let app;
try {
  app = createApp();
} catch (err) {
  console.error('Failed to start Cola Studio:', err);
  process.exit(1);
}

app
  .listen()
  .then((addr) => {
    const host = addr.address === '::' || addr.address === '0.0.0.0' ? 'localhost' : addr.address;
    app.log.info(`Cola Studio ${app.version} listening on http://${host}:${addr.port}`);
    app.log.info(`data: ${app.config.dataDir} · public: ${app.config.publicDir} · site: ${app.config.siteUrl}`);
  })
  .catch((err) => {
    app.log.error(`Could not listen on ${app.config.host}:${app.config.port}: ${err.message}`);
    process.exit(1);
  });

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal} received — shutting down`);
  try {
    await app.close();
  } catch (err) {
    app.log.error(`error during shutdown: ${err.message}`);
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Upstream problems are handled inside the services; these are last-resort guards.
process.on('unhandledRejection', (err) => {
  app.log.error(`unhandled promise rejection: ${err && err.stack ? err.stack : err}`);
});
process.on('uncaughtException', (err) => {
  app.log.error(`uncaught exception: ${err && err.stack ? err.stack : err}`);
  try {
    app.store.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
