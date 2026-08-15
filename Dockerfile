# Build the client bundle and compile the server.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server
# The repo is an ES module package, but the server is emitted as CommonJS; this
# marks the output directory so Node reads it that way.
RUN echo '{"type":"commonjs"}' > build/package.json

# Runtime carries only what it needs to serve: no source, no dev dependencies.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/build ./build
EXPOSE 8080
CMD ["node", "build/server/main.js"]
