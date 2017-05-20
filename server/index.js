var config = require('config');

var server_mode = config.get('server_mode');

if (server_mode === "http") {
	var Server = require('./server');
	var Controller = require('./controller');
	var controller = new Controller.Controller();
	var server = new Server.Server(controller);
	server.start();
} else if (server_mode === "mqtt") {
	var MqttServer = require('./MqttServer');
	var Controller = require('./controller_v2');
	var controller = new Controller.Controller();
	var server = new MqttServer.MqttServer(controller);
	server.start();
}
