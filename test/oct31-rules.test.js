'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const narrator=require('../lib/narrator');
const sheriff=require('../lib/sheriff');
const speaking=require('../lib/speaking');
const {makeRoom}=require('./helpers');

test('first-night knife reaches witch spirit and settles after seer, with no stalker stage',()=>{
 const r=makeRoom();game.createGame(r);game.advance(r);
 assert.equal(game.selfActionView(r,r.players[2]).step,'WOLF');
 game.submitAction(r,r.players[2],{type:'TARGET',seat:5});game.advance(r);
 assert.deepEqual(game.selfActionView(r,r.players[3]).spiritTargets,[5]);
 game.advance(r);assert.equal(r.game.step,3);game.advance(r);
 assert.equal(r.game.phase,'SHERIFF');assert.deepEqual(r.game.settledNights,[1]);
 assert.equal(game.cards(r.players[4])[0].status,'LOST');
 assert.equal(game.visibleCards(r,r.players[4])[0].status,'ACTIVE');
 assert.equal(r.game.recapEvents.some(e=>e.text==='狼队刀5号。'),true);
 assert.deepEqual(r.game.nightClock.windows.map(w=>w.role),['GUARD','WOLF','WITCH','SEER']);
 const saved=JSON.parse(JSON.stringify(r));game.upgrade(saved);assert.deepEqual(saved.game.settledNights,[1]);
});

test('first-night witch can save knife target; all later nights retain fixed ten-second stalker window',()=>{
 const r=makeRoom();game.createGame(r);game.advance(r);game.submitAction(r,r.players[2],{type:'TARGET',seat:4});game.advance(r);
 game.submitAction(r,r.players[3],{type:'SAVE',seat:4});game.advance(r);game.advance(r);
 assert.equal(game.current(r.players[3]).usedSave,true);assert.equal(r.game.pendingLosses.length,0);
 for(const night of [1,2,3]){
  const plan=narrator.nightPlan(night);
  assert.deepEqual(plan.windows.map(w=>w.closes-w.opens),night===1?[10000,40000,30000,10000]:[10000,40000,30000,10000,10000]);
  assert.equal(plan.cues.some(c=>c.cue==='STALKER.open'),night>1);
  assert.equal(plan.windows.at(-1).advance,plan.duration);
 }
});

test('random speaking point and both directions only include eligible seats',()=>{
 const players=[{seat:6},{seat:2},{seat:4}];
 for(const [direction,expected] of [[0,[4,6,2]],[1,[4,2,6]]]){
  const values=[1,direction],s=speaking.draw(players,()=>values.shift());
  assert.equal(s.point,2);assert.equal(s.start,4);assert.deepEqual(s.order,expected);
  assert.match(speaking.message(s),direction===0?/顺时针/:/逆时针/);
  assert.ok(narrator.pack.cues[speaking.cue(s)].durationMs>0);
 }
 assert.equal(speaking.draw([]),null);
});

test('campaign random order persists without timer or speaker tracking; withdrawal filters without reroll',()=>{
 const r=makeRoom();game.createGame(r);while(r.game.phase==='NIGHT')game.advance(r);
 for(const p of r.players)sheriff.submit(r,p,{type:'SIGNUP',run:[1,3,6].includes(p.seat)});
 game.advance(r);const roll=structuredClone(r.game.election.speaking);
 assert.deepEqual(roll.order.slice().sort((a,b)=>a-b),[1,3,6]);assert.equal(r.game.election.deadline,null);
 assert.equal(r.game.election.speakerIndex,undefined);
 const restored=JSON.parse(JSON.stringify(r));game.upgrade(restored);
 assert.deepEqual(restored.game.election.speaking,roll);
 sheriff.submit(restored,restored.players.find(p=>p.seat===roll.start),{type:'WITHDRAW'});
 assert.deepEqual(restored.game.election.speaking,roll);
 assert.deepEqual(sheriff.publicView(restored).speaking.order,roll.order.filter(n=>n!==roll.start));
 assert.ok(narrator.phaseCues(restored).includes(speaking.cue(roll)));
});

test('ordinary discussion rolls once per day only without sheriff; narration queues once and restore retains order',()=>{
 const r=makeRoom();r.code='speaking-test';game.createGame(r);
 r.game.day=2;r.game.phase='DISCUSSION';r.players[1].hand.cards.forEach(c=>c.status='LOST');game.initStep(r);
 const roll=structuredClone(r.game.discussionSpeaking);assert.equal(roll.order.includes(2),false);
 game.initStep(r);assert.deepEqual(r.game.discussionSpeaking,roll);
 const now=Date.now(),client='speaking-test-client';narrator.claim(r,client,now);narrator.control(r,client,'enable',now);
 assert.equal(r.narration.plan.filter(c=>c.cue===speaking.cue(roll)).length,1);
 assert.equal(narrator.sync(r,now+1),false);
 const restored=JSON.parse(JSON.stringify(r));game.upgrade(restored);game.initStep(restored);assert.deepEqual(restored.game.discussionSpeaking,roll);
 r.game.day=3;r.game.sheriff='p0';game.initStep(r);assert.equal(r.game.discussionSpeaking.day,2);
 assert.equal(narrator.phaseCues(r).some(c=>c.startsWith('speaking.')),false);
 r.game.sheriff=null;game.initStep(r);assert.equal(r.game.discussionSpeaking.day,3);
});
