#!/bin/bash -ve
mocha \
  test/test.js
eslint \
  lib/server.js
