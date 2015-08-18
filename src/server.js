var _ = require('lodash');
var assert = require('assert');
var debug = require('debug')('docker-exec-server');
var debugdata = require('debug')('docker-exec-server:data');
var Docker = require('dockerode-promise');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var msgcode = require('./messagecodes.js');
var through = require('through');
var url = require('url');
var ws = require('ws');

const MAX_OUTSTANDING_BYTES = 8 * 1024 * 1024;

class ExecSession {
  constructor(options) {
    this.options = options;
    this.execOptions = {
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      Tty: options.tty,
      Detach: false,
      Cmd: options.command,
    };
    this.attachOptions = {
      stdin: true,
      stdout: true,
      stderr: true,
      stream: true,
    };
    this.container = options.container;
    this.socket = options.socket;
    this.server = options.server;
  }

  async execute() {
    //TODO: add error handling support here
    this.exec = await this.container.exec(this.execOptions);
    this.execStream = await this.exec.start(this.attachOptions);
    //this.execStream = this.execStream.req.socket;

    //handling output
    this.strout = through((data) => {
      this.sendMessage(msgcode.stdout, new Buffer(data));
    });

    this.strerr = through((data) => {
      this.sendMessage(msgcode.stderr, new Buffer(data));
    });

    this.exec.modem.demuxStream(this.execStream, this.strout, this.strerr);
    //This stream is created solely for the purposes of pausing, because
    //data will only buffer up in streams using this.queue()
    this.strbuf = through();

    this.outstandingBytes = 0;

    this.strbuf.pipe(through((data) => {
      this.outstandingBytes += data.length;
      debugdata(data);
      this.socket.send(data, {binary: true}, () => {
        this.outstandingBytes -= data.length;
      });
      if (this.outstandingBytes > MAX_OUTSTANDING_BYTES) {
        this.strbuf.pause();
      } else {
        this.strbuf.resume();
      }
    }));

    //handling input
    this.socket.on('message', (message) => {
      this.messageHandler(message);
    });

    this.socket.on('close', () => {
      //TODO: this is VERY wrong, we should close stdin, that's all!
      //should be how to ctrl+c ctrl+d, might be better way to kill
      this.execStream.end('\x03\x04\r\nexit\r\n');
      debug('client close');
      //for now, it kills this session
      this.close();
    });

    //start recieving client output again
    this.execStream.on('drain', () => {
      this.sendCode(msgcode.resume);
      debug('resumed');
    });

    //When the process dies, the stream ends
    this.execStream.on('end', () => {
      this.execStreamEnd();
    });

    //send ready message to let client know it is ready
    this.sendCode(msgcode.resume);
    debug('server finished executing session');
  }

  sendCode(code) {
    this.strbuf.write(new Buffer([code]), {binary: true});
  }

  sendMessage(code, buffer) {
    this.strbuf.write(Buffer.concat([new Buffer([code]), buffer]), {binary: true});
  }

  messageHandler(message) {
    switch (message[0]) {
      case msgcode.pause:
        this.strbuf.pause();
        debug('paused');
        break;

      case msgcode.resume:
        this.strbuf.resume();
        debug('resumed');
        break;

      case msgcode.stdin:
        if (!this.execStream.write(message.slice(1), {binary: true})) {
          this.sendCode(msgcode.pause);
          debug('paused');
        }
        break;

      case msgcode.end:
        this.execStream.end();
        break;

      case msgcode.resize:
        if (this.options.tty) {
          this.exec.resize({
            h: message.readUInt16LE(1),
            w: message.readUInt16LE(3),
          });
        } else {
          this.sendMessage(msgcode.error, new Buffer('cannot resize, not a tty instance'));
        }
        break;

      default:
        debug('unknown msg code %s', message[0]);
    }
  }

  async execStreamEnd() {
    try {
      var info = await this.exec.inspect();
      debug('exit code: %s', info.ExitCode);
      this.sendMessage(msgcode.stopped, new Buffer([info.ExitCode]));
      this.close();
    } catch (err) {
      debug('Failed to exec.inspect, err: %s, JSON: %j', err, err, err.stack);
      this.forceClose();
    }
  }

  forceClose() {
    this.sendCode(msgcode.shutdown);
    this.close();
  }

  close() {
    var index = this.server.sessions.indexOf(this);
    if (index >= 0) {
      this.server.sessions.splice(index, 1);
      debug('%s sessions remain', this.server.sessions.length);
      this.server.emit('session removed', this.server.sessions.length);

      if (!this.strbuf.paused) {
        this.socket.close();
        this.strout.end();
        this.strerr.end();
        this.strbuf.end();
      } else {
        this.strbuf.on('drain', () => {
          this.socket.close();
          this.strout.end();
          this.strerr.end();
          this.strbuf.end();
        });
      }
    }
  }
}

export default class DockerExecWebsocketServer extends EventEmitter {
  /* Creates Docker Exec instance on given container,
   * running the first message given as a command.
   *
   * Options:
   * {
   *    server:         // http.Server/https.Server to get connections from
   *    containerId:    // Name or id of docker container
   *    path:           // Path to accept websockets on
   *    dockerSocket:   // Path to the docker unix domain socket
   *    maxSessions:    // Maximum number of sessions allowed
   *    wrapperCommand: // Optional wrapper script which wraps the command query
   * }
   */

    constructor(options) {
     // Initialize base class
     super();

     // Set default options
     this.options = options = _.defaults({}, options, {
       dockerSocket: '/var/run/docker.sock',
       maxSessions: 10,
       wrapperCommand: [],
     });
     // Validate options
     assert(options.server, 'options.server is required');
     assert(options.containerId, 'options.containerId is required');
     assert(options.path, 'options.path is required');
     assert(options.wrapperCommand instanceof Array,
            'options.wrapperCommand must be an array!');

     // Setup docker
     var docker = new Docker({socketPath: options.dockerSocket});

     // Get container wrapper
     this.container = docker.getContainer(options.containerId);
     assert(this.container, 'could not get container from Docker');

     // Setup websocket server
     this.server = new ws.Server({
       server: options.server,
       path: options.path,
     });
     debug('websocket server created for path: "%s"', options.path);

     // Track sessions
     this.sessions = [];

     this.server.on('connection', (socket) => {
       debug('connection received');
       this.onConnection(socket);
     });
   }

   onConnection(socket) {
     // Reject connection of we're at the session limit
     if (this.sessions.length >= this.options.maxSessions) {
       socket.send(Buffer.concat([
         new Buffer([msgcode.error]),
         new Buffer('Too many sessions active!'),
       ]));
       return socket.close();
     }

     // Find arguments from URL
     var args = url.parse(socket.upgradeReq.url, true).query;
     if (typeof args.command === 'string') {
       args.command = [args.command];
     }

     // Construct session
     var session = new ExecSession({
       container: this.container,
       socket: socket,
       command: this.options.wrapperCommand.concat(args.command),
       tty: /^true$/i.test(args.tty),
       server: this,
     });

     this.sessions.push(session);
     session.execute();
     debug('%s sessions created', this.sessions.length);
     this.emit('session', session);
     this.emit('session added', this.sessions.length);
   }

  close() {
    this.server.close();
    this.sessions.forEach((session) => {
      session.forceClose();
    });
  }
}
