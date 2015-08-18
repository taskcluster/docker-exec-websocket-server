var _ = require('lodash');
var assert = require('assert');
var debug = require('debug')('docker-exec-websocket-server:lib:client');
var debugdata = require('debug')('docker-exec-websocket-server:lib:rcv');
var EventEmitter = require('events').EventEmitter;
var msgcode = require('../lib/messagecodes.js');
var querystring = require('querystring');
var through2 = require('through2');
var WebSocket = require('ws');

export default class DockerExecWebsocketClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = _.defaults({}, options, {
      tty: true,
      command: 'sh',
      wsopts: {},
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
   */
  async execute() {
    this.url = this.options.url + '?' + querystring.stringify({
      tty: this.options.tty ? 'true' : 'false',
      command: this.options.command,
    });
    debug(this.url);
    assert(/ws?s:\/\//.test(this.url), 'url required or malformed url input');

    //HACK: browser check
    if (typeof window === 'undefined') { //means that this is probably node
      this.socket = new WebSocket(this.url, this.options.wsopts);
    } else { //means this is probably a browser, which means we ignore options
      this.socket = new WebSocket(this.url);
    }

    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = () => {
      debug('socket opened');
      this.emit('open');
    };

    //set state, state does nothing yet
    this.state = msgcode.pause;

    this.stdin = through2((data, enc, cb) => {
      this.sendMessage(msgcode.stdin, data);
      cb();
    }, (cb) => {
      this.sendCode(msgcode.end);
      cb();
    });

    //stream with pause buffering, everything passes thru here first
    this.strbuf = through2();

    const MAX_OUTSTANDING_BYTES = 8 * 1024 * 1024;
    this.outstandingBytes = 0;

    this.strbuf.pipe(through2((data, enc, cb) => {
      this.outstandingBytes += data.length;
      this.socket.send(data, {binary: true}, () => {
        this.outstandingBytes -= data.length;
      });
      if (this.outstandingBytes > MAX_OUTSTANDING_BYTES) {
        this.state = msgcode.pause;
        this.strbuf.pause();
        this.emit('paused');
      } else {
        this.state = msgcode.resume;
        this.strbuf.resume();
        this.emit('resumed');
      }
      cb();
    }));
    this.strbuf.pause();

    this.stdout = through2();
    this.stderr = through2();

    //Starts out paused so that input isn't sent until server is ready
    this.socket.onmessage = (messageEvent) => {
      this.messageHandler(messageEvent);
    };
    debug('client executed');
  }

  messageHandler(messageEvent) {
    var message = new Buffer(new Uint8Array(messageEvent.data));
    debugdata(message);
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
        debug('server has shut down');
        this.close();
        break;

      case msgcode.error:
        this.emit('error', message.slice(1));
        break;

      default:
        debug('unknown msg code %s', message[0]);
    }
  }

  //pauses input coming in from server, useful if you're running out of memory on local
  pause() {
    this.sendCode(msgcode.pause);
  }

  //analogue of pause
  resume() {
    this.sendCode(msgcode.resume);
  }

  resize(h, w) {
    if (!this.options.tty) {
      throw new Error('cannot resize, not a tty instance');
    } else {
      var buf = new Buffer(4);
      buf.writeUInt16LE(h, 0);
      buf.writeUInt16LE(w, 2);
      debug('resized to %sx%s', h, w);
      this.sendMessage(msgcode.resize, buf);
    }
  }

  sendCode(code) {
    this.strbuf.write(new Buffer([code]));
  }

  sendMessage(code, data) {
    this.strbuf.write(Buffer.concat([new Buffer([code]), new Buffer(data)]));
  }

  close() {
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
