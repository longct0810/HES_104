'use strict';

const MODULO = 0x8000;

const U_FRAME = Object.freeze({
  STARTDT_ACT: 0x07,
  STARTDT_CON: 0x0b,
  STOPDT_ACT: 0x13,
  STOPDT_CON: 0x23,
  TESTFR_ACT: 0x43,
  TESTFR_CON: 0x83,
});

function parseApci(apdu) {
  if (!Buffer.isBuffer(apdu)) apdu = Buffer.from(apdu);
  if (apdu.length < 6) throw new Error('IEC104 APDU too short');
  if (apdu[0] !== 0x68) throw new Error('Invalid IEC104 start byte');

  const declaredLength = apdu[1] + 2;
  if (apdu.length !== declaredLength) {
    throw new Error(`IEC104 APDU length mismatch: declared=${declaredLength}, actual=${apdu.length}`);
  }

  const c1 = apdu[2];
  const c2 = apdu[3];
  const c3 = apdu[4];
  const c4 = apdu[5];

  if ((c1 & 0x01) === 0) {
    return {
      type: 'I',
      ns: ((((c2 << 8) | c1) >>> 1) & 0x7fff),
      nr: ((((c4 << 8) | c3) >>> 1) & 0x7fff),
    };
  }

  if ((c1 & 0x03) === 0x01) {
    return {
      type: 'S',
      nr: ((((c4 << 8) | c3) >>> 1) & 0x7fff),
    };
  }

  if ((c1 & 0x03) === 0x03) {
    return {
      type: 'U',
      code: c1,
      name: getUFrameName(c1),
    };
  }

  throw new Error('Unknown IEC104 APCI frame type');
}

function getUFrameName(code) {
  switch (code) {
    case U_FRAME.STARTDT_ACT: return 'STARTDT_ACT';
    case U_FRAME.STARTDT_CON: return 'STARTDT_CON';
    case U_FRAME.STOPDT_ACT: return 'STOPDT_ACT';
    case U_FRAME.STOPDT_CON: return 'STOPDT_CON';
    case U_FRAME.TESTFR_ACT: return 'TESTFR_ACT';
    case U_FRAME.TESTFR_CON: return 'TESTFR_CON';
    default: return `U_${code.toString(16).padStart(2, '0')}`;
  }
}

function buildUFrame(code) {
  return Buffer.from([0x68, 0x04, code, 0x00, 0x00, 0x00]);
}

function buildSFrame(nr) {
  const value = ((Number(nr) & 0x7fff) << 1) & 0xffff;
  const buf = Buffer.alloc(6);
  buf[0] = 0x68;
  buf[1] = 0x04;
  buf[2] = 0x01;
  buf[3] = 0x00;
  buf.writeUInt16LE(value, 4);
  return buf;
}

function buildGeneralInterrogationFrame({ ns = 0, nr = 0, commonAddress = 2, originatorAddress = 1 } = {}) {
  const asdu = Buffer.alloc(10);
  let off = 0;
  asdu.writeUInt8(0x64, off++); // C_IC_NA_1
  asdu.writeUInt8(0x01, off++); // VSQ: 1 object
  asdu.writeUInt8(0x06, off++); // COT: activation
  asdu.writeUInt8(originatorAddress & 0xff, off++);
  asdu.writeUInt16LE(commonAddress & 0xffff, off); off += 2;
  asdu.writeUIntLE(0, off, 3); off += 3; // IOA = 0
  asdu.writeUInt8(0x14, off++); // QOI = station interrogation

  const buf = Buffer.alloc(6 + asdu.length);
  buf[0] = 0x68;
  buf[1] = 4 + asdu.length;
  buf.writeUInt16LE(((ns & 0x7fff) << 1) & 0xffff, 2);
  buf.writeUInt16LE(((nr & 0x7fff) << 1) & 0xffff, 4);
  asdu.copy(buf, 6);
  return buf;
}

function nextSequence(value) {
  return (Number(value) + 1) % MODULO;
}

function previousSequence(value) {
  return (Number(value) + MODULO - 1) % MODULO;
}

module.exports = {
  MODULO,
  U_FRAME,
  parseApci,
  getUFrameName,
  buildUFrame,
  buildSFrame,
  buildGeneralInterrogationFrame,
  nextSequence,
  previousSequence,
};
