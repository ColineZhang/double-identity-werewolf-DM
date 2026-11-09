'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const sheriff=require('../lib/sheriff');
const narrator=require('../lib/narrator');
const {makeRoom}=require('./helpers');
function campaign(){
 const r=makeRoom();r.code='campaign-speech';game.createGame(r);
 while(r.game.phase==='NIGHT')game.advance(r);
 for(const p of r.players)game.submitAction(r,p,{type:'SIGNUP',run:p.seat<=3});
 game.advance(r);return r;
}
test('campaign has no speaker or timeout; restored old timed speeches become untimed',()=>{
 const r=campaign();
 assert.equal(r.game.election.deadline,null);assert.equal(r.game.election.speechOrder,undefined);
 assert.equal(sheriff.publicView(r).speaker,undefined);
 assert.equal(game.tick(r,Date.now()+86400000),false);
 assert.equal(game.canExplode(r,r.players[2]),true);
 game.submitAction(r,r.players[0],{type:'WITHDRAW'});
 const saved=JSON.parse(JSON.stringify(r));saved.game.election.deadline=1;saved.game.election.speechOrder=['p0'];saved.game.election.speakerIndex=0;
 game.upgrade(saved);assert.equal(saved.game.election.deadline,null);assert.equal(saved.game.election.speakerIndex,undefined);
 assert.deepEqual(sheriff.publicView(saved).withdrawn,[1]);assert.equal(game.tick(saved,Date.now()),false);
 assert.throws(()=>game.submitAction(saved,saved.players[0],{type:'WITHDRAW'}),/不能退水/);
 assert.equal(saved.game.events.filter(e=>e==='1号玩家选择退水').length,1);
 game.advance(saved);assert.equal(saved.game.election.stage,'WITHDRAW');assert.ok(saved.game.election.deadline>Date.now());
});
test('withdrawal immediately queues its own voice, persists its list, and never repeats on polling',()=>{
 const r=campaign(),now=Date.now();narrator.claim(r,'campaign-voice-client',now);narrator.control(r,'campaign-voice-client','enable',now);
 assert.equal(r.game.election.deadline,null);
 assert.ok(r.narration.plan.every(c=>!c.cue.startsWith('speaker.')));
 const afterIntro=now+10000;
 game.submitAction(r,r.players[0],{type:'WITHDRAW'});narrator.sync(r,afterIntro);
 assert.deepEqual(sheriff.publicView(r).withdrawn,[1]);
 const cue=r.narration.plan.find(c=>c.cue==='withdrew.1');assert.equal(cue.at,0);
 assert.equal(narrator.pack.cues[cue.cue].text,'一号玩家选择退水。');
 const sequence=r.narration.sequence;assert.equal(narrator.sync(r,afterIntro+1),false);assert.equal(r.narration.sequence,sequence);
 game.advance(r,afterIntro+5000);narrator.sync(r,afterIntro+5000);
 const deadline=r.game.election.deadline;
 // Past the withdrawal introduction, but before the final five-second count.
 const when=deadline-6000;
 game.submitAction(r,r.players[1],{type:'WITHDRAW'});narrator.sync(r,when);
 const withdrawn=r.narration.plan.find(c=>c.cue==='withdrew.2');assert.equal(withdrawn.at,0);
 assert.equal(r.game.election.deadline,deadline);
 assert.ok(r.narration.plan.filter(c=>c.cue.startsWith('count.')).every(c=>c.at>=withdrawn.duration));
});
