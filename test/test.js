suite('trying server', () => {
  var debug = require('debug')('docker-exec-websocket-server:test');
  var ws = require('ws');
  var Server = require('../lib/server.js');
  var slugid = require('slugid');
  var path = require('path');
  var assert = require('assert');
  var url = require('url');
  var base = require('taskcluster-base');

  var randpath = '/'+slugid.v4();

  var server = new Server({
    containerId: 'servertest',
    port: 8080,
    path: randpath,
    log: true,
  });
  assert(server,'server required!');
  test('cat', async () => {
    var socket = new ws(url.format({
      protocol: 'ws',
      slashes: true,
      host: 'localhost:8080',
      pathname: randpath,
      query: {
        command: encodeURIComponent(JSON.stringify(['cat','-E'])),
        tty: false,
      },
    }));
    assert(socket,'socket connection required!');

    var passed = false;
    socket.once('message',(message) => {
      debug(message);
      var buf1 = new Buffer(3);
      buf1[0] = 0xfa;
      buf1[1] = 0xff;
      buf1[2] = 0x0a;
      socket.send(buf1, {binary: true, mask: true});
      socket.on('message', (message) => {
        var buf = new Buffer(5); //looks something like messagecode 0xfa 0xff $(-E option) 0x0a
        buf[0] = 0x01;
        buf[1] = 0xfa;
        buf[2] = 0xff;
        buf[3] = 0x24;
        buf[4] = 0x0a;
        assert(buf.compare(message) === 0, 'message wrong!');
        passed = true;
      });
    });
    await base.testing.poll(async () => {
      assert(passed,'message not recieved')
    }, 20, 250).then(() => {
      debug('successful');
    }, err => {throw err; });
  });
  test('exit code', async () => {
    var socket = new ws(url.format({
      protocol: 'ws',
      slashes: true,
      host: 'localhost:8080',
      pathname: randpath,
      query: {
        command: encodeURIComponent(JSON.stringify(['/bin/bash'])),
        tty: true,
      },
    }));
    assert(socket,'socket connection required!');
    var passed = false;
    socket.once('message', () => {
      socket.on('message', (message) => {
        if (message[0] === 0x64 && message.readInt32LE(1) === 9) {
          passed = true;
        }
      });
      socket.send('exit 9\n');
    });
    await base.testing.poll(async () => {
      assert(passed,'timeout');
    }, 20, 250).then(() => {
      debug('successful');
    }, err => {throw err; });
  });
});
