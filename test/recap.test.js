'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const recap=require('../lib/recap');
const {makeRoom}=require('./helpers');
const act=(r,seat,type,target)=>game.submitAction(r,r.players[seat-1],{type,seat:target});
function endNight(r){while(r.game.phase==='NIGHT')game.advance(r);}
function exile(r,seat){game.advance(r);for(const p of r.players.filter(game.alive))act(r,p.seat,'VOTE',seat);game.advance(r,r.game.voteDeadline);}

test('finished recap is chronological, includes final skills/results and both ordered identities for everyone',()=>{
 let r=makeRoom();game.createGame(r);
 game.advance(r);game.advance(r); // first-night forbidden knife, then witch
 act(r,4,'POISON',5);game.advance(r);
 act(r,1,'TARGET',3);act(r,1,'TARGET',3);endNight(r);
 assert.deepEqual(recap.view(r),{}); // not even first-dawn election exposes private actions
 game.advance(r,r.game.election.deadline);
 assert.equal(r.game.phase,'DISCUSSION');exile(r,4);
 // Persist/reload midgame; no repeated or lost journal entries.
 r=JSON.parse(JSON.stringify(r));game.upgrade(r);
 act(r,4,'TARGET',5);game.advance(r);act(r,3,'TARGET',5);game.advance(r);
 game.advance(r);act(r,1,'TARGET',2);endNight(r);
 exile(r,5);assert.equal(r.game.phase,'LAST_WORDS');assert.deepEqual(recap.view(r),{});
 game.advance(r);assert.equal(r.status,'FINISHED');
 const out=recap.view(r), rounds=out.recap.rounds;
 assert.deepEqual(rounds.map(x=>x.title),['第一夜','第一天','第二夜','第二天']);
 assert.equal(out.recap.partial,false);assert.equal(out.reveal.length,6);
 assert.deepEqual(out.reveal[5].cards.map(c=>c.role),['潜行者','潜行者']);assert.equal(out.reveal[5].cards[1].printedRole,'COPYCAT');
 const n1=rounds[0].lines.join('');assert.match(n1,/未提交或跳过/);assert.match(n1,/4号使用毒药毒5号/);
 assert.equal(rounds[0].lines.filter(x=>x.includes('查验')).length,1);
 assert.match(n1,/失去一张身份牌，剩余一张/);assert.doesNotMatch(n1,/不发动|PASS|6号/);
 assert.match(rounds[1].lines.join(''),/警长竞选.*放逐投票.*4号获得6票.*4号失去一张/);
 assert.match(rounds[2].lines.join(''),/4号守护5号.*狼队刀5号.*昨夜平安夜/);
 assert.match(rounds[3].lines.join(''),/5号获得6票.*5号失去最后一张身份牌，完全出局/);
 assert.deepEqual(recap.view(JSON.parse(JSON.stringify(r))),out);
});

test('wolf recap distinguishes deliberate pass, tied ballots, timeout and first-night pass',()=>{
 for(const [a,b,expected] of [[null,null,'主动选择'],[1,4,'平票'],[undefined,undefined,'未提交或跳过'],[4,4,'狼队刀4号']]){
  const r=makeRoom([['SEER','VILLAGER'],['WOLF','VILLAGER'],['HIDDEN_WOLF','VILLAGER'],['WITCH','GUARD'],['VILLAGER','VILLAGER'],['STALKER','COPYCAT']]);
  game.createGame(r);r.game.night=2;r.game.step=1;game.initStep(r);
  if(a!==undefined)act(r,2,'TARGET',a);if(b!==undefined)act(r,3,'TARGET',b);
  game.advance(r);assert.ok(r.game.recapEvents.at(-1).text.includes(expected));
 }
 const r=makeRoom();game.createGame(r);game.advance(r);game.advance(r);
 assert.match(r.game.recapEvents.at(-1).text,/空刀（未提交或跳过）/);
});

test('only committed medicine is recorded; unused medicine and overwritten choices are omitted',()=>{
 const r=makeRoom();game.createGame(r);game.advance(r);game.advance(r);
 act(r,4,'POISON',2);act(r,4,'SAVE',4);game.advance(r);
 assert.match(r.game.recapEvents.at(-1).text,/4号使用解药救4号/);
 assert.doesNotMatch(JSON.stringify(r.game.recapEvents),/毒/);
});

test('legacy recap labels incomplete history and does not invent missing skills or empty knife',()=>{
 const r=makeRoom();game.createGame(r);delete r.game.recapComplete;delete r.game.recapEvents;
 r.status='FINISHED';r.game.phase='FINISHED';r.game.day=1;
 r.game.dawnResults=[{night:1,message:'昨夜平安夜'}];
 const out=recap.view(r);assert.equal(out.recap.partial,true);assert.deepEqual(out.recap.rounds[0].lines,['昨夜平安夜']);
 assert.doesNotMatch(JSON.stringify(out.recap),/空刀|守护|查验/);
});
