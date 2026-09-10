'use strict';

const TYPE_DEFINITIONS = Object.freeze({
  1:  { name: 'M_SP_NA_1', kind: 'single',     valueLength: 1, qdsLength: 0, timeLength: 0 },
  2:  { name: 'M_SP_TA_1', kind: 'single',     valueLength: 1, qdsLength: 0, timeLength: 3 },
  3:  { name: 'M_DP_NA_1', kind: 'double',     valueLength: 1, qdsLength: 0, timeLength: 0 },
  4:  { name: 'M_DP_TA_1', kind: 'double',     valueLength: 1, qdsLength: 0, timeLength: 3 },
  5:  { name: 'M_ST_NA_1', kind: 'step',       valueLength: 1, qdsLength: 1, timeLength: 0 },
  6:  { name: 'M_ST_TA_1', kind: 'step',       valueLength: 1, qdsLength: 1, timeLength: 3 },
  7:  { name: 'M_BO_NA_1', kind: 'bitstring',  valueLength: 4, qdsLength: 1, timeLength: 0 },
  8:  { name: 'M_BO_TA_1', kind: 'bitstring',  valueLength: 4, qdsLength: 1, timeLength: 3 },
  9:  { name: 'M_ME_NA_1', kind: 'int16',      valueLength: 2, qdsLength: 1, timeLength: 0 },
  10: { name: 'M_ME_TA_1', kind: 'int16',      valueLength: 2, qdsLength: 1, timeLength: 3 },
  11: { name: 'M_ME_NB_1', kind: 'int16',      valueLength: 2, qdsLength: 1, timeLength: 0 },
  12: { name: 'M_ME_TB_1', kind: 'int16',      valueLength: 2, qdsLength: 1, timeLength: 3 },
  13: { name: 'M_ME_NC_1', kind: 'float32',    valueLength: 4, qdsLength: 1, timeLength: 0 },
  14: { name: 'M_ME_TC_1', kind: 'float32',    valueLength: 4, qdsLength: 1, timeLength: 3 },
  15: { name: 'M_IT_NA_1', kind: 'counter',    valueLength: 4, qdsLength: 1, timeLength: 0 },
  16: { name: 'M_IT_TA_1', kind: 'counter',    valueLength: 4, qdsLength: 1, timeLength: 3 },
  21: { name: 'M_ME_ND_1', kind: 'int16',      valueLength: 2, qdsLength: 0, timeLength: 0 },
  30: { name: 'M_SP_TB_1', kind: 'single',     valueLength: 1, qdsLength: 0, timeLength: 7 },
  31: { name: 'M_DP_TB_1', kind: 'double',     valueLength: 1, qdsLength: 0, timeLength: 7 },
  32: { name: 'M_ST_TB_1', kind: 'step',       valueLength: 1, qdsLength: 1, timeLength: 7 },
  33: { name: 'M_BO_TB_1', kind: 'bitstring',  valueLength: 4, qdsLength: 1, timeLength: 7 },
  34: { name: 'M_ME_TD_1', kind: 'int16',      valueLength: 2, qdsLength: 1, timeLength: 7 },
  35: { name: 'M_ME_TE_1', kind: 'int16',      valueLength: 2, qdsLength: 1, timeLength: 7 },
  36: { name: 'M_ME_TF_1', kind: 'float32',    valueLength: 4, qdsLength: 1, timeLength: 7 },
  37: { name: 'M_IT_TB_1', kind: 'counter',    valueLength: 4, qdsLength: 1, timeLength: 7 },
});

function parseAsdu(apdu) {
  if (!Buffer.isBuffer(apdu)) apdu = Buffer.from(apdu);
  if (apdu.length < 12) throw new Error('IEC104 I-frame does not contain a complete ASDU header');
  if (apdu[0] !== 0x68) throw new Error('Invalid IEC104 start byte');

  const declared = apdu[1] + 2;
  if (apdu.length !== declared) {
    throw new Error(`ASDU APDU length mismatch: declared=${declared}, actual=${apdu.length}`);
  }

  const typeId = apdu[6];
  const definition = TYPE_DEFINITIONS[typeId];
  const vsq = apdu[7];
  const sq = (vsq & 0x80) !== 0;
  const count = vsq & 0x7f;
  const cotRaw = apdu[8];
  const cause = cotRaw & 0x3f;
  const negativeConfirm = (cotRaw & 0x40) !== 0;
  const test = (cotRaw & 0x80) !== 0;
  const originatorAddress = apdu[9];
  const commonAddress = apdu.readUInt16LE(10);

  if (!definition || count === 0) {
    return {
      supported: Boolean(definition),
      typeId,
      typeName: definition ? definition.name : `UNKNOWN_${typeId}`,
      sq,
      count,
      cause,
      negativeConfirm,
      test,
      originatorAddress,
      commonAddress,
      objects: [],
    };
  }

  let offset = 12;
  let baseIoa = null;
  const objects = [];

  for (let index = 0; index < count; index += 1) {
    let ioa;

    if (!sq || index === 0) {
      ensureAvailable(apdu, offset, 3, `IOA object ${index}`);
      ioa = apdu.readUIntLE(offset, 3);
      offset += 3;
      if (sq && index === 0) baseIoa = ioa;
    } else {
      ioa = baseIoa + index;
    }

    const payloadLength = definition.valueLength + definition.qdsLength + definition.timeLength;
    ensureAvailable(apdu, offset, payloadLength, `${definition.name} object ${index}`);

    const valueBuffer = apdu.subarray(offset, offset + definition.valueLength);
    offset += definition.valueLength;

    let qualityByte = null;
    if (definition.qdsLength > 0) {
      qualityByte = apdu[offset];
      offset += definition.qdsLength;
    } else if (definition.kind === 'single' || definition.kind === 'double') {
      qualityByte = valueBuffer[0];
    }

    let timestamp = null;
    if (definition.timeLength > 0) {
      const timeBuffer = apdu.subarray(offset, offset + definition.timeLength);
      offset += definition.timeLength;
      timestamp = definition.timeLength === 7
        ? parseCP56Time2a(timeBuffer)
        : parseCP24Time2a(timeBuffer);
    }

    objects.push({
      ioa,
      value: decodeValue(definition.kind, valueBuffer),
      quality: decodeQuality(qualityByte, definition.kind),
      timestamp,
    });
  }

  return {
    supported: true,
    typeId,
    typeName: definition.name,
    sq,
    count,
    cause,
    negativeConfirm,
    test,
    originatorAddress,
    commonAddress,
    objects,
    consumedBytes: offset,
    trailingBytes: Math.max(0, apdu.length - offset),
  };
}

function ensureAvailable(buffer, offset, length, label) {
  if (offset + length > buffer.length) {
    throw new Error(`Truncated IEC104 ASDU while reading ${label}: need=${length}, remaining=${buffer.length - offset}`);
  }
}

function decodeValue(kind, valueBuffer) {
  switch (kind) {
    case 'single':
      return valueBuffer[0] & 0x01;
    case 'double':
      return valueBuffer[0] & 0x03;
    case 'step': {
      let value = valueBuffer[0] & 0x7f;
      if (value & 0x40) value -= 0x80;
      return value;
    }
    case 'bitstring':
      return valueBuffer.readUInt32LE(0);
    case 'int16':
      return valueBuffer.readInt16LE(0);
    case 'float32':
      return valueBuffer.readFloatLE(0);
    case 'counter':
      return valueBuffer.readInt32LE(0);
    default:
      return null;
  }
}

function decodeQuality(byte, kind) {
  if (byte == null) return null;

  // SIQ/DIQ dùng các quality bits ở nibble cao; QDS có OV ở bit 0.
  const q = {
    raw: byte,
    invalid: (byte & 0x80) !== 0,
    notTopical: (byte & 0x40) !== 0,
    substituted: (byte & 0x20) !== 0,
    blocked: (byte & 0x10) !== 0,
  };

  if (kind !== 'single' && kind !== 'double') {
    q.overflow = (byte & 0x01) !== 0;
  }
  return q;
}

function parseCP24Time2a(buffer) {
  if (!buffer || buffer.length !== 3) return null;
  const millisecondsWithinMinute = buffer.readUInt16LE(0);
  return {
    format: 'CP24Time2a',
    millisecondsWithinMinute,
    seconds: Math.floor(millisecondsWithinMinute / 1000),
    milliseconds: millisecondsWithinMinute % 1000,
    minute: buffer[2] & 0x3f,
    invalid: (buffer[2] & 0x80) !== 0,
  };
}

function parseCP56Time2a(buffer) {
  if (!buffer || buffer.length !== 7) return null;

  const millisecondsWithinMinute = buffer.readUInt16LE(0);
  const second = Math.floor(millisecondsWithinMinute / 1000);
  const millisecond = millisecondsWithinMinute % 1000;
  const minute = buffer[2] & 0x3f;
  const invalid = (buffer[2] & 0x80) !== 0;
  const hour = buffer[3] & 0x1f;
  const day = buffer[4] & 0x1f;
  const month = buffer[5] & 0x0f;
  const year = 2000 + (buffer[6] & 0x7f);

  const date = new Date(year, month - 1, day, hour, minute, second, millisecond);

  return {
    format: 'CP56Time2a',
    invalid,
    date: Number.isNaN(date.getTime()) ? null : date,
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
  };
}

module.exports = {
  TYPE_DEFINITIONS,
  parseAsdu,
  decodeQuality,
  parseCP24Time2a,
  parseCP56Time2a,
};
