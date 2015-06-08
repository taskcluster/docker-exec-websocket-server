# docker-exec-websocket-server
##Purpose
A server that serves the results of docker exec over websockets. 

##Usage
Server: 
```js
var DockerServer = require('../lib/server.js');
var dockerServer = new DockerServer({
  path: '/'+slugid.v4(),    //Path to WebSocket
                            //can be randomized to prevent unauthorized access
  port: 8081,               //Port to WebSocket, required
  container: 'servertest',  //Container to inject exec proccess into
});

```
By default, uses `/var/run/docker.sock` to communicate with Docker.

Client: 
```js
var DockerClient = require('../lib/client.js');
let client = await DockerClient({
  hostname: 'localhost', //hostname
  port: 8081,
  pathname: 'a',
  //alternatively,
  url: 'ws://localhost:8081/a' //whole url of websocket
  tty: 'true', //Whether or not we expect VT100 style output, also enables exit codes
  command: '/bin/bash', //Command to be run, can be an array with options such as ['cat', '-E']
});
process.stdin.pipe(client.stdin);
client.stdout.pipe(process.stdout);
client.stderr.pipe(process.stderr);
client.on('exit', (code) => {
  process.exit(code);
});
```

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
error: 201 // Some internal error occurred sorry, expect undefined behaviour
```

##Testing
Docker 1.6.1 or above must be installed with a container named `servertest` running with `cat` and `/bin/bash` capabilities to inject the exec process into. From there, `npm test` will carry out the test.
