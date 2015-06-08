var dockerClient = require('../lib/client.js');
var dockerServer = require('../lib/server.js');

dockerServer({
  port: 8081,
  containerId: 'servertest',
  path: '/a',
  log: true,
});

async function main () {
  let client = await dockerClient({
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
