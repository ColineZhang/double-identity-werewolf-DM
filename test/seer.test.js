'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {makeRoom}=require('./helpers');
const game=require('../lib/game');

function seerRoom(){const room=makeRoom();game.createGame(room);room.game.step=3;game.initStep(room);return room;}

test('first night seer sees real team immediately and keeps private results across phases and serialization',()=>{
  const room=seerRoom(),p=room.players[0];
  game.submitAction(room,p,{type:'TARGET',seat:2});
  assert.equal(game.selfActionView(room,p).inspection.team,'狼人','first night identifies the actual team despite a dormant wolf');
  assert.equal(game.selfActionView(room,p).inspection.basis,'REAL');
  game.advance(room);
  assert.equal(game.selfActionView(room,p).step,'SHERIFF_SIGNUP');
  assert.deepEqual(game.inspections(p).map(({night,seat,team})=>({night,seat,team})),[{night:1,seat:2,team:'狼人'}]);
  const restored=JSON.parse(JSON.stringify(room));
  assert.equal(game.inspections(restored.players[0])[0].team,'狼人');
  assert.deepEqual(game.inspections(restored.players[1]),[]);
});

test('second night returns current team even for the same dormant wolf; historical result stays unchanged',()=>{
 const r=seerRoom(),p=r.players[0];game.submitAction(r,p,{type:'TARGET',seat:2});
 r.game.night=2;game.initStep(r);game.submitAction(r,p,{type:'TARGET',seat:2});
 assert.deepEqual(game.inspections(p).map(x=>[x.night,x.team,x.basis]),[[1,'狼人','REAL'],[2,'好人','CURRENT']]);
 r.players[1].hand.cards[0].status='LOST';r.players[1].hand.cards[1].status='ACTIVE';
 r.game.night=3;game.initStep(r);game.submitAction(r,p,{type:'TARGET',seat:2});assert.equal(p.lastInspection.team,'狼人');
});

test('first night real team handles hidden wolves, copied wolves and good pairs',()=>{
 for(const pair of [['VILLAGER','HIDDEN_WOLF'],['COPYCAT','WOLF'],['COPYCAT','HIDDEN_WOLF'],['COPYCAT','VILLAGER'],['GUARD','VILLAGER']]){
  const r=makeRoom([['SEER','VILLAGER'],pair,['HIDDEN_WOLF','VILLAGER'],['WITCH','GUARD'],['VILLAGER','VILLAGER'],['STALKER','COPYCAT']]);
  game.createGame(r);r.game.step=3;game.initStep(r);game.submitAction(r,r.players[0],{type:'TARGET',seat:2});
  assert.equal(r.players[0].lastInspection.team,pair.some(x=>x==='WOLF'||x==='HIDDEN_WOLF')?'狼人':'好人');
 }
});

test('seer first activated on night two still inspects current team, not real team',()=>{
 const r=makeRoom([['VILLAGER','SEER'],['VILLAGER','WOLF'],['HIDDEN_WOLF','VILLAGER'],['WITCH','GUARD'],['VILLAGER','VILLAGER'],['STALKER','COPYCAT']]);
 r.players[0].hand.cards[0].status='LOST';r.players[0].hand.cards[1].status='ACTIVE';game.createGame(r);r.game.night=2;r.game.step=3;game.initStep(r);
 game.submitAction(r,r.players[0],{type:'TARGET',seat:2});assert.equal(r.players[0].lastInspection.team,'好人');
});

test('seer result distinguishes active wolf; duplicate confirmation cannot scan multiple targets',()=>{
  const room=seerRoom(),p=room.players[0];
  assert.throws(()=>game.submitAction(room,p,{type:'TARGET',seat:null}),/请选择查验对象/);
  game.submitAction(room,p,{type:'TARGET',seat:3});
  assert.equal(game.selfActionView(room,p).inspection.team,'狼人');
  game.submitAction(room,p,{type:'TARGET',seat:3});
  assert.equal(game.inspections(p).length,1);
  assert.throws(()=>game.submitAction(room,p,{type:'TARGET',seat:2}),/不能更换目标/);
  assert.equal(game.selfActionView(room,p).locked,true);
});
