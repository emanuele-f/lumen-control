var config = require('config');
var mqtt = require("mqtt");

var PERIODIC_STATUS_UPDATE_TIMEOUT = config.get("mqtt.refresh_time");

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
	this._statusTimer = null;
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

	this._controller.on('state-sync', this.updateStatus.bind(this));
	this._controller.start();
};

Server.prototype.performSwitchCommand = function(command) {
	if ((command === "ON") && (! this._controller.isLightOn()))
		this._controller.command(Controller.Commands.TURN_ON);
	else if (command === "OFF")
		this._controller.command(Controller.Commands.TURN_OFF);
}

Server.prototype.performWhiteCommand = function(command) {
	this._controller.command(Controller.Commands.WHITE, parseInt(command)/255.);
}

Server.prototype.performRgbCommand = function(command) {
	var color = /^([\d]+),([\d]+),([\d]+)$/i.exec(command);

	if (color) {
		this._controller.command(Controller.Commands.COLOR, [
			parseInt(color[1]) / 255.,
			parseInt(color[2]) / 255.,
			parseInt(color[3]) / 255.
		]);
	}
}

Server.prototype.performEffectCommand = function(command) {
	if (command === "Disco")
		this._controller.command(Controller.Commands.DISCO);
	else if (command === "Cool")
		this._controller.command(Controller.Commands.COOL);
	else if (command === "Soft")
		this._controller.command(Controller.Commands.SOFT);
}

Server.prototype.updateStatus = function() {
	console.log("state-sync");

	var options = {
		retain: true,
		qos: 0 /* best effort */,
	};

	var mode_2_effect = {}
	mode_2_effect[Controller.Modes.SOFT] = "Soft";
	mode_2_effect[Controller.Modes.COOL] = "Cool";
	mode_2_effect[Controller.Modes.DISCO] = "Disco";

	var on_state = this._controller.isLightOn() ? "ON" : "OFF";
	var white_level = Math.ceil(this._controller.getWhiteLevel() * 255).toString();
	var color_rgb = this._controller.getColor().map(function(x) {return Math.ceil(x * 255)}).join(",");
	var effect = mode_2_effect[this._controller.getMode()] || "";

	this._client.publish(this.command_topic + "/stat", on_state, options);
	this._client.publish(this.white_value_command_topic + "/stat", white_level, options);
	this._client.publish(this.rgb_command_topic + "/stat", color_rgb, options);
	this._client.publish(this.effect_command_topic + "/stat", effect, options);

	if (this._statusTimer)
		clearInterval(this._statusTimer);
	this._statusTimer = setInterval(this.updateStatus.bind(this), PERIODIC_STATUS_UPDATE_TIMEOUT);
}

module.exports = {
    'MqttServer': Server,
};
