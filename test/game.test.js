'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deal,lockOrder}=require('../lib/rules');
const game=require('../lib/game');
function makeRoom(){return {status:'GAME',players:deal().map((hand,i)=>({id:'p'+i,seat:i+1,name:'玩家'+(i+1),hand:lockOrder(hand,hand.cards.find(c=>!(hand.team==='WOLF'&&c.effectiveRole==='WITCH')).id)}))};}
// Automated client choices exist only in this test; the server never plays for people.
test('six scripted human clients finish random deals with the four-stage first night',()=>{
 for(let n=0;n<120;n++){
  const r=makeRoom();game.createGame(r);const nightOne=[];
  for(let step=0;r.status==='GAME'&&step<400;step++){
   if(r.game.phase==='NIGHT'&&r.game.night===1)nightOne.push(game.NIGHT[r.game.step]);
   for(const p of r.players){
    const a=game.selfActionView(r,p);if(!a)continue;
    if(a.step==='SHERIFF_SIGNUP')game.submitAction(r,p,{type:'SIGNUP',run:false});
    else if(a.step==='WITCH')game.submitAction(r,p,{type:'PASS',seat:null});
    else if(a.step==='BADGE')game.submitAction(r,p,{type:'TRANSFER',seat:null});
    else if(a.step==='VOTE')game.submitAction(r,p,{type:'VOTE',seat:a.targets[0]});
    else if(a.step==='WOLF'||a.step==='SEER')game.submitAction(r,p,{type:'TARGET',seat:a.targets[0]});
   }
   game.advance(r,r.game.election?.deadline||Date.now());
  }
  assert.equal(r.status,'FINISHED');assert.deepEqual(nightOne,game.NIGHT.slice(0,4));assert.ok(['WOLF','VILLAGE'].includes(r.game.winner));
 }
});
