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

test('independent host + phone join + five bots + lock -> interactive game -> outcome',async t=>{
  await new Promise(done=>server.listen(0,'127.0.0.1',done));base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const host=await post('/api/create',{testMode:true});assert.equal(host.status,200);
  const code=host.body.code;
  const initial=(await state(host.cookie)).body;
  assert.equal(initial.self.isHost,true);
  assert.equal(initial.self.seat,undefined);
  assert.equal(initial.room.playerCount,0);
  const phone=await post('/api/join',{code,name:'手机测试玩家'});assert.equal(phone.status,200);
  const me=(await state(phone.cookie)).body;
  assert.equal(me.self.seat,1);
  assert.equal(me.self.isHost,false);
  assert.equal((await post('/api/bots',{action:'add'},phone.cookie)).status,403);
  assert.equal((await post('/api/bots',{action:'fill'},host.cookie)).status,200);
  const filled=(await state(host.cookie)).body;
  assert.equal(filled.room.playerCount,6);
  assert.equal(filled.room.botCount,5);
  assert.equal((await post('/api/join',{code,name:'第七人'})).status,409);
  assert.equal((await post('/api/start',{},host.cookie)).status,200);
  const hostDeal=(await state(host.cookie)).body;
  assert.equal(hostDeal.room.status,'ORDERING');
  assert.equal(hostDeal.room.readyCount,5);
  assert.equal(hostDeal.self.cards,undefined);assert.equal(hostDeal.room.debugBotHands.length,5);assert.ok(hostDeal.room.debugBotHands.every(p=>p.seat!==1),'human hands stay private');
  assert.equal((await post('/api/lock',{topCardId:'xxx'},host.cookie)).status,403);
  const myHand=(await state(phone.cookie)).body.self;
  assert.equal(myHand.cards.length,2);
  const allowed=myHand.cards.find(c=>!(myHand.team==='WOLF'&&c.effectiveRole==='WITCH'));
  assert.equal((await post('/api/lock',{topCardId:allowed.id},phone.cookie)).status,200);
  assert.equal((await state(host.cookie)).body.room.status,'READY');
  assert.equal((await post('/api/begin',{},phone.cookie)).status,403);
  assert.equal((await post('/api/begin',{},host.cookie)).status,200);
  let seenDay=false, seenNight=false, seenVote=false, seenNightTwo=false;
  let lastPhaseKey='';
  for(let i=0;i<700;i++){
    const view=(await state(phone.cookie)).body;
    if(view.room.status==='FINISHED'){
      assert.ok(seenNight&&seenDay,'must traverse night and election');
      assert.ok(['WOLF','VILLAGE'].includes(view.room.game.winner));
      const fromHost=(await state(host.cookie)).body;
      assert.equal(fromHost.room.game.winner,view.room.game.winner);
      assert.equal(view.room.game.reveal.length,6);
      assert.deepEqual(fromHost.room.game.reveal,view.room.game.reveal);
      assert.deepEqual(fromHost.room.game.recap,view.room.game.recap);
      assert.ok(view.room.game.recap.rounds.length);
      assert.equal((await post('/api/restart',{},host.cookie)).status,200);
      assert.equal((await state(phone.cookie)).body.room.status,'LOBBY');
      assert.equal((await state(phone.cookie)).body.self.cards,undefined);
      return;
    }
    const g=view.room.game;
    assert.equal(g.reveal,undefined);assert.equal(g.recap,undefined);assert.equal(g.recapEvents,undefined);
    seenNight ||= g.phase==='NIGHT';seenDay ||= g.phase==='SHERIFF';seenVote ||= g.phase==='VOTE';seenNightTwo ||=g.night>=2;
    const av=view.self.action;
    if(av){
      let type=av.step==='SHERIFF_SIGNUP'?'SIGNUP':av.step==='BADGE'?'TRANSFER':av.step==='WITCH'?'PASS':['SHERIFF','VOTE'].includes(av.step)?'VOTE':'TARGET';
      let target=av.targets.length?av.targets[0]:null;
      if(av.step==='WITCH')target=null;
      const submitted=await post('/api/action',{type,seat:target,run:false,stepKey:g.stepKey},phone.cookie);
      assert.equal(submitted.status,200,JSON.stringify({g,av,submitted:submitted.body}));
    }
    
    const adv=await post('/api/test-skip',{mode:'PHASE',stepKey:g.stepKey,gameId:g.id,commandId:'simulation-'+i},host.cookie);
    if(adv.status===409&&/阶段已经改变|倒计时/.test(adv.body.error))continue;
    assert.equal(adv.status,200,JSON.stringify(adv.body));
  }
  assert.fail('test game did not finish in 700 manual phase advances');
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
