const {test} = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../SendIEC104');
test('C_SC_NA_1 frame encodes ON/OFF addresses and execute value',()=>{
  const client=new Client('localhost',2,2404);
  const frames=[];client.socket={write:frame=>frames.push(frame)};
  client.sendSingleCommand(1,1);client.sendSingleCommand(2,1);
  frames.forEach((frame,i)=>{
    assert.equal(frame.length,16);assert.equal(frame[1],14);
    assert.equal(frame[6],45);assert.equal(frame[7],1);
    assert.equal(frame.readUInt16LE(8),6);assert.equal(frame.readUInt16LE(10),2);
    assert.equal(frame.readUIntLE(12,3),i+1);assert.equal(frame[15],1);
    assert.equal(frame.readUInt16LE(2),i*2);
  });
  assert.throws(()=>client.sendSingleCommand(1,2));
});
