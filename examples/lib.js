require('babel/register');
var DockerClient = require('./babel.js');
(function() {
  window.onload = function() {
    DockerClient({
      hostname: 'localhost',
      port: 8081,
      pathname: 'a',
      tty: 'true',
      command: '/bin/bash',
    }).then(function (client) {
      var term = new Terminal({
        cols: 80,
        rows: 24,
        useStyle: true,
        screenKeys: true,
        cursorBlink: false
      });


      term.on('data', function(data) {
        client.stdin.write(data);
      });

      term.on('title', function(title) {
        document.title = title;
      });

      term.open(document.body);

      client.stdout.on('data', function (data) {
        term.write(String.fromCharCode.apply(null, data));
      });
      client.stderr.on('data', function (data) {
        term.write(String.fromCharCode.apply(null, data));
      });

      client.on('exit', function (code) {
        term.write('\r\nProcess exited with code ' + code + '\r\n');
      });
      client.on('resumed', function () {
        term.write('\x1b[31mReady\x1b[m\r\n');
      });

    });
  };
}).call(this);
