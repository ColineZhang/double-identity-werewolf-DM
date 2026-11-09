'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const {makeRoom}=require('./helpers');
function exile(lastCard=true){
 const r=makeRoom();if(lastCard){r.players[1].hand.cards[0].status='LOST';r.players[1].hand.cards[1].status='ACTIVE';}
 game.createGame(r);r.game.phase='VOTE';r.game.day=1;game.initStep(r);
 game.submitAction(r,r.players[0],{type:'VOTE',seat:2});game.advance(r,r.game.voteDeadline);return r;
}
test('fully exiled player has untimed last words; manual ending advances once to night',()=>{
 const r=exile();assert.equal(r.game.phase,'LAST_WORDS');assert.equal(r.game.lastWordsSeat,2);assert.equal(r.game.night,1);
 assert.equal(game.tick(r,Date.now()+86400000),false);
 const saved=JSON.parse(JSON.stringify(r));game.upgrade(saved);assert.equal(saved.game.phase,'LAST_WORDS');
 game.advance(saved);assert.equal(saved.game.phase,'NIGHT');assert.equal(saved.game.night,2);assert.equal(saved.game.lastWordsSeat,null);
});
test('losing only the first identity does not create last words',()=>{
 const r=exile(false);assert.equal(r.game.phase,'NIGHT');assert.equal(game.role(r.players[1]),'WOLF');
});
test('eliminated sheriff can transfer badge after last words, before the next night',()=>{
 const r=makeRoom();r.players[1].hand.cards[0].status='LOST';r.players[1].hand.cards[1].status='ACTIVE';
 game.createGame(r);r.game.sheriff='p1';r.game.phase='VOTE';game.initStep(r);
 game.submitAction(r,r.players[0],{type:'VOTE',seat:2});game.advance(r,r.game.voteDeadline);
 assert.equal(r.game.phase,'LAST_WORDS');game.advance(r);assert.equal(r.game.phase,'BADGE');
 game.submitAction(r,r.players[1],{type:'TRANSFER',seat:1});assert.equal(r.game.sheriff,'p0');assert.equal(r.game.phase,'NIGHT');
});
test('game-ending exile finishes after last words without starting another night',()=>{
 const r=makeRoom();r.players[1].hand.cards[0].status='LOST';r.players[1].hand.cards[1].status='ACTIVE';
 r.players[2].hand.cards[0].status='LOST';r.players[2].hand.cards[1].status='ACTIVE';
 game.createGame(r);r.game.phase='VOTE';game.initStep(r);game.submitAction(r,r.players[0],{type:'VOTE',seat:2});game.advance(r,r.game.voteDeadline);
 assert.equal(r.game.phase,'LAST_WORDS');game.advance(r);assert.equal(r.game.phase,'FINISHED');assert.equal(r.game.winner,'VILLAGE');assert.equal(r.game.night,1);
});
