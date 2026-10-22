'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateDatabaseControlRequest:validate}=require('../WebSocket/control-policy-db');
const principal={permissions:new Set(['control.execute']),allowedDevices:new Set(['366502'])};
const command={deviceId:'366502',ioa:1,value:1,commandType:'C_SC_NA_1'};
test('reads database on every command; deletion/revocation takes effect immediately',async()=>{
  let rows=[{command_type:'C_SC_NA_1',min_value:1,max_value:1,common_address:null}];let calls=0;
  const db={query:async(sql,params)=>{calls++;assert.match(sql,/enabled = true/);assert.deepEqual(params,['366502',1]);return {rows};}};
  const result=await validate(principal,command,db);assert.equal(result.ok,true);assert.equal(result.command.commonAddress,null);
  rows=[];assert.equal((await validate(principal,command,db)).code,'IOA_FORBIDDEN');assert.equal(calls,2);
});
test('does not query database for unauthorized devices or malformed requests',async()=>{
 const db={query:()=>{throw new Error('Must not query');}};
 assert.equal((await validate(principal,{...command,deviceId:'999'},db)).code,'DEVICE_FORBIDDEN');
 assert.equal((await validate({...principal,permissions:new Set()},command,db)).code,'FORBIDDEN');
 assert.equal((await validate(principal,{...command,ioa:-1},db)).code,'INVALID_CONTROL');
});
test('database errors deny commands, never fall back to JSON',async()=>{
 assert.equal((await validate(principal,command,{query:async()=>{throw {code:'ECONNREFUSED'};}})).code,'CONTROL_POLICY_UNAVAILABLE');
});
test('database points enforce command type and value range',async()=>{
 const db={query:async()=>({rows:[{command_type:'C_SC_NA_1',min_value:1,max_value:1,common_address:2}]})};
 assert.equal((await validate(principal,{...command,value:0},db)).code,'VALUE_OUT_OF_RANGE');
 assert.equal((await validate(principal,{...command,commandType:'C_SE_NC_1'},db)).code,'CONTROL_TYPE_MISMATCH');
});
