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

export default class DockerExecWebsocketClient extends events.EventEmitter {
  constructor (options) {
    super();
    this.options = _.defaults({}, options, {
      tty: true,
      command: ['/bin/bash'],
      protocol: 'ws',
      slashes: true,
    });
  }

  /* Makes a client program with unbroken stdin, stdout, stderr streams
   * Is also an EventEmitter with 'exit' event
   *
   * Required options:
   * url parts (hostname port pathname)
   * or url
   * tty: whether or not we expect VT100 style output
   * command: array or string of command to be run in exec
   * not supported yet: ssl cert
   */
  async execute () {
    this.options.query = {
      tty: encodeURIComponent(this.options.tty ? 'true' : 'false'),
      command: this.options.command,
    };
    this.url = this.options.url || url.format(this.options);
    assert(this.url, 'url required or malformed url input');

    this.socket = new WS(this.url);
    this.socket.binaryType = 'arraybuffer';

    //set state, state does nothing yet
    this.state = msgcode.pause;
    //stdin stream with pause buffering
    this.stdin = through(function (data) {
      var buf = muxBuffer(msgcode.stdin, new Buffer(data));
      this.queue(buf);
    });

    this.bufin = through();
    this.stdin.pipe(this.bufin);

    this.bufin.pause();
    this.finalin = through((data) => {
      this.socket.send(data, {binary: true});
    });
    this.bufin.pipe(this.finalin);

    this.stdout = through();
    this.stderr = through();

    //Starts out paused so that input isn't sent until server is ready
    this.socket.onmessage = (messageEvent) => {
      this.messageHandler(messageEvent);
    };
  }

  messageHandler (messageEvent) {
    var message = new Buffer(new Uint8Array(messageEvent.data));
    debug(message);
    // the first byte is the message code
    switch (message[0]) {
      //pauses the client, causing stdin to buffer
      case msgcode.pause:
        this.state = msgcode.pause;
        this.bufin.pause();
        this.emit('paused');
        break;

      //resumes the client, flushing stdin
      case msgcode.resume:
        this.state = msgcode.resume;
        this.bufin.resume();
        this.emit('resumed');
        break;

      case msgcode.stdout:
        this.stdout.write(message.slice(1));
        // debug('client stdout needs drain: ',!tf);
        break;

      case msgcode.stderr:
        this.stderr.write(message.slice(1));
        // debug('client stderr needs drain: ',!tf);
        break;

      //first byte contains exit code
      case msgcode.stopped:
        this.emit('exit', message.readInt8(1));
        this.stdout.end();
        this.stderr.end();
        break;

      default:
        debug('unknown msg code %s', message[0]);
    }
  }

  //pauses input coming in from server, useful if you're running out of memory on local (ie probably never)
  pause () {
    this.bufin.write(new Buffer([msgcode.pause]), {binary: true});
  }

  //analogue of pause
  resume () {
    this.bufin.write(new Buffer([msgcode.resume]), {binary: true});
  }
}

module.exports = DockerExecWebsocketClient.createClient;
