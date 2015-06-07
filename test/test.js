suite('trying server', () => {
  var debug = require('debug')('docker-exec-websocket-server:test');
  var ws = require('ws');
  var Server = require('../lib/server.js');
  var slugid = require('slugid');
  var path = require('path');
  var assert = require('assert');
  var url = require('url');
  var base = require('taskcluster-base');
  var msgcode = require('../lib/messagecodes');

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
      var buf1 = new Buffer([0xfa, 0xff, 0x0a]);
      socket.send(buf1, {binary: true, mask: true});
      socket.on('message', (message) => {
        //looks something like messagecode 0xfa 0xff $(-E option) 0x0a
        var buf = new Buffer([0x01, 0xfa, 0xff, 0x24, 0x0a]); 
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
        if (message[0] === msgcode.stopped && message.readInt32LE(1) === 9) {
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
