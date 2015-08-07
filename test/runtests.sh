#!/bin/bash -ve
# USAGE: Run this file using `npm test` (must run from repository root)
mocha \
  test/test.js

eslint \
  src/server.js \
  src/client.js 
