#!/bin/bash -ve
mocha \
  test/testclient.js
eslint \
  lib/server.js \
  lib/client.js 
