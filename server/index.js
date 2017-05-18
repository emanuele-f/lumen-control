var config = require('config');

var Controller = require('./controller');
var controller = new Controller.Controller();

var server_mode = config.get('server_mode');

if (server_mode === "http") {
	var Server = require('./server');
	var server = new Server.Server(controller);
	server.start();
} else if (server_mode === "mqtt") {
	var MqttServer = require('./MqttServer');
	var server = new MqttServer.MqttServer(controller);
	server.start();
}
