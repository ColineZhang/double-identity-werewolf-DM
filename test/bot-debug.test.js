'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const sheriff=require('../lib/sheriff');
const debug=require('../lib/bot-debug');
const {makeRoom}=require('./helpers');

test('Bot night actions and inspection results persist; human actions are excluded',()=>{
 const r=makeRoom();r.testMode=true;r.players[0].bot=true;r.players[2].bot=true;r.players[3].bot=true;game.createGame(r);
 game.advance(r);game.advance(r);
 assert.deepEqual(debug.view(r).find(a=>a.phase==='WITCH'),{
  id:2,seat:4,night:1,day:0,phase:'WITCH',type:r.game.actions.p3.type,target:r.game.actions.p3.seat,
 });
 game.advance(r);
 const action=debug.view(r).find(a=>a.phase==='SEER');
 assert.equal(action.seat,1);assert.equal(action.target,r.players[0].lastInspection.seat);assert.equal(action.result,r.players[0].lastInspection.team);
 debug.record(r,r.players[1],'WOLF',{type:'TARGET',seat:5});
 assert.ok(debug.view(r).every(a=>r.players.find(p=>p.seat===a.seat).bot));
 assert.deepEqual(debug.view(JSON.parse(JSON.stringify(r))),debug.view(r));
 const normal=makeRoom();normal.players.forEach(p=>p.bot=true);game.createGame(normal);game.advance(normal);game.advance(normal);game.advance(normal);
 assert.equal(normal.game.debugBotActions,undefined);
});

test('Bot signup and sheriff ballots are recorded with no human ballot',()=>{
 const r=makeRoom();r.testMode=true;r.players[2].bot=true;game.createGame(r);
 while(r.game.phase==='NIGHT')game.advance(r);
 assert.equal(debug.view(r).find(a=>a.phase==='SHERIFF_SIGNUP').run,r.game.election.signups.p2);
 r.game.election.signups=Object.fromEntries(r.players.map(p=>[p.id,p.seat<=2]));
 game.advance(r);game.advance(r);game.tick(r,r.game.election.deadline);
 assert.equal(r.game.election.stage,'VOTE');
 const a=debug.view(r).find(a=>a.phase==='SHERIFF_VOTE');assert.equal(a.seat,3);assert.equal(a.target,r.game.election.votes.p2);
});

test('Bot exile and badge choices are included; projection discards foreign fields',()=>{
 const r=makeRoom();r.testMode=true;r.players[0].bot=true;game.createGame(r);
 r.game.phase='VOTE';game.initStep(r);
 assert.equal(debug.view(r).at(-1).target,r.game.actions.p0.seat);
 r.game.phase='BADGE';r.game.sheriff='p0';game.initStep(r);
 assert.equal(debug.view(r).at(-1).type,'TRANSFER');
 r.game.debugBotActions.at(-1).humanHand=['WITCH','SEER'];
 assert.equal(debug.view(r).at(-1).humanHand,undefined);
});

test('signup and exile have ten-second server deadlines; sheriff voting retains thirty seconds',()=>{
 const r=makeRoom();game.createGame(r);sheriff.start(r,1000);
 assert.equal(r.game.election.deadline,11000);
 r.game.phase='VOTE';const before=Date.now();game.initStep(r);const after=Date.now();
 assert.ok(r.game.voteDeadline>=before+10000&&r.game.voteDeadline<=after+10000);
 assert.equal(sheriff.TIMING.vote,30);
});
