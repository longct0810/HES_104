'use strict';

const { TYPE_DEFINITIONS } = require('./IEC104/asdu-parser.js');

/**
 * Giữ API cũ: [typeName, valueLength, qdsLength, timeLength]
 */
module.exports.getTypeID = (typeId) => {
  const def = TYPE_DEFINITIONS[Number(typeId)];
  if (!def) return [`NaN${typeId}`, 0, 0, 0];
  return [def.name, def.valueLength, def.qdsLength, def.timeLength];
};
