'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseApci,
  buildSFrame,
  buildGeneralInterrogationFrame,
} = require('../IEC104/apci');

test('parse I-frame N(S)/N(R)', () => {
  const frame = Buffer.from('680e0400060001010300020010000001', 'hex');
  const apci = parseApci(frame);
  assert.equal(apci.type, 'I');
  assert.equal(apci.ns, 2);
  assert.equal(apci.nr, 3);
});

test('build S-frame đúng N(R)', () => {
  const frame = buildSFrame(123);
  const apci = parseApci(frame);
  assert.equal(apci.type, 'S');
  assert.equal(apci.nr, 123);
});

test('General Interrogation dùng sequence và common address động', () => {
  const frame = buildGeneralInterrogationFrame({ ns: 5, nr: 7, commonAddress: 12, originatorAddress: 1 });
  const apci = parseApci(frame);

  assert.equal(apci.type, 'I');
  assert.equal(apci.ns, 5);
  assert.equal(apci.nr, 7);
  assert.equal(frame[6], 0x64);
  assert.equal(frame.readUInt16LE(10), 12);
  assert.equal(frame[15], 0x14);
});
