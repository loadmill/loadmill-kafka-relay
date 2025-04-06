FROM node:18.20.5-alpine

WORKDIR /usr/src/app/loadmill-kafka-relay

COPY . .
RUN yarn install
RUN yarn build

EXPOSE 3000
CMD ["node", "--no-experimental-fetch", "dist"]