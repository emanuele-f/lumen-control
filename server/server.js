var net = require('net');
var Controller = require('./controller');

// :: constraints ::
var SERVER_PORT = 7878;
var DATA_MARKER = "$";
var KEEP_ALIVE_LIMIT = 10;              // seconds

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

function Server(controller) {
    this._socket = null;
    this._client = null;                     // client socket - null if disconnected
    this._partial = "";                      // holds partial responses
    this._controller = controller;
};

Server.prototype.start = function() {
    this._socket = net.createServer(this._onClientConnection.bind(this));
    this._socket.on('listening', function () {
        console.log("Listening on port " + SERVER_PORT);
    });
    this._socket.listen(SERVER_PORT);
};

Server.prototype._splitRequest = function (request) {
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
};

Server.prototype._formatColorResponse = function (rgb) {
    return "0x" +
            ("00" + parseInt(rgb[0] * 255).toString(16)).substr(-2) +
            ("00" + parseInt(rgb[1] * 255).toString(16)).substr(-2) +
            ("00" + parseInt(rgb[2] * 255).toString(16)).substr(-2)
};

Server.prototype._parseColorParam = function (hexstr) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexstr.substr(2));
    return result ? [
        parseInt(result[1], 16) / 255.,
        parseInt(result[2], 16) / 255.,
        parseInt(result[3], 16) / 255.,
    ] : null;
};

Server.prototype._processRequest = function (request) {
    var parsed = this._splitRequest(request);
    var pathname = parsed.path;
    var query = parsed.query;
    var action = null;
    var action_val = null;
    var pending = false;

    // Query commands
    if (pathname === "") {
        // just to keep alive
        return RESPONSE_ALIVE;
    } else if (pathname === REQUEST_STATUS) {
        if (this._controller.ready)
            return REPLY_ONLINE;
        else
            return REPLY_OFFLINE;
    } else if (pathname === REQUEST_ONOFF) {
        if (! this._controller.ready)
            return RESPONSE_OFFLINE;

        if (this._controller.lighton)
            return REPLY_ON;
        else
            return REPLY_OFF;
    } else if (pathname === REQUEST_COLOR) {
        if (! this._controller.ready)
            return RESPONSE_OFFLINE;

        return this._formatColorResponse(this._controller.color);
    }

    // Imperative commands
    if (pathname === COMMAND_ON) {
        pending = this._controller.command(Controller.Commands.TURN_ON);
    } else if (pathname === COMMAND_OFF) {
        pending = this._controller.command(Controller.Commands.TURN_OFF);
    } else if (pathname === COMMAND_COLOR) {
        if (query === null)
            return RESPONSE_ERROR;

        if (query.length != 8 || query.slice(0,2) != "0x")
            return RESPONSE_ERROR;

        var color = this._parseColorParam(query);
        if (! color)
            return RESPONSE_ERROR;

        pending = this._controller.command(Controller.Commands.COLOR, color);
    } else if (pathname === COMMAND_WHITE) {
        if (query === null)
            return RESPONSE_ERROR;

        var white = parseInt(query);
        if (white < 0 || white > 100)
            return RESPONSE_ERROR;

        pending = this._controller.command(Controller.Commands.WHITE, white/100.);
    } else if (pathname === COMMAND_DISCO) {
        pending = this._controller.command(Controller.Commands.DISCO);
    } else if (pathname === COMMAND_COOL) {
        pending = this._controller.command(Controller.Commands.COOL);
    } else if (pathname === COMMAND_SOFT) {
        pending = this._controller.command(Controller.Commands.SOFT);
    }

    if (pending)
        return RESPONSE_PENDING;
    else
        return RESPONSE_OK;
}

Server.prototype._onRequest = function (request) {
    if (! this._client)
        // client disconnected, it is no more valid
        return;

    var host = this._client.remoteAddress;

    if (host.indexOf("::ffff:")===0)
        host = host.slice(7, host.length);
    host = host + ":" + this._client.remotePort;

    // request formatting
    var s;
    if (! request)
        s = "{KEEPALIVE}";
    else
        s = request;

    console.log(" <- " + host + " " + s);
    var reply = this._processRequest(request);
    if (reply != null) {
        this._client.write(reply + DATA_MARKER);
        console.log(" -> " + host + " " + reply);
    }
};

Server.prototype._onClientData = function (data) {
    // join previous pending data
    var pending = this._partial + data.toString();
    var k;

    do {
        k = pending.indexOf(DATA_MARKER);
        if (k != -1) {
            var req = pending.substr(0, k);
            this._onRequest(req);
            pending = pending.substr(k+DATA_MARKER.length);
        }
    }while (k != -1);

    // save remaining data
    this._partial = pending;
};

Server.prototype._onClientConnection = function (socket) {
    console.log("Client Connected");

    if (this._client != null) {
        console.log("No more clients supported");
        socket.end();
        return;
    }

    this._client = socket;
    this._client.setEncoding('utf8');
    this._client.setTimeout(KEEP_ALIVE_LIMIT * 1000);
    this._client.on('data', this._onClientData.bind(this));
    this._client.on('close', this._onClientDisconnected.bind(this));
    this._client.on('error', function (err) {
        console.log("Client error: " + err);
        // close event is sent right after this
    }.bind(this));
    this._client.on('timeout', function (err) {
        console.log("Client timeout");
        this._onClientDisconnected();
    }.bind(this));

    this._controller.connect();
};

Server.prototype._onClientDisconnected = function() {
    if (this._client) {
        console.log("Client disconnected");
        this._client.destroy();
        this._client = null;
    }
};

module.exports = {
    'Server': Server,
};
