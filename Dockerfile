FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
# CI=true: pnpm refuses to remove node_modules without a TTY otherwise.
ENV CI=true
RUN pnpm install --frozen-lockfile
RUN pnpm build
# Drop dev dependencies (vite, vitest, ...) but keep tsx, which runs the server.
RUN pnpm install --frozen-lockfile --prod

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/server/templates ./apps/server/templates
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 8080
CMD ["apps/server/node_modules/.bin/tsx", "apps/server/src/main.ts"]
