'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const sheriff=require('../lib/sheriff');
const {makeRoom}=require('./helpers');

function electionRoom(){const room=makeRoom();game.createGame(room);while(room.game.phase==='NIGHT')game.advance(room);return room;}
function signup(room,seats){for(const p of room.players)game.submitAction(room,p,{type:'SIGNUP',run:seats.includes(p.seat)});game.advance(room);}
function finishSpeeches(room){while(room.game.phase==='SHERIFF'&&room.game.election.stage==='SPEECH')game.advance(room);}
function openVote(room){finishSpeeches(room);game.tick(room,room.game.election.deadline);}

test('first night enters private signup, and waits for choices or the deadline',()=>{
  const room=electionRoom(),g=room.game;
  assert.equal(g.phase,'SHERIFF');assert.equal(g.election.stage,'SIGNUP');
  assert.equal(g.dawnPending,true);
  game.submitAction(room,room.players[0],{type:'SIGNUP',run:true});
  assert.deepEqual(sheriff.publicView(room).candidates,[]);
  assert.equal(sheriff.publicView(room).signups,undefined);
  assert.throws(()=>game.advance(room),/等待所有玩家/);
  const originalDeadline=g.election.deadline;
  const restored=JSON.parse(JSON.stringify(room));game.upgrade(restored);
  assert.equal(restored.game.election.deadline,originalDeadline);
  assert.equal(game.tick(restored,originalDeadline-1),false);
  assert.equal(game.tick(restored,originalDeadline),true);
  assert.equal(restored.game.election.stage,'SPEECH');
  assert.deepEqual(sheriff.candidates(restored).map(p=>p.seat),[1]);
  assert.equal(restored.game.election.signups.p1,false,'missing choice defaults to staying below');
});

test('speech, withdrawal, fixed final countdown, restricted ballots, tie -> no sheriff',()=>{
  const room=electionRoom(),p=room.players;signup(room,[1,2,3]);
  assert.equal(sheriff.publicView(room).speaker,undefined);
  assert.equal(room.game.election.deadline,null);
  assert.throws(()=>game.submitAction(room,p[1],{type:'END_SPEECH'}),/竞选操作无效/);
  game.submitAction(room,p[1],{type:'WITHDRAW'});
  assert.equal(room.game.election.stage,'SPEECH');
  assert.deepEqual(sheriff.publicView(room).withdrawn,[2]);
  assert.equal(game.tick(room,Date.now()+86400000),false);
  game.advance(room);
  assert.equal(room.game.election.stage,'WITHDRAW');
  const deadline=room.game.election.deadline;
  assert.throws(()=>game.advance(room,deadline-1),/倒计时尚未结束/);
  assert.equal(game.tick(room,deadline),true);
  assert.equal(room.game.election.stage,'VOTE');
  assert.throws(()=>game.submitAction(room,p[0],{type:'WITHDRAW'}),/不能退水/);
  assert.throws(()=>game.submitAction(room,p[1],{type:'VOTE',seat:1}),/退水玩家不能投票/);
  assert.throws(()=>game.submitAction(room,p[0],{type:'VOTE',seat:3}),/只有最初在警下/);
  assert.throws(()=>game.submitAction(room,p[3],{type:'VOTE',seat:2}),/仍在参选/);
  game.submitAction(room,p[3],{type:'VOTE',seat:1});
  game.submitAction(room,p[4],{type:'VOTE',seat:3});
  assert.equal(room.game.events.some(x=>x.includes('4→')),false);
  assert.equal(sheriff.publicView(room).votes,undefined);
  assert.throws(()=>game.advance(room),/等待警下玩家/);
  game.submitAction(room,p[5],{type:'VOTE',seat:null});
  game.advance(room);
  assert.equal(room.game.phase,'DISCUSSION');assert.equal(room.game.sheriff,null);
  assert.match(room.game.events.join('\n'),/平票.*本局没有警长/);
  assert.match(room.game.events.join('\n'),/4号投给1号。5号投给3号。6号弃票。/);
    game.advance(room);assert.equal(room.game.phase,'VOTE');
});

test('no candidates, sole candidate, everyone running, and everyone withdrawing',()=>{
  let room=electionRoom();signup(room,[]);
  assert.equal(room.game.phase,'DISCUSSION');assert.equal(room.game.sheriff,null);
  room=electionRoom();signup(room,[1]);openVote(room);
  assert.equal(room.game.phase,'DISCUSSION');assert.equal(room.game.sheriff,'p0');
  room=electionRoom();signup(room,[1,2,3,4,5,6]);openVote(room);
  assert.equal(room.game.phase,'DISCUSSION');assert.equal(room.game.sheriff,null);
  room=electionRoom();signup(room,[1,2]);
  game.submitAction(room,room.players[0],{type:'WITHDRAW'});
  game.submitAction(room,room.players[1],{type:'WITHDRAW'});
  game.advance(room);
  game.tick(room,room.game.election.deadline);
  assert.equal(room.game.phase,'DISCUSSION');assert.equal(room.game.sheriff,null);
});

test('deadline closes ballots with missing votes as abstentions and rejects stale stage commands',()=>{
  const room=electionRoom();signup(room,[1,2]);
  const oldKey=room.game.stepKey;openVote(room);
  assert.throws(()=>game.submitAction(room,room.players[2],{type:'VOTE',seat:1,stepKey:oldKey}),/阶段已经改变/);
  game.submitAction(room,room.players[2],{type:'VOTE',seat:1});
  const restored=JSON.parse(JSON.stringify(room));
  assert.equal(game.tick(restored,restored.game.election.deadline),true);
  assert.equal(restored.game.sheriff,'p0');
  assert.equal(game.tick(restored,Date.now()+100000),false,'completed election must not run again');
});

test('only the current wolf identity may explode; election explosion swallows badge and enters night',()=>{
  const room=electionRoom();signup(room,[1,3]);
  assert.equal(game.canExplode(room,room.players[0]),false);
  assert.equal(game.canExplode(room,room.players[1]),false,'dormant wolf cannot explode');
  assert.equal(game.canExplode(room,room.players[2]),true);
  assert.throws(()=>game.submitAction(room,room.players[1],{type:'EXPLODE'}),/不能自爆/);
  game.submitAction(room,room.players[2],{type:'EXPLODE'});
  assert.equal(room.game.phase,'NIGHT');assert.equal(room.game.night,2);
  assert.equal(room.game.sheriff,null);assert.equal(game.role(room.players[2]),'VILLAGER');
  assert.match(room.game.events.join('\n'),/警徽流失/);
  assert.throws(()=>game.submitAction(room,room.players[2],{type:'EXPLODE'}),/不能自爆/);
});

test('unannounced first-night deaths stay private through election; lost wolf explosion does not kill second card',()=>{
  const room=makeRoom();game.createGame(room);
  room.game.step=3;room.game.pending={WITCH:{type:'POISON',seat:3}};
  game.advance(room);
  const wolf=room.players[2];
  assert.equal(game.role(wolf),'VILLAGER');
  assert.equal(game.visibleCards(room,wolf).find(c=>c.status==='ACTIVE').effectiveRole,'HIDDEN_WOLF');
  assert.equal(room.game.events.length,0);
  signup(room,[1,3]);game.submitAction(room,wolf,{type:'EXPLODE'});
  assert.equal(game.role(wolf),'VILLAGER','lost wolf must not spend the second identity on the same explosion');
  assert.equal(room.game.phase,'DISCUSSION','original rules retain discussion if wolf already lost in first night');
  assert.equal(room.game.night,1);assert.equal(room.game.dawnPending,false);
});

test('fully eliminated sheriff elected before death announcement can transfer badge privately',()=>{
  const room=makeRoom();game.createGame(room);
  // Explicit two-hit fixture exercises hidden death projection, not a legal first-night wolf knife.
  room.game.step=3;room.game.pending={WOLF:{seat:3},WITCH:{type:'POISON',seat:3}};
  game.advance(room);
  assert.equal(game.alive(room.players[2]),false);
  assert.equal(game.publiclyAlive(room,room.players[2]),true);
  assert.equal(room.game.events.some(x=>x.includes('出局')),false);
  signup(room,[3]);openVote(room);
  assert.equal(room.game.sheriff,'p2');
  assert.equal(room.game.phase,'BADGE');assert.equal(game.publiclyAlive(room,room.players[2]),false);
  assert.throws(()=>game.submitAction(room,room.players[0],{type:'TRANSFER',seat:2}),/只有出局警长/);
  game.submitAction(room,room.players[2],{type:'TRANSFER',seat:1});
  assert.equal(room.game.sheriff,'p0');assert.equal(room.game.phase,'DISCUSSION');
});

test('daytime vote remains one ballot per player and sheriff breaks only the specified tie',()=>{
  const room=makeRoom();game.createGame(room);room.game.phase='VOTE';room.game.sheriff='p0';
  game.initStep(room);
  for(const [i,seat] of [2,3,2,3,null,null].entries())game.submitAction(room,room.players[i],{type:'VOTE',seat});
  game.advance(room);
  assert.equal(game.role(room.players[1]),'WOLF');
  assert.equal(game.role(room.players[2]),'HIDDEN_WOLF');
  assert.equal(room.game.phase,'NIGHT');
});
