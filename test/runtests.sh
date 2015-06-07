#!/bin/bash -ve
mocha \
  test/test.js \
  test/client.js
eslint \
  lib/server.js \
  lib/client.js
