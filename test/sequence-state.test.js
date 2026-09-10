'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ReceiveSequenceState = require('../IEC104/sequence-state');

test('sequence state nhận đúng frame kế tiếp', () => {
  const state = new ReceiveSequenceState(0);
  assert.equal(state.accept(0).status, 'expected');
  assert.equal(state.expected, 1);
  assert.equal(state.accept(1).status, 'expected');
  assert.equal(state.expected, 2);
});

test('sequence state nhận diện duplicate và không tăng ACK', () => {
  const state = new ReceiveSequenceState(0);
  state.accept(0);
  const duplicate = state.accept(0);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(state.expected, 1);
});

test('sequence state log gap và resync để telemetry tiếp tục', () => {
  const state = new ReceiveSequenceState(2);
  const gap = state.accept(5);
  assert.equal(gap.status, 'gap');
  assert.equal(gap.expectedBefore, 2);
  assert.equal(state.expected, 6);
});

test('sequence state wrap 32767 -> 0', () => {
  const state = new ReceiveSequenceState(32767);
  assert.equal(state.accept(32767).status, 'expected');
  assert.equal(state.expected, 0);
});
