'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {tmpdir}=require('node:os');
const game=require('../lib/game');
const {makeRoom}=require('./helpers');
const dir=fs.mkdtempSync(path.join(tmpdir(),'werewolf-change-request-'));
process.env.DATA_FILE=path.join(dir,'rooms.json');
function fixture(code,testMode=true){
 const r=makeRoom([['VILLAGER','WITCH'],['WOLF','VILLAGER'],['HIDDEN_WOLF','VILLAGER'],['WITCH','COPYCAT'],['VILLAGER','VILLAGER'],['GUARD','STALKER']]);
 r.code=code;r.testMode=testMode;r.host={id:'host',sid:code.padEnd(64,'a')};r.players.forEach((p,i)=>p.sid=(code+i).padEnd(64,'b'));return r;
}
const witch=fixture('666661');witch.players[0].hand.cards[0].status='LOST';witch.players[0].hand.cards[1].status='ACTIVE';game.createGame(witch);
witch.game.night=2;witch.game.day=1;witch.game.step=1;game.initStep(witch);game.submitAction(witch,witch.players[1],{type:'TARGET',seat:1});game.advance(witch);
const hidden=fixture('666662');hidden.players[3].bot=true;game.createGame(hidden);hidden.game.step=3;hidden.game.pending={WITCH:{type:'POISON',seat:4}};game.advance(hidden);
const normal=fixture('666663',false);normal.players[3].bot=true;game.createGame(normal);
const timed=fixture('666664',false);game.createGame(timed);timed.game.night=2;timed.game.day=1;timed.game.step=4;game.initStep(timed);
timed.game.pending={WITCH:{type:'POISON',seat:1}};timed.game.nightClock.origin=Date.now()-timed.game.nightClock.windows.at(-1).advance+1800;
const timedBots=fixture('666665',false);timedBots.players.forEach(p=>p.bot=true);game.createGame(timedBots);timedBots.game.step=3;game.initStep(timedBots);timedBots.game.nightClock.origin=Date.now()-timedBots.game.nightClock.windows.at(-1).advance+1800;
const ready=fixture('666666');ready.status='READY';ready.players[3].bot=true;
const rooms=Object.fromEntries([witch,hidden,normal,timed,timedBots,ready].map(r=>[r.code,r]));fs.writeFileSync(process.env.DATA_FILE,JSON.stringify({rooms}));
const {server}=require('../server');
test('HTTP regression: witch privacy, Bot reveal isolation, skip permissions, automatic dawn and persistence',async t=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 async function req(r,actor,route='/api/state',body){
  const sid=actor==='host'?r.host.sid:r.players[actor].sid;
  const result=await fetch(base+route,{method:body?'POST':'GET',headers:{cookie:`werewolf_sid=${sid}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return {status:result.status,body:await result.json()};
 }
 const w=(await req(witch,0)).body;assert.deepEqual(w.self.action.spiritTargets,[1]);assert.equal(w.self.action.canSave,true);
 for(const actor of ['host',0]){
  const v=(await req(ready,actor)).body;assert.equal(v.room.status,'READY');assert.equal(v.room.debugBotHands.length,1);
  assert.deepEqual(v.room.debugBotHands[0].cards.map(c=>[c.order,c.printedRole,c.effectiveRole]),[[0,'WITCH','WITCH'],[1,'COPYCAT','WITCH']]);
  assert.equal(v.room.debugBotHands.some(p=>p.seat===1),false);
 }
 for(const actor of ['host',1,2]){const v=(await req(witch,actor)).body;assert.doesNotMatch(JSON.stringify(v),/spiritTargets|attackSelections|wolfTargetId/);assert.equal(v.self.cards?.some(c=>c.id===w.self.cards[1].id)||false,false);}
 const before=(await req(hidden,'host')).body;
 assert.equal(before.room.game.phase,'SHERIFF');assert.deepEqual(before.room.game.dawnResults,[]);
 assert.equal(before.room.debugBotHands.length,1);assert.equal(before.room.debugBotHands[0].cards[0].status,'ACTIVE');
 assert.equal(before.room.players.find(p=>p.seat===4).remainingCards,2);
 assert.ok(before.room.debugBotActions.every(a=>a.seat===4));
 assert.ok(before.room.debugBotActions.some(a=>a.phase==='SHERIFF_SIGNUP'));
 assert.doesNotMatch(JSON.stringify(before),/pendingLosses|nightHistory|cardId|attackSelections/);
 assert.equal((await req(normal,'host')).body.room.debugBotHands,undefined);
 assert.equal((await req(normal,'host')).body.room.debugBotActions,undefined);
 for(const actor of ['host',0,1]){
  const g=(await req(normal,actor)).body.room.game;
  assert.equal(g.reveal,undefined);assert.equal(g.recap,undefined);assert.equal(g.recapEvents,undefined);
 }
 assert.equal((await req(witch,'host')).body.room.players[0].remainingCards,1);
 assert.deepEqual((await req(hidden,0)).body.room.debugBotActions,before.room.debugBotActions);
 const cmd={mode:'PHASE',gameId:witch.game.id,stepKey:w.room.game.stepKey,commandId:'witch-api-phase'};
 assert.equal((await req(witch,0,'/api/test-skip',cmd)).status,403);
 assert.equal((await req(normal,'host','/api/test-skip',{...cmd,gameId:normal.game.id,stepKey:normal.game.stepKey})).status,409);
 assert.equal((await req(witch,0,'/api/action',{type:'SAVE',seat:1,stepKey:w.room.game.stepKey})).status,200);
 assert.equal((await req(witch,'host','/api/test-skip',cmd)).status,200);
 const same=await req(witch,'host','/api/test-skip',cmd);assert.equal(same.body.changed,false);
 assert.equal((await req(witch,'host','/api/test-skip',{...cmd,commandId:'witch-stale-command'})).status,409);
 let v=(await req(witch,'host')).body;
 await req(witch,'host','/api/test-skip',{mode:'DAWN',gameId:v.room.game.id,stepKey:v.room.game.stepKey,commandId:'witch-api-dawn'});
 assert.equal((await req(witch,0)).body.self.cards[1].status,'ACTIVE');
 // Explicit false choices avoid random Bot signup so this transition is deterministic.
 for(let i=0;i<6;i++)if(i!==3)await req(hidden,i,'/api/action',{type:'SIGNUP',run:false});
 let h=(await req(hidden,'host')).body;
 await req(hidden,'host','/api/test-skip',{mode:'NIGHT',gameId:h.room.game.id,stepKey:h.room.game.stepKey,commandId:'hidden-to-night'});
 h=(await req(hidden,'host')).body;assert.deepEqual(h.room.game.dawnResults[0].seats,[4]);assert.equal(h.room.debugBotHands[0].cards[0].status,'LOST');
 assert.equal(h.room.players.find(p=>p.seat===4).remainingCards,1);
 assert.doesNotMatch(h.room.game.events.join('\n'),/女巫|复制人/);
 // Timer must work with no state requests, in both mixed and all-Bot rooms.
 const until=Date.now()+5000;let persisted;
 do{await new Promise(r=>setTimeout(r,80));persisted=JSON.parse(fs.readFileSync(process.env.DATA_FILE,'utf8'));}while((persisted.rooms[timed.code].game.phase==='NIGHT'||persisted.rooms[timedBots.code].game.phase==='NIGHT')&&Date.now()<until);
 assert.equal(persisted.rooms[timed.code].game.phase,'DISCUSSION');assert.deepEqual(persisted.rooms[timed.code].game.dawnResults[0].seats,[1]);
 assert.equal(persisted.rooms[timedBots.code].game.phase,'SHERIFF');
 for(let i=0;i<3;i++)await req(timed,'host');
 persisted=JSON.parse(fs.readFileSync(process.env.DATA_FILE,'utf8'));assert.equal(persisted.rooms[timed.code].game.nightHistory.length,1);
 assert.equal(persisted.rooms[timed.code].game.dawnResults.length,1);
});
