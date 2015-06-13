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
    this.socket.onopen = () => {
      console.log('socket opened');
      this.emit('open');
    };

    //set state, state does nothing yet
    this.state = msgcode.pause;
    //stdin stream with pause buffering
    this.stdin = through((data) => {
      this.sendMessage(msgcode.stdin, data);
    });

    this.strbuf = through(function (data) {
      console.log(data);
      this.queue(data);
    });

    const MAX_OUTSTANDING_BYTES = 8 * 1024 * 1024;
    this.outstandingBytes = 0;

    this.strbuf.pause();
    this.strbuf.pipe(through((data) => {
      this.outstandingBytes += data.length;
      console.log(data);
      console.log('being sent');
      this.socket.send(data, {binary: true}, () => {
        this.outstandingBytes -= data.length;
      });
      if (this.outstandingBytes > MAX_OUTSTANDING_BYTES) {
        this.strbuf.pause();
      } else {
        this.strbuf.resume();
      }
    }));

    this.stdout = through();
    this.stderr = through();

    //Starts out paused so that input isn't sent until server is ready
    this.socket.onmessage = (messageEvent) => {
      this.messageHandler(messageEvent);
    };
    console.log('client executed');
  }

  messageHandler (messageEvent) {
    var message = new Buffer(new Uint8Array(messageEvent.data));
    console.log(message);
    // the first byte is the message code
    switch (message[0]) {
      //pauses the client, causing strbuf to buffer
      case msgcode.pause:
        this.state = msgcode.pause;
        //This stream is created solely for the purposes of pausing, because
        //data will only buffer up in streams using this.queue()
        this.strbuf.pause();
        this.emit('paused');
        break;

      //resumes the client, flushing strbuf
      case msgcode.resume:
        this.state = msgcode.resume;
        this.strbuf.resume();
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
    this.strbuf.write(new Buffer([code]), {binary: true});
  }

  sendMessage (code, data) {
    this.strbuf.write(Buffer.concat([new Buffer([code]), new Buffer(data)]), {binary: true});
  }

  close () {
    if (!this.strbuf.paused) {
      this.socket.close();
      this.stdin.end();
      this.stdout.end();
      this.stderr.end();
      this.strbuf.end();
    } else {
      this.strbuf.on('drain', () => {
        this.socket.close();
        this.stdin.end();
        this.stdout.end();
        this.stderr.end();
        this.strbuf.end();
      });
    }
  }
}
