FROM node:14.18.0-alpine

WORKDIR /usr/src/app/loadmill-kafka-relay

COPY . .
RUN yarn install
RUN yarn build

EXPOSE 3000
CMD ["node", "dist"]