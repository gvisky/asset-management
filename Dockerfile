# Node 24 ships a stable built-in SQLite (node:sqlite) — no native build tools needed.
FROM node:24-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# Persist the database on a mounted volume (see render.yaml / your host's disk config)
ENV DB_PATH=/data/assets.db

# Create the volume mount point
RUN mkdir -p /data

EXPOSE 3000

CMD ["node", "server.js"]
