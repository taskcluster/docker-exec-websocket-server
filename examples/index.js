var express = require('express');
var http = require('http');
var terminal = require('term.js');
var DockerServer = require('../lib/server.js');

var app = express();
var server = http.createServer(app);

app.use(function (req, res, next) { //some header magic, i don't know what this does
  var setHeader = res.setHeader;
  res.setHeader = function (name) {
    switch (name) {
        case 'Cache-Control':
        case 'Last-Modified':
        case 'ETag':
        return;
    }
    return setHeader.apply(res, arguments);
  };
  next();
});

app.use(express.static(__dirname));
app.use(terminal.middleware());
server.listen(8080);

var dockerServer = new DockerServer({
  path: '/a',
  port: 8081,
  containerId: 'servertest',
});
