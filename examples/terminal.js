var DockerClient = require('../lib/client.js');
var DockerServer = require('../lib/server.js');
var debug = require('debug')('docker-exec-websocket-server:examples/terminal.js');

var server = new DockerServer({
  port: 8081,
  path: '/a',
  containerId: 'servertest',
  log: true,
});

async function main () {
  var client = new DockerClient({
    url: 'ws://localhost:8081/a',
    tty: 'true',
    command: 'sh',
  });
  await client.execute();

  process.stdin.pipe(client.stdin);
  client.stdout.pipe(process.stdout);
  client.stderr.pipe(process.stderr);
  client.on('exit', (code) => {
    process.exit(code);
  });
  client.resize(process.stdout.rows, process.stdout.columns);
  process.stdout.on('resize', () => {
    client.resize(process.stdout.rows, process.stdout.columns);
  });
}
main();
