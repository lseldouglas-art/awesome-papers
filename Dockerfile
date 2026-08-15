FROM node:22.19-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.19-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV RESEARCH_WORKBENCH_HOST=0.0.0.0
ENV RESEARCH_WORKBENCH_PORT=5177
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-research ./dist-research
COPY --from=build /app/research-workbench-server.mjs ./research-workbench-server.mjs
COPY --from=build /app/research-core ./research-core

RUN mkdir -p /app/.research-workbench-data && chown -R node:node /app
USER node

EXPOSE 5177
VOLUME ["/app/.research-workbench-data"]
CMD ["npm", "start"]
