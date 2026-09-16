FROM node:24-alpine
ARG TG_RELEASE_COMMIT
LABEL org.opencontainers.image.revision=$TG_RELEASE_COMMIT
ENV TG_RELEASE_COMMIT=$TG_RELEASE_COMMIT
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY filter.json filter.production.json ./
COPY src ./src
USER node
ENV NODE_ENV=production PORT=8081
EXPOSE 8081
CMD ["node", "--experimental-strip-types", "src/server.ts"]
