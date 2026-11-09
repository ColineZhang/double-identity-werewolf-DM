'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const sheriff=require('../lib/sheriff');
const {makeRoom}=require('./helpers');
test('signup and exile have ten-second server deadlines; sheriff voting retains thirty seconds',()=>{
 const r=makeRoom();game.createGame(r);sheriff.start(r,1000);
 assert.equal(r.game.election.deadline,11000);
 r.game.phase='VOTE';const before=Date.now();game.initStep(r);const after=Date.now();
 assert.ok(r.game.voteDeadline>=before+10000&&r.game.voteDeadline<=after+10000);
 assert.equal(sheriff.TIMING.vote,30);
});
