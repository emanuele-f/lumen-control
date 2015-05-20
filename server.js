/*
 * Emanuele Faranda     18/05/2015
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

var http = require("http");
var util = require("util");
var url = require("url");
var Lumen = require("lumen");

var SERVER_PORT = 7878;
var DEVICE_NO = null;
var AUTOMODE = false;
var STATUS_ON = false;
var STATUS_COLOR = null;
var DEVICE_READY = false;
var STATE_SYNC = false;
var ACTION_QUEUE = [];

var DEVICE_STATUS_OFFLINE = "offline";
var DEVICE_STATUS_ONLINE = "online";
var DEVICE_STATUS_AUTO = "auto-mode";
var DEVICE_IS_ON = "on";
var DEVICE_IS_OFF = "off";

var RESPONSE_OK = "OK";
var RESPONSE_PENDING = "PENDING";
var RESPONSE_ERROR = "BAD REQUEST";
var RESPONSE_OFFLINE = "OFFLINE";

// groups compatible actions -> performs only the last one
var ACTION_TURN = 1;
var ACTION_COLOR = 2;
var ACTION_TURN_V;
var ACTION_COLOR_V = null;

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
 *  /color : 0xrrggbbww | RESPONSE_OFFLINE
 * 
 *  [write] : OK | PENDING | RESPONSE_ERROR
 *  /on
 *  /off
 *  /reset
 *  /rgb?0xrrggbb
 * 
 *  [debug]
 *  /getpending : (int)
 */
 
function perform_action(action)
{
    if (action == ACTION_TURN) {
        if (ACTION_TURN_V == "on")
            lumen.turnOn(function () {
                STATUS_ON = true;
            });
        else 
            lumen.turnOff(function () {
                STATUS_ON = false;
            });
    } else if (action == ACTION_COLOR) {
        cmyw = rgb_to_cmyw(ACTION_COLOR_V);
        //~ console.log("C:"+cmyw.c + " M:"+cmyw.m + " Y:"+cmyw.y + " W:"+cmyw.w);
        lumen.color(cmyw.c, cmyw.m, cmyw.y, cmyw.w, function () {
            STATUS_COLOR = ACTION_COLOR_V;
        });
    }
}

// Processa le azioni pendenti, chiamando perform_action
function process_action_queue()
{
    while (ACTION_QUEUE.length > 0) {
        var action = ACTION_QUEUE.pop();
        perform_action(action);
    }
}

// Processa una richiesta http, se possibile, o la accoda in ACTION_QUEUE
function process_request(request)
{
    var parsed = url.parse(request.url);
    var pathname = parsed.pathname;
    var action = null;
    
    // Query commands
    if (pathname == "/status") {
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
        if (parsed.search == null)
            return RESPONSE_ERROR;
            
        var hex = parsed.search.slice(1, parsed.search.length);
        if (hex.length != 8 || hex.slice(0,2) != "0x")
            return RESPONSE_ERROR;
        
        ACTION_COLOR_V = xrgb_to_rgb(hex);
        //~ console.log("R:"+ACTION_COLOR_V.r + " G:"+ACTION_COLOR_V.g + " B:"+ACTION_COLOR_V.b);
        action = ACTION_COLOR;
    }
    
    // Let's see if we can fulfil request now, otherwise enqueue
    if (action != null)
        if (DEVICE_READY) {
            perform_action(action);
            return RESPONSE_OK;
        } else {
            if (ACTION_QUEUE.indexOf(action)==-1)
                ACTION_QUEUE.push(action);
            return RESPONSE_PENDING;
        }
}

function onRequest(request, response)
{
    var host = request.connection.remoteAddress;
    if (host.indexOf("::ffff:")==0)
        host = host.slice(7, host.length);
    host = host + ":" + request.connection.remotePort;
    
    console.log(host + " >> " + request.url);
    var body = process_request(request);
    if (body != null) {
        response.writeHead(200, {"Content-Type":"text/html"});
        response.write(body);
        console.log(host + " << " + body);
    }
    response.end();
}

var server = http.createServer(onRequest).listen(SERVER_PORT);
console.log("Server started on port " + SERVER_PORT);
var lumen = null;

Lumen.discover(function(lume) {
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
                        
                        // perform pending actions
                        process_action_queue();
                    });//});
                });
            });
        });
    });
    lumen.on('disconnect', function() {
        console.log("disconnected");
        DEVICE_READY = false;
    });
});
