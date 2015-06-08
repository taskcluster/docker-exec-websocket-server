var WS = require('ws');
var debug = require('debug')('docker-exec-websocket-server:lib:client');
var url = require('url');
var events = require('events');
var _ = require('lodash');
var assert = require('assert');
var msgcode = require('../lib/messagecodes.js');
var through = require('through');

class DockerExecWebsocketClient extends events.EventEmitter {
  constructor () {
    super();
  }

  /* Makes a client program with unbroken stdin, stdout, stderr streams
   * is also an EventEmitter with 'exit' event
   *
   * Required options:
   * url parts (hostname port pathname)
   * or url
   * tty: whether or not we expect VT100 style output
   * command: array or string of command to be run in exec
   * not supported yet: ssl cert
   */
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

    client.socket = new WS(client.url);
    client.socket.binaryType = 'arraybuffer';

    //set state, state does nothing yet
    client.state = msgcode.pause;
    //stdin stream with pause buffering
    //sends string data when it senses a string, and binary when it sees non-string
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

    //When the connection is paused, this listener is on
    function paused (messageEvent) {
      var message = new Uint8Array(messageEvent.data);
      console.log('message sent: %s', message);
      if (message[0] === msgcode.resume) {
        client.state = msgcode.resume;
        client.stdin.resume();
        client.emit('resumed');
        client.socket.onmessage = resumed;
      }
    }

    //When the connection is resumed, this listener is on
    function resumed (messageEvent) {
      var message = new Uint8Array(messageEvent.data);
      console.log('message sent: %s', message);
      switch (message[0]) {
        case msgcode.pause:
          client.state = msgcode.pause;
          client.stdin.pause();
          client.emit('paused');
          client.socket.onmessage = paused;
          break;
        case msgcode.stdout:
          client.stdout.write(String.fromCharCode.apply(null, message.slice(1)));
          break;
        case msgcode.stderr:
          client.stderr.write(String.fromCharCode.apply(null, message.slice(1)));
          break;
        case msgcode.stopped:
          client.emit('exit', message.readInt8(1));
          break;
        default:
          debug('unknown msg code %s', message[0]);
          throw new Error('unknown msg code');
      }
    }

    //Starts out paused so that input isn't sent until server is ready
    client.socket.onmessage = paused;
    return client;
  }
}

module.exports = DockerExecWebsocketClient.createClient;
