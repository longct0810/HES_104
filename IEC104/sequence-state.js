'use strict';

const { nextSequence, previousSequence } = require('./apci');

class ReceiveSequenceState {
  constructor(initialExpected = 0) {
    this.expected = Number(initialExpected) & 0x7fff;
  }

  reset(value = 0) {
    this.expected = Number(value) & 0x7fff;
  }

  accept(ns) {
    const received = Number(ns) & 0x7fff;
    const expectedBefore = this.expected;

    if (received === this.expected) {
      this.expected = nextSequence(received);
      return { status: 'expected', received, expectedBefore, expectedAfter: this.expected };
    }

    if (received === previousSequence(this.expected)) {
      return { status: 'duplicate', received, expectedBefore, expectedAfter: this.expected };
    }

    // TCP đảm bảo thứ tự byte, vì vậy gap thường cho thấy peer/session đã lệch
    // sequence hoặc HES vừa resync sau sự cố. v0.2.0 ưu tiên tiếp tục telemetry:
    // ghi nhận gap và resync theo frame thực tế thay vì treo session vô hạn.
    this.expected = nextSequence(received);
    return { status: 'gap', received, expectedBefore, expectedAfter: this.expected };
  }
}

module.exports = ReceiveSequenceState;
