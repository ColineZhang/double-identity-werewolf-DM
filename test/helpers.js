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
    return {id:`p${i}`,seat:i+1,name:`玩家 ${i+1}`,bot:false,hand:lockOrder(hand,hand.cards[0].id)};
  })};
}
module.exports={makeRoom};
