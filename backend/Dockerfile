FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY tsconfig.json prisma7.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npm run prisma:generate && npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM dependencies AS migration
COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma ./prisma
CMD ["npm", "run", "db:deploy"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json package-lock.json ./
EXPOSE 4000
CMD ["npm", "start"]
