FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY filter.json ./filter.json
COPY src ./src
USER node
ENV NODE_ENV=production PORT=8081
EXPOSE 8081
CMD ["node", "--experimental-strip-types", "src/server.ts"]
