'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const narrator=require('../lib/narrator');
const game=require('../lib/game');
const sheriff=require('../lib/sheriff');
const {makeRoom}=require('./helpers');
const client='test-narrator-client';
let serial=0;
function enabled(now=100000){const r=makeRoom();r.code='voice-test-'+(++serial);game.createGame(r);narrator.claim(r,client,now);narrator.control(r,client,'enable',now);return r;}

test('all bundled clips are valid WAVs; fixed night words and waits match the supplied script',()=>{
 const script=fs.readFileSync(path.join(__dirname,'../NARRATOR_SCRIPT_2023_6P_v0.2.md'),'utf8');
 const template=narrator.nightPlan();
 for(const cue of template.cues){assert.equal(cue.playbackRate,1.5);assert.equal(cue.duration,Math.ceil(narrator.pack.cues[cue.cue].durationMs/1.5));}
 for(const [id,c] of Object.entries(narrator.pack.cues)){
  const b=fs.readFileSync(path.join(narrator.packRoot,c.file));
  assert.equal(b.toString('ascii',0,4),'RIFF',id);assert.equal(b.toString('ascii',8,12),'WAVE');
  let pos=12;while(b.toString('ascii',pos,pos+4)!=='data')pos+=8+b.readUInt32LE(pos+4)+(b.readUInt32LE(pos+4)%2);
  assert.equal(c.durationMs,Math.ceil(b.readUInt32LE(pos+4)/44100*1000),id);
  assert.ok(c.durationMs>0);if(id.startsWith('count.'))assert.ok(c.durationMs<=1000);
 }
 for(let i=0;i<7;i++){
  const start=script.indexOf(`### N0${i} —`),end=script.indexOf('\n### ',start+1);
  const expected=script.slice(start,end).split(/\r?\n/).filter(s=>/^>\s+/.test(s)).map(s=>s.replace(/^>\s+/,'' )).join('');
  const ids=i===0?['N00']:i===6?['N06.settle','N06.dawn']:[template.windows[i-1].role+'.open',template.windows[i-1].role+'.close'];
  assert.equal(ids.map(id=>narrator.pack.cues[id].text).join(''),expected);
 }
 assert.deepEqual(template.windows.map(w=>w.closes-w.opens),[10000,40000,30000,10000,10000]);
 assert.equal(template.cues[1].at,template.cues[0].duration+5000);
 for(let i=0;i<4;i++){const close=template.cues.find(c=>c.cue===template.windows[i].role+'.close');assert.equal(template.windows[i].advance,close.at+close.duration+3000);}
 const settle=template.cues.find(c=>c.cue==='N06.settle'),dawn=template.cues.at(-1);
 assert.equal(dawn.at,settle.at+settle.duration+5000);assert.equal(template.windows.at(-1).advance,template.duration);
});

test('fixed first-night timeline advances four roles, gates actions, and is unchanged by missing or exhausted roles',()=>{
 const r=enabled(),n=r.narration,plan=JSON.stringify(n.plan),origin=n.origin;
 for(const w of n.windows){
  assert.equal(r.game.step,w.step);assert.equal(narrator.windowOpen(r,origin+w.opens-1),false);
  assert.equal(narrator.windowOpen(r,origin+w.opens),true);assert.equal(narrator.windowOpen(r,origin+w.closes),false);
  assert.equal(narrator.due(r,origin+w.advance-1),false);assert.equal(narrator.due(r,origin+w.advance),true);
  game.advance(r,origin+w.advance);
  if(w.step<n.windows.at(-1).step){assert.equal(narrator.sync(r,origin+w.advance),false);assert.equal(JSON.stringify(n.plan),plan);}
 }
 assert.equal(r.game.phase,'SHERIFF');
 const second=enabled();second.players[0].hand.cards.forEach(c=>c.status='LOST');second.players[3].hand.cards[0].usedSave=true;
 narrator.sync(second,100001);
 const normalize=n=>n.plan.filter(c=>c.cue==='N00'||c.cue.startsWith('N06.')||/\.(open|close)$/.test(c.cue)).map(c=>({cue:c.cue,at:c.at-n.nightOffset,duration:c.duration}));
 assert.deepEqual(normalize(n),normalize(second.narration));
});

test('pause freezes night actions and election deadlines; lease loss and service restart pause safely',()=>{
 const r=enabled(),origin=r.narration.origin;
 narrator.pause(r,'test',102000);assert.equal(narrator.windowOpen(r,999999),false);assert.equal(narrator.due(r,999999),false);
 narrator.resume(r,107000);assert.equal(r.narration.origin,origin+5000);
 assert.throws(()=>narrator.claim(r,'other-client-123456',110000),/另一个/);
 narrator.maintain(r,116000);assert.equal(r.narration.pausedAt,115000);
 narrator.claim(r,client,120000);narrator.control(r,client,'enable',120000);assert.equal(r.narration.paused,false);
 narrator.restore(r,130000);assert.equal(r.narration.paused,true);
 const e=enabled();while(e.game.phase==='NIGHT')game.advance(e,100000);narrator.sync(e,100000);
 const deadline=e.game.election.deadline;
 narrator.pause(e,'test',100500);assert.equal(game.tick(e,deadline+999999),false);
 narrator.resume(e,105500);assert.equal(e.game.election.deadline,deadline+5000);
});

test('public result queue reads ballots and sorted deaths, excludes private results, cancels obsolete countdowns',()=>{
 assert.deepEqual(narrator.eventCues('警长选举：1→2、3→弃票'),['D00.count','ballot.1.2','ballot.3.0']);
 assert.deepEqual(narrator.eventCues('昨夜完全出局：6号、2号'),['deaths.2-6']);
 assert.deepEqual(narrator.eventCues('你查验了 3 号：狼人'),[]);
 assert.deepEqual(narrator.eventCues('本轮全员弃票，无人被放逐'),['D05.abstain']);
 const r=enabled();while(r.game.phase==='NIGHT')game.advance(r,100000);
 for(const p of r.players)sheriff.submit(r,p,{type:'SIGNUP',run:p.seat<=2});
 game.advance(r);while(r.game.election.stage==='SPEECH')game.advance(r);
 narrator.sync(r);assert.ok(r.narration.plan.some(c=>c.cue==='count.5'));
 r.game.phase='DISCUSSION';game.initStep(r);narrator.sync(r);
 assert.equal(r.narration.plan.some(c=>c.cue.startsWith('count.')),false);
 r.game.phase='VOTE';game.initStep(r);narrator.sync(r);
 // Winning resolution can leave stepKey unchanged: the winner still needs an announcement.
 r.game.phase='FINISHED';r.game.winner='WOLF';r.status='FINISHED';narrator.sync(r);
 assert.ok(r.narration.plan.some(c=>c.cue==='D08.WOLF'));
});
