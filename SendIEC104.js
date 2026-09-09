const net = require('net');

class IEC104Client {
  constructor(host, ca, port) {
    this.host = host;
    this.port = port;
    this.ca = ca;
    this.sendSeq = 0;
    this.recvSeq = 0;
  }

  connect() {
    this.socket = net.createConnection(this.port, this.host, () => {
      this.socket.write(Buffer.from([0x68, 0x04, 0x07, 0x00, 0x00, 0x00]));
      console.log('▶ Sent STARTDT');
    });

    this.socket.on('data', (data) => {
      console.log('◀ Received:', data.toString('hex'));
    });

    this.socket.on('error', (err) => {
      console.error('⚠ Socket error:', err);
    });

    this.socket.on('close', () => {
      console.warn('⛔ Connection closed');
    });
  }

  sendFloatValue(ioa, val) {
    const buf = Buffer.alloc(6 + 1 + 1 + 2 + 2 + 3 + 4 + 1);
    let off = 0;

    buf.writeUInt8(0x68, off++);
    buf.writeUInt8(buf.length - 2, off++);
    buf.writeUInt16LE(this.sendSeq << 1, off); off += 2;
    buf.writeUInt16LE(this.recvSeq << 1, off); off += 2;
    this.sendSeq++;

    buf.writeUInt8(0x32, off++);
    buf.writeUInt8(0x01, off++);
    buf.writeUInt16LE(0x0006, off); off += 2;
    buf.writeUInt16LE(this.ca, off); off += 2;

    buf.writeUInt8(ioa & 0xFF, off++);
    buf.writeUInt8((ioa >> 8) & 0xFF, off++);
    buf.writeUInt8((ioa >> 16) & 0xFF, off++);

    buf.writeFloatLE(val, off); off += 4;
    buf.writeUInt8(0x00, off++);

    this.socket.write(buf);
    console.log(byteToHexString(buf))
    console.log(`▶ Sent C_SE_NC_1 IOA=${ioa}, float=${val}`);
  }
}

module.exports = IEC104Client;
function byteToHexString(uint8arr) {
    if (!uint8arr) {
        return '';
    }

    var hexStr = '';
    for (let i = 0; i < uint8arr.length; i++) {
        var hex = (uint8arr[i] & 0xff).toString(16);
        hex = (hex.length === 1) ? '0' + hex : hex;
        hexStr += hex + " ";
    }

    return hexStr.toUpperCase();
}