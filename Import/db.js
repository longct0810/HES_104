'use strict';

const { Pool } = require('pg');

let pool;
const CHUNK_SIZE = 1000;

async function initPool() {
  try {
    pool = new Pool({
      user: process.env.DB_USER || 'SMARTGRID',
      password: process.env.DB_PASS || 'SMARTGRID',
      host: process.env.DB_HOST || '10.21.12.84',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'ifc',

      min: Number(process.env.DB_POOL_MIN || 1),
      max: Number(process.env.DB_POOL_MAX || 20),

      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT || 15000),
      idleTimeoutMillis: Number(process.env.DB_POOL_TIMEOUT || 60000),
      statement_timeout: Number(process.env.DB_CALL_TIMEOUT || 60000),
      query_timeout: Number(process.env.DB_CALL_TIMEOUT || 60000),
    });

    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL Pool đã sẵn sàng.');
  } catch (err) {
    console.error('❌ Lỗi khi tạo PostgreSQL pool:', err);
    process.exit(1);
  }
}

function parseDdMMyyyyHHmmss(s) {
  if (!s || typeof s !== 'string') return null;

  const [dd, mm, rest] = s.split('/');
  if (!dd || !mm || !rest) return null;

  const [yyyy, time] = rest.split(' ');
  if (!yyyy || !time) return null;

  const [HH, MI, SS] = time.split(':');

  const d = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(HH),
    Number(MI),
    Number(SS)
  );

  return Number.isNaN(d.getTime()) ? null : d;
}

async function insertCambienLog(dataArray, opts = {}) {
  if (!pool) {
    throw new Error('PostgreSQL pool chưa khởi tạo. Hãy gọi initPool() trước.');
  }

  console.log(
    `Pool before connect - Total: ${pool.totalCount}, Idle: ${pool.idleCount}, Waiting: ${pool.waitingCount}`
  );

  const t0 = Date.now();
  const client = await pool.connect();

  try {
    console.log('⏱️ getConnection waited', Date.now() - t0, 'ms');

    for (let i = 0; i < dataArray.length; i += CHUNK_SIZE) {
      const chunk = dataArray.slice(i, i + CHUNK_SIZE);

      const binds = chunk.map(([_, id_thietbi, id_cambien, value, time]) => ({
        id_thietbi: Number(id_thietbi),
        id_cambien: Number(id_cambien),
        value: value === '' || value == null ? null : Number(value),
        time: parseDdMMyyyyHHmmss(time),
      }));

      const bad = binds.find(b => b.time === null);
      if (bad) {
        throw new Error(
          `Invalid time format, expect "DD/MM/YYYY HH24:MI:SS": ${JSON.stringify(bad)}`
        );
      }

      await client.query('BEGIN');

      for (const b of binds) {
        await client.query(
          `
          INSERT INTO CAMBIEN_LOG
            (ID_THIETBI, ID_CAMBIEN, VALUE, TIMEINSERT, TIME)
          VALUES
            ($1, $2, $3, NOW(), $4)
          ON CONFLICT (ID_THIETBI, ID_CAMBIEN)
          DO UPDATE SET
            VALUE = EXCLUDED.VALUE,
            TIME = EXCLUDED.TIME,
            TIMEINSERT = NOW()
          `,
          [b.id_thietbi, b.id_cambien, b.value, b.time]
        );
      }

      const idThietbis = [...new Set(binds.map(b => b.id_thietbi))];

      await client.query(
        `
        UPDATE TT_THIETBI
        SET TGKETNOI = NOW(),
            KETNOI = 1
        WHERE ID_THIETBI = ANY($1)
        `,
        [idThietbis]
      );

      await client.query('COMMIT');
    }
  } catch (err) {
    console.error('❌ Lỗi insert PostgreSQL:', err);

    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('❌ Lỗi rollback:', rollbackErr);
    }

    throw err;
  } finally {
    client.release();
  }
}

function getPoolStatus() {
  if (!pool) {
    return {
      total: 0,
      idle: 0,
      waiting: 0,
      hasPool: false,
    };
  }

  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    hasPool: true,
  };
}

module.exports = {
  initPool,
  insertCambienLog,
  getPoolStatus,
};