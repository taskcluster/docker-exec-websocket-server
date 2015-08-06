var _ = require('lodash');
var assert = require('assert');
var debug = require('debug')('docker-exec-websocket-server:lib:server');
var debugdata = require('debug')('docker-exec-websocket-server:lib:sent');
var Docker = require('dockerode-promise');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var msgcode = require('./messagecodes.js');
var slugid = require('slugid');
var through = require('through');
var url = require('url');
var ws = require('ws');

class ExecSession {
  constructor (options) {
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

  async execute () {
    //TODO: add error handling support here
    this.exec = await this.container.exec(this.execOptions);
    this.execStream = await this.exec.start(this.attachOptions);

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

    const MAX_OUTSTANDING_BYTES = 8 * 1024 * 1024;
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

  sendCode (code) {
    this.strbuf.write(new Buffer([code]), {binary: true});
  }

  sendMessage (code, buffer) {
    this.strbuf.write(Buffer.concat([new Buffer([code]), buffer]), {binary: true});
  }

  messageHandler (message) {
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
        this.exec.resize({
          h: message.readUInt16LE(1),
          w: message.readUInt16LE(3),
        });
        break;

      default:
        debug('unknown msg code %s', message[0]);
    }
  }

  execStreamEnd () {
    this.exec.inspect().then((data) => {
      debug('%s is exit code', data.ExitCode);
      this.sendMessage(msgcode.stopped, new Buffer([data.ExitCode]));
      this.close();
    }, () => {
      this.forceClose();
    });
  }

  forceClose () {
    this.sendCode(msgcode.shutdown);
    this.close();
  }

  close () {
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
  /* Creates Docker Exec instance on given container, running the first message given
   * as a command.
   * Options:
   * port, required
   * OR
   * server, instance of http.Server or https.Server already listening on a port
   * containerId, name or id of docker container, required
   * path, path where the websocket is hosted
   * dockerSocket, path to docker's remote API
   * maxSessions, the maximum number of sessions allowed for one server
   * wrapperCommand, an optional wrapper script which wraps the command query
   */
   constructor (options) {
    super();
    this.options = options = _.defaults({}, options, {path: '/'+slugid.v4(),
      dockerSocket: '/var/run/docker.sock',
      maxSessions: 10,
    });

    //setting up docker
    var stats = fs.statSync(options.dockerSocket);
    if (!stats.isSocket()) {
      throw new Error('Are you sure the docker is running?');
    }
    var docker = new Docker({socketPath: options.dockerSocket});

    //getting container
    assert(options.containerId, 'required container option missing');
    var container = docker.getContainer(options.containerId);
    assert(container, 'could not get container from Docker');

    //making websocket server
    var wsopts;
    if (options.server) {
      wsopts = {
        server: options.server,
        path: options.path,
      };
    } else if (options.port && options.path) {
      wsopts = {
        port: options.port,
        path: options.path,
      };
    }
    assert(wsopts, 'required port or server option missing');
    this.server = new ws.Server(wsopts);
    if (options.port && options.path) {
      debug('%s%s created', wsopts.port, wsopts.path);
    } else {
      debug('websocket server created');
    }

    this.sessions = [];

    this.server.on('connection', (socket) => {
      debug('connection recieved');
      if (this.sessions.length < this.options.maxSessions) {
        var args = url.parse(socket.upgradeReq.url, true).query;
        if (typeof args.command === 'string') {
          args.command = [args.command];
        }
        var session = new ExecSession({
          container: container,
          socket: socket,
          command: (options.wrapperCommand ? options.wrapperCommand : []).concat(args.command),
          tty: /^true$/i.test(args.tty),
          server: this,
        });
        this.sessions.push(session);
        session.execute();
        debug('%s sessions created', this.sessions.length);
        this.emit('session added', this.sessions.length);
      } else {
        socket.send(Buffer.concat([new Buffer([msgcode.error]), new Buffer('Too many sessions active!')]));
      }
    });
  }

  close () {
    this.server.close();
    this.sessions.forEach((session) => {
      session.forceClose();
    });
  }
}
