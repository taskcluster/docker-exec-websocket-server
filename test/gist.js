var Docker = require('dockerode-promise');

var dockerSocket = '/var/run/docker.sock';
var docker = new Docker({socketPath: dockerSocket});

var container = docker.getContainer('servertest');
var options = {
  AttachStdout: true,
  AttachStderr: true,
  AttachStdin: true,
  Tty: false,
  Detach: false,
  Cmd: ['echo','asd'],
};
var attachoptions = {
  stdin: true,
  stdout: true,
  stderr: true,
  stream: true,
};
container.exec(options).then((exec) => {
	return exec.start(attachoptions);
}).then(() => {execstream.pipe(process.stdout);})
.done();
