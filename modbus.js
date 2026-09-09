// const modbus = require('modbus-stream');

// modbus.tcp.connect(502, '127.0.0.1', (err, connection) => {
//     if (err) {
//         return console.error(err);
//     }

//     // Assuming the S32 value is stored in registers 40001 and 40002
//     connection.readHoldingRegisters({ address: 40001, quantity: 1 }, (err, res) => {
//         if (err) {
//             return console.error(err);
//         }

//         // Combine the two 16-bit registers into one 32-bit integer
//         const buffer = Buffer.from(res.response.data);
//         const s32Value = buffer.readInt32BE(0);
//         console.log('S32 Value:', s32Value);
   
//     });
// });

// create an empty modbus client
const ModbusRTU = require("modbus-serial");
const client = new ModbusRTU();

// open connection to a tcp line
client.connectTCP("10.10.30.141", { port: 502 });
client.setID(1);

// read the values of 10 registers starting at address 0
// on device number 1. and log the values to the console.
setInterval(function() {
    client.readHoldingRegisters(1000, 10, function(err, data) {
        console.log(data);
    });
}, 1000);