var Docker = require('dockerode');
var debug = require('debug')('docker-exec-websocket-server:lib:server');
var through = require('through');
var fs = require('fs');
var ws = require('ws');
var slugid = require('slugid');
var _ = require('lodash');
var path = require('path');

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
        debug(message);
        execStream.write(message);
      });
      socket.on('disconnect', () => {
        execStream.end('^C^D\r\nexit\r\n'); //figure out how to ctrl+c ctrl+d
      });
      socket.send('ready');
    });
  });
}

export default class DockerExecWebsocketServer {
  //options has container (name, id both ok), port, tty bool
  constructor (options) {
    options = _.defaults({}, options, {path: '/'+slugid.v4(), tty: false});
    var container = docker.getContainer(options.container);
    var wsopts = {
      port: options.port,
      path: options.path,
    };
    debug(wsopts.path);
    this.server = new ws.Server(wsopts);
    this.server.on('connection', (socket) => {
      socket.once('message', (command) => {
        execWithSocket(container, socket, command, options.tty);
      });
    });
  }
  close () {
    this.server.close();
  }
}
