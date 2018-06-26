# koov_scratch_server
A server to control KOOV Core from scratch.

# How to use
## Run the server
* npm install
* npm run server

The server will listen on localhost:3030.
The server will return all found devices by default.
Since there seems to be no UI in scratch 3.0 GUI to select one of them,
it is highly difficult to predict which device will be used.
You can restrict the found device only to usb connected device
by passing --usb-only option.
```
$ npm run server -- --usb-only
```
