var Lumen = require('lumen');

var INTERPOLATION_INTERVAL = 40;        // milliseconds before interpolation step
var COLOR_STEP = 0.01;                  // step for color mode
var SOFTMODE_MIN = 0.25;                // softmode minimum colors value
var SOFTMODE_MAX = 1.0;                 // softmode maximum colors value
var SOFTMODE_STEP = 0.002;              // step for soft mode

var Modes = {
    COLOR: 'color',
    WHITE: 'white',
    DISCO: 'disco',
    COOL: 'cool',
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

var Controller = function () {
    this.mode = Modes.WHITE;
    this.color = [1.0, 1.0, 1.0];
    this.white = 1.0;
    this.lighton = true;
    this.ready = false;

    this._lumen = null;
    this._listener_set = false;
    this._discovering = false;
    this._connecting = false;
    this._stopped = false;                             // use to force disconnection
    this._pending = null;                                   // .action, .value
    this._busy = true;                                      // !_busy => _pending = null
    this._softstep = 0;

    // interpolation stuff
    this._initial = [1.0, 1.0, 1.0];                        // initial interpolation value
    this._target = [1.0, 1.0, 1.0];                         // final interpolation value
    this._interpwait = false;
    this._progress = 0.0;
    this._timer = null;
};

Controller.prototype._getSeconds = function(callback) {
    return Math.floor(new Date() / 1000);
};

/* connects or reconnects to the bound lumen */
Controller.prototype._connect = function() {
    if (this._connecting)
        return;

    this._connecting = true;
    this._lumen.connectAndSetUp(function(error) {
        if (this._stopped)
            return;

        if (error) {
            console.log('Lumen connection error');
            this._connecting = false;
            // TODO use a timer before retry and fix recursion bug!
            this._connect();
        } else {
            console.log('Lumen connected');
            this._syncStatus(function() {
                if (this._stopped)
                    return;
                this._connecting = false;
                this.ready = true;
                this._executePendingCommand();
            }.bind(this));
        }
    }.bind(this));
};

// sync internal status to the lumen
Controller.prototype._syncStatus = function(callback) {
    if (this.lighton === false)
        this._lumen.turnOff(callback);
    else if (this.mode === Modes.DISCO)
        this._lumen.disco1Mode(callback);
    else if (this.mode === Modes.COOL)
        this._lumen.coolMode(callback);
    else if (this.mode === Modes.WHITE)
        this._lumen.white(this.white*99, callback);
    else if (this.mode === Modes.COLOR || this.mode === Modes.SOFT)
        this._lumen.color(this.color[0]*99, this.color[1]*99, this.color[2]*99, callback);
    else
        console.log("Unknown mode", this.mode);
};

Controller.prototype._onDisconnect = function() {
    this.ready = false;

    if (! this._stopped) {
        console.log("Lumen disconnected, retry...");
        this._connecting = false;
        this._connect();
    } else {
        console.log("Lumen disconnected");
    }
};

Controller.prototype._doDiscover = function() {
    if (this._discovering)
        return;

    console.log("Start discovering...");
    this._discovering = true;

    if (!this._listener_set)
        // need to keep a reference to remove on stopDiscoverAll
        this._listener_set = function(lumen) {
            if (this._stopped)
                return;

            console.log("Lumen bound: " + lumen.toString());
            this._discovering = false;
            this._lumen = lumen;
            this._lumen.on('disconnect', this._onDisconnect.bind(this));
            this._connect();
        }.bind(this);

    // discovering process is handled by noble, only one device at a time
    Lumen.discoverAll(this._listener_set);
};

Controller.prototype._executePendingCommand = function() {
    if (this._pending) {
        var cmd = this._pending;
        this._pending = null;
        this._executeCommand(cmd);
    } else {
        this._busy = false;
    }
};

/* stop any interpolation or long operation on the device */
Controller.prototype._stopAnyWork = function() {
    if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
    }
    this._interpwait = false;
};

Controller.prototype._onTimer = function() {
    if (! this.ready) {
        this._interpwait = false;
        return;
    }

    this._progress = Math.min(Math.max(0.0, this._progress + this._interpstep), 1.0);
    if (this._interpwait)
        // skip
        return;

    var p = this._progress;
    this.color = [
        this._initial[0] * (1-p) + this._target[0] * p,
        this._initial[1] * (1-p) + this._target[1] * p,
        this._initial[2] * (1-p) + this._target[2] * p,
    ];
    this._interpwait = true;
    this._syncStatus(function() {
        this._interpwait = false;
        if (this._progress == 1.0)
            // interpolation end
            if (this.mode === Modes.SOFT)
                this._softmodeNextStep();
            else
                this._stopAnyWork();
    }.bind(this));
};

/* Modes.COLOR | Modes.SOFT */
Controller.prototype._startInterpolationWork = function(target, step) {
    this._progress = 0.0;
    this._initial = this.color;
    this._target = target;
    this._interpstep = step;

    if (! this._timer)
        this._timer = setInterval(this._onTimer.bind(this), INTERPOLATION_INTERVAL);
};

/* Modes.SOFT only */
Controller.prototype._startSoftmodeWork = function() {
    if (this.mode !== Modes.COLOR)
        this.color = [SOFTMODE_MIN, SOFTMODE_MIN, SOFTMODE_MIN];

    this.mode = Modes.SOFT;
    this._softstep = 0;
    this._softmodeNextStep();
};

Controller.prototype._softmodeNextStep = function () {
    // r -> y -> g -> p -> b -> m -> r
    var mapper = {
        0: [SOFTMODE_MAX, SOFTMODE_MIN, SOFTMODE_MIN],
        1: [SOFTMODE_MAX, SOFTMODE_MAX, SOFTMODE_MIN],
        2: [SOFTMODE_MIN, SOFTMODE_MAX, SOFTMODE_MIN],
        3: [SOFTMODE_MIN, SOFTMODE_MAX, SOFTMODE_MAX],
        4: [SOFTMODE_MIN, SOFTMODE_MIN, SOFTMODE_MAX],
        5: [SOFTMODE_MAX, SOFTMODE_MIN, SOFTMODE_MAX],
    };

    target = mapper[this._softstep];
    this._softstep = (this._softstep + 1) % 6;
    this._startInterpolationWork(target, SOFTMODE_STEP);
};

Controller.prototype._executeCommand = function(cmd) {
    var action = cmd.action;
    var value = cmd.value;

    if (! this.ready)
        return;
    this._busy = true;

    if (action === Commands.TURN_ON) {
        if (! this.lighton) {
            this._stopAnyWork();
            this.lighton = true;
            this._syncStatus(this._executePendingCommand.bind(this));
        } else {
            this._executePendingCommand();
        }
    } else if (action === Commands.TURN_OFF) {
        if (this.lighton) {
            this._stopAnyWork();
            this.lighton = false;
            this._syncStatus(this._executePendingCommand.bind(this));
        } else {
            this._executePendingCommand();
        }
    } else if (action === Commands.DISCO) {
        this._stopAnyWork();
        this.mode = Modes.DISCO;
        this._syncStatus(this._executePendingCommand.bind(this));
    } else if (action === Commands.COOL) {
        this._stopAnyWork();
        this.mode = Modes.COOL;
        this._syncStatus(this._executePendingCommand.bind(this));
    } else if (action === Commands.WHITE) {
        // TODO white interpolation + color mix
        this._stopAnyWork();
        this.mode = Modes.WHITE;
        this.white = value;
        this._syncStatus(this._executePendingCommand.bind(this));
    } else if (action === Commands.COLOR) {
        if (this.mode === Modes.COLOR || this.mode === Modes.SOFT) {
            this.mode = Modes.COLOR;
            this._startInterpolationWork(value, COLOR_STEP);
            this._executePendingCommand();
        } else {
            // current color is not relevant, set color directly
            this.mode = Modes.COLOR;
            this.color = value;
            this._syncStatus(this._executePendingCommand.bind(this));
        }
    } else if (action === Commands.SOFT) {
        this._startSoftmodeWork();
        this._executePendingCommand();
    } else {
        console.log("ERROR: unrecognized command: ", action);
        this._executePendingCommand();
    }
};

/* returns true if action is pending, false otherwise */
Controller.prototype.command = function(action, value) {
    cmd = {'action':action, 'value':value};

    this.connect();

    if (this._busy || ! this._lumen) {
        this._pending = cmd;
        return true;
    } else {
        this._executeCommand(cmd);
        return false;
    }
};

/* start/restart device connection */
Controller.prototype.connect = function() {
    if (this.ready)
        return;

    if (!this._stopped && (this._discovering || this._connecting)) {
        // already in progress
        return;
    }

    this._stopped = false;
    if (this._lumen) {
        // we are already bound
        this._connecting = false;
        this._connect();
    } else {
        // still not bound
        this._discovering = false;
        this._doDiscover();
    }
};

/* stop any action we are taking to connect */
Controller.prototype.disconnect = function() {
    if (this._stopped || this.mode === Modes.SOFT)
        return;

    this._stopped = true;
    this._ready = false;

    if (this._discovering)
        Lumen.stopDiscoverAll(this._listener_set);
    else if (this._lumen && ! this._connecting)
        this._lumen.disconnect();
};

module.exports = {
    'Controller': Controller,
    'Commands': Commands,
    'Modes': Modes,
};
