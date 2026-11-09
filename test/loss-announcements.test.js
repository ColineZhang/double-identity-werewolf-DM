'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const narrator=require('../lib/narrator');
const {makeRoom}=require('./helpers');

test('night announcements distinguish first card, last card and two cards without revealing roles',()=>{
 for(const [alreadyLost,poison,message] of [
  [false,false,'2号昨夜失去一张身份牌，剩余一张身份牌。'],
  [true,false,'2号昨夜失去最后一张身份牌，完全出局。'],
  [false,true,'2号昨夜失去两张身份牌，完全出局。'],
 ]){
  const r=makeRoom(),p=r.players[1];
  if(alreadyLost){p.hand.cards[0].status='LOST';p.hand.cards[1].status='ACTIVE';}
  game.createGame(r);r.game.night=2;r.game.day=1;r.game.step=4;
  r.game.pending={WOLF:{seat:2},WITCH:poison?{type:'POISON',seat:2}:[]};
  game.advance(r);
  assert.ok(r.game.events.includes(message));
  const cues=narrator.eventCues(message,r);assert.equal(cues.length,1);
  assert.ok(narrator.pack.cues[cues[0]]);
  assert.equal(narrator.pack.cues[cues[0]].text,message.replace(/^2号/,'二号'));
  assert.doesNotMatch(message,/村民|狼人|隐狼|女巫/);
  const count=r.game.events.length;game.tick(r,Date.now()+100000);assert.equal(r.game.events.length,count);
 }
});

test('exile reads loss detail after votes and before the next night, for both identities',()=>{
 const r=makeRoom();game.createGame(r);
 for(const message of ['2号失去一张身份牌，剩余一张身份牌。','2号失去最后一张身份牌，完全出局。']){
  r.game.phase='VOTE';game.initStep(r);game.submitAction(r,r.players[0],{type:'VOTE',seat:2});
  game.advance(r,r.game.voteDeadline);
  assert.ok(r.game.events.indexOf(message)>r.game.events.indexOf(r.game.voteResults.at(-1).message));
  const cues=narrator.eventCues(message,r);assert.equal(cues.length,1);assert.ok(narrator.pack.cues[cues[0]]);
 }
});

test('active hidden wolf remains a wolf inspection under the latest instruction',()=>{
 const r=makeRoom();game.createGame(r);r.game.step=3;game.initStep(r);
 game.submitAction(r,r.players[0],{type:'TARGET',seat:3});
 assert.equal(r.players[0].lastInspection.team,'狼人');
});

test('voice queue completes exile loss announcement before the next night introduction',()=>{
 const r=makeRoom();r.code='loss-voice-test';game.createGame(r);r.game.phase='VOTE';game.initStep(r);
 narrator.claim(r,'test-loss-voice-client');narrator.control(r,'test-loss-voice-client','enable');
 game.submitAction(r,r.players[0],{type:'VOTE',seat:2});game.advance(r,r.game.voteDeadline);narrator.sync(r);
 const ids=r.narration.plan.map(c=>c.cue);
 assert.ok(ids.indexOf('loss.first.2')>ids.indexOf('exiledVotes.2.1'));
 assert.ok(ids.indexOf('loss.first.2')<ids.indexOf('D07'));
 const count=ids.filter(id=>id==='loss.first.2').length;narrator.sync(r);
 assert.equal(r.narration.plan.filter(c=>c.cue==='loss.first.2').length,count);
});
