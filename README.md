# docker-exec-websocket-server
##Purpose
A server that serves the results of docker exec over websockets. 

##Usage
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

Client: 
```js
var DockerClient = require('../lib/client.js');
var client = new DockerClient({
  url: 'ws://localhost:8081/a' //whole url of websocket, preface with wss if secure
  tty: 'true', //Whether or not we expect VT100 style output, also enables exit codes
  command: '/bin/bash', //Command to be run, can be an array with options such as ['cat', '-E']
  wsopts: {}, //Pass in websocket options for the underlying websocket
});
await client.execute();
process.stdin.pipe(client.stdin);
client.stdout.pipe(process.stdout);
client.stderr.pipe(process.stderr);
client.on('exit', (exitCode) => {
  //exitCode is a number between 0 and 255
  process.exit(exitCode);
});
```
There are also other client events: 
* `open` signifies the opening of the websocket
* `pause` and `resume` signify when the server has paused/resumed sending data
* `shutdown` signifies the server was shut down
* `error` signifies that some sort of internal error occured, and may carry a utf-8 payload

##Message Types
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

##Testing
Docker 1.6.1 or above must be installed with a container named `servertest` running with `cat` and `/bin/bash` capabilities to inject the exec process into. From there, `npm test` will carry out the test.
