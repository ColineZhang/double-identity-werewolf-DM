'use strict';
const { effective, isWolf, lockOrder } = require('../lib/rules');

function makeRoom(pairs = [
  ['SEER', 'VILLAGER'], ['VILLAGER', 'WOLF'], ['HIDDEN_WOLF', 'VILLAGER'],
  ['WITCH', 'GUARD'], ['VILLAGER', 'VILLAGER'], ['STALKER', 'COPYCAT'],
]) {
  return {status:'GAME',players:pairs.map((pair,i)=>{
    const roles=effective(pair);
    const hand={team:roles.some(isWolf)?'WOLF':'VILLAGE',golden:roles.every(r=>r==='VILLAGER'),locked:false,
      cards:pair.map((r,j)=>({id:`p${i}c${j}`,printedRole:r,effectiveRole:roles[j],status:'UNORDERED',order:null}))};
    return {id:`p${i}`,seat:i+1,name:`玩家 ${i+1}`,hand:lockOrder(hand,hand.cards[0].id)};
  })};
}
// Open a persisted fixture's current window without a product-side test bypass.
function openWindow(room,now=Date.now(),duration=180000){
 const w=room.game.nightClock.windows.find(w=>w.step===room.game.step);
 room.game.nightClock.origin=now-w.opens-1;w.closes=w.opens+duration;w.advance=w.closes+3000;
}
module.exports={makeRoom,openWindow};
