'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const IEC104FrameBuffer = require('../IEC104/frame-buffer');

const STARTDT_CON = Buffer.from('68040b000000', 'hex');
const TESTFR_ACT = Buffer.from('680443000000', 'hex');

test('frame buffer ghép APDU bị chia thành nhiều TCP chunks', () => {
  const parser = new IEC104FrameBuffer();

  assert.deepEqual(parser.push(STARTDT_CON.subarray(0, 2)), []);
  assert.deepEqual(parser.push(STARTDT_CON.subarray(2, 4)), []);

  const frames = parser.push(STARTDT_CON.subarray(4));
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], STARTDT_CON);
  assert.equal(parser.pendingBytes, 0);
});

test('frame buffer tách được nhiều APDU trong cùng TCP chunk', () => {
  const parser = new IEC104FrameBuffer();
  const frames = parser.push(Buffer.concat([STARTDT_CON, TESTFR_ACT]));

  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], STARTDT_CON);
  assert.deepEqual(frames[1], TESTFR_ACT);
});

test('frame buffer resync khi có byte rác trước 0x68', () => {
  const parser = new IEC104FrameBuffer();
  const frames = parser.push(Buffer.concat([Buffer.from([0xaa, 0xbb, 0xcc]), STARTDT_CON]));

  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], STARTDT_CON);
});
