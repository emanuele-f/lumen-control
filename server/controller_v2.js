/*
 * This is a cleaned and improved version of the original controller.
 *
 * TODO migrate the app to use this controller and drop the other.
 */

var Lumen = require('lumen');
var noble = require('noble');
var config = require('config');
const EventEmitter = require('events');

var INTERPOLATION_INTERVAL = config.get("interpolation.interval");        // milliseconds before interpolation step
var WHITE_STEP = config.get("interpolation.white_step");                  // step for white mode
var COLOR_STEP = config.get("interpolation.color_step");                  // step for color mode
var SOFTMODE_MIN = config.get("interpolation.softmode.min_color");        // softmode minimum colors value
var SOFTMODE_MAX = config.get("interpolation.softmode.max_color");        // softmode maximum colors value
var SOFTMODE_STEP = config.get("interpolation.softmode.color_step");      // step for soft mode
var USE_WHITE_INTERPOLATION = config.get("interpolation.in_white_mode");  // if true, colors will be interpolated when in WHITE mode
var USE_COLOR_INTERPOLATION = config.get("interpolation.in_color_mode");  // if true, colors will be interpolated when in COLOR mode

var MAX_DISCOVERY_TIME = config.get("device.max_discovery_time");
var MAX_CONNECTION_TIME = config.get("device.max_connection_time");
var SLEEP_TIME = config.get("device.sleep_time");

var Modes = {
  COLOR: 'color',
  WHITE: 'white',
  DISCO: 'disco',
  COOL: 'cool',
  SOFT: 'soft',
  // TODO add Warm mode support
};

var Commands = {
  TURN_ON: 'on',
  TURN_OFF: 'off',
  COLOR: 'color',
  WHITE: 'white',
  DISCO: 'disco',
  COOL: 'cool',
  SOFT: 'soft',
  // TODO add Warm command
};

var ConnectionStatus = {
  INIT: "init",
  SLEEPING: "sleeping",
  DISCOVERING: "discovering",
  CONNECTING: "connecting",
  SYNC: "sync",
  CONNECTED: "connected",
};

function cloneStatus(status) {
  return JSON.parse(JSON.stringify(status));
}

var Controller = function () {
  // current status variable
  this.initial_status = {
    mode: Modes.WHITE,
    color: [1.0, 1.0, 1.0],
    white: 0.9,
    lighton: true,
  };

  this.lumen = null;
  this.sm_state = ConnectionStatus.INIT;
  this.next_command = null;
  this.status = cloneStatus(this.initial_status);
  this.new_status = null;

  // color interpolation stuff
  this.interp = {
    initial:  [1.0, 1.0, 1.0],    // initial interpolation value
    target: [1.0, 1.0, 1.0],      // final interpolation value
    progress: 1.0,
    timer: null,
    soft_stage: 0,
    interpstep: COLOR_STEP,
    active: false,
    syncing: true,
  };

  this.bound = {};    // bound single instance callbacks
  this.timeouts = {};
  this.can_abort_connection = (typeof noble.cancelConnect === "function");

  if (! this.can_abort_connection)
      console.warn("cancelConnect is not available, device disconnection will fail");
};

Controller.prototype.__proto__ = EventEmitter.prototype;

// utilities to bind/unbind this
Controller.prototype.bindCallback = function(callback_name) {
  if (this.bound[callback_name]) {
    console.warn("Callback " + callback_name + " already bound!");
    this.unbindCallback(callback_name);
  }

  var cb = this[callback_name].bind(this);
  this.bound[callback_name] = cb;
  return cb;
};

Controller.prototype.unbindCallback = function(callback_name) {
  var cb = this.bound[callback_name];
  this.bound[callback_name] = null;
  return cb;
};

Controller.prototype.sleep = function() {
  console.log("Sleeping...")
  this.sm_state = ConnectionStatus.SLEEPING;

  if (this.status.lighton) {
    // if we lose connection, we suppose the light is off
    this.status.lighton = false;
    this.emit('state-sync');
  }

  this.lumen = null;
  this.timeouts.sleeping = setTimeout(this.sleepTimeout.bind(this), SLEEP_TIME);
};

Controller.prototype.sleepTimeout = function() {
  clearTimeout(this.timeouts.sleepTimeout);
  this.timeouts.sleepTimeout = null;

  this.discover();
};

Controller.prototype.discover = function() {
  /* Clean state */
  this.lumen = null;

  console.log("Start discovering...");
  this.sm_state = ConnectionStatus.DISCOVERING;

  this.timeouts.discovery = setTimeout(this.discoveryTimeout.bind(this), MAX_DISCOVERY_TIME);
  Lumen.discoverAll(this.bindCallback("discoverCallback"));
};

Controller.prototype.discoveryTimeout = function() {
  console.log("Device discovery timeout");
  clearTimeout(this.timeouts.discovery);
  this.timeouts.discovery = null;

  Lumen.stopDiscoverAll(this.unbindCallback("discoverCallback"));
  this.sleep();
};

Controller.prototype.discoverCallback = function(lumen) {
  console.log("Lumen found: " + lumen.toString());
  this.lumen = lumen;

  // stop the discovery
  Lumen.stopDiscoverAll(this.unbindCallback("discoverCallback"));
  clearTimeout(this.timeouts.discovery);
  this.timeouts.discovery = null;

  this.connect();
};

Controller.prototype.disconnectedCallback = function() {
  console.log("Lumen disconnected");
  this.lumen.removeListener('disconnect', this.unbindCallback('disconnectedCallback'));

  if (this.interp.active)
    this.stopInterpolation();

  this.discover();
};

Controller.prototype.connect = function() {
  console.log("Connecting...");
  this.sm_state = ConnectionStatus.CONNECTING;

  // Connection abort is only supported with patched code
  if (this.can_abort_connection)
    this.timeouts.connect = setTimeout(this.connectTimeout.bind(this), MAX_CONNECTION_TIME);

  this.lumen.connectAndSetUp(this.connectCallback.bind(this));
};

Controller.prototype.connectTimeout = function() {
  console.log("Device connection timeout");
  clearTimeout(this.timeouts.connect);
  this.timeouts.connect = null;

  // cancel the connection hard
  noble.cancelConnect();

  // this is also needed, but we don't register a callback since it could block...
  this.lumen.disconnect();
  this.discover();
};

Controller.prototype.connectCallback = function(error) {
  if (this.can_abort_connection) {
    clearTimeout(this.timeouts.connect);
    this.timeouts.connect = null;
  }

  if (error) {
    console.log('Lumen connection error');
    this.discover();
    return;
  }

  console.log("Lumen connected");
  this.lumen.on('disconnect', this.bindCallback('disconnectedCallback'));
  this.sm_state = ConnectionStatus.READY;

  // we can only assume the light was manually toggled, so go back to the initial state
  this.status = cloneStatus(this.initial_status);

  if (this.next_command)
    this.nextCommand();
  else
    this.emit('state-sync');
};

Controller.prototype.syncToLumen = function() {
  this.sm_state = ConnectionStatus.SYNC;
  var new_status = this.new_status;
  var callback = this.onCommandSet.bind(this);

  if (new_status.lighton === false)
    this.lumen.turnOff(callback);
  else if (new_status.mode === Modes.DISCO)
    this.lumen.disco1Mode(callback);
  else if (new_status.mode === Modes.COOL)
    this.lumen.coolMode(callback);
  else if (new_status.mode === Modes.WHITE)
    this.lumen.white(new_status.white*99, callback);
  else if (new_status.mode === Modes.COLOR || new_status.mode === Modes.SOFT) {
    this.lumen.color(new_status.color[0]*99, new_status.color[1]*99, new_status.color[2]*99, callback);
  }else
    console.log("Unknown mode", new_status.mode);
};

Controller.prototype.onCommandSet = function() {
  this.sm_state = ConnectionStatus.READY;
  this.status = this.new_status;
  this.new_status = null;

  if (this.interp.active) {
    // check if there is a incoming command
    if (this.next_command)
      this.stopInterpolation();
    else
      this.interpolationStep();
  } else
    this.emit('state-sync');

  this.nextCommand();
};

Controller.prototype.commandToStatus = function(command) {
  var action = command.action;
  var value = command.value;

  var new_status = cloneStatus(this.status);

  if (action === Commands.TURN_ON)
    new_status.lighton = true;
  else if (action === Commands.TURN_OFF)
    new_status.lighton = false;
  else if (action === Commands.DISCO)
    new_status.mode = Modes.DISCO;
  else if (action === Commands.COOL)
    new_status.mode = Modes.COOL;
  else if (action === Commands.WHITE) {
    new_status.mode = Modes.WHITE;

    if (USE_WHITE_INTERPOLATION && (this.status.mode === Modes.WHITE))
      this.startInterpolation(value, WHITE_STEP, "white");
    else
      new_status.white = value;
  } else if (action === Commands.COLOR) {
    new_status.mode = Modes.COLOR;

    if (USE_COLOR_INTERPOLATION && (this.status.mode === Modes.COLOR))
      this.startInterpolation(value, COLOR_STEP, "color");
    else
      new_status.color = value;
  } else if (action === Commands.SOFT) {
    if (new_status.mode !== Modes.COLOR)
      new_status.color = [SOFTMODE_MIN, SOFTMODE_MIN, SOFTMODE_MIN];
    new_status.mode = Modes.SOFT;
    this.startSoftMode();
  } else {
    console.log("ERROR: unrecognized command: ", action);
  }

  return new_status;
};

Controller.prototype.nextCommand = function() {
  if (! this.next_command)
    return;

  this.new_status = this.commandToStatus(this.next_command);
  this.next_command = null;
  console.log("syncToLumen (" + JSON.stringify(this.new_status) + ")");
  this.syncToLumen();
};

// -----------------------------------------------------------------------------
// Interpolation stuff
// -----------------------------------------------------------------------------

function linear_interpolation(from, to, p) {
  /* handle both lists and single numbers */
  if (typeof from.length !== "number") {
    from = [from,];
    to = [to,];
  }

  var ret = [];

  for (i=0; i<from.length; i++)
    ret.push(from[i] * (1-p) + to[i] * p);

  return (ret.length == 1) ? ret[0] : ret;
}

/* Modes.COLOR | Modes.SOFT */
Controller.prototype.startInterpolation = function(target, step, property, interp_fn) {
  this.interp.progress = 0.0;
  this.interp.initial = this.status[property];
  this.interp.target = target;
  this.interp.interpstep = step;
  this.interp.active = true;        /* true if interpolation is currently active */
  this.interp.syncing = true;       /* true if an interpolation command is being sent to the lumen */
  this.interp.property = property;
  this.interp.interp_fn = interp_fn || linear_interpolation;

  if (! this.timeouts.interpolation) {
    console.log("interpolation start");
    this.timeouts.interpolation = setInterval(this.interpolationTimeout.bind(this), INTERPOLATION_INTERVAL);
  }
};

/* Modes.SOFT only */
Controller.prototype.startSoftMode = function() {
  this.interp.soft_stage = 0;
  this.softModeNextStep();
};

Controller.prototype.interpolationStep = function() {
  if (this.interp.progress == 1.0) {
    if (this.status.mode === Modes.SOFT)
      this.softModeNextStep();
    else if (this.interp.active) {
      this.stopInterpolation();
      this.emit('state-sync');
    }
  }

  this.interp.syncing = false;
};

Controller.prototype.stopInterpolation = function() {
  clearTimeout(this.timeouts.interpolation);
  this.timeouts.interpolation = null;
  this.interp.active = false;
  console.log("interpolation stop");
};

Controller.prototype.softModeNextStep = function () {
  // r -> y -> g -> p -> b -> m -> r
  var mapper = {
    0: [SOFTMODE_MAX, SOFTMODE_MIN, SOFTMODE_MIN],
    1: [SOFTMODE_MAX, SOFTMODE_MAX, SOFTMODE_MIN],
    2: [SOFTMODE_MIN, SOFTMODE_MAX, SOFTMODE_MIN],
    3: [SOFTMODE_MIN, SOFTMODE_MAX, SOFTMODE_MAX],
    4: [SOFTMODE_MIN, SOFTMODE_MIN, SOFTMODE_MAX],
    5: [SOFTMODE_MAX, SOFTMODE_MIN, SOFTMODE_MAX],
  };

  target = mapper[this.interp.soft_stage];
  this.interp.soft_stage = (this.interp.soft_stage + 1) % 6;
  this.startInterpolation(target, SOFTMODE_STEP, "color");
};

Controller.prototype.interpolationTimeout = function() {
  if(this.interp.syncing)
    return;

  this.interp.progress = Math.min(Math.max(0.0, this.interp.progress + this.interp.interpstep), 1.0);

  var p = this.interp.progress;

  this.new_status = cloneStatus(this.status);
  this.new_status[this.interp.property] = this.interp.interp_fn(this.interp.initial, this.interp.target, p);

  // console.log(JSON.stringify(this.new_status[this.interp.property]));

  this.interp.syncing = true;
  this.syncToLumen();
};

// -----------------------------------------------------------------------------
// API
// -----------------------------------------------------------------------------

Controller.prototype.start = function() {
  if (this.sm_state === ConnectionStatus.INIT)
    this.discover();
};

Controller.prototype.isConnected = function() {
  return (this.sm_state === ConnectionStatus.SYNC)
      || (this.sm_state === ConnectionStatus.READY);
};

/* this is the method to call to set a command */
Controller.prototype.command = function(action, value) {
  this.next_command = {'action':action, 'value':value};

  console.log("Command: " + JSON.stringify(this.next_command));

  if (this.sm_state === ConnectionStatus.READY)
    this.nextCommand();
  else if (this.sm_state === ConnectionStatus.SLEEPING)
    this.sleepTimeout();    // resume from sleep
};

Controller.prototype.getMode = function() { return this.status.mode; };
Controller.prototype.getColor = function() { return JSON.parse(JSON.stringify(this.status.color)); };
Controller.prototype.getWhiteLevel = function() { return this.status.white; };
Controller.prototype.isLightOn = function() { return this.status.lighton; };

module.exports = {
  'Controller': Controller,
  'Commands': Commands,
  'Modes': Modes,
};
