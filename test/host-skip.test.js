'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const narrator=require('../lib/narrator');
const {makeRoom}=require('./helpers');
let id=0;
function room(){const r=makeRoom();r.code='skip-'+(++id);game.createGame(r);return r;}
function command(r,mode='PHASE'){return {mode,gameId:r.game.id,stepKey:r.game.stepKey,commandId:'command-'+(++id)};}
test('host skip preserves committed medicine, records PASS defaults, and rejects duplicate/stale/finished commands',()=>{
 const r=room();game.advance(r);game.advance(r);
 game.submitAction(r,r.players[3],{type:'POISON',seat:1});const c=command(r,'DAWN');
 assert.equal(game.hostSkip(r,c),true);assert.equal(r.game.phase,'SHERIFF');assert.equal(game.current(r.players[3]).usedPoison,true);
 assert.equal(game.role(r.players[0]),'VILLAGER');assert.equal(r.game.pendingLosses.length,1);
 const history=JSON.stringify(r.game.nightHistory);assert.equal(game.hostSkip(r,c),false);assert.equal(JSON.stringify(r.game.nightHistory),history);
 assert.throws(()=>game.hostSkip(r,{...c,commandId:'different-command'}),/阶段已经改变/);
 
 r.status='FINISHED';assert.throws(()=>game.hostSkip(r,command(r)),/进行中的游戏/);
 const noAction=room();game.hostSkip(noAction,command(noAction));assert.deepEqual(noAction.game.pending.GUARD,[]);
 game.hostSkip(noAction,command(noAction,'DAWN'));assert.equal(noAction.game.nightHistory.length,0);
 assert.ok(noAction.game.events.some(e=>e.startsWith('房主跳过：')));
});
test('skip a day resolves existing ballots and starts the next night without another injury on replay',()=>{
 const r=room();game.hostSkip(r,command(r,'DAWN'));game.hostSkip(r,command(r,'PHASE'));
 assert.equal(r.game.phase,'DISCUSSION');game.advance(r);
 game.submitAction(r,r.players[0],{type:'VOTE',seat:2});const c=command(r,'NIGHT');game.hostSkip(r,c);
 assert.equal(r.game.phase,'NIGHT');assert.equal(r.game.night,2);assert.equal(game.role(r.players[1]),'WOLF');
 assert.equal(r.game.voteResults.at(-1).selectedVotes,1);assert.equal(r.game.voteResults.at(-1).ballots.filter(b=>b.target===null).length,5);
 assert.equal(game.hostSkip(r,c),false);assert.equal(game.role(r.players[1]),'WOLF');
});
test('server clock completes every silent night window and settlement exactly once, including restored state',()=>{
 let r=room();
 const clock=structuredClone(r.game.nightClock);
 for(const w of clock.windows){
  assert.equal(game.tick(r,clock.origin+w.advance-1),false);
  assert.equal(narrator.windowOpen(r,clock.origin+w.opens-1),false);
  assert.equal(narrator.windowOpen(r,clock.origin+w.opens),true);
  r=JSON.parse(JSON.stringify(r));game.upgrade(r);
  assert.equal(game.tick(r,clock.origin+w.advance),true);
 }
 assert.equal(r.game.phase,'SHERIFF');assert.deepEqual(r.game.settledNights,[1]);
 const history=JSON.stringify(r.game.nightHistory);game.tick(r,clock.origin+clock.windows.at(-1).advance);
 assert.equal(JSON.stringify(r.game.nightHistory),history);assert.deepEqual(r.game.settledNights,[1]);
});
test('host skip rebases the voice clock; an expired timer or duplicate command cannot settle twice',()=>{
 const r=room(),client='test-skip-voice-client',now=Date.now();narrator.claim(r,client,now);narrator.control(r,client,'enable',now);
 const first=command(r);game.hostSkip(r,first,now+500);
 assert.equal(r.game.step,1);assert.equal(r.narration.plan[0].cue,'WOLF.open');
 assert.equal(narrator.due(r,now+501),false);assert.equal(game.hostSkip(r,first,now+501),false);
 const end=command(r,'DAWN');game.hostSkip(r,end,now+1000);assert.deepEqual(r.game.settledNights,[1]);
 assert.equal(narrator.due(r,now+999999),false);assert.equal(game.hostSkip(r,end,now+1001),false);
});
