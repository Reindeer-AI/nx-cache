# Packages the bundle, so run this first: bun build src/server.ts --target bun --outdir ./dist
FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4

WORKDIR /app
COPY dist/server.js dist/server.js.map ./

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080

# Run as non-root user (bun user is built into oven/bun images, UID 1000)
USER bun

CMD ["bun", "server.js"]
