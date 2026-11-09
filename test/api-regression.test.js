'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {tmpdir}=require('node:os');
const {makeRoom,openWindow}=require('./helpers');
const game=require('../lib/game');
const sheriff=require('../lib/sheriff');
const dir=fs.mkdtempSync(path.join(tmpdir(),'werewolf-api-regression-'));
process.env.DATA_FILE=path.join(dir,'rooms.json');
function fixture(code){
 const room=makeRoom();room.code=code;room.host={id:'host',sid:code.padEnd(64,'a'),lastSeen:Date.now()};
 room.players.forEach((p,i)=>{p.sid=(code+String(i)).padEnd(64,'b');p.lastSeen=Date.now();});
 game.createGame(room);return room;
}
const seer=fixture('888881');seer.game.step=3;game.initStep(seer);openWindow(seer);
const election=fixture('888882');while(election.game.phase==='NIGHT')game.advance(election);
const timed=fixture('888883');while(timed.game.phase==='NIGHT')game.advance(timed);
for(const p of timed.players)sheriff.submit(timed,p,{type:'SIGNUP',run:p.seat<=2});
game.advance(timed);while(timed.game.election.stage==='SPEECH')game.advance(timed);
timed.game.election.deadline=Date.now()+2000;
fs.writeFileSync(process.env.DATA_FILE,JSON.stringify({rooms:{[seer.code]:seer,[election.code]:election,[timed.code]:timed}}));
const {server}=require('../server');

test('HTTP private inspection persistence, election permissions, and server countdown without clients',async t=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep))throw Error('unexpected test path');
  fs.rmSync(dir,{recursive:true,force:true});
 });
 async function req(room,actor,route='/api/state',body){
  const p=actor==='host'?room.host:room.players[actor];
  const r=await fetch(base+route,{method:body?'POST':'GET',headers:{cookie:`werewolf_sid=${p.sid}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,body:await r.json()};
 }
 let r=await req(seer,0,'/api/action',{type:'TARGET',seat:3});assert.equal(r.status,200);
 r=await req(seer,0);assert.deepEqual(r.body.self.inspections,[{night:1,seat:3,team:'狼人',basis:'REAL'}]);
 for(const actor of ['host',1]){
  const other=await req(seer,actor);
  assert.ok(!other.body.self.inspections?.length);
  assert.doesNotMatch(JSON.stringify(other.body.room),/inspection|cardId|nightSnapshot|HIDDEN_WOLF/);
 }
 assert.equal((await req(seer,0,'/api/action',{type:'TARGET',seat:2})).status,409);
 const prior=(await req(seer,'host')).body.room.game.stepKey;
 assert.equal((await req(seer,'host','/api/skip',{mode:'PHASE',gameId:seer.game.id,stepKey:prior,commandId:'seer-skip-first'})).status,200);
 assert.equal((await req(seer,'host','/api/advance',{stepKey:prior})).status,409);
 r=await req(seer,0);assert.equal(r.body.self.action.step,'SHERIFF_SIGNUP');assert.equal(r.body.self.inspections[0].team,'狼人');
 assert.equal((await req(election,'host','/api/action',{type:'SIGNUP',run:true})).status,403);
 assert.equal((await req(election,0,'/api/advance',{})).status,403);
 for(let i=0;i<6;i++)assert.equal((await req(election,i,'/api/action',{type:'SIGNUP',run:i<2})).status,200);
 r=await req(election,'host');assert.deepEqual(r.body.room.game.election.candidates,[]);
 assert.doesNotMatch(JSON.stringify(r.body),/signups|nightSnapshot|"cards"/);
 assert.equal((await req(election,'host','/api/advance',{})).status,200);
 assert.equal((await req(election,1,'/api/action',{type:'WITHDRAW'})).status,200);
 assert.equal((await req(election,0,'/api/action',{type:'END_SPEECH'})).status,409);
 r=await req(election,'host');assert.equal(r.body.room.game.election.deadline,null);
 assert.deepEqual(r.body.room.game.election.withdrawn,[2]);assert.equal(r.body.room.game.election.speaker,undefined);
 assert.equal((await req(election,'host','/api/advance',{})).status,200);
 r=await req(election,'host');assert.equal(r.body.room.game.election.stage,'WITHDRAW');
 assert.equal((await req(election,'host','/api/advance',{})).status,409);
 // No requests to the timed room: inspect the persisted database to prove the server timer ran.
 const until=Date.now()+4000;
 let stored;
 do{await new Promise(resolve=>setTimeout(resolve,100));stored=JSON.parse(fs.readFileSync(process.env.DATA_FILE,'utf8')).rooms[timed.code];}
 while(stored.game.election.stage==='WITHDRAW'&&Date.now()<until);
 assert.equal(stored.game.election.stage,'VOTE');
 r=await req(timed,0,'/api/action',{type:'WITHDRAW'});assert.equal(r.status,409);
});
