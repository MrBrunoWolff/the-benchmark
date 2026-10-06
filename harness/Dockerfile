FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
RUN npm install --global --ignore-scripts @earendil-works/pi-coding-agent@1.0.4 \
    && npm cache clean --force
WORKDIR /app
