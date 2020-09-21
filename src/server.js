var _ = require('lodash');
var assert = require('assert');
var debug = require('debug')('docker-exec-server');
var debugdata = require('debug')('docker-exec-server:data');
var Docker = require('dockerode');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var msgcode = require('./messagecodes.js');
var through2 = require('through2').obj;
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
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
    };
    this.container = options.container;
    this.server = options.server;
    this.socket = options.socket;
    this.closed = false;

    //must set this before this.execute() in case of premature close
    this.socket.on('close', () => {
      //should be how to ctrl+c ctrl+d, might be better way to kill
      debug('client close');
      //for now, it kills this session
      this.close();
    });
  }

  async execute() {
    //TODO: add error handling support here
    this.exec = await this.container.exec(this.execOptions);
    this.execStream = await this.exec.start(this.attachOptions);
    let execStream = this.execStream;
    // this.execStream = await new Promise(async (accept, reject) => {
    //   var req = http.request({
    //     socketPath: '/var/run/docker.sock', //replace with generic later
    //     path: '/exec/' + this.exec.id + '/start?' + qs.stringify(this.attachOptions),
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //       'Connection': 'upgrade',
    //       'Upgrade': 'tcp',
    //     }
    //   }, reject);
    //   req.write(JSON.stringify({
    //     Detach: false,
    //     Tty: this.options.tty,
    //   }));
    //   req.end();
    //   req.on('upgrade', accept);
    //   req.on('error', reject);
    //   req.setTimeout(10000, reject);
    // });
    // debug(this.execStream);
    // this.execStream.write(new Buffer([30]));

    var header = null;

    execStream.on('readable', () => {
      header = header || execStream.read(8);
      while (header !== null) {
        var type = header.readUInt8(0);
        var payload = execStream.read(header.readUInt32BE(4));
        if (payload === null) {
          break;
        }
        if (!this.sendMessage(type, payload)) {
          execStream.pause();
          this.strbuf.once('drain', execStream.resume);
        }

        //try to set new header to continue reading
        header = execStream.read(8);
      }
    });
    //This stream is created solely for the purposes of pausing, because
    //data will only buffer up in streams using this.queue()
    // this.strbuf = through2();

    this.outstandingBytes = 0;
    this.socketBuffering = false;
    this.clientPause = false;

    this.strbuf = through2();
    this.strbuf.on('data', (data) => {
      this.outstandingBytes += data.length;
      debugdata(data);
      this.socket.send(data, {binary: true}, () => {
        this.outstandingBytes -= data.length;
      });
      if (this.outstandingBytes > MAX_OUTSTANDING_BYTES) {
        this.strbuf.pause();
        this.socketBuffering = true;
        debug('paused');
      } else {
        if (!this.clientPause && this.socketBuffering) {
          this.strbuf.resume();
          debug('resumed');
        }
        this.socketBuffering = false;
      }
    });

    execStream.resume();

    //handling input
    this.socket.on('message', (message) => {
      try {
        this.messageHandler(message);
      } catch(e) {
        debug('Error: %s %j, closing connection', e, e, e.stack);
        this.close();
      }
    });

    /*this.socket.on('close', () => {
      //TODO: this is VERY wrong, we should close stdin, that's all!
      //should be how to ctrl+c ctrl+d, might be better way to kill
      execStream.end('\x03\x04\r\nexit\r\n');
      debug('client close');
      //for now, it kills this session
      this.close();
    });*/

    //start recieving client output again
    execStream.on('drain', () => {
      this.sendCode(msgcode.resume);
      debug('resumed');
    });

    //When the process dies, the stream ends
    execStream.on('end', () => {
      this.execStreamEnd();
    });

    //send ready message to let client know it is ready
    this.sendCode(msgcode.resume);
    debug('server executed session');
  }

  sendCode(code) {
    return this.strbuf.write(new Buffer([code]), {binary: true});
  }

  sendMessage(code, buffer) {
    return this.strbuf.write(Buffer.concat([new Buffer([code]), buffer]), {binary: true});
  }

  messageHandler(message) {
    switch (message[0]) {
      case msgcode.pause:
        this.clientPause = true;
        this.strbuf.pause();
        debug('paused');
        break;

      case msgcode.resume:
        if (!this.socketBuffering && this.clientPause) {
          this.strbuf.resume();
          debug('resumed');
        }
        this.clientPause = false;
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
        debug('unknown msg code %s; message is %s', message[0], message.length);
        debug(message);
    }
  }

  async execStreamEnd() {
    var info = await this.exec.inspect();
    debug('exit code: %s', info.ExitCode);
    if (!this.closed) {
      try {
        this.sendMessage(msgcode.stopped, new Buffer([info.ExitCode]));
        this.strbuf.end();
        this.strbuf.on('finish', () => {this.close(); });
      } catch (err) {
        debug('Failed to exec.inspect, err: %s, JSON: %j', err, err, err.stack);
        this.forceClose();
      }
    }
  }

  forceClose() {
    if (!this.closed) {
      this.sendCode(msgcode.shutdown);
      this.close();
    }
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      var index = this.server.sessions.indexOf(this);
      if (index >= 0) {
        this.server.sessions.splice(index, 1);
        debug('%s sessions remain', this.server.sessions.length);
        this.server.emit('session removed', this.server.sessions.length);
        try {this.execStream.end(); } catch(err) {/*ignore*/}
        try {this.execStream.destroy(); } catch(err) {/*ignore*/}
        try {this.socket.destroy(); } catch(err) {/*ignore*/}
      }
    }
  }
}

class DockerExecWebsocketServer extends EventEmitter {
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
    // Test that we have a docker socket
    assert(fs.statSync(this.options.dockerSocket).isSocket(),
     'Are you sure that docker is running?');

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

    this.server.on('connection', (socket, request) => {
      debug('connection received');
      this.onConnection(socket, request);
    });
  }

  onConnection(socket, request) {
    // Reject connection of we're at the session limit
    if (this.sessions.length >= this.options.maxSessions) {
      socket.send(Buffer.concat([
       new Buffer([msgcode.error]),
       new Buffer('Too many sessions active!'),
      ]));
      return socket.close();
    }

    // Find arguments from URL
    var args = url.parse(request.url, true).query;
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
    session.execute().catch(err => {
      debug('Failed to execute session, err: %s, JSON: %j', err, err, err.stack);
    });

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

module.exports = DockerExecWebsocketServer;
