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
var Lumen = require("lumen");

// :: server constraints ::
var CONSUME_DELAY = 10;
var SERVER_PORT = 7878;
var DATA_MARKER = "$";
var KEEP_ALIVE_LIMIT = 10;              // seconds

// :: status modes ::
var STATUS_MODE_WARM = "warm";
var STATUS_MODE_COLOR = "color";
var STATUS_MODE_DISCO = "disco";
var STATUS_MODE_SOFT = "soft";          // TODO implement soft color change

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

// :: bulb internal state clone ::
var status_mode = STATUS_MODE_WARM;
var status_on = true;
var status_color = null;
var status_warm = null;

// :: bulb connection status ::
var device_ready = false;
var device_synched = false;             // if true, then status_* variables are synched with bulb

// :: internals ::
var clsock = null;                      // client socket - null if disconnected
var lumen = null;                       // holds connected buld interface - null if disconnected
var partial = "";                       // holds partial responses
// internal request state: ensure only one applies
var action_queue = [];
var action_pending = false;
var action_color_val;
var action_warm_val;
var action_turn_val;

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
    return "0x" + ("00" + rgb.r.toString(16)).substr(-2) +
            ("00" + rgb.g.toString(16)).substr(-2) +
            ("00" + rgb.b.toString(16)).substr(-2)
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
        r: (1-cmyw.c) * (1-k),
        g: (1-cmyw.m) * (1-k),
        b: (1-cmyw.y) * (1-k)
    };
}

// put an action in the queue, if not already there
function put_action(action)
{
    if (action_queue.indexOf(action)==-1)
        action_queue.push(action);
}

function _pending_done () {
    action_pending = false;
}

// called regurarly to perform actions. use action_pending to serialize
function action_consumer()
{
    if (! device_ready || action_pending || action_queue.length==0)
        // nothing to do
        return;
    
    var action = action_queue.pop();
    action_pending = true;
    
    if (action == ACTION_TURN) {
        if (action_turn_val == "on") {
            status_on = true;
            
            // decide what "on" means
            if (status_mode == STATUS_MODE_COLOR) {
                cmyw = rgb_to_cmyw(action_color_val);
                lumen.color(cmyw.c, cmyw.m, cmyw.y, cmyw.w, _pending_done);
            } else if (status_mode == STATUS_MODE_WARM)
                lumen.warmWhite(action_warm_val, _pending_done);
            else if (status_mode == STATUS_MODE_DISCO)
                lumen.disco2Mode(_pending_done);
            //else if (status_mode == STATUS_MODE_SOFT) TODO
            else {
                console.log("Unknown mode:", status_mode);
                lumen.turnOn(_pending_done);
            }
        } else  {
            lumen.turnOff(function () {
                status_on = false;
                action_pending = false;
            });
        }
    } else if (action == ACTION_COLOR) {
        cmyw = rgb_to_cmyw(action_color_val);
        //~ console.log("C:"+cmyw.c + " M:"+cmyw.m + " Y:"+cmyw.y + " W:"+cmyw.w);
        lumen.color(cmyw.c, cmyw.m, cmyw.y, cmyw.w, function () {
            status_mode = STATUS_MODE_COLOR;
            status_color.r = action_color_val.r;
            status_color.g = action_color_val.g;
            status_color.b = action_color_val.b;
            action_pending = false;
        });
    } else if (action == ACTION_WARM) {
        lumen.warmWhite(action_warm_val, function () {
            status_mode = STATUS_MODE_WARM;
            status_warm = action_warm_val;
            action_pending = false;
        });
    } else if (action == ACTION_DISCO) {
        lumen.disco2Mode(function() {
            status_mode = STATUS_MODE_DISCO;
            action_pending = false;
        });
    } else {
        console.log("Unknown action: "+action);
        action_pending = false;
    }
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
        if (!device_ready && !device_synched)
            return RESPONSE_OFFLINE;
        
        if (status_on)
            return REPLY_ON;
        else
            return REPLY_OFF;
    } else if (pathname == REQUEST_COLOR) {
        if (!device_ready && !device_synched)
            return RESPONSE_OFFLINE;
            
        return rgb_to_xrgb(status_color);
    }
    
    // Imperative commands
    if (pathname == COMMAND_ON) {
        action = ACTION_TURN;
        action_turn_val = "on"
    } else if (pathname == COMMAND_OFF) {
        action = ACTION_TURN;
        action_turn_val = "off"
    } else if (pathname == COMMAND_COLOR) {
        if (query == null)
            return RESPONSE_ERROR;
            
        if (query.length != 8 || query.slice(0,2) != "0x")
            return RESPONSE_ERROR;
        
        action_color_val = xrgb_to_rgb(query);
        //~ console.log("R:"+action_color_val.r + " G:"+action_color_val.g + " B:"+action_color_val.b);
        action = ACTION_COLOR;
    } else if (pathname == COMMAND_WARM) {
        if (query == null)
            return RESPONSE_ERROR;
            
        var b = parseInt(query) || -1;
        if (b < 0 || b > 100)
            return RESPONSE_ERROR;
            
        action_warm_val = b;
        action = ACTION_WARM;
    } else if (pathname == COMMAND_DISCO) {
        action = ACTION_DISCO;
    }
    
    // Let's see if we can fulfil request now, otherwise enqueue
    if (action != null) {
        put_action(action);
        
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

function onDiscover(lume) {
    lumen = lume;
    console.log("Lumen found: " + lumen.toString());
    
    lumen.connect(function () {});
    
    lumen.on('connect', function() {
        console.log('connected!');
        lumen.discoverServicesAndCharacteristics(function(){
            lumen.setup(function() {
                if (! device_synched)
                    // need to get device current configuration
                    lumen.readState(function(state) {
                        // fill status_mode variable and related
                        if (state.mode == 'color') {
                            cmyw = {
                                c: state.colorC,
                                m: state.colorM,
                                y: state.colorY,
                                w: state.colorW
                            }
                            status_mode = STATUS_MODE_COLOR;
                            status_color = cmyw_to_rgb(cmyw);
                        } else if (state.mode == 'warmWhite') {
                            status_mode = STATUS_MODE_WARM;
                            status_warm = state.warmWhitePercentage;
                        } else if (state.mode == 'disco2') {
                            status_mode = STATUS_MODE_DISCO;
                        }
                        status_on = state.on;
                        device_synched = true;
                        device_ready = true;
                        console.log("Initial state: r="+status_color.r + " g="+status_color.g + " b="+status_color.b);
                    });
                else
                    device_ready = true;
            });
        });
    });
    lumen.on('disconnect', function() {
        console.log("disconnected");
        device_ready = false;
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
setInterval(action_consumer, CONSUME_DELAY);
Lumen.discover(onDiscover);
