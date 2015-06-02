var Docker = require('dockerode');
var debug = require('debug')('docker-exec-websocket-server:lib:lib');
var through = require('through');
var fs = require('fs');
var ws = require('ws');
var slugid = require('slugid');

var socket = '/var/run/docker.sock';
var stats = fs.statSync(socket);
if (!stats.isSocket()) {
  throw new Error('Are you sure the docker is running?');
}
var docker = new Docker({socketPath: socket});

var dbgstream;
if (process.argv[2] === '--dump') {
  dbgstream = fs.createWriteStream(path.join(__dirname, '/dump.log'));
}

module.exports = class DockerExecWebsocketServer {
  //options has container (name, id both ok), port
  constructor(options) {
    var container = docker.getContainer(options.container);
    var path = slugid.v4();
    var wsopts = {
      port: options.port,
      path: path,
    }
    this.server = new ws.Server(wsopts);
    server.on('connection', (socket) => {
      socket.once('message', (message) => {
        execTtyWithSocket(container, socket, message);
      })
    });
  }
  close() {
    this.server.close();
  }
}

/** Makes an instance of docker exec running command, then links the provided
    websocket to the stream provided by docker exec
  */
function execTtyWithSocket (container, socket, command) {
  var options = {
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: true,
    Tty: true,
    Detach: false,
    Cmd: command || '/bin/bash',
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
      var strout = through((data) => { //keep these streams separate for now
        if (dbgstream) {
          dbgstream.write('OUT: ' + data + '\n-\n');
        }
        socket.send(String.fromCharCode(1) + data.toString());
      });
      var strerr = through((data) => {
        if (dbgstream) {
          dbgstream.write('ERR: ' + data + '\n-\n');
        }
        socket.send(String.fromCharCode(2) + data.toString());
      });
      exec.modem.demuxStream(execStream, strout, strerr);
      socket.on('message', (message) => {
        if (dbgstream) {
          dbgstream.write('IN: ' + message + '\n-\n');
        }
        execStream.write(message);
      });
      socket.on('disconnect', () => { 
        execStream.end('^C^D\r\nexit\r\n'); //figure out how to ctrl+c ctrl+d
      });
    });
  });
}