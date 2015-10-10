/*
 * Emanuele Faranda     18/05/2015
 *
 * USES UTF-8
 *
 *  rgb (for internal use):
 *      .r: 0.0-1.0 : red level
 *      .g: 0.0-1.0 : green level
 *      .b: 0.0-1.0 : blue level
 *
 *  xrgb (for client use):
 *      "0xRRGGBB"
 *
 *      RR: 00-FF : red level
 *      GG: 00-FF : green level
 *      BB: 00-FF : blue level
 *
 * Provided conversions:
 *      xrgb <-> rgb
 */

// :: modules ::
var net = require('net');
var Lumen = require('lumen');

// :: constraints ::
var CONSUME_INTERVAL = 10;              // milliseconds
var POWER_SAVE_TIMEOUT = 300;           // seconds
var SERVER_PORT = 7878;
var DATA_MARKER = "$";
var KEEP_ALIVE_LIMIT = 10;              // seconds
var INTERPOLATION_TICK = 0.1;           // 0-1 / CONSUME_INTERVAL

// :: status modes ::
var STATUS_MODE_WHITE = "white";
var STATUS_MODE_COLOR = "color";
var STATUS_MODE_DISCO = "disco";
var STATUS_MODE_SOFT = "soft";
var STATUS_MODE_COOL = "cool";

// :: server replies codes ::
var REPLY_ON = "on";
var REPLY_OFF = "off";
var REPLY_OFFLINE = "offline";
var REPLY_ONLINE = "online";

// :: client query commands ::
var REQUEST_COLOR = "/color";
var REQUEST_ONOFF = "/ison";
var REQUEST_STATUS = "/status";

// :: client commands ::
var COMMAND_ON = "/on";
var COMMAND_OFF = "/off";
var COMMAND_COLOR = "/rgb";
var COMMAND_WHITE = "/warm";
var COMMAND_DISCO = "/disco";
var COMMAND_SOFT = "/soft";
var COMMAND_COOL = "/cool";

// :: server response to commands ::
var RESPONSE_OK = "OK";
var RESPONSE_PENDING = "PENDING";
var RESPONSE_ERROR = "BAD REQUEST";
var RESPONSE_OFFLINE = "OFFLINE";
var RESPONSE_ALIVE = "+";

// :: consumer queue action codes ::
var ACTION_TURN = 1;
var ACTION_COLOR = 2;
var ACTION_WHITE = 3;
var ACTION_DISCO = 4;
var ACTION_COOL = 5;

// :: bulb internal state clone ::
var status_mode = STATUS_MODE_WHITE;
var status_on = true;
var status_color = {r:1.0, g:1.0, b:1.0};
var status_warm = null;

// :: bulb connection status ::
var device_ready = false;               // can be true after synch, not before
var device_synched = false;             // if true, then status_* variables are synched with bulb

// :: internals ::
var clsock = null;                      // client socket - null if disconnected
var lumen = null;                       // holds connected buld interface - null if disconnected
var partial = "";                       // holds partial responses
var beat_interval = null;               // callback to the heart_beat
var ps_timeout = null;                  // powersave callback for bluetooth
var is_discovering = false;             // true if lumen.discover is pending
// internal request state: ensure only one applies
var action_queue = [];                  // holds {code: ACTION_*, value: [action_specific]}
var action_pending = false;
// soft mode status
var softmode_step = 0;
var softmode_r = 0;
var softmode_g = 0;
var softmode_b = 0;
// color interpolation
var interp_start = null;                // initial interpolation color
var interp_end = null;                  // target interpolation color
var interp_progress = 0.0;              // progress in the interpolation

// Handle rgb list and property formats, in range 0.0-1.0
Lumen.prototype.rgbColor = function (rgb, callback)
{
    if (rgb.hasOwnProperty("r"))
        this.color(rgb.r*99, rgb.g*99, rgb.b*99, callback);
    else
        this.color(rgb[0]*99, rgb[1]*99, rgb[2]*99, callback);
}

function get_system_seconds()
{
    return Math.floor(new Date() / 1000);
}

function xrgb_to_rgb(hexstr)
{
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexstr.substr(2));
    return result ? {
        r: parseInt(result[1], 16) *1. / 255,
        g: parseInt(result[2], 16) *1. / 255,
        b: parseInt(result[3], 16) *1. / 255,
    } : null;
}

function rgb_to_xrgb(rgb) {
    return "0x" + ("00" + parseInt(rgb.r * 255).toString(16)).substr(-2) +
            ("00" + parseInt(rgb.g * 255).toString(16)).substr(-2) +
            ("00" + parseInt(rgb.b * 255).toString(16)).substr(-2)
}

// put an action in the queue, if not already there
function put_action(action)
{
    if (action_queue.indexOf(action)==-1)
        action_queue.push(action);
}

// send internal status and set on the bulb
function mystatus_to_bulb(callback) {
    if (status_on) {
        if (status_mode == STATUS_MODE_COLOR) {
            lumen.rgbColor(status_color, callback);
        } else if (status_mode == STATUS_MODE_WHITE)
            lumen.white(status_warm, callback);
        else if (status_mode == STATUS_MODE_DISCO)
            lumen.disco2Mode(callback);
        else if (status_mode == STATUS_MODE_COOL)
            lumen.coolMode(callback);
        else if (status_mode == STATUS_MODE_SOFT) {
            lumen.rgbColor([softmode_r, softmode_g, softmode_b], callback);
        } else {
            console.log("Unknown mode:", status_mode);
            lumen.turnOn(callback);
        }
    } else {
        lumen.turnOff(callback);
    }
}

// called regurarly to perform actions. use action_pending to serialize
function heart_beat()
{
    if (action_queue.length==0 && (status_mode==STATUS_MODE_COLOR || status_mode==STATUS_MODE_SOFT)) {
        // interpolation logic
        tick_interpolation();
        return;
    }

    if (! device_ready || action_pending || action_queue.length==0)
        // nothing to do
        return;

    var action_q = action_queue.pop();
    var action = action_q.code;
    var action_val = action_q.value;
    action_pending = true;

    if (action == ACTION_TURN) {
        if (action_val == "on")
            status_on = true;
        else
            status_on = false;

        mystatus_to_bulb(function () {
            action_pending = false;
        });
    } else if (action == ACTION_COLOR) {
        if (status_mode == STATUS_MODE_COLOR) {
            // perform color interpolation
            interp_start = {r:status_color.r, g:status_color.g, b:status_color.b};
            interp_end = action_val;
            interp_progress = 0.0;
            action_pending = false;
        } else {
            // just set given color
            interp_start = null;
            interp_end = null;
            lumen.rgbColor(action_val, function() {
                status_mode = STATUS_MODE_COLOR;
                status_color.r = action_val.r;
                status_color.g = action_val.g;
                status_color.b = action_val.b;
                action_pending = false;
            });
        }
    } else if (action == ACTION_WHITE) {
        lumen.white(action_val, function () {
            status_mode = STATUS_MODE_WHITE;
            status_warm = action_val;
            action_pending = false;
        });
    } else if (action == ACTION_DISCO) {
        lumen.disco2Mode(function() {
            status_mode = STATUS_MODE_DISCO;
            action_pending = false;
        });
    } else if (action == ACTION_COOL) {
        lumen.coolMode(function() {
            status_mode = STATUS_MODE_COOL;
            action_pending = false;
        });
    } else {
        console.log("Unknown action: "+action);
        action_pending = false;
    }
}

function tick_interpolation() {
    if (interp_end == null && status_mode == STATUS_MODE_SOFT)
        soft_mode_next();

    if (interp_start == null || interp_end == null || action_pending || status_on == false)
        return;

    interp_progress = Math.min(Math.max(0.0, interp_progress + INTERPOLATION_TICK), 1.0);
    var p = interp_progress;
    var rgb = {
        r: interp_start.r * (1-p) + interp_end.r * p,
        g: interp_start.g * (1-p) + interp_end.g * p,
        b: interp_start.b * (1-p) + interp_end.b * p
    };
    //~ console.log("r:" + rgb.r + " g:" + rgb.g + " b:" + rgb.b + " step:" + softmode_step);
    status_color.r = rgb.r;
    status_color.g = rgb.g;
    status_color.b = rgb.b;

    action_pending = true;
    lumen.rgbColor(rgb, function() {
        action_pending = false;

        // end of interpolation
        if (interp_progress == 1.0)
            interp_end = null;
    });
}

function soft_mode_next()
{
    // r -> y -> g -> p -> b -> m -> r
    var MIN = 0.0;
    var MAX = 1.0;

    if (softmode_step == 0 || softmode_step == 7) {
        softmode_step = 1;
        softmode_r = MAX;
    } else if (softmode_step==1) {
        softmode_step = 2;
        softmode_g = MAX;
    } else if (softmode_step==2) {
        softmode_step = 3;
        softmode_r = MIN;
    } else if (softmode_step==3) {
        softmode_step = 4;
        softmode_b = MAX;
    } else if (softmode_step==4) {
        softmode_step = 5;
        softmode_g = MIN;
    } else if (softmode_step==5) {
        softmode_step = 6;
        softmode_r = MAX;
    } else if (softmode_step==6) {
        softmode_step = 7;
        softmode_b = MIN;
    }

    interp_start = {r:status_color.r, g:status_color.g, b:status_color.b};
    interp_end = {r:softmode_r, g:softmode_g, b:softmode_b};
    interp_progress = 0.0;
}

function split_request(request) {
    var path;
    var query;
    var qx = request.indexOf("?");

    if (qx != -1) {
        path = request.slice(0, qx);
        query = request.slice(qx+1);
    } else {
        path = request;
        query = null;
    }

    return {
        path: path,
        query: query
    }
}

// Processa una richiesta http, se possibile, o la accoda in action_queue
function process_request(request)
{
    var parsed = split_request(request);
    var pathname = parsed.path;
    var query = parsed.query;
    var action = null;
    var action_val = null;

    // Query commands
    if (pathname == "") {
        // just to keep alive
        return RESPONSE_ALIVE;
    } else if (pathname == REQUEST_STATUS) {
        if (device_ready == null)
            return REPLY_OFFLINE;
        else
            return REPLY_ONLINE;
    } else if (pathname == REQUEST_ONOFF) {
        if (!device_ready)
            return RESPONSE_OFFLINE;

        if (status_on)
            return REPLY_ON;
        else
            return REPLY_OFF;
    } else if (pathname == REQUEST_COLOR) {
        if (!device_ready)
            return RESPONSE_OFFLINE;

        return rgb_to_xrgb(status_color);
    }

    // Imperative commands
    if (pathname == COMMAND_ON) {
        action = ACTION_TURN;
        action_val = "on"
    } else if (pathname == COMMAND_OFF) {
        action = ACTION_TURN;
        action_val = "off"
    } else if (pathname == COMMAND_COLOR) {
        if (query == null)
            return RESPONSE_ERROR;

        if (query.length != 8 || query.slice(0,2) != "0x")
            return RESPONSE_ERROR;

        action = ACTION_COLOR;
        action_val = xrgb_to_rgb(query);
    } else if (pathname == COMMAND_WHITE) {
        if (query == null)
            return RESPONSE_ERROR;

        var b = parseInt(query) || -1;
        if (b < 0 || b > 100)
            return RESPONSE_ERROR;

        action_val = b;
        action = ACTION_WHITE;
    } else if (pathname == COMMAND_DISCO) {
        action = ACTION_DISCO;
    } else if (pathname == COMMAND_COOL) {
        action = ACTION_COOL;
    } else if (pathname == COMMAND_SOFT) {
        status_mode = STATUS_MODE_SOFT;

        if (device_ready)
            return RESPONSE_OK;
        else
            return RESPONSE_PENDING;
    }

    // Let's see if we can fulfil request now, otherwise enqueue
    if (action != null) {
        var action_q = {code: action, value:action_val};
        put_action(action_q);

        if (device_ready)
            return RESPONSE_OK;
        else
            return RESPONSE_PENDING;
    }
}

// extra formatting
function request_string(req) {
    if (req == "")
        return "{KEEPALIVE}";
    return req;
}

function onRequest(request)
{
    var host = clsock.remoteAddress;
    if (host.indexOf("::ffff:")==0)
        host = host.slice(7, host.length);
    host = host + ":" + clsock.remotePort;

    console.log(" <- " + host + " " + request_string(request));
    var reply = process_request(request);
    if (reply != null) {
        clsock.write(reply + DATA_MARKER);
        console.log(" -> " + host + " " + reply);
    }
}

function onLumenDisconnected() {
    console.log("Lumen disconnected");
    device_ready = false;

    if (lumen != null) {
        lumen.removeListener('disconnect', onLumenDisconnected);
        lumen = null;
    }

    if (clsock != null)
        do_discover();
};

function onClientDisconnected() {
    clearInterval(beat_interval);
    beat_interval = null;
    clsock = null;
    ps_timeout = setTimeout(enterPowerSave, POWER_SAVE_TIMEOUT*1000);
}

function onDiscover(bulb) {
    lumen = bulb;
    console.log("Lumen found: " + lumen.toString());

    lumen.connectAndSetUp(function() {
        console.log('Lumen connected');
        is_discovering = false;

        if (! device_synched) {
            // need to get device current configuration
            lumen.readState(function(state) {
                if (state === null) {
                    mystatus_to_bulb(function() {
                        device_ready = true;
                    });
                    return;
                }

                // fill status_mode variable and related
                if (state.mode == 'color') {
                    status_mode = STATUS_MODE_COLOR;
                    status_color = {r:state.r, g:state.g, b:state.b};
                } else if (state.mode == 'white') {
                    status_mode = STATUS_MODE_WHITE;
                    status_warm = state.percentage;
                } else if (state.mode == 'disco2') {
                    status_mode = STATUS_MODE_DISCO;
                } else if (state.mode == 'cool') {
                    status_mode = STATUS_MODE_COOL;
                }
                status_on = state.on;
                device_synched = true;
                device_ready = true;
                console.log("Initial state: mode=" + status_mode + " r="+status_color.r + " g="+status_color.g + " b="+status_color.b);
            });
        } else {
            // need to set my device configuration
            mystatus_to_bulb(function() {
                device_ready = true;
            });
        }
    });

    lumen.on('disconnect', onLumenDisconnected);
}

function do_discover() {
    // remove power save scheduling
    if (ps_timeout != null) {
        clearTimeout(ps_timeout);
        ps_timeout = null;
    }
    if (is_discovering == false) {
        console.log("Discovering...");
        Lumen.discover(onDiscover);
        is_discovering = true;
    }
}

function enterPowerSave() {
    ps_timeout = null;

    if (lumen != null) {
        lumen.disconnect(function(){
            if (clsock == null) {
                lumen = null;
                console.log("Power save");
            }
        });
    }
}

// Start the server
var server = net.createServer(function (socket) {
    console.log("Client Connected");

    if (clsock != null) {
        console.log("No more clients supported");
        socket.end();
        return;
    }

    clsock = socket;
    clsock.setEncoding('utf8');
    clsock.setTimeout(KEEP_ALIVE_LIMIT*1000);
    clsock.on('data', function (data) {
        // join previous pending data
        var pending = partial + data.toString();
        var k;

        do {
            k = pending.indexOf(DATA_MARKER);
            if (k != -1) {
                var req = pending.substr(0, k);
                onRequest(req);
                pending = pending.substr(k+DATA_MARKER.length);
            }
        }while (k != -1);

        // save remaining data
        partial = pending;
    });
    clsock.on('close', function () {
        console.log("Client disconnected");
        onClientDisconnected();
    });
    clsock.on('error', function (err) {
        console.log("Client error: " + err);
    });
    clsock.on('timeout', function (err) {
        console.log("Client timeout");
        clsock.destroy();
        onClientDisconnected();
    });

    beat_interval = setInterval(heart_beat, CONSUME_INTERVAL);
    if (lumen == null)
        do_discover();
});
server.on('listening', function () {
    console.log("Listening on port " + SERVER_PORT);
});
server.listen(SERVER_PORT);
