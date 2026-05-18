# syntax = docker/dockerfile:1

ARG NODE_VERSION=22.11.0
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

WORKDIR /app

ENV NODE_ENV="production"

# Install deps + typecheck (fails image build if types are wrong).
COPY package-lock.json package.json ./
RUN npm ci --include=dev

COPY . .

RUN npx tsc --noEmit

# Trim devDependencies for the runtime image. tsx is a runtime dep so it survives.
RUN npm prune --omit=dev

EXPOSE 3000
CMD [ "npm", "run", "start" ]
