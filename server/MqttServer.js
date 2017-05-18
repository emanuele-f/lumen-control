var config = require('config');
var mqtt = require("mqtt");

var Controller = require("./controller");

function Server(controller) {
	this._mqtt_options = {
	        username: config.get('mqtt.user'),
        	password: config.get('mqtt.password'),
	};
	this.command_topic = config.get('mqtt.command_topic');
	this.white_value_command_topic = config.get('mqtt.white_value_command_topic');
	this.rgb_command_topic = config.get('mqtt.rgb_command_topic');
	this.effect_command_topic = config.get('mqtt.effect_command_topic');
	this._controller = controller;
}

Server.prototype.start = function() {
	this._client = mqtt.connect(config.get('mqtt.url'), this._mqtt_options);
	console.info('Connected to the MQTT server');

	this._client.subscribe(this.command_topic);
	this._client.subscribe(this.white_value_command_topic);
	this._client.subscribe(this.rgb_command_topic);
	this._client.subscribe(this.effect_command_topic);

	this._client.on('message', (function (topic, message) {
		message = message.toString();
		console.info("topic: " + topic + " message: " + message);

  		if (topic === this.command_topic)
			this.performSwitchCommand(message);
		else if (topic === this.white_value_command_topic)
			this.performWhiteCommand(message);
		else if (topic === this.rgb_command_topic)
			this.performRgbCommand(message);
		else if (topic === this.effect_command_topic)
			this.performEffectCommand(message);
	}).bind(this));

	this._controller.connect();
}

Server.prototype.performSwitchCommand = function(command) {
	if (command === "ON")
		this._controller.command(Controller.Commands.TURN_ON);
	else if (command === "OFF")
		this._controller.command(Controller.Commands.TURN_OFF);
}

Server.prototype.performWhiteCommand = function(command) {
	console.log("TODO");
}

Server.prototype.performRgbCommand = function(command) {
	console.log("TODO");
}

Server.prototype.performEffectCommand = function(command) {
	console.log("TODO");
}

module.exports = {
    'MqttServer': Server,
};
