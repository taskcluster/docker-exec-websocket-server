ARG  NODE_VERSION=14-bullseye
FROM node:${NODE_VERSION}

RUN node -v
RUN npm -v
USER root
RUN mkdir /var/run/app
COPY . /var/run/app/
WORKDIR /var/run/app
RUN yarn install --ignore-engines
