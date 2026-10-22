'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {Client} = require('pg');
async function main() {
  const missing=['DB_USER','DB_PASS','DB_HOST','DB_NAME'].filter(key=>!process.env[key]);
  if(missing.length) throw new Error('Missing settings: '+missing.join(', '));
  const client=new Client({user:process.env.DB_USER,password:process.env.DB_PASS,
    host:process.env.DB_HOST,port:Number(process.env.DB_PORT||5432),database:process.env.DB_NAME,
    connectionTimeoutMillis:5000,statement_timeout:15000});
  try {
    await client.connect();
    await client.query(fs.readFileSync(path.join(__dirname,'../migrations/20261005_hes_control_points.sql'),'utf8'));
    console.log('hes_control_points migration applied. Existing points preserved.');
  } finally {await client.end();}
}
main().catch(error=>{console.error('Migration failed:',error.code||error.message);process.exitCode=1;});
