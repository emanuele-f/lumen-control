/*
 * Emanuele Faranda     18/05/2015
 * 
 * USES UTF-8
 * 
 *  cmyk (standard):
 *      .c: 0.0-1.0 : cyan level
 *      .m: 0.0-1.0 : magenta level
 *      .y: 0.0-1.0 : yellow level
 *      .k: 0.0-1.0 : key black
 * 
 *  cmyw (for use in lumen module interface, w=1-k)
 *      .c: 0.0-1.0 : cyan level
 *      .m: 0.0-1.0 : magenta level
 *      .y: 0.0-1.0 : yellow level
 *      .w: 0.0-1.0 : key white
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
 *      xrgb <-> rgb <-> cmyw
 */
 
// :: modules ::
var net = require('net');
var Lumen = require("/home/emanuele/src/node-lumen/index.js");

// :: server constraints ::
var CONSUME_INTERVAL = 10;              // milliseconds
var SERVER_PORT = 7878;
var DATA_MARKER = "$";
var KEEP_ALIVE_LIMIT = 10;              // seconds
var INTERPOLATION_TICK = 0.1;           // 0-1 / CONSUME_INTERVAL

// :: status modes ::
var STATUS_MODE_WARM = "warm";
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
var COMMAND_WARM = "/warm";
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
var ACTION_WARM = 3;
var ACTION_DISCO = 4;
var ACTION_COOL = 5;

// :: bulb internal state clone ::
var status_mode = STATUS_MODE_WARM;
var status_on = true;
var status_color = null;
var status_warm = null;

// :: bulb connection status ::
var device_ready = false;               // can be true after synch, not before
var device_synched = false;             // if true, then status_* variables are synched with bulb

// :: internals ::
var clsock = null;                      // client socket - null if disconnected
var lumen = null;                       // holds connected buld interface - null if disconnected
var partial = "";                       // holds partial responses
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

function rgb_to_cmyw(rgb) {
    var k = Math.min(1-rgb.r, 1-rgb.g, 1-rgb.b);
    
    return {
        c: (1-rgb.r-k) / (1-k) || 0,
        m: (1-rgb.g-k) / (1-k) || 0,
        y: (1-rgb.b-k) / (1-k) || 0,
        w: 1-k
    };
}

function cmyw_to_rgb(cmyw)
{
    var k = 1-cmyw.w;
    return {
        r: 1 - Math.min(1, cmyw.c * (1 - k) + k),
        g: 1 - Math.min(1, cmyw.m * (1 - k) + k),
        b: 1 - Math.min(1, cmyw.y * (1 - k) + k)
    };
}

function rgb_to_99(color)
{
    return [color.r*99, color.g*99, color.b*99]
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
            lumen.rgbColor(rgb_to_99(status_color), callback);
        } else if (status_mode == STATUS_MODE_WARM)
            lumen.warmWhite(status_warm, callback);
        else if (status_mode == STATUS_MODE_DISCO)
            lumen.disco2Mode(callback);
        else if (status_mode == STATUS_MODE_COOL)
            lumen.coolMode(callback);
        else if (status_mode == STATUS_MODE_SOFT) {
            cmyw = rgb_to_cmyw({r:softmode_r, g:softmode_g, b:softmode_b});
            lumen.color(cmyw.c, cmyw.m, cmyw.y, cmyw.w, callback);
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
            lumen.rgbColor(rgb_to_99(action_val), function() {
                status_mode = STATUS_MODE_COLOR;
                status_color.r = action_val.r;
                status_color.g = action_val.g;
                status_color.b = action_val.b;
                action_pending = false;
            });
        }
    } else if (action == ACTION_WARM) {
        lumen.warmWhite(action_val, function () {
            status_mode = STATUS_MODE_WARM;
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
    lumen.rgbColor(rgb_to_99(rgb), function() {
        action_pending = false;
        
        // end of interpolation
        if (interp_progress == 1.0)
            interp_end = null;
    });
}

function soft_mode_next()
{
    // r -> y -> g -> p -> b -> m -> r
    var MIN = 0;
    var MAX = 99;
    
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
    interp_end = {r:softmode_r/99., g:softmode_g/99., b:softmode_b/99.};
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
    } else if (pathname == COMMAND_WARM) {
        if (query == null)
            return RESPONSE_ERROR;
            
        var b = parseInt(query) || -1;
        if (b < 0 || b > 100)
            return RESPONSE_ERROR;
            
        action_val = b;
        action = ACTION_WARM;
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

function onDiscover(bulb) {
    lumen = bulb;
    console.log("Lumen found: " + lumen.toString());
    
    bulb.connect(function () {});
    
    bulb.on('connect', function() {
        console.log('connected!');
        bulb.discoverServicesAndCharacteristics(function(){
            bulb.setup(function() {
                if (! device_synched)
                    // need to get device current configuration
                    bulb.readState(function(state) {
                        // fill status_mode variable and related
                        if (state.mode == 'color') {
                            // TODO use decrypted rgb
                            cmyw = {
                                c: state.colorC,
                                m: state.colorM,
                                y: state.colorY,
                                w: state.colorW
                            }
                            //~ console.log("c="+cmyw.c + " m="+cmyw.m + " y="+cmyw.y + " w:"+cmyw.w);
                            status_mode = STATUS_MODE_COLOR;
                            status_color = cmyw_to_rgb(cmyw);
                        } else if (state.mode == 'warmWhite') {
                            status_mode = STATUS_MODE_WARM;
                            status_warm = state.warmWhitePercentage;
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
                else {
                    // need to set my device configuration
                    mystatus_to_bulb(function() {
                        device_ready = true;
                    });
                }
            });
        });
    });
    bulb.on('disconnect', function() {
        console.log("disconnected");
        device_ready = false;
        lumen = null;
        // TODO reconnect in someway, not this
        Lumen.discover(onDiscover);
    });
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
        clsock = null;
    });
    clsock.on('error', function (err) {
        console.log("Client error: " + err);
        clsock = null;
    });
    clsock.on('timeout', function (err) {
        console.log("Client timeout");
        clsock.destroy();
        clsock = null;
    });
});
server.on('listening', function () {
    console.log("Listening on port " + SERVER_PORT);
});
server.listen(SERVER_PORT);
setInterval(heart_beat, CONSUME_INTERVAL);
Lumen.discover(onDiscover);
