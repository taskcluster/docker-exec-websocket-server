#!/bin/bash -ve
mocha \
  test/test.js
mocha-phantomjs \
  test/browserifytest.html
eslint \
  lib/server.js \
  lib/client.js 
