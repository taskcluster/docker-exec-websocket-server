#!/bin/bash -ve
# USAGE: Run this file using `npm test` (must run from repository root)

npm run compile;

docker run --rm  --name testserver ubuntu sleep 60 &
trap "docker kill testserver;" EXIT; sleep 1;

mocha \
  test/test.js

eslint \
  src/server.js \
  src/client.js 
