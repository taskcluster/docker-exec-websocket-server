var Docker = require('dockerode-promise');
var debug = require('debug')('docker-exec-websocket-server:lib:server');
var through = require('through');
var fs = require('fs');
var ws = require('ws');
var slugid = require('slugid');
var _ = require('lodash');
var path = require('path');
var assert = require('assert');
var url = require('url');
var msgcode = require('./messagecodes.js');

var dockerSocket = '/var/run/docker.sock';
var stats = fs.statSync(dockerSocket);
if (!stats.isSocket()) {
  throw new Error('Are you sure the docker is running?');
}
var docker = new Docker({socketPath: dockerSocket});

// Makes a new buffer with code number (ideally 0x00-0xFF)
// appended to the start of the given buffer
function muxBuffer (code, buffer) {
  return Buffer.concat([new Buffer([code]), buffer]);
}

/** Makes an instance of docker exec running command, then links the provided
    websocket to the stream provided by docker exec

    @param tty: boolean representing whether or not terminal emulation is active
  */
function execWithSocket (container, socket, command, tty, dbgWrite) {
  var options = {
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: true,
    Tty: tty,
    Detach: false,
    Cmd: command,
  };
  var attachoptions = {
    stdin: true,
    stdout: true,
    stderr: true,
    stream: true,
  };
  var exec;
  container.exec(options).then((_exec) => {
    exec = _exec;
    return exec.start(attachoptions);
  }).then((execStream) => {
    //handling output
    var strout = through();
    strout.pipe(through((data) => {
      dbgWrite('OUT', data);
      socket.send(muxBuffer(msgcode.stdout, data), {binary: true});
    }));
    var strerr = through();
    strerr.pipe(through((data) => {
      dbgWrite('ERR', data);
      socket.send(muxBuffer(msgcode.stderr, data), {binary: true});
    }));
    exec.modem.demuxStream(execStream, strout, strerr);

    //handling input

    function paused (message) {
      var buf = new Buffer(new Uint8Array(message));
      debug('message recieved during pause');
      debug(buf);
      switch (message[0]) {
        case msgcode.resume: 
          strout.resume();
          strerr.resume();
          socket.removeListener('message', paused);
          socket.on('message', resumed);
          debug('resumed');
        break;

        case msgcode.stdin:
          var tf = execStream.write(buf.slice(1), {binary: true});
          debug('server needs drain: ',!tf);
        break;

        default:
          debug('unknown msg code %s', message[0]);
          throw new Error('unknown msg code');
      }
    }

    function resumed (message) {
      var buf = new Buffer(new Uint8Array(message));
      debug(buf);
      dbgWrite('IN', buf);
      switch (message[0]) {
        case msgcode.stdin:
          var tf = execStream.write(buf.slice(1), {binary: true});
          debug('server needs drain: ',!tf);
        break;

        case msgcode.pause:
          strout.pause();
          strerr.pause();
          socket.removeListener('message', resumed);
          socket.on('message', paused);
          debug('paused');
        break;

        default:
          debug('unknown msg code %s', message[0]);
          throw new Error('unknown msg code');
      }
    }
    socket.on('message', resumed);

    socket.on('disconnect', () => {
      //should be how to ctrl+c ctrl+d, might be better way to kill
      execStream.end('\x03\x04\r\nexit\r\n');
    });

    //When the process dies, the stream ends
    execStream.on('end', () => {
      exec.inspect().then((data) => {
        var exitBuf = new Buffer([data.ExitCode]);
        socket.send(muxBuffer(msgcode.stopped, exitBuf), {binary: true});
      }).done();
    });

    //send ready message to let client know it is ready
    socket.send(new Buffer([msgcode.resume]), {binary: true});
  }).done();
}

export default class DockerExecWebsocketServer {
  /* Creates Docker Exec instance on given container, running the first message given
   * as a command.
   * Options:
   * port, required
   * containerId, name or id of docker container, required
   * path, path where the websocket is hosted
   * log, whether or not we want to log the i/o
   */
  constructor (options) {
    options = _.defaults({}, options, {path: '/'+slugid.v4(), log: false});

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
    var dbgStream;
    if (options.log) {
      dbgStream = fs.createWriteStream(path.join(__dirname, '/dump.log'));
    }
    var dbgWrite = dbgStream ? (m, d) => dbgStream.write(m + ': ' + d + '\n-\n') : () => {};

    this.server.on('connection', (socket) => {
      debug('connection recieved');
      var args = url.parse(socket.upgradeReq.url, true).query;
      execWithSocket(container, socket, JSON.parse(decodeURIComponent(args.command)),
        args.tty, dbgWrite);
    });
  }

  close () {
    this.server.close();
  }
}
