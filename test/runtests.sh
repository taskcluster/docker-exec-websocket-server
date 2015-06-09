#!/bin/bash -ve
mocha \
  test/client.js
eslint \
  lib/server.js \
  lib/client.js 
