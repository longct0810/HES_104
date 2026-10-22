'use strict';
const { Pool } = require('pg');
const { validateControlRequest } = require('./control-policy');
let pool;
function getPool() {
  if (!pool) {
    const missing = ['DB_USER','DB_PASS','DB_HOST','DB_NAME'].filter(key => !process.env[key]);
    if (missing.length) throw new Error('Missing database settings: ' + missing.join(', '));
    pool = new Pool({user:process.env.DB_USER,password:process.env.DB_PASS,
      host:process.env.DB_HOST,port:Number(process.env.DB_PORT || 5432),database:process.env.DB_NAME,
      max:5,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000});
    pool.on('error', error => console.error('[WS][CONTROL][DB] Pool error:', error.code || 'DB_ERROR'));
  }
  return pool;
}
async function validateDatabaseControlRequest(principal, message, database) {
  const preliminary = validateControlRequest(principal, message, {});
  if (preliminary.code !== 'IOA_FORBIDDEN') return preliminary;
  try {
    const result = await (database || getPool()).query(
      `SELECT command_type, min_value, max_value, common_address
       FROM public.hes_control_points WHERE device_id = $1 AND ioa = $2 AND enabled = true`,
      [String(message.deviceId), Number(message.ioa)]);
    const row = result.rows[0];
    if (!row) return preliminary;
    const point = {type:row.command_type, commonAddress:row.common_address == null ? undefined : row.common_address};
    if (row.min_value != null) point.min = Number(row.min_value);
    if (row.max_value != null) point.max = Number(row.max_value);
    return validateControlRequest(principal, message, {[String(message.deviceId)]:{[String(message.ioa)]:point}});
  } catch (error) {
    console.error('[WS][CONTROL][DB] Whitelist unavailable:', error.code || 'DB_ERROR');
    return {ok:false,code:'CONTROL_POLICY_UNAVAILABLE',message:'Cannot read control whitelist from database; command denied'};
  }
}
module.exports = { validateDatabaseControlRequest };
