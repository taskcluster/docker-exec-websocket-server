var dockerClient = require('../lib/client.js');
var DockerServer = require('../lib/server.js');
var debug = require('debug')('docker-exec-websocket-server:ex/terminal.js');

var server = new DockerServer({
  port: 8081,
  containerId: 'servertest',
  path: '/a',
  log: true,
});

async function main () {
  var client = new dockerClient({
    hostname: 'localhost',
    port: 8081,
    pathname: 'a',
    tty: 'true',
    command: '/bin/bash',
  });
  await client.execute();

  process.stdin.pipe(client.stdin);
  client.stdout.pipe(process.stdout);
  client.stderr.pipe(process.stderr);
  client.on('exit', (code) => {
    process.exit(code);
  });
}
main();
