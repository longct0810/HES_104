'use strict';

/**
 * IEC-60870-5-104 chạy trên TCP stream. Một TCP chunk có thể chứa một phần APDU
 * hoặc nhiều APDU. Class này giữ buffer theo từng connection và chỉ trả về
 * các APDU hoàn chỉnh (68 LL ...).
 */
class IEC104FrameBuffer {
  constructor(options = {}) {
    this.maxApduLength = Number(options.maxApduLength || 253);
    this.maxBufferLength = Number(options.maxBufferLength || 1024 * 1024);
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    if (!chunk || chunk.length === 0) return [];

    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, incoming])
      : Buffer.from(incoming);

    if (this.buffer.length > this.maxBufferLength) {
      // Giữ lại từ start byte cuối cùng để có cơ hội resync thay vì tăng RAM vô hạn.
      const lastStart = this.buffer.lastIndexOf(0x68);
      this.buffer = lastStart >= 0
        ? this.buffer.subarray(lastStart)
        : Buffer.alloc(0);
      throw new Error('IEC104 receive buffer exceeded safety limit');
    }

    const frames = [];

    while (this.buffer.length >= 2) {
      if (this.buffer[0] !== 0x68) {
        const nextStart = this.buffer.indexOf(0x68, 1);
        if (nextStart < 0) {
          this.buffer = Buffer.alloc(0);
          break;
        }
        this.buffer = this.buffer.subarray(nextStart);
        if (this.buffer.length < 2) break;
      }

      const apduLength = this.buffer[1];

      // IEC-104 APCI luôn có 4 control bytes. Giá trị lớn bất thường thường là
      // dấu hiệu đang lệch frame, nên bỏ start byte hiện tại và resync.
      if (apduLength < 4 || apduLength > this.maxApduLength) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      const totalLength = apduLength + 2;
      if (this.buffer.length < totalLength) break;

      frames.push(Buffer.from(this.buffer.subarray(0, totalLength)));
      this.buffer = this.buffer.subarray(totalLength);
    }

    return frames;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }

  get pendingBytes() {
    return this.buffer.length;
  }
}

module.exports = IEC104FrameBuffer;
