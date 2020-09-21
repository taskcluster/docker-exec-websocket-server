# docker-exec-websocket-server

[![Build Status](https://travis-ci.org/taskcluster/docker-exec-websocket-server.svg?branch=master)](https://travis-ci.org/taskcluster/docker-exec-websocket-server)

## Purpose
A server that serves the results of docker exec over websockets.

See `docker-exec-websocket-client` for a client that communicates with this server.

## Usage
Server:

```js
var DockerServer = require('../lib/server.js');
var dockerServer = new DockerServer({
  port:8080, //automatically creates http server
  //OR
  server: //http.Serv object, can also be https, should already be listening

  path: '/'+slugid.v4(),    //Path to WebSocket
  containerId: 'servertest',  //Container to inject exec proccess into
  dockerSocket: '/var/run/docker.sock' //location of docker remote API socket
  maxSessions: 10 //maximum number of connected sessions
});
await dockerServer.execute();
```
By default, uses `/var/run/docker.sock` to communicate with Docker.

## Message Types
Messages are prepended with a single byte which contains information about the encoded message. The payload is a `Buffer` in node, or a `UInt8Array` in browserify.

```js
// stream related message types (carries a payload)
stdin: 0,
stdout: 1,
stderr: 2,
// data-flow related message types (carries no payload)
resume: 100, // Process is now ready to receive data
pause: 101, // Process is processing current data, don't send more right now
// resolution related message types
stopped: 200, // Process exited, payload is single byte exit code
shutdown: 201, // Server shut down
error: 202 // Some internal error occurred, expect undefined behaviour
```

## Testing

Docker 1.6.1 or above must be installed with a container named `servertest` running with `cat` and `/bin/bash` capabilities to inject the exec process into. From there, `npm test` will carry out the test.
