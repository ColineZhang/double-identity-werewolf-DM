'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const {makeRoom}=require('./helpers');

function room(){
 const r=makeRoom([['GUARD','COPYCAT'],['WOLF','VILLAGER'],['HIDDEN_WOLF','VILLAGER'],['WITCH','VILLAGER'],['VILLAGER','VILLAGER'],['STALKER','SEER']]);
 game.createGame(r);return r;
}
function at(r,night,step){r.game.night=night;r.game.day=night-1;r.game.phase='NIGHT';r.game.step=step;game.initStep(r);}
function finish(r){while(r.game.phase==='NIGHT')game.advance(r);}

test('guard may return to an earlier target after a PASS night, but not on consecutive nights',()=>{
 const r=room(),guard=r.players[0];
 game.submitAction(r,guard,{type:'TARGET',seat:5});game.advance(r);
 at(r,2,0);assert.equal(game.targets(r,guard).includes(5),false);
 game.submitAction(r,guard,{type:'TARGET',seat:null});game.advance(r);
 at(r,3,0);assert.equal(game.targets(r,guard).includes(5),true);
 game.submitAction(r,guard,{type:'TARGET',seat:5});game.advance(r);
 at(r,4,0);assert.equal(game.targets(r,guard).includes(5),false);
});

test('copied guard has an independent selection history',()=>{
 const r=room(),guard=r.players[0];
 game.submitAction(r,guard,{type:'TARGET',seat:5});game.advance(r);
 guard.hand.cards[0].status='LOST';guard.hand.cards[1].status='ACTIVE';
 at(r,2,0);assert.equal(game.targets(r,guard).includes(5),true);
});

test('stalker cannot reuse an earlier day ballot after an explosion skips today voting',()=>{
 const r=room(),stalker=r.players[5];
 r.game.phase='VOTE';r.game.day=1;game.initStep(r);
 for(const p of r.players)game.submitAction(r,p,{type:'VOTE',seat:p===stalker?5:null});
 game.advance(r);assert.equal(r.game.night,2);
 // The identity hit by the vote is lost, but its remaining identity is a legal target.
 while(r.game.step<4)game.advance(r);
 assert.equal(game.eligible(r,stalker),true);assert.deepEqual(game.targets(r,stalker),[5]);
 game.advance(r);assert.equal(r.game.phase,'DISCUSSION');
 game.submitAction(r,r.players[1],{type:'EXPLODE'});
 assert.equal(r.game.night,3);
 while(r.game.step<4)game.advance(r);
 assert.equal(game.eligible(r,stalker),false);
 assert.equal(game.selfActionView(r,stalker),null);
});

test('election explosion ending the game still publishes pending night loss before victory',()=>{
 const r=room();
 // Remove the other wolf from this deterministic fixture; only seat 2 remains.
 r.players[2].hand.cards[0].status='LOST';r.players[2].hand.cards[1].status='ACTIVE';
 game.createGame(r);
 game.advance(r);game.advance(r);
 game.submitAction(r,r.players[3],{type:'POISON',seat:5});finish(r);
 for(const p of r.players)game.submitAction(r,p,{type:'SIGNUP',run:p.seat===2});
 game.advance(r);game.submitAction(r,r.players[1],{type:'EXPLODE'});
 assert.equal(r.game.winner,'VILLAGE');assert.equal(r.game.dawnPending,false);
 assert.deepEqual(r.game.dawnResults[0].seats,[5]);
 const events=r.game.events;
 assert.ok(events.indexOf('5号昨夜失去一张身份牌，剩余一张身份牌。')>events.findIndex(x=>x.includes('警徽流失')));
 assert.ok(events.indexOf('5号昨夜失去一张身份牌，剩余一张身份牌。')<events.indexOf('好人获胜'));
});

test('dormant hidden wolf joins the pack but cannot explode; inspection still follows current identity',()=>{
 const r=makeRoom([['SEER','VILLAGER'],['VILLAGER','WOLF'],['VILLAGER','HIDDEN_WOLF'],['WITCH','GUARD'],['VILLAGER','VILLAGER'],['STALKER','COPYCAT']]);game.createGame(r);
 at(r,2,1);
 assert.deepEqual(game.wolves(r).map(p=>p.seat),[3]);
 assert.equal(game.eligible(r,r.players[1]),false);assert.equal(game.eligible(r,r.players[2]),true);
 at(r,2,3);game.submitAction(r,r.players[0],{type:'TARGET',seat:3});
 assert.equal(r.players[0].lastInspection.team,'好人');
 r.game.phase='DISCUSSION';assert.equal(game.canExplode(r,r.players[2]),false);
 r.players[2].hand.cards[0].status='LOST';r.players[2].hand.cards[1].status='ACTIVE';
 assert.equal(game.canExplode(r,r.players[2]),true);
 at(r,3,3);game.submitAction(r,r.players[0],{type:'TARGET',seat:3});assert.equal(r.players[0].lastInspection.team,'狼人');
});

test('copied wolf is a wolf on both identities; the second card remains eligible after the first is lost',()=>{
 const r=makeRoom([['SEER','VILLAGER'],['WOLF','COPYCAT'],['HIDDEN_WOLF','VILLAGER'],['WITCH','VILLAGER'],['VILLAGER','VILLAGER'],['GUARD','STALKER']]);game.createGame(r);
 for(const night of [1,2]){
  at(r,night,3);game.submitAction(r,r.players[0],{type:'TARGET',seat:2});assert.equal(r.players[0].lastInspection.team,'狼人');
  if(night===1){r.players[1].hand.cards[0].status='LOST';r.players[1].hand.cards[1].status='ACTIVE';}
 }
 at(r,2,1);assert.equal(game.eligible(r,r.players[1]),true);
});

test('copied stalker cannot inherit the previous identity ballot even though its use is fresh',()=>{
 const r=makeRoom();game.createGame(r);const p=r.players[5];at(r,2,4);
 r.game.lastVotes[p.id]={day:1,targetId:r.players[4].id,cardId:game.current(p).id};
 assert.equal(game.eligible(r,p),true);
 p.hand.cards[0].status='LOST';p.hand.cards[1].status='ACTIVE';
 assert.equal(game.current(p).usedStalk,undefined);assert.equal(game.eligible(r,p),false);
});

test('persisted v3 stalker ballots use their public vote date, never a newer discussion day',()=>{
 const r=room(),p=r.players[5];at(r,2,4);
 r.game.lastVotes[p.id]={targetId:r.players[4].id,cardId:game.current(p).id};
 r.game.voteResults=[{kind:'EXILE',day:1}];
 const restored=JSON.parse(JSON.stringify(r));game.upgrade(restored);
 assert.equal(game.eligible(restored,restored.players[5]),true);
 restored.game.day=2;restored.game.night=3;
 assert.equal(game.eligible(restored,restored.players[5]),false);
});

test('confirmed table rule: wolf votes choose the largest tally and ties give no knife',()=>{
 for(const [choices,target] of [[[5,5],5],[[5,6],null],[[5,null],5],[[null,null],null]]){
  const r=room();at(r,2,1);
  for(const [index,seat] of choices.entries())game.submitAction(r,r.players[index+1],{type:'TARGET',seat});
  game.advance(r);assert.equal(r.game.pending.WOLF.seat,target);
 }
});

test('confirmed table rule: repeated vote changes before close use only the final ballot',()=>{
 const r=room();r.game.phase='VOTE';r.game.day=1;game.initStep(r);
 for(const p of r.players)game.submitAction(r,p,{type:'VOTE',seat:null});
 for(const seat of [2,3,5,2,5])game.submitAction(r,r.players[0],{type:'VOTE',seat});
 game.advance(r);
 assert.equal(r.game.voteResults[0].selected,5);assert.equal(r.game.voteResults[0].selectedVotes,1);
 assert.deepEqual(r.game.voteResults[0].ballots[0],{voter:1,target:5});
});

// Each row uses one guard, one witch and one stalker from the actual six-seat deck.
for(const [name,knife,guard,medicine,stalk,losses] of [
 ['knife alone',true,false,null,false,1],
 ['guard blocks knife',true,true,null,false,0],
 ['save blocks knife',true,false,'SAVE',false,0],
 ['guard and save cancel with knife',true,true,'SAVE',false,1],
 ['guard and save without damage do not kill',false,true,'SAVE',false,0],
 ['2023 guard blocks poison',false,true,'POISON',false,0],
 ['2023 guard blocks both knife and poison',true,true,'POISON',false,0],
 ['unprotected knife then poison lose both identities',true,false,'POISON',false,2],
 ['stalk bypasses guard',false,true,null,true,1],
 ['stalk bypasses save',false,false,'SAVE',true,1],
 ['guard save conflict plus knife then stalk lose both identities',true,true,'SAVE',true,2],
 ['guard blocks poison while stalk still hits',false,true,'POISON',true,1],
])test(name,()=>{
 const r=room(),target=r.players[4],stalker=r.players[5];at(r,2,4);
 r.game.lastVotes[stalker.id]={targetId:target.id,cardId:game.current(stalker).id,day:1};
 r.game.pending={WOLF:{seat:knife?5:null},GUARD:guard?[{seat:5}]:[],WITCH:medicine?[{type:medicine,seat:5}]:[]};
 if(stalk)game.submitAction(r,stalker,{type:'TARGET',seat:5});
 game.advance(r);
 assert.equal(game.cards(target).filter(c=>c.status==='LOST').length,losses);
 assert.deepEqual(r.game.dawnResults[0].seats,losses?[5]:[]);
 if(losses===2)assert.deepEqual(r.game.nightHistory.map(e=>e.cause),medicine==='POISON'?['WOLF','POISON']:['WOLF','STALKER']);
});
