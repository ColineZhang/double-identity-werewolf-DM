'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {layoutsFor,deal,legal,golden,lockOrder}=require('../lib/rules');
const dir=mkdtempSync(path.join(tmpdir(),'werewolf-lan-v03-'));
process.env.DATA_FILE=path.join(dir,'rooms.json');
const {server}=require('../server');
let base;
async function request(route,options={},cookie=''){
  const r=await fetch(base+route,{...options,headers:{...(cookie?{cookie}:{}),...(options.headers||{})}});
  const body=r.headers.get('content-type')?.includes('json')?await r.json():await r.text();
  return {status:r.status,body,cookie:r.headers.get('set-cookie')?.split(';')[0]||cookie};
}
const post=(url,body={},cookie='')=>request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},cookie);
const state=cookie=>request('/api/state',{},cookie);

test('production: independent host and six human sessions, private deal, authorized skip, voting and recap',async t=>{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
 assert.equal((await post('/api/create',{testMode:true})).status,400);
 const host=await post('/api/create');assert.equal(host.status,200);const code=host.body.code;
 assert.equal((await state(host.cookie)).body.self.seat,undefined);
 assert.equal((await state(host.cookie)).body.room.playerCount,0);
 for(const route of ['/api/bots','/api/test-mode','/api/test-skip'])assert.equal((await post(route,{action:'fill',enabled:true},host.cookie)).status,404);
 assert.equal((await post('/api/start',{},host.cookie)).status,409);
 const phones=[];
 for(let i=0;i<6;i++){const phone=await post('/api/join',{code,name:'玩家'+(i+1),bot:true});assert.equal(phone.status,200);phones.push(phone);}
 assert.equal((await post('/api/join',{code,name:'第七人'})).status,409);
 assert.equal((await post('/api/start',{},phones[0].cookie)).status,403);
 assert.equal((await post('/api/start',{},host.cookie)).status,200);
 const dealt=(await state(host.cookie)).body;assert.equal(dealt.room.readyCount,0);assert.equal(dealt.self.cards,undefined);
 assert.doesNotMatch(JSON.stringify(dealt),/testMode|botCount|debugBot|"bot"|"cards"/);
 for(const phone of phones){
  const v=(await state(phone.cookie)).body;assert.equal(v.self.cards.length,2);assert.ok(v.room.players.every(p=>!p.cards));
  const top=v.self.cards.find(c=>!(v.self.team==='WOLF'&&c.effectiveRole==='WITCH'));
  assert.equal((await post('/api/lock',{topCardId:top.id},phone.cookie)).status,200);
 }
 assert.equal((await state(host.cookie)).body.room.status,'READY');
 assert.equal((await post('/api/begin',{},host.cookie)).status,200);
 let serial=0;
 const skip=async(mode)=>{
  const v=(await state(host.cookie)).body,g=v.room.game;
  const cmd={mode,gameId:g.id,stepKey:g.stepKey,commandId:'human-game-'+(++serial)};
  assert.equal((await post('/api/skip',cmd,phones[0].cookie)).status,403);
  const result=await post('/api/skip',cmd,host.cookie);assert.equal(result.status,200,JSON.stringify(result.body));return cmd;
 };
 // No phone can act during the unopened introduction; skip does not fabricate a target.
 assert.equal((await post('/api/action',{type:'TARGET',seat:1},phones[0].cookie)).status,409);
 const cmd=await skip('PHASE');assert.equal((await post('/api/skip',cmd,host.cookie)).body.changed,false);
 assert.equal((await post('/api/skip',{...cmd,commandId:'stale-human-command'},host.cookie)).status,409);
 let sawVote=false;
 for(let i=0;i<100;i++){
  const v=(await state(host.cookie)).body,g=v.room.game;
  if(v.room.status==='FINISHED'){
   assert.ok(sawVote);assert.equal(g.reveal.length,6);
   for(const phone of phones){const pg=(await state(phone.cookie)).body.room.game;assert.deepEqual(pg.recap,g.recap);assert.deepEqual(pg.reveal,g.reveal);}
   assert.equal((await post('/api/skip',{...cmd,commandId:'after-finish-command'},host.cookie)).status,409);
   assert.equal((await post('/api/restart',{},host.cookie)).status,200);
   const reset=(await state(host.cookie)).body;assert.equal(reset.room.status,'LOBBY');assert.equal(reset.room.playerCount,6);
   assert.equal((await state(phones[0].cookie)).body.self.cards,undefined);return;
  }
  assert.equal(g.reveal,undefined);assert.equal(g.recap,undefined);assert.equal(g.recapEvents,undefined);
  if(g.phase==='VOTE'){
   sawVote=true;const target=v.room.players.find(p=>!p.eliminated).seat;
   for(const phone of phones){const pv=(await state(phone.cookie)).body;if(pv.self.action?.step==='VOTE')assert.equal((await post('/api/action',{type:'VOTE',seat:target,stepKey:g.stepKey},phone.cookie)).status,200);}
  }
  await skip(g.phase==='NIGHT'?'DAWN':'PHASE');
 }
 assert.fail('six-player game did not finish');
});

test('random deals meet 2023 constraints',()=>{
  assert.equal(layoutsFor().length,6750);
  for(let i=0;i<3000;i++){
    const hands=deal();assert.equal(hands.length,6);
    const goldCount=hands.filter(h=>h.golden).length;assert.ok(goldCount===1||goldCount===2);
    for(const hand of hands){
      assert.ok(legal(hand.cards.map(c=>c.printedRole)));
      assert.equal(golden(hand.cards.map(c=>c.printedRole)),hand.golden);
      const bad=hand.cards.find(c=>c.effectiveRole==='WITCH');
      if(hand.team==='WOLF'&&bad)assert.throws(()=>lockOrder(hand,bad.id),/女巫/);
      const selected=hand.cards.find(c=>!(hand.team==='WOLF'&&c.effectiveRole==='WITCH'));
      const locked=lockOrder(hand,selected.id);assert.equal(locked.cards.filter(c=>c.status==='ACTIVE').length,1);
    }
  }
});
