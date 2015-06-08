suite('trying client', () => {
  var debug = require('debug')('docker-exec-websocket-server:test:client');
  var DockerClient = require('../lib/client.js');
  var DockerServer = require('../lib/server.js');
  var base = require('taskcluster-base');
  var assert = require('assert');

  var server = new DockerServer({
    port: 8081,
    containerId: 'servertest',
    path: '/a',
    log: true,
  });

  test('cat', async () => {
    let client = await DockerClient({
      hostname: 'localhost',
      port: 8081,
      pathname: 'a',
      tty: 'false',
      command: ['cat', '-E'],
    });
    var buf1 = new Buffer([0xfa, 0xff, 0x0a]);
    client.stdin.write(buf1);
    var passed = false;
    client.stdout.on('data', (message) => {
      var buf = new Buffer([0xfa, 0xff, 0x24, 0x0a]); //looks something like 0xfa 0xff $(-E option) 0x0a
      assert(buf.compare(message) === 0, 'message wrong!');
      passed = true;
    });
    await base.testing.poll(async () => {
      assert(passed, 'message not recieved');
    }, 20, 250).then(() => {
      debug('successful');
    }, err => {throw err; });
  });
  test('exit code', async () => {
    let client = await DockerClient({
      hostname: 'localhost',
      port: 8081,
      pathname: 'a',
      tty: 'true',
      command: ['/bin/bash'],
    });
    client.stdin.write('exit 9\n');
    var passed = false;
    client.on('exit', (code) => {
      assert(code === 9, 'message wrong!');
      passed = true;
    });
    await base.testing.poll(async () => {
      assert(passed, 'exit message not recieved');
    }, 20, 250).then(() => {
      debug('successful');
    }, err => {throw err; });
  });
});
