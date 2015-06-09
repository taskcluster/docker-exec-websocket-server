var WS = require('ws');
var debug = require('debug')('docker-exec-websocket-server:lib:client');
var url = require('url');
var events = require('events');
var _ = require('lodash');
var assert = require('assert');
var msgcode = require('../lib/messagecodes.js');
var through = require('through');

// Makes a new buffer with code number (ideally 0x00-0xFF)
// appended to the start of the given buffer
function muxBuffer (code, buffer) {
  return Buffer.concat([new Buffer([code]), buffer]);
}

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
    client.stdin = through(function (data) {
      var buf = muxBuffer(msgcode.stdin, new Buffer(data));
      this.queue(buf);
    });

    client.bufin = through();
    client.stdin.pipe(client.bufin);

    client.bufin.pause();
    client.finalin = through((data) => {
      client.socket.send(data, {binary: true});
    });
    client.bufin.pipe(client.finalin);


    client.stdout = through();
    client.stderr = through();

    //When the connection is paused, this listener is on
    function paused (messageEvent) {
      var message = new Uint8Array(messageEvent.data);
      //resumes the client, flushing stdin
      switch (message[0]) {
        case msgcode.resume: 
          client.state = msgcode.resume;
          client.bufin.resume();
          client.emit('resumed');
          client.socket.onmessage = resumed;
          break;

        case msgcode.stdout:
          var tf = client.stdout.write(message.slice(1));
          debug('client stdout needs drain: ',!tf);
          break;

        case msgcode.stderr:
          var tf = client.stderr.write(message.slice(1));
          debug('client stderr needs drain: ',!tf);
          break;

        //first byte contains exit code
        //maybe i want to do more here?
        case msgcode.stopped:
          client.emit('exit', message.readInt8(1));
          break;

        default:
          debug('unknown msg code %s', message[0]);
          throw new Error('unknown msg code');
      }
    }

    //When the connection is resumed, this listener is on
    function resumed (messageEvent) {
      var message = new Buffer(new Uint8Array(messageEvent.data));
      debug(message.length);
      // the first byte is the message code
      switch (message[0]) {
        //pauses the client, causing stdin to buffer
        case msgcode.pause:
          client.state = msgcode.pause;
          client.bufin.pause();
          client.emit('paused');
          client.socket.onmessage = paused;
          break;

        case msgcode.stdout:
          var tf = client.stdout.write(message.slice(1));
          debug('client stdout needs drain: ',!tf);
          break;

        case msgcode.stderr:
          var tf = client.stderr.write(message.slice(1));
          debug('client stderr needs drain: ',!tf);
          break;

        //first byte contains exit code
        //maybe i want to do more here?
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

  pause () { //pauses input coming in from server, useful if you're running out of memory on local (ie probably never)
    this.bufin.write(new Buffer([msgcode.pause]), {binary: true});
  }

  resume () { //analogue of pause
    this.bufin.write(new Buffer([msgcode.resume]), {binary: true});
  }
}

module.exports = DockerExecWebsocketClient.createClient;
