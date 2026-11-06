# Packages the bundle, so run this first: bun build src/server.ts --target bun --outdir ./dist
FROM oven/bun:1.4.4-slim

WORKDIR /app
COPY dist ./

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080

# Run as non-root user (bun user is built into oven/bun images, UID 1000)
USER bun

CMD ["bun", "server.js"]
