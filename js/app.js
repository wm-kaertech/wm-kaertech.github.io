'use strict';

const bleUartServiceUUID = '30b6c2e6-be0d-4130-bc74-02c55a3d2356';
const bleUartCharRXUUID = 'aaaeb2cc-ad5e-4d4a-9b67-7abe674dd76d';
const bleUartCharTXUUID = 'ff192c3e-4392-4053-89a3-17fcdf49dec7';
const MTU = 20;

var bleDevice;
var bleServer;
var uartService;
var rxCharacteristic;
var txCharacteristic;

var connected = false;

function connectionToggle() {
    if (connected) {
        disconnect();
    } else {
        connect();
    }
    document.getElementById('terminal').focus();
}

// Sets button to either Connect or Disconnect
function setConnButtonState(enabled) {
    if (enabled) {
        document.getElementById("clientConnectButton").innerHTML = "Disconnect";
    } else {
        document.getElementById("clientConnectButton").innerHTML = "Connect";
    }
}

function connect() {
    if (!navigator.bluetooth) {
        console.log('WebBluetooth API is not available.\r\n' +
            'Please make sure the Web Bluetooth flag is enabled.');
        window.term_.io.println('WebBluetooth API is not available on your browser.\r\n' +
            'Please make sure the Web Bluetooth flag is enabled.');
        return;
    }
    console.log('Requesting Bluetooth Device...');
    navigator.bluetooth.requestDevice({
        filters: [
            //{ services: ['6B978498-A66F-11EB-BCBC-0242AC130002'] },
            { namePrefix: 'Storyphone' }
        ],
    })
        .then(device => {
            bleDevice = device;
            console.log('Found ' + device.name);
            console.log('Connecting to GATT Server...');
            bleDevice.addEventListener('gattserverdisconnected', onDisconnected);
            return device.gatt.connect();
        })
        .then(server => {
            console.log('Locate UART service');
            return server.getPrimaryService(bleUartServiceUUID);
        }).then(service => {
            uartService = service;
            console.log('Found UART service: ' + service.uuid);
        })
        .then(() => {
            console.log('Locate RX characteristic');
            return uartService.getCharacteristic(bleUartCharRXUUID);
        })
        .then(characteristic => {
            rxCharacteristic = characteristic;
            console.log('Found RX characteristic');
        })
        .then(() => {
            console.log('Locate TX characteristic');
            return uartService.getCharacteristic(bleUartCharTXUUID);
        })
        .then(characteristic => {
            txCharacteristic = characteristic;
            console.log('Found TX characteristic');
        })
        .then(() => {
            console.log('Enable notifications');
            return txCharacteristic.startNotifications();
        })
        .then(() => {
            console.log('Notifications started');
            txCharacteristic.addEventListener('characteristicvaluechanged',
                handleNotifications);
            connected = true;
            uartSendString('\r');
            setConnButtonState(true);
        })
        .catch(error => {
            console.log('' + error);
            window.term_.io.println('' + error);
            if (bleDevice && bleDevice.gatt.connected) {
                bleDevice.gatt.disconnect();
            }
        });
}

function disconnect() {
    if (!bleDevice) {
        console.log('No Bluetooth Device connected...');
        return;
    }
    console.log('Disconnecting from Bluetooth Device...');
    if (bleDevice.gatt.connected) {
        bleDevice.gatt.disconnect();
        connected = false;
        setConnButtonState(false);
        console.log('Bluetooth Device connected: ' + bleDevice.gatt.connected);
    } else {
        console.log('> Bluetooth Device is already disconnected');
    }
}

function onDisconnected() {
    connected = false;
    window.term_.io.println('\r\n' + bleDevice.name + ' Disconnected.');
    setConnButtonState(false);
}

function handleNotifications(event) {
    console.log('notification');
    let value = event.target.value;
    // Convert raw data bytes to character values and use these to 
    // construct a string.
    let str = "";
    for (let i = 0; i < value.byteLength; i++) {
        str += String.fromCharCode(value.getUint8(i));
    }
    window.term_.io.print(str);
}

function uartSendString(s) {
    if (bleDevice && bleDevice.gatt.connected) {
        console.log("send: " + s);
        let val_arr = new Uint8Array(s.length)
        for (let i = 0; i < s.length; i++) {
            let val = s[i].charCodeAt(0);
            val_arr[i] = val;
        }
        sendNextChunk(val_arr);
    } else {
        window.term_.io.println('Not connected to a device yet.');
    }
}

function sendNextChunk(a) {
    let chunk = a.slice(0, MTU);
    rxCharacteristic.writeValue(chunk)
        .then(function () {
            if (a.length > MTU) {
                sendNextChunk(a.slice(MTU));
            }
        });
}



function initContent(io) {
}

function setupHterm() {
    const term = new hterm.Terminal();

    term.onTerminalReady = function () {
        const io = this.io.push();
        io.onVTKeystroke = (string) => {
            uartSendString(string);
        };
        io.sendString = uartSendString;
        initContent(io);
        this.setCursorVisible(true);
        this.keyboard.characterEncoding = 'raw';
    };
    term.decorate(document.querySelector('#terminal'));
    term.installKeyboard();

    term.contextMenu.setItems([
        ['Terminal Reset', () => { term.reset(); initContent(window.term_.io); }],
        ['Terminal Clear', () => { term.clearHome(); }],
        [hterm.ContextMenu.SEPARATOR],
        ['GitHub', function () {
            lib.f.openWindow('https://github.com/makerdiary/web-device-cli', '_blank');
        }],
    ]);

    term.prefs_.set('cursor-color', 'white')
    term.prefs_.set('font-size', 12)
    term.prefs_.set('backspace-sends-backspace', true)

    // Useful for console debugging.
    window.term_ = term;
}

window.onload = function () {
    lib.init(setupHterm);
};