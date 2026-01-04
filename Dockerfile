# ---------- Build Stage ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

# ---------- Runtime Stage ----------
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
USER node
EXPOSE 3000
CMD ["yarn", "start"]

LABEL org.opencontainers.image.source="https://github.com/loadmill/loadmill-kafka-relay"
LABEL org.opencontainers.image.description="Loadmill Kafka Relay"
LABEL org.opencontainers.image.licenses="MIT"
