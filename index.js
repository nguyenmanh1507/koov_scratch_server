/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 *
 * Copyright (c) 2017 Sony Global Education, Inc.
 * 
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy,
 * modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
 * BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
 * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

"use strict";

let debug = require('debug')('koov_scratch_server');
const async = require('async');

const { scratch3_sprite, scratch3_translate } = require('./scr3conv.js');

const device_proxy = require('device_proxy');
const ipc = { request: {}, reply: {} };
const opts = {
  sender: (to, what) => { return ipc.request[to](to, what); },
  listener: (to, cb) => {
    ipc.reply[to] = (event, arg) => { return cb(arg); };
  }
};

const device = device_proxy.client(opts);
const koovdev_action = require('koovdev_action').action({
  device: device
});

const koovdev_device = require('koovdev_device');
const serialport = require('serialport');
const koovble = require('koovble').KoovBle;
const server = device_proxy.server({
  listener: (from, handler) => {
    ipc.request[from] = (event, arg) => {
      return handler((to, what) => {
        return ipc.reply[to](to, what);
      }, arg);
    };
  },
  device: koovdev_device.device({
    serialport: serialport,
    ble: koovble
  })
});

let selected_device = null;
const device_select = (done) => {
  device.list((list) => {
    debug(list);
//    const uuid = '33c493e7cced46f89b48fc1db7ae8157';
//    const uuid = '8d8c74220dd946fdb817c8d8df509897';
//    const uuid = '87eda7a823dd4ae78fe8daa72d5ea89b';
    const dev = list.find(x => x.type === 'usb');
//    const dev = list.find(x => x.uuid === uuid);
    if (!dev)
      return done('no device');
    selected_device = dev;
    return done(null, dev);
  });
};


const start_server = () => {
  const fs = require('fs');
  const url = require('url');
  const app = (() => {
    const https = false;
    if (https) {
      const options = {
        key: fs.readFileSync('key.pem'),
        cert: fs.readFileSync('cert.pem')
      };
      return require('https').createServer(options, handler);
    } else {
      return require('http').createServer(handler);
    }
  })();
  const io = require('socket.io')(app);

  app.listen(3030);

  var devices = [];
  function handler (req, res) {
    var { pathname, query } = url.parse(req.url, true);
    debug('pathname: ', pathname);
    debug('query: ', query);
    if (pathname === '/koov/list') {
      debug('call device_select');
      return device.device_scan(() => {
        device.list((devs) => {
          debug('found devices', devs);
          devices = devs;
          const data = devs.map(x => {
            return {
              connected: false,
              id: x.id,
              name: x.name
            };
          });

          debug('response data', data);
          res.setHeader('Access-Control-Allow-Origin',
                        req.headers.origin || '*');
          res.setHeader('Access-Control-Request-Method', '*');
          res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
          res.setHeader('Access-Control-Allow-Headers', '*');
          res.writeHead(200);
          return res.end(JSON.stringify(data));
        });
      });
    } else {
      res.writeHead(500);
      return res.end('Error unexpected request');
    }
  }

  io.on('connection', function (client) {
    debug('connection');
    client.on('open', (x) => {
      debug('open', x);
    });
  });

  const koov_handler = (client) => {
    debug('koov: connection');
    let device_ready = false;
    client.on('open', (x) => {
      debug('koov: open', x);

      const device = devices.find(dev => dev.id === x.deviceId);
      if (!device) {
        device_ready = false;
        client.disconnect(true);
        return;
      }

      return koovdev_action.open(device, (err) => {
        debug('open result', err);
        if (err) {
          device_ready = false;
          client.disconnect(true);
        } else {
          device_ready = true;
          client.emit('deviceWasOpened');
        }
      });
    });

    const device_close = (msg) => {
      debug(`${msg}`);
      koovdev_action.close((err) => {
        debug(`${msg}: device closed`, err);
        device_ready = false;
      });
    };
    client.on('disconnect', () => device_close('koov: disconnected'));
    client.on('error', () => device_close('koov: error'));

    client.on('turn-led', (x) => {
      debug('koov: turn-led', x);
      koovdev_action.action.action({
        name: 'turn-led', port: x.PORT, mode: x.MODE
      }, null, (v) => {
        debug(`error => `, v);
      });
    });

    client.on('light-sensor-value', (x, fn) => {
      debug('koov: light-sensor-value', x);
      koovdev_action.action.action({
        name: 'light-sensor-value', port: x.PORT
      }, null, (v) => {
        debug(`error => `, v);
        fn(v.error ? 0 : v.value);
      });
    });

    const port_state = {};
    const with_port_init = (port, type, body) => {
      if (port_state[port] === type)
        return body();
      koovdev_action.action.action({
        name: 'port-init', port: port, type: type
      }, null, (v) => {
        port_state[port] = type;
        body();
      });
    };

    client.on('set-actuator', (x, fn) => {
      debug('koov: set-actuator', x);
      if (!device_ready) {
        return fn(new Error('device is not open'));
      }
      const port = x.PORT;
      let blk = { name: x.ACTUATOR, port: port };
      let args = {};
      let type = null;
      switch (x.ACTUATOR) {
      case 'turn-led':
        blk.mode = x.MODE;
        type = 'led';
        break;
      case 'multi-led':
        blk.name = 'multi-led.1'; // use new multi-led protocol
        blk.port = 'RGB';
        args.r = Number(x.R);
        args.g = Number(x.G);
        args.b = Number(x.B);
        type = 'multi-led';
        break;
      case 'buzzer-on':
        args.frequency = Number(x.FREQUENCY);
        type = 'buzzer';
        break;
      case 'buzzer-off':
        type = 'buzzer';
        break;
      case 'dcmotor-power':
        blk.name = 'set-dcmotor-power';
        args.power = Number(x.POWER);
        type = 'dc-motor';
        break;
      case 'dcmotor-on':
        blk.name = 'turn-dcmotor-on';
        blk.direction = x.DIRECTION;
        type = 'dc-motor';
        break;
      case 'dcmotor-off':
        blk.name = 'turn-dcmotor-off';
        blk.mode = x.MODE;
        type = 'dc-motor';
        break;
      case 'servomotor-degree':
        blk.name = 'set-servomotor-degree';
        args.degree = Number(x.DEGREE);
        type = 'servo-motor';
        break;
      default:
        debug('koov: set-actuator: unknown actuator', x.ACTUATOR);
        return;
      }
      with_port_init(port, type, () => {
        debug('koov: set-actuator: blk', blk);
        koovdev_action.action.action(blk, args, (v) => {
          debug(`error => `, v);
          fn(v);
        });
      });
    });

    client.on('get-sensor', (x, fn) => {
      debug('koov: get-sensor', x);
      if (!device_ready) {
        return fn(new Error('device is not open'));
      }
      let blk = { name: `${x.SENSOR}-value`, port: x.PORT };
      switch (x.SENSOR) {
      case 'light-sensor':
      case 'sound-sensor':
      case 'ir-photo-reflector':
      case 'touch-sensor':
        break;
      case 'core-button':
        blk.name = 'button-value';
        switch (x.PORT) {
        case 'UP': blk.port = 'A0'; break;
        case 'RIGHT': blk.port = 'A1'; break;
        case 'BUTTOM': blk.port = 'A2'; break;
        case 'LEFT': blk.port = 'A3'; break;
        default: blk.port = x.PORT; break;
        }
        break;
      case 'accelerometer':
        blk.name = '3-axis-digital-accelerometer-value';
        blk.direction = x.DIRECTION;
        break;
      default:
        debug('koov: get-sensor: unknown sensor', x.SENSOR);
        return fn(0);
      }
      koovdev_action.action.action(blk, null, (v) => {
        debug(`error => `, v);
        fn(v.error ? 0 : v.value);
      });
    });

    client.on('move-servomotors', (x, fn) => {
      debug('koov: move-servomotors', x);
      if (!device_ready) {
        return fn(new Error('device is not open'));
      }
      const type = 'servo-motor';
      const ports = Object.keys(x.SERVOS);
      const exec = (ports) => {
        debug('koov: move-servomotors: exec', ports);
        const port = ports.pop();
        if (port)
          return with_port_init(port, type, () => exec(ports));

        koovdev_action.action.action({
          name: 'move-servomotors'
        }, {
          speed: x.SPEED,
          degrees: x.SERVOS,
        }, (err) => {
          debug(`error => `, err);
          return fn(err);
        });
      };
      return exec(ports);
    });

    client.on('transfer-script', (x, fn) => {
      debug('koov: transfer-script', x);
      if (!device_ready) {
        return fn(new Error('device is not open'));
      }
      const script = scratch3_translate(x.target.blocks, x.topBlockId);
      debug('koov: transfer-script: script',
                  JSON.stringify(script, null, 2));

      const bilbinary = require('bilbinary');
      const trans = bilbinary.translator(script);
      const data = trans.translate();
      const progress = () => {};

      koovdev_action.clear_keep_alive();
      koovdev_action.action.action({ name: 'flash-write' }, {
        data: data,
        progress: progress
      }, (err) => {
        debug(`ProgramScript`, err);
        fn(err);
        device_close('koov: transferred');
        client.disconnect(true);
      });
      //const trans = bilbinary.translator(script);
      //data = trans.translate();
    });
  };

  io.of('koov').on('connection', koov_handler);
};

start_server();
