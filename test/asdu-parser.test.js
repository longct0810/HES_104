'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAsdu } = require('../IEC104/asdu-parser');

function makeIFrame(asdu, ns = 0, nr = 0) {
  const frame = Buffer.alloc(6 + asdu.length);
  frame[0] = 0x68;
  frame[1] = 4 + asdu.length;
  frame.writeUInt16LE(ns << 1, 2);
  frame.writeUInt16LE(nr << 1, 4);
  asdu.copy(frame, 6);
  return frame;
}

function makeHeader(typeId, vsq, cause = 3, ca = 2) {
  const b = Buffer.alloc(6);
  b[0] = typeId;
  b[1] = vsq;
  b[2] = cause;
  b[3] = 0;
  b.writeUInt16LE(ca, 4);
  return b;
}

function ioa(value) {
  const b = Buffer.alloc(3);
  b.writeUIntLE(value, 0, 3);
  return b;
}

test('M_SP_NA_1 parse single point', () => {
  const asdu = Buffer.concat([
    makeHeader(1, 1),
    ioa(16),
    Buffer.from([0x01]),
  ]);

  const parsed = parseAsdu(makeIFrame(asdu));
  assert.equal(parsed.typeName, 'M_SP_NA_1');
  assert.equal(parsed.objects.length, 1);
  assert.equal(parsed.objects[0].ioa, 16);
  assert.equal(parsed.objects[0].value, 1);
});

test('SQ=0 parse nhiều M_ME_NB_1 không bỏ byte giữa các object', () => {
  const value1 = Buffer.alloc(2); value1.writeInt16LE(100);
  const value2 = Buffer.alloc(2); value2.writeInt16LE(-50);

  const asdu = Buffer.concat([
    makeHeader(11, 2),
    ioa(1000), value1, Buffer.from([0x00]),
    ioa(1001), value2, Buffer.from([0x00]),
  ]);

  const parsed = parseAsdu(makeIFrame(asdu));
  assert.deepEqual(
    parsed.objects.map((x) => [x.ioa, x.value]),
    [[1000, 100], [1001, -50]]
  );
});

test('SQ=1 parse nhiều M_ME_NC_1 với IOA tăng tuần tự', () => {
  const value1 = Buffer.alloc(4); value1.writeFloatLE(1.5);
  const value2 = Buffer.alloc(4); value2.writeFloatLE(-2.25);

  const asdu = Buffer.concat([
    makeHeader(13, 0x80 | 2),
    ioa(2000),
    value1, Buffer.from([0x00]),
    value2, Buffer.from([0x00]),
  ]);

  const parsed = parseAsdu(makeIFrame(asdu));
  assert.equal(parsed.objects.length, 2);
  assert.equal(parsed.objects[0].ioa, 2000);
  assert.equal(parsed.objects[1].ioa, 2001);
  assert.equal(parsed.objects[0].value, 1.5);
  assert.equal(parsed.objects[1].value, -2.25);
});

test('M_SP_TA_1 consume đúng CP24Time2a 3 byte', () => {
  const cp24 = Buffer.from([0x39, 0x30, 0x15]); // 12345 ms, minute 21
  const asdu = Buffer.concat([
    makeHeader(2, 1),
    ioa(3000),
    Buffer.from([0x01]),
    cp24,
  ]);

  const parsed = parseAsdu(makeIFrame(asdu));
  assert.equal(parsed.objects.length, 1);
  assert.equal(parsed.objects[0].value, 1);
  assert.equal(parsed.objects[0].timestamp.format, 'CP24Time2a');
  assert.equal(parsed.objects[0].timestamp.minute, 21);
  assert.equal(parsed.trailingBytes, 0);
});

test('M_ME_TF_1 parse float + CP56Time2a', () => {
  const value = Buffer.alloc(4); value.writeFloatLE(230.5);
  const cp56 = Buffer.alloc(7);
  cp56.writeUInt16LE(12345, 0); // 12s345ms
  cp56[2] = 34; // minute
  cp56[3] = 16; // hour
  cp56[4] = 9;  // day
  cp56[5] = 9;  // month
  cp56[6] = 26; // 2026

  const asdu = Buffer.concat([
    makeHeader(36, 1),
    ioa(4104),
    value,
    Buffer.from([0x00]),
    cp56,
  ]);

  const parsed = parseAsdu(makeIFrame(asdu));
  assert.equal(parsed.objects[0].ioa, 4104);
  assert.equal(parsed.objects[0].value, 230.5);
  assert.equal(parsed.objects[0].timestamp.year, 2026);
  assert.equal(parsed.objects[0].timestamp.hour, 16);
});

test('parser phát hiện ASDU bị truncate thay vì đọc lệch dữ liệu', () => {
  const asdu = Buffer.concat([
    makeHeader(13, 1),
    ioa(1000),
    Buffer.from([0x00, 0x00]), // thiếu 2 byte float + QDS
  ]);

  assert.throws(() => parseAsdu(makeIFrame(asdu)), /Truncated IEC104 ASDU/);
});
