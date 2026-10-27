# Cola Studio — zero-dependency Node.js server
#
# Used by Render (render.yaml), Railway and docker compose. No npm install
# needed: the server only uses Node.js built-ins.
#
# Persistent data (database, backups, uploads, media cache) lives in /app/data.
#  - Render: render.yaml attaches a 1 GB disk on /app/data (DATA_DIR=/app/data).
#  - Railway: attach a Volume to the service with mount path /app/data
#    (the app also picks up RAILWAY_VOLUME_MOUNT_PATH if you choose another path).
#  - docker compose: see docker-compose.yml (named volume on /app/data).
# PORT: Render sets 10000, Railway its own; 3000 is only the local default.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PUBLIC_DIR=/app/public

WORKDIR /app

COPY package.json server.js ./
COPY server ./server
COPY public ./public

RUN mkdir -p /app/data

# Runs as root on purpose: PaaS disks (Railway volumes, Render disks) are
# typically mounted owned by root, so a non-root user could not write there.

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
