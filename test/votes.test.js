'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const votes=require('../lib/votes');
const narrator=require('../lib/narrator');
const game=require('../lib/game');
const {makeRoom}=require('./helpers');
test('structured votes drive short ballots, exact totals, election ties, abstentions and sheriff tie-breaks',()=>{
 const ballots=[{voter:6,target:null},{voter:1,target:2},{voter:2,target:2},{voter:3,target:2}];
 const r=votes.result('SHERIFF',ballots,[1,2]);const g={id:'test',day:1,night:1,events:[]};votes.publish(g,r);
 assert.equal(r.selected,2);assert.equal(r.selectedVotes,3);assert.match(r.message,/1号投给2号。.*6号弃票。.*2号获得3票，当选警长。/);
 assert.doesNotMatch(r.message,/玩家/);assert.deepEqual(r.ballots.map(b=>b.voter),[1,2,3,6]);
 for(const id of votes.cues(r))assert.equal(narrator.pack.cues[id].text,votes.clipText(id));
 const tie=[{voter:1,target:2},{voter:2,target:1}];
 assert.equal(votes.result('SHERIFF',tie,[1,2]).reason,'TIE');
 assert.equal(votes.result('EXILE',tie,[1,2],2).selected,2);
 assert.equal(votes.result('EXILE',tie,[1,2],null).selected,null);
 assert.equal(votes.result('EXILE',[{voter:1,target:null}],[1]).reason,'ABSTAIN');
});
test('exile names the identity loss target and only announces complete elimination after the second loss',()=>{
 const r=makeRoom();game.createGame(r);
 for(let round=0;round<2;round++){
  r.game.phase='VOTE';game.initStep(r);game.submitAction(r,r.players[0],{type:'VOTE',seat:2});game.advance(r,r.game.voteDeadline);
  assert.match(r.game.voteResults.at(-1).message,/2号获得1票，本轮被放逐/);
  assert.equal(r.game.events.includes('2号失去最后一张身份牌，完全出局。'),round===1);
 }
});
test('unfinished exile ballots stay private until all submit or the server deadline expires',()=>{
 const r=makeRoom();game.createGame(r);r.game.phase='VOTE';game.initStep(r);
 game.submitAction(r,r.players[0],{type:'VOTE',seat:2});assert.throws(()=>game.advance(r),/等待所有玩家/);
 assert.equal(r.game.voteResults,undefined);assert.equal(r.game.events.length,0);
 game.tick(r,r.game.voteDeadline);assert.equal(r.game.voteResults[0].selectedVotes,1);assert.equal(r.game.phase,'NIGHT');
});
