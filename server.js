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

var net = require('net');
var Lumen = require("lumen");

var CONSUME_DELAY = 10;
var SERVER_PORT = 7878;
var DATA_MARKER = "$";
var KEEP_ALIVE_LIMIT = 10; // seconds

var DEVICE_NO = null;
var AUTOMODE = false;
var STATUS_ON = false;
var STATUS_COLOR = null;
var STATUS_WARM = null;
var DEVICE_READY = false;
var STATE_SYNC = false;
var ACTION_QUEUE = [];
var ACTPEND = false;

var DEVICE_STATUS_OFFLINE = "offline";
var DEVICE_STATUS_ONLINE = "online";
var DEVICE_STATUS_AUTO = "auto-mode";
var DEVICE_IS_ON = "on";
var DEVICE_IS_OFF = "off";

var RESPONSE_OK = "OK";
var RESPONSE_PENDING = "PENDING";
var RESPONSE_ERROR = "BAD REQUEST";
var RESPONSE_OFFLINE = "OFFLINE";
var RESPONSE_ALIVE = "+";

// groups compatible actions -> performs only the last one
var ACTION_TURN = 1;
var ACTION_COLOR = 2;
var ACTION_WARM = 3;
var ACTION_TURN_V;
var ACTION_COLOR_V = null;
var ACTION_WARM_V = null

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

/*
 *  [read]
 *  /status : online | offline | auto-mode
 *  /ison : on | off | RESPONSE_OFFLINE
 *  /color : 0xrrggbb| RESPONSE_OFFLINE
 * 
 *  [write] : OK | PENDING | RESPONSE_ERROR
 *  /on
 *  /off
 *  /reset
 *  /rgb?0xrrggbb
 *  /warm?0-100
 * 
 *  [debug]
 *  /getpending : (int)
 */

// put an action in the queue, if not already there
function put_action(action)
{
    if (ACTION_QUEUE.indexOf(action)==-1)
        ACTION_QUEUE.push(action);
}

// called regurarly to perform actions. use ACTPEND to serialize
function action_consumer()
{
    if (! DEVICE_READY || ACTPEND || ACTION_QUEUE.length==0)
        // nothing to do
        return;
    
    var action = ACTION_QUEUE.pop();
    ACTPEND = true;
    
    if (action == ACTION_TURN) {
        if (ACTION_TURN_V == "on")
            lumen.turnOn(function () {
                STATUS_ON = true;
                ACTPEND = false;
            });
        else 
            lumen.turnOff(function () {
                STATUS_ON = false;
                ACTPEND = false;
            });
    } else if (action == ACTION_COLOR) {
        cmyw = rgb_to_cmyw(ACTION_COLOR_V);
        //~ console.log("C:"+cmyw.c + " M:"+cmyw.m + " Y:"+cmyw.y + " W:"+cmyw.w);
        lumen.color(cmyw.c, cmyw.m, cmyw.y, cmyw.w, function () {
            STATUS_COLOR = ACTION_COLOR_V;
            ACTPEND = false;
        });
    } else if (action == ACTION_WARM) {
        lumen.warmWhite(ACTION_WARM_V, function () {
            STATUS_WARM = ACTION_WARM_V;
            ACTPEND = false;
        });
    } else {
        console.log("Unknown action: "+action);
        ACTPEND = false;
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

// Processa una richiesta http, se possibile, o la accoda in ACTION_QUEUE
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
    } else if (pathname == "/status") {
        if (DEVICE_READY == null) {
            return DEVICE_STATUS_OFFLINE;
        } else {
            if (AUTOMODE)
                return DEVICE_STATUS_AUTO;
            else
                return DEVICE_STATUS_ONLINE;
        }
    } else if (pathname == "/ison") {
        if (!DEVICE_READY && !STATE_SYNC)
            return RESPONSE_OFFLINE;
        
        if (STATUS_ON)
            return DEVICE_IS_ON;
        else
            return DEVICE_IS_OFF;
    } else if (pathname == "/getpending") {
        return String(ACTION_QUEUE.length);
    } else if (pathname == "/color") {
        if (!DEVICE_READY && !STATE_SYNC)
            return RESPONSE_OFFLINE;
            
        return rgb_to_xrgb(STATUS_COLOR);
    }
    
    // Imperative commands
    if (pathname == "/on") {
        action = ACTION_TURN;
        ACTION_TURN_V = "on"
    } else if (pathname == "/off") {
        action = ACTION_TURN;
        ACTION_TURN_V = "off"
    } else if (pathname == "/reset") {
        // empty the queue
        ACTION_QUEUE = [];
    } else if (pathname == "/rgb") {
        if (query == null)
            return RESPONSE_ERROR;
            
        if (query.length != 8 || query.slice(0,2) != "0x")
            return RESPONSE_ERROR;
        
        ACTION_COLOR_V = xrgb_to_rgb(query);
        //~ console.log("R:"+ACTION_COLOR_V.r + " G:"+ACTION_COLOR_V.g + " B:"+ACTION_COLOR_V.b);
        action = ACTION_COLOR;
    } else if (pathname == "/warm") {
        if (query == null)
            return RESPONSE_ERROR;
            
        var b = parseInt(query) || -1;
        if (b < 0 || b > 100)
            return RESPONSE_ERROR;
            
        ACTION_WARM_V = b;
        action = ACTION_WARM;
    }
    
    // Let's see if we can fulfil request now, otherwise enqueue
    if (action != null) {
        put_action(action);
        
        if (DEVICE_READY)
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
                lumen.readSerialNumber(function(serialNumber) {
                    console.log('\tserial number = ' + serialNumber);
                    DEVICE_NO = serialNumber;
                    //~ lumen.normalMode(function() {

                    lumen.readState(function(state) {
                        console.log("initial state read, device is ready!");
                        cmyw = {
                            c: state.colorC,
                            m: state.colorM,
                            y: state.colorY,
                            w: state.colorW
                        }
                        STATUS_COLOR = cmyw_to_rgb(cmyw);
                        console.log("C:"+cmyw.c + " M:"+cmyw.m + " Y:"+cmyw.y + " W:"+cmyw.w);
                        console.log("R:"+STATUS_COLOR.r + " G:"+STATUS_COLOR.g + " B:"+STATUS_COLOR.b);
                        STATUS_ON = state.on;
                        DEVICE_READY = true;
                        STATE_SYNC = true;
                    });//});
                });
            });
        });
    });
    lumen.on('disconnect', function() {
        console.log("disconnected");
        DEVICE_READY = false;
        Lumen.discover(onDiscover);
    });
}

// GLOBALS
var clsock = null;
var lumen = null;
var partial = "";

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
