'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../public/voice');
const {pack}=require('../lib/narrator');
function fixture(defer=false,autoStart=false,isHost=true){
 let plays=0,requests=[],fetches=0,voice,pending=[],audio;
 const state={joined:true,self:{isHost},room:{code:'123456',status:'GAME',narration:{enabled:false,paused:false,origin:Date.now(),gameId:'test',plan:[{id:1,cue:'N00',at:0,duration:20000}]}}};
 class Audio{constructor(){this.paused=true;audio=this;}play(){this.paused=false;plays++;return defer&&plays>1?new Promise((resolve,reject)=>pending.push({resolve,reject})):Promise.resolve();}pause(){this.paused=true;}}
 const env={Audio,fetch:async()=>{fetches++;return {ok:true,json:async()=>pack,arrayBuffer:async()=>new ArrayBuffer(0)};}};
 voice=create({env,autoStart,request:async({action})=>{requests.push(action);const n=state.room.narration;if(action==='enable'||action==='attach')n.enabled=true;if(action==='pause'){n.paused=true;n.pausedAt=Date.now();}if(action==='resume')n.paused=false;if(action==='disable')n.enabled=false;return {lease:{until:Date.now()+15000,serverNow:Date.now()}};},refresh:async()=>voice.accept(structuredClone(state))});
 voice.accept(structuredClone(state));return {voice,state,pending,get audio(){return audio;},get plays(){return plays;},get requests(){return requests;},get fetches(){return fetches;}};
}
test('only an activated host fetches/plays audio; repeated state refresh does not replay cues',async()=>{
 const f=fixture();f.state.self.isHost=false;f.voice.accept(f.state);await f.voice.enable();assert.equal(f.fetches,0);assert.equal(f.plays,0);
 f.state.self.isHost=true;f.voice.accept(f.state);await f.voice.enable();assert.equal(f.voice.status().active,true);
 const played=f.plays;for(let i=0;i<4;i++)f.voice.accept(structuredClone(f.state));assert.equal(f.plays,played);
 await f.voice.control('pause');assert.equal(f.voice.status().playing,false);
 await f.voice.replay();assert.equal(f.voice.status().preview,true);assert.equal(f.state.room.narration.paused,true);
 await f.voice.control('resume');assert.equal(f.voice.status().preview,false);assert.equal(f.voice.status().playing,true);
 await f.voice.control('disable');assert.equal(f.voice.status().active,false);assert.equal(f.voice.status().playing,false);
 f.voice.destroy();
});
test('test playback freezes the game and disconnect requests a pause',async()=>{
 const f=fixture();await f.voice.enable();await f.voice.test();assert.equal(f.state.room.narration.paused,true);
 assert.equal(f.voice.status().preview,true);await f.voice.control('resume');f.voice.disconnect();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.requests.at(-1),'pause');assert.equal(f.voice.status().playing,false);
 f.voice.destroy();
});

test('voice uses 1.5x speed and scales seek positions; replay and preview also use 1.5x',async()=>{
 const f=fixture();f.state.room.narration.plan[0].playbackRate=1.5;
 f.state.room.narration.origin=Date.now()-2000;
 await f.voice.enable();assert.equal(f.audio.playbackRate,1.5);assert.equal(f.audio.preservesPitch,true);
 assert.ok(f.audio.currentTime>=3&&f.audio.currentTime<3.5);
 await f.voice.control('pause');await f.voice.replay();assert.equal(f.audio.playbackRate,1.5);assert.equal(f.audio.currentTime,0);
 await f.voice.test();assert.equal(f.audio.playbackRate,1.5);f.voice.destroy();
});
test('a superseded play promise cannot pause a resumed game',async()=>{
 const f=fixture(true);await f.voice.enable();assert.equal(f.pending.length,1);
 await f.voice.control('pause');await f.voice.control('resume');
 f.pending[0].reject(Object.assign(Error('play interrupted by pause'),{name:'AbortError'}));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.requests.filter(action=>action==='pause').length,1);
 assert.equal(f.state.room.narration.paused,false);assert.equal(f.voice.status().message,'');
 // An actual playback error on the current attempt still freezes the game.
 f.pending.at(-1).reject(Error('audio unavailable'));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.state.room.narration.paused,true);assert.match(f.voice.status().message,/audio unavailable/);
 f.voice.destroy();
});

 test('default hosting attaches once; phone clients remain silent',async()=>{
  const f=fixture(false,true);await f.voice.enable();assert.equal(f.voice.status().active,true);
  assert.deepEqual(f.requests,['attach']);
  for(let i=0;i<4;i++)f.voice.accept(structuredClone(f.state));
  assert.deepEqual(f.requests,['attach']);
  await f.voice.control('pause');f.voice.accept(structuredClone(f.state));
  assert.equal(f.state.room.narration.paused,true);
  f.voice.destroy();
  const phone=fixture(false,true,false);await phone.voice.test();
  assert.equal(phone.fetches,0);assert.equal(phone.plays,0);assert.equal(phone.requests.length,0);phone.voice.destroy();
 });
 test('volume test works before activation and pauses the game until explicitly resumed',async()=>{
  const f=fixture();await f.voice.test();
  assert.equal(f.voice.status().active,true);assert.equal(f.voice.status().preview,true);
  assert.equal(f.state.room.narration.paused,true);assert.match(f.audio.src,/test.wav$/);
  f.audio.onended();assert.equal(f.state.room.narration.paused,true);
  await f.voice.control('resume');assert.equal(f.state.room.narration.paused,false);f.voice.destroy();
 });
 test('blocked autoplay can recover from volume test without repeated automatic retries',async()=>{
  const f=fixture();const original=f.audio.play.bind(f.audio);
  f.audio.play=()=>Promise.reject(Error('NotAllowedError'));
  assert.equal(await f.voice.enable('attach'),false);assert.equal(f.audio.volume,1);
  assert.equal(f.requests.length,0);
  f.audio.play=original;await f.voice.test();assert.equal(f.voice.status().preview,true);f.voice.destroy();
 });
