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

class execSession {
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
    this.dbgWrite = options.dbgWrite;
    this.container = options.container;
    this.socket = options.socket;
  }

  async execute() {
    debug(this.execOptions);
    let exec = await this.container.exec(this.execOptions);
    debug('does this ever happen');
    exec.start(this.attachOptions).then((execStream) => {
      debug('a');
      //handling output
      this.strout = through((data) => {
        this.dbgWrite('out', data);
        this.sendMessage(msgcode.stdout, new Buffer(data));
      });

      this.strerr = through((data) => {
        this.dbgWrite('err', data);
        this.sendMessage(msgcode.stderr, new Buffer(data));
      });

      exec.modem.demuxStream(execStream, this.strout, this.strerr);
      this.strbuf = through();
      this.strbuf.pipe(through((data) => {
        this.socket.send(data, {binary: true});
      }));
      this.strout.pipe(this.strbuf);
      this.strerr.pipe(this.strbuf);

      //handling input
      this.messageHandler = (message) => {
        var buf = new Buffer(new Uint8Array(message)); //really necessary when we're not using arraybuffer?
        debug(buf.compare(message));
        debug(buf);
        this.dbgWrite('in', buf);
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
            if (!execStream.write(buf.slice(1), {binary: true})) {
              this.sendMessage(msgcode.pause, new Buffer(0));
              debug('paused');
            }
            // debug('server needs drain: ',!tf);
            break;

          default:
            debug('unknown msg code %s', message[0]);
        }
      };
      this.socket.on('message', this.messageHandler);

      this.socket.on('disconnect', () => {
        //should be how to ctrl+c ctrl+d, might be better way to kill
        execStream.end('\x03\x04\r\nexit\r\n');
      });

      //start recieving client output again
      execStream.on('drain', () => {
        this.sendMessage(msgcode.resume, new Buffer(0));
        debug('resumed');
      });

      //When the process dies, the stream ends
      execStream.on('end', () => {
        exec.inspect().then((data) => {
          this.sendMessage(msgcode.stopped, new Buffer([data.ExitCode]));
        }).done();
      });

      //send ready message to let client know it is ready
      this.sendMessage(msgcode.resume, new Buffer(0));

      debug('server has sent ready');
    }).done();
  }

  sendMessage (code, buffer) {
    this.strbuf.write(Buffer.concat([new Buffer([code]), buffer]));
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
   * dbgStream, stream where io is to be logged (optional)
   * dockerSocket, path to docker's remote API
   */
  constructor (options) {
    options = _.defaults({}, options, {path: '/'+slugid.v4(), 
      dockerSocket: '/var/run/docker.sock',
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

    //making websocket server
    var wsopts = {
      port: this.port,
      path: this.path,
    };
    assert(this.port, 'required port option missing');
    this.server = new ws.Server(wsopts);
    debug('%s%s created', wsopts.port, wsopts.path);

    //creating optional debug stream
    var dbgWrite = options.dbgStream ? (m, d) => options.dbgStream.write(m + ': ' + d + '\n-\n') : () => {};

    this.server.on('connection', (socket) => {
      debug('connection recieved');
      var args = url.parse(socket.upgradeReq.url, true).query;
      (new execSession({
        container: container,
        socket: socket,
        command: args.command,
        tty: /^true$/i.test(args.tty),
        dbgWrite: dbgWrite,
      })).execute();
    });
  }

  close () {
    this.server.close();
  }
}
