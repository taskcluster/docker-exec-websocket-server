var WS = require('ws');
var debug = require('debug')('docker-exec-websocket-server:lib:client');
var url = require('url');
var events = require('events');
var _ = require('lodash');
var assert = require('assert');
var msgcode = require('../lib/messagecodes.js');
var through = require('through');

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
    this.stdin = through((data) => {
      this.sendMessage(msgcode.stdin, data);
    });

    this.bufin = through();

    const MAX_OUTSTANDING_BYTES = 8 * 1024 * 1024;
    this.outstandingBytes = 0;

    this.bufin.pause();
    this.bufin.pipe(through((data) => {
      this.outstandingBytes += data.length;
      this.socket.send(data, {binary: true}, () => {
        this.outstandingBytes -= data.length;
      });
      if (this.outstandingBytes > MAX_OUTSTANDING_BYTES) {
        this.bufin.pause();
      } else {
        this.bufin.resume();
      }
    }));

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
        break;

      case msgcode.stderr:
        this.stderr.write(message.slice(1));
        break;

      //first byte contains exit code
      case msgcode.stopped:
        this.emit('exit', message.readInt8(1));
        this.close();
        break;

      case msgcode.shutdown:
        this.emit('shutdown');
        this.close();
        break;

      case msgcode.error:
        this.emit('error', message.slice(1));
        break;

      default:
        debug('unknown msg code %s', message[0]);
    }
  }

  //pauses input coming in from server, useful if you're running out of memory on local (ie probably never)
  pause () {
    this.sendCode(msgcode.pause);
  }

  //analogue of pause
  resume () {
    this.sendCode(msgcode.resume);
  }

  sendCode (code) {
    this.bufin.write(new Buffer([code]), {binary: true});
  }

  sendMessage (code, data) {
    this.bufin.write(Buffer.concat([new Buffer([code]), new Buffer(data)]), {binary: true});
  }

  close () {
    if (!this.bufin.paused) {
      this.socket.close();
      this.stdin.end();
      this.stdout.end();
      this.stderr.end();
      this.bufin.end();
    } else {
      this.bufin.on('drain', () => {
        this.socket.close();
        this.stdin.end();
        this.stdout.end();
        this.stderr.end();
        this.bufin.end();
      });
    }
  }
}
