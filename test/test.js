suite('trying client', () => {
  var debug = require('debug')('docker-exec-websocket-server:test:testclient');
  var DockerClient = require('../src/client.js');
  var DockerServer = require('../src/server.js');
  var base = require('taskcluster-base');
  var assert = require('assert');
  var Docker = require('dockerode-promise');
  var fs = require('fs');
  var http = require('http');
  var fs = require('fs');
  var Docker = require('dockerode-promise');

  const PORT = 60171;
  const DOCKER_SOCKET = '/var/run/docker.sock';

  // Test that we have a docker socket
  if (!fs.statSync(DOCKER_SOCKET).isSocket()) {
    throw new Error('Are you sure the docker is running?');
  }

  // Setup docker container we can play with
  var dockerServer, dockerServer2, container;
  before(async() => {
    var docker = new Docker({socketPath: DOCKER_SOCKET});

    await docker.pull('ubuntu');

    await base.testing.poll(async () => {
      // Create docker container
      container = await docker.createContainer({
        Image: 'ubuntu',
        Cmd: ['sleep', '600']
      });
    }, 20, 250);

    // Start the container
    await container.start();

    // Start server
    var server = http.createServer();
    await new Promise(accept => server.listen(PORT, accept));

    debug(container.id);
    // Docker docket socket server
    dockerServer = new DockerServer({
      server: server,
      containerId: container.id,
      path: '/a',
    });

    //another server to do the connection limit tests
    var server2 = http.createServer();
    await new Promise(accept => server2.listen(8082, accept));

    dockerServer2 = new DockerServer({
      server: server2,
      containerId: container.id,
      path: '/a',
      maxSessions: 1,
    });
  });

  // Clean up after docker container
  after(async() => {
    dockerServer.close();
    dockerServer2.close();
    await container.remove({v: true, force: true});
  });


  /*test('docker exec true', async () => {
    var client = new DockerClient({
      url: 'ws://localhost:' + PORT + '/a',
      tty: false,
      command: ['sh', '-c', 'true'],
    });

    // Execute command
    await client.execute();

    // Wait for termination
    var code = await new Promise((accept, reject) => {
      client.on('exit', accept);
      client.on('error', reject);
    });

    assert(code === 0, 'Expected exit code to be zero');

    client.close();
  });


  test('docker exec echo test', async () => {
    var client = new DockerClient({
      url: 'ws://localhost:' + PORT + '/a',
      tty: false,
      command: ['echo', 'test'],
    });

    // Execute command
    await client.execute();

    // Read bytes from stdout
    var data = [];
    client.stdout.on('data', buf => data.push(buf));

    // Wait for termination
    var code = await new Promise((accept, reject) => {
      client.on('exit', accept);
      client.on('error', reject);
    });
    assert(code === 0, 'Expected exit code to be zero');

    // Get all the data we received from stdout
    var output = Buffer.concat(data);

    // Check that the output is correct
    assert(output.toString() == "test\n", 'Expected output === "test\\n"');

    client.close();
  });*/


  test('docker exec wc -c', async () => {
    var client = new DockerClient({
      url: 'ws://localhost:' + PORT + '/a',
      tty: false,
      command: ['wc', '-c'],
    });

    // Execute command
    await client.execute();

    // Write some bytes on stdin to cat, then close stdin
    var input = new Uint8Array([97, 98, 99]);
    client.stdin.write(new Buffer(input));
    client.stdin.end();

    // Read bytes from stdout
    var stdout = [], stderr = [];
    client.stdout.on('data', b => stdout.push(b));
    client.stderr.on('data', b => stderr.push(b));

    // Wait for termination
    var code = await new Promise((accept, reject) => {
      client.on('exit', accept);
      client.on('error', reject);
    });
    console.log("Exit code: " + code);

    stdout = Buffer.concat(stdout);
    stderr = Buffer.concat(stderr);
    console.log("stdout: '%s'", stdout.toString());
    console.log("stderr: '%s'", stderr.toString());

    assert(code === 0, 'Expected exit code to be zero');

    client.close();
  });

  test('cat on server', async () => {
    var client = new DockerClient({
      url: 'ws://localhost:' + PORT + '/a',
      tty: false,
      command: ['cat', '-E'],
    });
    await client.execute();
    var buf1 = new Uint8Array([0xfa, 0xff, 0x0a]);
    client.stdin.write(new Buffer(buf1));
    var passed = false;
    client.stdout.on('data', (message) => {
      var buf = new Buffer([0xfa, 0xff, 0x24, 0x0a]); //0x24 is $ from the -E option
      assert(buf.compare(message) === 0, 'message wrong!');
      passed = true;
    });
    await base.testing.poll(async () => {
      assert(passed, 'message not recieved');
    }, 20, 250);
    client.close();
  });

  test('exit code', async () => {
    var client = new DockerClient({
      url: 'ws://localhost:' + PORT + '/a',
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
    }, 20, 250);
    client.close();
  });

/*  test('server pause', async (done) => {
    var client = new DockerClient({
      url: 'ws://localhost:' + PORT + '/a',
      tty: false,
      command: 'cat',
    });
    await client.execute();
    client.pause();
    var paused = true;
    var timer;
    client.stdin.write('hello\n');
    client.stdout.on('data', (message) => {
      assert(!paused, 'message recieved too early');
      assert(message.toString() === 'hello\n', 'message recieved was incorrect');
      client.close();
      clearTimeout(timer);
      done();
    });
    setTimeout(() => {
      paused = false;
      client.resume();
      timer = setTimeout(() => {
        throw new Error('message too slow');
      }, 500);
    }, 500);
  });*/

  test('connection limit', async (done) => {
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
      // client.close();
      // TODO: server isn't closed here due to race condition where client2
      // isn't finished executing, causing things to be unclosable
      // Possible solution: There's no way to cancel execute, so we could
      // emit something on end of execute so the close function knows when to close
      // That doesn't seem like a very nice solution to me though
      done();
    });
    client2.execute();
  });

  test('automatic pausing', async () => {
    var client = new DockerClient({
      url: 'ws://localhost:' + PORT + '/a',
      tty: false,
      command: ['sleep', '3'],
    });
    await client.execute();
    //before the socket opens, the writes will just buffer in memory
    // await base.testing.sleep(1000);
    client.strbuf.write(new Buffer(8 * 1024 * 1024 + 1));
    // assert(!client.strbuf.write(new Buffer(1)));
    var passed = false;
    client.on('paused', () => {
      passed = true;
    });
    // similar to above problem, can't close client here
    await base.testing.sleep(1000);
    assert(passed, 'did not pause when socket overloaded');
    client.close();
  });

  test('session count', async (done) => {
    var sessionCount;
    dockerServer.once('session added', (num) => {
      sessionCount = num;
      dockerServer.once('session removed', (newnum) => {
        assert(num === newnum + 1, 'session count not working properly');
        done();
      })
    })
    var client = new DockerClient({
      url: 'ws://localhost:' + PORT + '/a',
      tty: false,
      command: ['cat'],
    });
    await client.execute();
    client.close();
  });

  test('resize', async () => {
    //have to give it some time to resize before lsing
    var client = new DockerClient({
      url: 'ws://localhost:' + PORT + '/a',
      tty: true,
      command: ['/bin/bash', '-c', 'sleep 3; ls'],
    });
    await client.execute();
    client.resize(25, 1);

    var passed = false;
    var byteNum = 0;
    var buf = new Buffer([0x62, 0x69, 0x6e, 0x0d, 0x0a]);
    var res = [];
    client.stdout.on('data', (message) => {
      res.push(message);
      if(!buf.compare(Buffer.concat(res).slice(0, 5))) {
        passed = true;
      }
      else {
        debug(Buffer.concat(res).slice(0, 15));
        assert(Buffer.concat(res).length <= 5, 'message is wrong, not properly resized');
      }
    });

    await base.testing.poll(async () => {
      assert(passed, 'message not recieved');
    }, 20, 250);
    client.close();
  });
});
