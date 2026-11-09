'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {deal,lockOrder}=require('../lib/rules');
const {createGame,advance,NIGHT,role,wolves}=require('../lib/game');
function makeRoom(){
 const hands=deal();
 return {status:'READY',players:hands.map((hand,i)=>{
  const top=hand.cards.find(c=>!(hand.team==='WOLF'&&c.effectiveRole==='WITCH'));
  return {id:'p'+i,seat:i+1,name:'bot '+(i+1),bot:true,hand:lockOrder(hand,top.id)};
 })};
}
test('bot-only simulations complete; first night omits stalker and simulations finish',()=>{
 for(let n=0;n<120;n++){
  const room=makeRoom();createGame(room);room.status='GAME';
  let steps=0,nightOne=[];
  while(room.status==='GAME'&&steps<1600){
   if(room.game.night===1&&room.game.phase==='NIGHT')nightOne.push(NIGHT[room.game.step]);
   advance(room,room.game.election?.deadline||Date.now());steps++;
  }
  assert.equal(room.status,'FINISHED',`simulation ${n} did not finish`);
  assert.deepEqual(nightOne,NIGHT.slice(0,4));
  assert.ok(room.game.winner==='WOLF'||room.game.winner==='VILLAGE');
 }
});
