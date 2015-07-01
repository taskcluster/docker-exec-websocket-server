suite('trying client', (done) => {
  var debug = require('debug')('docker-exec-websocket-server:test:testclient');
  var DockerClient = require('../lib/client.js');
  var DockerServer = require('../lib/server.js');
  var base = require('taskcluster-base');
  var assert = require('assert');
  var http = require('http');

  var serverPort = new DockerServer({
    port: 8081,
    containerId: 'servertest',
    path: '/a',
  });

  test('cat on port', async () => {
    var client = new DockerClient({
      url: 'ws://localhost:8081/a',
      tty: false,
      command: ['cat', '-E'],
    });
    await client.execute();
    var buf1 = new Uint8Array([0xfa, 0xff, 0x0a, 0x12]);
    client.stdin.write(buf1);
    var passed = false;
    client.stdout.on('data', (message) => {
      debug('\n\n\nlookie here\n\n\n');
      debug(message);
      var buf = new Buffer([0xfa, 0xff, 0x24, 0x0a, 0x12]); //0x24 is $ from the -E option
      assert(buf.compare(message) === 0, 'message wrong!');
      passed = true;
    });
    await base.testing.poll(async () => {
      assert(passed, 'message not recieved');
    }, 20, 250).then(() => {
      client.close();
    }, err => {throw err; });
  });

  test('cat on server', async () => {
    var httpServ = http.createServer().listen(8083);
    var serverServer = new DockerServer({
      containerId: 'servertest',
      server: httpServ,
      path: '/a',
    });
    var client = new DockerClient({
      url: 'ws://localhost:8083/a',
      tty: false,
      command: ['cat', '-E'],
    });
    await client.execute();
    var buf1 = new Uint8Array([0xfa, 0xff, 0x0a]);
    client.stdin.write(buf1);
    var passed = false;
    client.stdout.on('data', (message) => {
      var buf = new Buffer([0xfa, 0xff, 0x24, 0x0a]); //0x24 is $ from the -E option
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
      url: 'ws://localhost:8081/a',
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
      url: 'ws://localhost:8081/a',
      tty: false,
      command: 'cat',
    });
    await client.execute();
    client.pause();
    var paused = true;
    client.stdin.write('hello\n');
    client.stdout.on('data', (message) => {
      assert(!paused, 'message recieved too early');
      assert(message.toString() === 'hello\n', 'message recieved was incorrect');
      client.close();
      done();
    });
    setTimeout(() => {
      paused = false;
      client.resume();
      setTimeout(() => {
        throw new Error('message too slow');
      }, 500);
    }, 500);
  });

  test('connection limit', async (done) => {
    let server2 = new DockerServer({
      port: 8082,
      containerId: 'servertest',
      path: '/a',
      maxSessions: 1,
    });
    var client = new DockerClient({
      url: 'ws://localhost:8082/a',
      tty: false,
      command: ['cat'],
    });
    var client2 = new DockerClient({
      url: 'ws://localhost:8082/a',
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

  test('automatic pausing', async () => {
    var client = new DockerClient({
      url: 'ws://localhost:8081/a',
      tty: false,
      command: ['cat'],
    });
    await client.execute();
    client.stdin.write(new Buffer(8 * 1024 * 1024 + 1));
    assert(!client.strbuf.write(new Buffer(1)));
  });
});
