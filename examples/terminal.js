var msgcode = require('../lib/messagecodes');
var DockerClient = require('../lib/client.js');
var DockerServer = require('../lib/server.js');

var server = new DockerServer({
  port: 8081,
  containerId: 'servertest',
  path: '/a',
  log: true
});

async function main() {
  let client = await DockerClient({
    hostname: 'localhost',
    port: 8081,
    pathname: 'a',
    tty: 'true',
    command: '/bin/bash',
  });
  
  process.stdin.pipe(client.stdin);
  client.stdout.pipe(process.stdout);
  client.stderr.pipe(process.stderr);
  client.on('exit', (code) => {
    process.exit(code);
  });
}
main();
