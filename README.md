# lumen-control
Detatched server and clients to control Tabu Lumen device

![Android screenshot](https://cloud.githubusercontent.com/assets/5488003/7778002/bff5c71a-00c7-11e5-8566-a47ddaa15798.png)

Lumen devices use Bluetooth LE adapters and protocol to communicate with smartphones.
Old phone devices don't have bluetooth 4.0 hardware, so the control application which is shipped with the lumen is not
available for use.

This project builds a server-client infrastructure to enable remote controlling on your lumen through a network.
You'll only need:
- a pc with required nodejs framework and additional modules
- a standard (usb) bluetooth LE adapter

The server is implemented in nodejs. Right now, the only available client is an Android application.
Please note that the application is configured to connect to my own server. You will need to setup your own configuration.

Features
--------

- Access your Tabu Lumen from Internet, wherever you are
- Fade from one color to another, see "soft" mode (sperimental)
- Support for the lumen modes: color, white, disco, cool colors (blue-magenta)

Server setup
------------
- install nodejs
- install libbluetooth-dev (required by [noble](https://github.com/sandeepmistry/noble) dependency; also ensure to have linux version 3.6 or above)

Enter lumen-control/server directory and

- install dependency modules: `npm install`
- create and edit a custom configuration: `cp config/default.json config/local.json`
- run the server: `node start`
