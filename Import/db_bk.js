'use strict';

const oracledb = require('oracledb');

// ========== Optional: init Oracle Instant Client ==========
try {
  oracledb.initOracleClient({ libDir: '/opt/oracle/instantclient_21_6' });
} catch (err) {
  console.error('Whoops! initOracleClient failed:', err);
  // Nếu chạy trên máy đã cài sẵn client thì có thể bỏ qua exit
  // process.exit(1);
}

// ========== Pool & Config ==========
let pool;
const CHUNK_SIZE = 1000;

async function initPool() {
  try {
    const required = ['ORACLE_DB_USER', 'ORACLE_DB_PASS', 'ORACLE_DB_CONNECT'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
      throw new Error(`Thiếu cấu hình Oracle legacy: ${missing.join(', ')}`);
    }
    pool = await oracledb.createPool({
      user: process.env.ORACLE_DB_USER,
      password: process.env.ORACLE_DB_PASS,
      connectString: process.env.ORACLE_DB_CONNECT,
      poolMin: Number(process.env.DB_POOL_MIN || 1),
      poolMax: Number(process.env.DB_POOL_MAX || 20),
      poolIncrement: Number(process.env.DB_POOL_INC || 1),
      queueRequests: true,
      queueTimeout: Number(process.env.DB_QUEUE_TIMEOUT || 120000),
      poolTimeout: Number(process.env.DB_POOL_TIMEOUT || 60),
      poolPingInterval: Number(process.env.DB_PING_INTERVAL || 60),
      stmtCacheSize: Number(process.env.DB_STMT_CACHE || 100),
    });

    console.log('✅ Oracle Pool đã sẵn sàng.');
  } catch (err) {
    console.error('❌ Lỗi khi tạo pool:', err);
    process.exit(1);
  }
}

// ========== Leak Tracker (tùy chọn, bật qua env) ==========
const ENABLE_LEAK_TRACK = String(process.env.DB_LEAK_TRACK || 'false') === 'true';
const inUseMap = new Map();

function stampConn(conn, tag) {
  if (!ENABLE_LEAK_TRACK) return;
  try {
    conn._connTag = tag || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    inUseMap.set(conn._connTag, { at: new Error().stack, ts: Date.now() });
  } catch { }
}

function unstampConn(conn) {
  if (!ENABLE_LEAK_TRACK) return;
  try {
    if (conn && conn._connTag) inUseMap.delete(conn._connTag);
  } catch { }
}

if (ENABLE_LEAK_TRACK) {
  setInterval(() => {
    if (inUseMap.size) {
      console.warn('🔎 Connections suspected in-use:', inUseMap.size);
      for (const [k, v] of inUseMap) {
        console.warn(`— tag=${k} age=${((Date.now() - v.ts) / 1000).toFixed(1)}s\n${v.at}`);
      }
    }
  }, 10_000).unref();
}

// ========== Helper: parse "DD/MM/YYYY HH24:MI:SS" -> JS Date ==========
function parseDdMMyyyyHHmmss(s) {
  // input ví dụ: "27/07/2025 13:45:10"
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

// ========== Public API ==========
async function insertCambienLog(dataArray, opts = {}) {
  if (!pool) {
    throw new Error('Oracle pool chưa khởi tạo. Hãy gọi initPool() trước.');
  }

  // Log pool snapshot trước khi lấy connection
  console.log(
    `Pool before getConnection - Open: ${pool.connectionsOpen}, InUse: ${pool.connectionsInUse}`
  );

  let connection;
  const t0 = Date.now();
  try {
    connection = await pool.getConnection();
    stampConn(connection, `job-${opts.jobId || 'n/a'}`);

    // Cắt statement nếu treo quá lâu (ms)
    connection.callTimeout = Number(process.env.DB_CALL_TIMEOUT || 60_000);

    console.log('⏱️ getConnection waited', Date.now() - t0, 'ms');

    // CHUNK dữ liệu để transaction ngắn, trả conn sớm hơn
    for (let i = 0; i < dataArray.length; i += CHUNK_SIZE) {
      const chunk = dataArray.slice(i, i + CHUNK_SIZE);

      // Map binds -> dùng DATE bind thay vì TO_DATE chuỗi
      const binds = chunk.map(([_, id_thietbi, id_cambien, value, time]) => ({
        id_thietbi: Number(id_thietbi),
        id_cambien: Number(id_cambien),
        value: value === '' || value == null ? null : Number(value),
        time: parseDdMMyyyyHHmmss(time),
      }));

      // Validate nhanh nếu time parse fail
      const bad = binds.find(b => b.time === null);
      if (bad) {
        throw new Error(`Invalid time format, expect "DD/MM/YYYY HH24:MI:SS": ${JSON.stringify(bad)}`);
      }

      const sql = `
        MERGE INTO CAMBIEN_LOG l
        USING (SELECT :id_thietbi AS id_thietbi, :id_cambien AS id_cambien FROM dual) d
        ON (l.ID_THIETBI = d.id_thietbi AND l.ID_CAMBIEN = d.id_cambien)
        WHEN MATCHED THEN
          UPDATE SET l.VALUE = :value,
                     l.TIME = :time,
                     l.TIMEINSERT = SYSDATE
        WHEN NOT MATCHED THEN
          INSERT (ID_THIETBI, ID_CAMBIEN, VALUE, TIMEINSERT, TIME)
          VALUES (:id_thietbi, :id_cambien, :value, SYSDATE, :time)
      `;

      await connection.executeMany(sql, binds, {
        autoCommit: false, // commit theo batch
        bindDefs: {
          id_thietbi: { type: oracledb.NUMBER },
          id_cambien: { type: oracledb.NUMBER },
          value: { type: oracledb.NUMBER },
          time: { type: oracledb.DATE },
        },
      });

      // 2. UPDATE TT_THIETBI sau khi merge
      const updateSql = `
  UPDATE TT_THIETBI 
  SET TGKETNOI = SYSDATE, KETNOI = 1 
  WHERE ID_THIETBI = :id_thietbi
`;

      // Loại bỏ thiết bị trùng lặp để tránh update nhiều lần không cần thiết
      const updateBinds = [...new Set(binds.map(b => b.id_thietbi))].map(id => ({ id_thietbi: id }));

      await connection.executeMany(updateSql, updateBinds, {
        autoCommit: false,
        bindDefs: {
          id_thietbi: { type: oracledb.NUMBER }
        }
      });

      await connection.commit();
    }
  } catch (err) {
    console.error('❌ Lỗi insert:', err);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error('❌ Lỗi rollback:', rollbackErr);
      }
    }
    throw err;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error('❌ Lỗi khi đóng kết nối:', closeErr);
      } finally {
        unstampConn(connection);
      }
    }
  }
}

// Tiện ích: xem nhanh pool
function getPoolStatus() {
  if (!pool) return { open: 0, inUse: 0, hasPool: false };
  return {
    open: pool.connectionsOpen,
    inUse: pool.connectionsInUse,
    hasPool: true,
  };
}

module.exports = {
  initPool,
  insertCambienLog,
  getPoolStatus,
};
