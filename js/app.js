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
var privateKey = undefined;

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
        optionalServices: [bleUartServiceUUID],
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

function hexToBytes(hex) {
    for (var bytes = [], c = 0; c < hex.length; c += 2)
        bytes.push(parseInt(hex.substr(c, 2), 16));
    return bytes;
}

function pemToRawKey(pem) {
    const pemHeader = "-----BEGIN PRIVATE KEY-----";
    const pemFooter = "-----END PRIVATE KEY-----";
    const pemContents = pem.trim().substring(pemHeader.length, pem.length - pemFooter.length);
    const binaryDerString = window.atob(pemContents);
    const binaryDer = new Uint8Array(48);
    for (let i = 0, strLen = 48; i < strLen; i++) {
        binaryDer[i] = binaryDerString.charCodeAt(35 + i);
    }
    return binaryDer;
}

async function challengeComputeAnswer(challenge) {
    const parts = challenge.trim().replaceAll("[", "").replaceAll("]", "").split('_');
    if (parts.length != 2) {
        throw "Invalid challenge";
    }
    const header = parts[0];
    const core = parts[1];

    if ((header != "SPD") && (header != "SPP")) {
        throw "Invalid challenge header " + header;
    }
    const coreBytes = hexToBytes(core);
    if (coreBytes.length != 32) {
        throw "Invalid challenge core";
    }

    const ec = new elliptic.ec('p384');
    const key = ec.keyFromPrivate(privateKey);
    const msgHash = hexToBytes(sha256(coreBytes));
    const signature = ec.sign(msgHash, key, "hex", { canonical: true }).toDER();

    const base64Signature = btoa(String.fromCharCode.apply(null, new Uint8Array(signature)));
    var answer = "_" + base64Signature;
    for (var i = 0; i < 150 - base64Signature.length; i++) {
        answer += "@";
    }
    return answer;
}

function handleUnlock(line) {
    const re = /s*\[KT-CLI\] Please unlock\s*$/gm;
    if (line.match(re)) {
        if (privateKey) {
            window.term_.io.print("\x1b[1;33m" + "Attempting to unlock KT-CLI\n" + "\x1b[1;0m");
            uartSendString("_jU9FJ5EE3TuxTX8Ak3dQyjUk\n");
        } else {
            window.term_.io.print("\x1b[1;31m" + "No private key provided to authentify to KT-CLI\n" + "\x1b[1;0m");
        }
    }
}

function handleAuthentication(line) {
    const re = /s*\[\[[A-Z]{3}_[A-Za-z0-9]{64}\]\]\s$/gm;
    if (line.match(re)) {
        if (privateKey) {
            window.term_.io.print("\x1b[1;33m" + "Attempting to authentify to KT-CLI\n" + "\x1b[1;0m");
            challengeComputeAnswer(line).then(function (answer) {
                uartSendString(answer);
            })
        } else {
            window.term_.io.print("\x1b[1;31m" + "No private key provided to authentify to KT-CLI\n" + "\x1b[1;0m");
        }
    }
}

function handleAuthenticationIfNeeded(line) {
    handleUnlock(line)
    handleAuthentication(line);
}

function handleNotifications(event) {
    let value = event.target.value;
    // Convert raw data bytes to character values and use these to 
    // construct a string.
    let str = "";
    for (let i = 0; i < value.byteLength; i++) {
        str += String.fromCharCode(value.getUint8(i));
    }
    window.term_.io.print(str);

    handleAuthenticationIfNeeded(str);
}

function uartSendString(s) {
    if (bleDevice && bleDevice.gatt.connected) {
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

function setupHterm() {
    const term = new hterm.Terminal();

    term.onTerminalReady = function () {
        const io = this.io.push();
        io.onVTKeystroke = (string) => {
            uartSendString(string);
        };
        io.sendString = uartSendString;
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


function allowDrop(ev) {
    ev.preventDefault();
}

function drop(ev) {
    ev.preventDefault();
    var file = undefined;
    if (ev.dataTransfer.items && ev.dataTransfer.items.length == 1) {
        file = ev.dataTransfer.items[0].getAsFile();
    } else if (ev.dataTransfer.files && ev.dataTransfer.files.length == 1) {
        file = ev.dataTransfer.files[0].getAsFile();
    }
    readPemFile(file);
}

function readPemFile(file) {
    if (!file) {
        return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
        try {
            privateKey = pemToRawKey(e.target.result.trim());
            window.term_.io.print("\x1b[1;32m" + "Successfully loaded private key\n" + "\x1b[1;0m");
        } catch (error) {
            console.error(error);
        }

    };
    reader.readAsText(file);
}