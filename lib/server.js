var Docker = require('dockerode-promise');
var debug = require('debug')('docker-exec-websocket-server:lib:server');
var through = require('through');
var fs = require('fs');
var ws = require('ws');
var slugid = require('slugid');
var _ = require('lodash');
var assert = require('assert');
var url = require('url');
var msgcode = require('./messagecodes.js');

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
    this.strbuf = through();

    const MAX_OUTSTANDING_BYTES = 8 * 1024 * 1024;
    this.outstandingBytes = 0;
    
    this.strbuf.pipe(through((data) => {
      this.outstandingBytes += data.length;
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

    this.socket.on('disconnect', () => {
      //should be how to ctrl+c ctrl+d, might be better way to kill
      this.execStream.end('\x03\x04\r\nexit\r\n');
      debug('client disconnect');
      //for now, it kills this session
      this.close();
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

      default:
        debug('unknown msg code %s', message[0]);
    }
  }

  execStreamEnd () {
    this.exec.inspect().then((data) => {
      debug('%s is exit code', data.ExitCode);
      this.sendMessage(msgcode.stopped, new Buffer([data.ExitCode]));
      this.close();
    }).done();
  }

  forceClose () {
    //signifies that it was shut down forcefully, may want a better way to express this in protocol
    this.sendCode(msgcode.shutdown);
    this.close();
  }

  close () {
    this.server.sessions.splice(this.server.sessions.indexOf(this), 1);

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

// Makes a new buffer with code number (ideally 0x00-0xFF)
// appended to the start of the given buffer

/** Makes an instance of docker exec running command, then links the provided
    websocket to the stream provided by docker exec

    @param tty: boolean representing whether or not terminal emulation is active
  */

export default class DockerExecWebsocketServer {
  /* Creates Docker Exec instance on given container, running the first message given
   * as a command.
   * Options:
   * port, required
   * containerId, name or id of docker container, required
   * path, path where the websocket is hosted
   * dockerSocket, path to docker's remote API
   * maxSessions, the maximum number of sessions allowed for one server
   */
  constructor (options) {
    options = _.defaults({}, options, {path: '/'+slugid.v4(),
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

    this.port = options.port;
    this.path = options.path;
    this.maxSessions = options.maxSessions;

    //making websocket server
    var wsopts = {
      port: this.port,
      path: this.path,
    };
    assert(this.port, 'required port option missing');
    this.server = new ws.Server(wsopts);
    debug('%s%s created', wsopts.port, wsopts.path);

    this.sessions = [];

    this.server.on('connection', (socket) => {
      debug('connection recieved');
      if (this.sessions.length < this.maxSessions) {
        var args = url.parse(socket.upgradeReq.url, true).query;
        var session = new ExecSession({
          container: container,
          socket: socket,
          command: args.command,
          tty: /^true$/i.test(args.tty),
          server: this,
        });
        this.sessions.push(session);
        session.execute();
        debug('%s sessions created', this.sessions.length);
      } else {
        socket.send(Buffer.concat([new Buffer([msgcode.error]), new Buffer('Too many sessions active!')]));
      }
    });
  }

  close () {
    this.server.close();
    this.sessions.foreach((session) => {
      session.forceClose();
    });
  }
}
