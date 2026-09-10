'use strict';

const { Pool } = require('pg');

let pool;
const CHUNK_SIZE = Number(process.env.DB_CHUNK_SIZE || 1000);

async function initPool() {
  if (pool) return;

  const required = ['DB_USER', 'DB_PASS', 'DB_HOST', 'DB_NAME'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Thiếu cấu hình PostgreSQL trong environment: ${missing.join(', ')}`);
  }

  pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    max: Number(process.env.DB_POOL_MAX || 20),
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT || 15000),
    idleTimeoutMillis: Number(process.env.DB_POOL_TIMEOUT || 60000),
    statement_timeout: Number(process.env.DB_CALL_TIMEOUT || 60000),
    query_timeout: Number(process.env.DB_CALL_TIMEOUT || 60000),
  });

  await pool.query('SELECT 1');
  console.log('✅ PostgreSQL Pool đã sẵn sàng.');
}

function parseDdMMyyyyHHmmss(value) {
  if (!value || typeof value !== 'string') return null;

  const match = value.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/
  );
  if (!match) return null;

  const [, dd, mm, yyyy, HH, MI, SS, ms = '0'] = match;
  const date = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(HH),
    Number(MI),
    Number(SS),
    Number(ms.padEnd(3, '0'))
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeChunk(chunk) {
  // Nếu trong cùng job có lặp cùng (device, IOA), giữ bản cuối cùng để tránh
  // PostgreSQL ON CONFLICT cố update cùng row hai lần trong một statement.
  const byKey = new Map();

  for (const row of chunk) {
    const [, idThietbiRaw, idCambienRaw, valueRaw, timeRaw] = row;
    const idThietbi = Number(idThietbiRaw);
    const idCambien = Number(idCambienRaw);
    const value = valueRaw === '' || valueRaw == null ? null : Number(valueRaw);
    const time = parseDdMMyyyyHHmmss(timeRaw);

    if (!Number.isFinite(idThietbi) || !Number.isFinite(idCambien)) {
      throw new Error(`Invalid device/IOA: ${JSON.stringify(row)}`);
    }
    if (value !== null && !Number.isFinite(value)) {
      throw new Error(`Invalid numeric value: ${JSON.stringify(row)}`);
    }
    if (!time) {
      throw new Error(`Invalid time format, expect "DD/MM/YYYY HH24:MI:SS": ${JSON.stringify(row)}`);
    }

    byKey.set(`${idThietbi}:${idCambien}`, {
      idThietbi,
      idCambien,
      value,
      time,
    });
  }

  return [...byKey.values()];
}

async function insertCambienLog(dataArray) {
  if (!pool) {
    throw new Error('PostgreSQL pool chưa khởi tạo. Hãy gọi initPool() trước.');
  }
  if (!Array.isArray(dataArray) || dataArray.length === 0) return;

  const client = await pool.connect();

  try {
    for (let i = 0; i < dataArray.length; i += CHUNK_SIZE) {
      const binds = normalizeChunk(dataArray.slice(i, i + CHUNK_SIZE));
      if (binds.length === 0) continue;

      const idsThietbi = binds.map((b) => b.idThietbi);
      const idsCambien = binds.map((b) => b.idCambien);
      const values = binds.map((b) => b.value);
      const times = binds.map((b) => b.time);

      await client.query('BEGIN');

      await client.query(
        `
        INSERT INTO CAMBIEN_LOG
          (ID_THIETBI, ID_CAMBIEN, VALUE, TIMEINSERT, TIME)
        SELECT
          src.id_thietbi,
          src.id_cambien,
          src.value,
          NOW(),
          src.event_time
        FROM UNNEST(
          $1::bigint[],
          $2::bigint[],
          $3::double precision[],
          $4::timestamp[]
        ) AS src(id_thietbi, id_cambien, value, event_time)
        ON CONFLICT (ID_THIETBI, ID_CAMBIEN)
        DO UPDATE SET
          VALUE = EXCLUDED.VALUE,
          TIME = EXCLUDED.TIME,
          TIMEINSERT = NOW()
        WHERE CAMBIEN_LOG.TIME IS NULL
           OR EXCLUDED.TIME >= CAMBIEN_LOG.TIME
        `,
        [idsThietbi, idsCambien, values, times]
      );

      const distinctDeviceIds = [...new Set(idsThietbi)];
      await client.query(
        `
        UPDATE TT_THIETBI
        SET TGKETNOI = NOW(),
            KETNOI = 1
        WHERE ID_THIETBI = ANY($1::bigint[])
        `,
        [distinctDeviceIds]
      );

      await client.query('COMMIT');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('❌ Lỗi rollback:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

function getPoolStatus() {
  if (!pool) return { total: 0, idle: 0, waiting: 0, hasPool: false };
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    hasPool: true,
  };
}

async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

module.exports = {
  initPool,
  insertCambienLog,
  getPoolStatus,
  closePool,
  parseDdMMyyyyHHmmss,
};
