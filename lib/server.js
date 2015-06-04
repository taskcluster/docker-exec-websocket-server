var Docker = require('dockerode');
var debug = require('debug')('docker-exec-websocket-server:lib:server');
var through = require('through');
var fs = require('fs');
var ws = require('ws');
var slugid = require('slugid');
var _ = require('lodash');
var path = require('path');
var assert = require('assert');

var dockerSocket = '/var/run/docker.sock';
var stats = fs.statSync(dockerSocket);
if (!stats.isSocket()) {
  throw new Error('Are you sure the docker is running?');
}
var docker = new Docker({socketPath: dockerSocket});

var dbgstream;
if (process.argv[2] === '--dump') {
  dbgstream = fs.createWriteStream(path.join(__dirname, '/dump.log'));
}

// Makes a new buffer with code number (ideally 0x00-0xFF)
// appended to the start of the given buffer
function muxBuffer (code, buffer) {
  return Buffer.concat([new Buffer(String.fromCharCode(code)), buffer]);
}

/** Makes an instance of docker exec running command, then links the provided
    websocket to the stream provided by docker exec

    @param tty: boolean representing whether or not terminal emulation is active
  */
function execWithSocket (container, socket, command, tty) {
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
  return container.exec(options, (err, exec) => {
    if (err) {
      throw err;
    }
    exec.start(attachoptions, (err, execStream) => {
      if (err) {
        throw err;
      }
      var strout = through((data) => {
        if (dbgstream) {
          dbgstream.write('OUT: ' + data + '\n-\n');
        }
        socket.send(muxBuffer(1, data), {binary: true, mask: true});
      });
      var strerr = through((data) => {
        if (dbgstream) {
          dbgstream.write('ERR: ' + data + '\n-\n');
        }
        socket.send(muxBuffer(2, data), {binary: true, mask: true});
      });
      exec.modem.demuxStream(execStream, strout, strerr);
      socket.on('message', (message) => {
        if (dbgstream) {
          dbgstream.write('IN: ' + message + '\n-\n');
        }
        execStream.write(message);
      });
      socket.on('disconnect', () => {
        execStream.end('\x03\x04\r\nexit\r\n'); //should be how to ctrl+c ctrl+d, might be better way to kill
      });
      socket.send('ready');
    });
  });
}

export default class DockerExecWebsocketServer {
  /* Creates Docker Exec instance on given container, running the first message given
   * as a command.
   * Options:
   * port, required
   * container, name or id of docker container, required
   * path, path where the websocket is hosted
   * tty, whether or not we expect VT100-style output
   */
  constructor (options) {
    options = _.defaults({}, options, {path: '/'+slugid.v4(), tty: false});
    var container = docker.getContainer(options.container);
    this.port = options.port;
    this.path = options.path;
    var wsopts = {
      port: this.port,
      path: this.path,
    };
    assert(this.port, 'required port option missing');
    assert(container, 'required container option missing');
    this.server = new ws.Server(wsopts);
    debug(wsopts.port+'/'+wsopts.path+' created');
    debug(this.server.options.path);
    this.server.on('connection', (socket) => {
      debug('connection recieved');
      socket.once('message', (command) => {
        execWithSocket(container, socket, command, options.tty);
      });
    });
  }
  close () {
    this.server.close();
  }
}
