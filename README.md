# lumen-control
A nodejs server and an Android client to control the Tabu Lumen device

![Android screenshot](https://cloud.githubusercontent.com/assets/5488003/7778002/bff5c71a-00c7-11e5-8566-a47ddaa15798.png)

This project builds a server-client infrastructure to enable remote controlling on your lumen through a network.
You'll only need:
- a raspberry/pc with nodejs framework
- a standard (usb) bluetooth LE adapter

There are two backends available:
- The HTTP backend one can be used with the app provided within this project to control the light.
  Please note that the application is configured to connect to my own server. You will need to setup your own configuration.
- The MQTT backend can be used to integrate the light with home assistant. See below for details.
  This ships with a simpler and improved light controller to overcome most connection troubles of the HTTP one.
  The patch `server/noble_disconnect.patch` must be applied to noble in order to properly handle disconnections.
  See [upstream issue](https://github.com/sandeepmistry/noble/issues/229) for details.

The `server_mode` option in the configuration file defines which backend to use.

Features
--------

- Access your Tabu Lumen from Internet, wherever you are
- Fade from one color to another (enable this via `interpolation.in_color_mode` configuration option)
- Support for the lumen modes: color, white, disco, cool colors (blue-magenta)
- Home Assistant [MQTT light](https://home-assistant.io/components/light.mqtt/) integration

Server setup
------------
- install nodejs
- install libbluetooth-dev (required by [noble](https://github.com/sandeepmistry/noble) dependency; also ensure to have linux version 3.6 or above)

Enter lumen-control/server directory and

- install dependency modules: `npm install`
- create a custom configuration file: `cp config/default.json config/local.json`
- run the server: `npm start`

Home Assistant
--------------
[home assistant](https://home-assistant.io/) integration is now available!
Add the following snipped to your `configuration.yaml`:

```
light:
  platform: mqtt
  name: "Tabu Lumen"
  command_topic: "home/light/lumen/1/power"
  state_topic: "home/light/lumen/1/power/stat"
  white_value_command_topic: "home/light/lumen/1/white"
  white_value_state_topic: "home/light/lumen/1/white/stat"
  rgb_command_topic: "home/light/lumen/1/rgb"
  rgb_state_topic: "home/light/lumen/1/rgb/stat"
  effect_command_topic: "home/light/lumen/1/effect"
  effect_list: ["Cool", "Soft", "Disco"]
  effect_state_topic: "home/light/lumen/1/effect/stat"
  payload_on: "ON"
  payload_off: "OFF"
  qos: 0
```
