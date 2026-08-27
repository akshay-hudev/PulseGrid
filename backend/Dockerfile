FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY tsconfig.json prisma7.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM dependencies AS migration
COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma ./prisma
CMD ["npm", "run", "db:deploy"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs pulsegrid
COPY --from=production-dependencies --chown=pulsegrid:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=pulsegrid:nodejs /app/dist ./dist
COPY --chown=pulsegrid:nodejs package.json package-lock.json prisma7.config.ts ./
COPY --chown=pulsegrid:nodejs prisma ./prisma
USER pulsegrid
EXPOSE 4000
CMD ["npm", "start"]
