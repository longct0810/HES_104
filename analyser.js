'use strict';

const logger = require('./Files/logger.js');
const { parseApci } = require('./IEC104/apci.js');
const { parseAsdu } = require('./IEC104/asdu-parser.js');

/**
 * Compatibility wrapper giữ nguyên output nghiệp vụ cũ:
 * [ten_thietbi, id_thietbi, id_cambien(IOA), value, receive_time]
 */
module.exports.analyser = (dataInput, tenthietbi, idthietbi) => {
  const apdu = normalizeToBuffer(dataInput);
  const dataJson = [];
  let dataWrite = '';

  try {
    const apci = parseApci(apdu);
    if (apci.type !== 'I') {
      return { type: 'DATA', Data: [] };
    }

    const parsed = parseAsdu(apdu);
    if (!parsed.supported || parsed.objects.length === 0) {
      writeProtocolLog(apdu, `[UNSUPPORTED] type=${parsed.typeName}`);
      return { type: 'DATA', Data: [] };
    }

    const receiveTime = fDateTime();

    for (const object of parsed.objects) {
      const item = [
        tenthietbi || '',
        idthietbi,
        object.ioa,
        object.value,
        receiveTime,
      ];
      dataJson.push(item);

      const qualityWarning = object.quality && object.quality.invalid ? ';QUALITY=INVALID' : '';
      dataWrite += `${idthietbi};${object.ioa};${object.value};${receiveTime}${qualityWarning}\n`;
    }

    writeProtocolLog(apdu, dataWrite);
  } catch (err) {
    writeProtocolLog(apdu, `[PARSE_ERROR] ${err.message}`);
    console.error('[IEC104][PARSER]', err.message, apdu.toString('hex'));
  }

  return {
    type: 'DATA',
    Data: dataJson,
  };
};

module.exports.parseAsdu = parseAsdu;

module.exports.getLength = (dataInput) => normalizeToBuffer(dataInput).length;

function normalizeToBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);

  const clean = String(input || '').replace(/\s+/g, '');
  if (!clean || clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error('Invalid IEC104 hex input');
  }
  return Buffer.from(clean, 'hex');
}

function writeProtocolLog(apdu, parsedText) {
  const rawLoggingEnabled = String(process.env.IEC104_RAW_LOG || 'true').toLowerCase() !== 'false';
  if (!rawLoggingEnabled) return;

  logger.writeLog(`${apdu.toString('hex')}\n${parsedText || ''}`);
}

function fDateTime() {
  const today = new Date();
  const date = `${getD2(today.getDate())}/${getD2(today.getMonth() + 1)}/${today.getFullYear()}`;
  const time = `${getD2(today.getHours())}:${getD2(today.getMinutes())}:${getD2(today.getSeconds())}`;
  return `${date} ${time}`;
}

function getD2(value) {
  return String(value).padStart(2, '0');
}
