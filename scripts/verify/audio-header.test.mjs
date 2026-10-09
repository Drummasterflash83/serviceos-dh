import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectAudioHeader} from './audio-header.mjs';
function wav(dataBytes=65){
 const b=Buffer.alloc(64);b.write('RIFF',0);b.writeUInt32LE(52+dataBytes,4);b.write('WAVE',8);
 b.write('fmt ',12);b.writeUInt32LE(20,16);b.writeUInt16LE(49,20);b.writeUInt16LE(1,22);
 b.writeUInt32LE(8000,24);b.writeUInt32LE(1625,28);b.writeUInt16LE(65,32);
 b.write('fact',40);b.writeUInt32LE(4,44);b.writeUInt32LE(320,48);
 b.write('data',52);b.writeUInt32LE(dataBytes,56);return b;
}
test('WAV inspection handles buffer offsets, binary format fields and empty payloads',()=>{
 for(const bytes of [0,65,2849470]){
  const padded=Buffer.concat([Buffer.alloc(7),wav(bytes),Buffer.alloc(9)]);
  const result=inspectAudioHeader(padded.subarray(7,71));
  assert.equal(result.format,'wav');assert.equal(result.declared_wav_bytes,60+bytes);
  assert.deepEqual(result.wav,{format_tag:49,channels:1,sample_rate:8000,byte_rate:1625,bits_per_sample:0,data_bytes:bytes});
 }
});
test('truncated or distant data chunks stay unknown; odd chunks use RIFF padding',()=>{
 assert.equal(inspectAudioHeader(wav().subarray(0,55)).wav.data_bytes,undefined);
 const b=wav();b.write('JUNK',12);b.writeUInt32LE(1,16);b.write('data',22);b.writeUInt32LE(0,26);
 assert.equal(inspectAudioHeader(b).wav.data_bytes,0);
 b.writeUInt32LE(4096,16);assert.deepEqual(inspectAudioHeader(b).wav,{});
 for(let i=0;i<12;i++)assert.equal(inspectAudioHeader(wav().subarray(0,i)).format,null);
});
