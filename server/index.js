var Controller = require('./controller');
var Server = require('./server');

var controller = new Controller.Controller();
var server = new Server.Server(controller);
server.start();
