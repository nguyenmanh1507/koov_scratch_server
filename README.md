# koov_scratch_server
A server to control KOOV Core from scratch.

# How to use
## Run the server
* npm install
* npm run server

The server will listen on localhost:3030.
The server will return all found device by default, but you can
restrict it only to usb connected device by passing --usb-only option.
```
$ npm run server -- --usb-only
```
