suite('trying client', () => {
  var debug = require('debug')('docker-exec-websocket-server:test:testclient');
  var DockerClient = require('../lib/client.js');
  var DockerServer = require('../lib/server.js');
  var base = require('taskcluster-base');
  var assert = require('assert');
  var Promise = require('promise');

  var server = new DockerServer({
    port: 8081,
    containerId: 'servertest',
    path: '/a',
    log: true,
    maxSessions: 1,
  });

  test('cat', async () => {
    var client = new DockerClient({
      hostname: 'localhost',
      port: 8081,
      pathname: 'a',
      tty: false,
      command: ['cat', '-E'],
    });
    await client.execute();
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
      client.close();
    }, err => {throw err; });
  });

  test('exit code', async () => {
    var client = new DockerClient({
      hostname: 'localhost',
      port: 8081,
      pathname: 'a',
      tty: true,
      command: ['/bin/bash'],
    });
    await client.execute();
    client.stdin.write('exit 9\n');
    var passed = false;
    client.on('exit', (code) => {
      assert(code === 9, 'message wrong!');
      passed = true;
    });
    await base.testing.poll(async () => {
      assert(passed, 'exit message not recieved');
    }, 20, 250).then(() => {
    }, err => {throw err; });
  });

  test('server pause', async (done) => {
    var client = new DockerClient({
      hostname: 'localhost',
      port: 8081,
      pathname: 'a',
      tty: false,
      command: ['cat'],
    });
    await client.execute();
    client.pause();
    var paused = true;
    client.stdin.write('hello\n');
    client.stdout.on('data', (message) => {
      assert(!paused, 'message recieved too early');
      assert(message.toString() =='hello\n', 'message recieved was incorrect');
      client.close();
      done();
    });
    setTimeout(() => {
      paused = false;
      client.resume();
      setTimeout(() => {
        throw new Error('message too slow');
      }, 1000);
    }, 1000);
  });

  test('connection limit', async (done) => {
    var client = new DockerClient({
      hostname: 'localhost',
      port: 8081,
      pathname: 'a',
      tty: false,
      command: ['cat'],
    });
    var client2 = new DockerClient({
      hostname: 'localhost',
      port: 8081,
      pathname: 'a',
      tty: false,
      command: ['cat'],
    });
    await client.execute();
    client2.on('error', (errorStr) => {
      assert(errorStr.toString() === 'Too many sessions active!');
      client.close();
      done();
    });
    client2.execute();
  });
});
