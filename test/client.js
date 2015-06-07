suite('trying client', () => {
  var debug = require('debug')('docker-exec-websocket-server:test:client');
  var through = require('through');
  var msgcode = require('../lib/messagecodes.js');
  var DockerClient = require('../lib/client.js');
  var DockerServer = require('../lib/server.js');

  var server = new DockerServer({

  });

  test('cat', async () => {
    var client = DockerClient.createClient({
      hostname: 'localhost',
      port: 8081,
      pathname: 'a',
      tty: 'false',
    });
  })
})