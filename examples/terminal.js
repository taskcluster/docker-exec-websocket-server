var DockerClient = require('../lib/client.js');
var debug = require('debug')('docker-exec-websocket-server:examples/terminal.js');

function main () {
  var client = new DockerClient({
    url: 'ws://localhost:8080/a',
    tty: 'true',
    command: 'bash',
  });
  return client.execute().then(() => {
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
  });
}
main();
