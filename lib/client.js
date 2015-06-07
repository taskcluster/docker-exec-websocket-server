var Ws = require('ws');
var debug = require('debug')('docker-exec-websocket-server:lib:client');
var url = require('url');
var events = require('events');
var _ = require('lodash');
var assert = require('assert');
var msgcode = require('./messagecodes.js');
var through = require('through');

class DockerExecWebsocketClient extends events.EventEmitter {
  constructor () {
    super();
  }

  //options requires: url parts (hostname port pathname) or url, tty, command
  //not supported yet: ssl cert
  static async createClient (options) {
    var client = new DockerExecWebsocketClient();
    options = _.defaults({}, options, {
      tty: true,
      command: ['/bin/bash'],
      protocol: 'ws',
      slashes: true,
    });
    options.query = {
      tty: encodeURIComponent(options.tty),
      command: encodeURIComponent(JSON.stringify(options.command)),
    };
    client.url = options.url || url.format(options);
    assert(client.url, 'url required or malformed url input');
    client.socket = new Ws(client.url);
    client.state = msgcode.pause;
    client.stdin = through();
    client.stdin.pipe(through((data) => {
      if (typeof data === 'string') {
        client.socket.send(data);
      } else {
        client.socket.send(data, {binary: true});
      }
    }));
    client.stdin.pause();
    client.stdout = through();
    client.stderr = through();
    var socket = client.socket;
    function paused (message) {
      if (message[0] === msgcode.resume) {
        client.state = msgcode.resume;
        client.stdin.resume();
        socket.removeListener('message', paused);
        socket.on('message', resumed);
      }
    }
    function resumed (message) {
      switch (message[0]) {
        case msgcode.pause:
          client.state = msgcode.pause;
          client.stdin.pause();
          socket.removeListener('message', resumed);
          socket.on('message', paused);
          break;
        case msgcode.stdout:
          client.stdout.write(message.slice(1));
          break;
        case msgcode.stderr:
          client.stderr.write(message.slice(1));
          break;
        case msgcode.stopped:
          client.emit('exit', Buffer.readInt32LE(message.slice(1)));
          break;
        default:
          debug('unknown msg code %s', message[0]);
          throw new Error('unknown msg code');
      }
    }
    socket.on('message', paused);
    return client;
  }
}

module.exports = DockerExecWebsocketClient.createClient;
