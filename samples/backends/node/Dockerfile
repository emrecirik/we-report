FROM node:22-alpine
WORKDIR /app/samples/backends/node
COPY samples/data/ /app/samples/data/
COPY samples/backends/node/package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY samples/backends/node/src ./src
USER node
ENV WE_REPORT_HOST=0.0.0.0
EXPOSE 5480
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.mjs"]
