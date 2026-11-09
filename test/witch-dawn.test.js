'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const game=require('../lib/game');
const {makeRoom}=require('./helpers');
function room(){const r=makeRoom([['VILLAGER','WITCH'],['WOLF','VILLAGER'],['HIDDEN_WOLF','VILLAGER'],['WITCH','COPYCAT'],['VILLAGER','VILLAGER'],['GUARD','STALKER']]);game.createGame(r);return r;}
function activateSecond(p){p.hand.cards.find(c=>c.order===0).status='LOST';p.hand.cards.find(c=>c.order===1).status='ACTIVE';}
function at(r,step,night=2){r.game.night=night;r.game.day=night-1;r.game.phase='NIGHT';r.game.step=step;game.initStep(r);}
function witchWindow(r,target=1){at(r,1);if(target!==null)game.submitAction(r,r.players[1],{type:'TARGET',seat:target});game.advance(r);}
function finish(r){while(r.game.phase==='NIGHT')game.advance(r);}
function voteFirstIdentity(r,index){
 r.game.phase='VOTE';r.game.day=1;game.initStep(r);
 for(const [i,p] of r.players.entries())game.submitAction(r,p,{type:'VOTE',seat:i===1?r.players[index].seat:null});
 game.advance(r);
}

test('second identity witch sees ordered attack selections and may save herself or any legal player',()=>{
 for(const target of [1,5]){
  const r=room();voteFirstIdentity(r,0);witchWindow(r);
  const view=game.selfActionView(r,r.players[0]);
  assert.equal(view.step,'WITCH');assert.deepEqual(view.spiritTargets,[1]);assert.equal(view.canSave,true);
  assert.doesNotThrow(()=>game.submitAction(r,r.players[0],{type:'SAVE',seat:target}));finish(r);
  assert.equal(game.current(r.players[0])?.effectiveRole,target===1?'WITCH':undefined);
 }
});
test('guard plus save cancels both protections; poison alone preserves spirit; two medicine targets both resolve',()=>{
 const conflict=room();activateSecond(conflict.players[0]);at(conflict,0);
 game.submitAction(conflict,conflict.players[5],{type:'TARGET',seat:1});game.advance(conflict);
 game.submitAction(conflict,conflict.players[1],{type:'TARGET',seat:1});game.advance(conflict);
 game.submitAction(conflict,conflict.players[0],{type:'SAVE',seat:1});finish(conflict);assert.equal(game.alive(conflict.players[0]),false);
 const poison=room();activateSecond(poison.players[0]);at(poison,2);
 game.submitAction(poison,poison.players[0],{type:'POISON',seat:6});game.submitAction(poison,poison.players[3],{type:'POISON',seat:5});finish(poison);
 assert.equal(game.role(poison.players[5]),'STALKER');assert.equal(game.cards(poison.players[4])[0].status,'LOST');
 at(poison,2,3);poison.game.attackSelections=[{type:'DIRECT',seat:1}];assert.deepEqual(game.selfActionView(poison,poison.players[0]).spiritTargets,[1]);
});
test('wolf knife wins when the last golden identity and last wolf both die; announcements retain both losses',()=>{
 const r=room();for(const p of [r.players[1],r.players[2]])p.hand.cards[0].status='LOST';
 // Retain only seat 2's last active wolf identity and seat 5's last golden identity.
 r.players[1].hand.cards[0].status='ACTIVE';r.players[1].hand.cards[1].status='LOST';activateSecond(r.players[2]);activateSecond(r.players[4]);
 at(r,4,2);r.game.pending={WOLF:{seat:5},WITCH:{type:'POISON',seat:2}};finish(r);
 assert.equal(r.game.phase,'FINISHED');assert.equal(r.game.winner,'WOLF');
 assert.deepEqual(r.game.dawnResults[0].seats,[2,5]);assert.equal(r.game.pendingLosses.length,0);
});
test('saved last golden baby survives so poison on the final wolf gives the village victory',()=>{
 const r=room();r.players[1].hand.cards[1].status='LOST';activateSecond(r.players[2]);activateSecond(r.players[4]);
 at(r,4,2);r.game.pending={WOLF:{seat:5},WITCH:[{type:'SAVE',seat:5},{type:'POISON',seat:2}]};finish(r);
 assert.equal(r.game.winner,'VILLAGE');assert.equal(game.alive(r.players[4]),true);assert.deepEqual(r.game.dawnResults[0].seats,[2]);
});
test('witch may submit poison after the knife targets the last golden baby; both effects settle before wolf-priority victory',()=>{
 const r=room();r.players[1].hand.cards[1].status='LOST';activateSecond(r.players[2]);activateSecond(r.players[4]);
 witchWindow(r,5);
 const witchPlayer=r.players[3];assert.deepEqual(game.selfActionView(r,witchPlayer).spiritTargets,[5]);
 assert.equal(r.status,'GAME');assert.equal(r.game.winner,null);assert.equal(game.alive(r.players[4]),true);
 game.submitAction(r,witchPlayer,{type:'POISON',seat:2});game.advance(r);
 assert.equal(game.current(witchPlayer).usedPoison,true);assert.equal(r.game.winner,null);
 finish(r);
 assert.equal(game.alive(r.players[1]),false);assert.equal(game.alive(r.players[4]),false);
 assert.deepEqual(r.game.dawnResults[0].seats,[2,5]);assert.equal(r.game.winner,'WOLF');
 assert.equal(r.game.nightHistory.some(e=>e.cause==='POISON'&&e.seat===2),true);
});
test('first night and no knife still allow self save and blind save',()=>{
 for(const night of [1,2]){const r=room();activateSecond(r.players[0]);at(r,2,night);
  const view=game.selfActionView(r,r.players[0]);assert.equal(view.canSave,true);assert.deepEqual(view.spiritTargets,[]);
  game.submitAction(r,r.players[0],{type:'SAVE',seat:5});game.advance(r);assert.equal(game.current(r.players[0]).usedSave,true);
 }
});
test('spirit information filters attack types and deduplicates in occurrence order; save permanently removes it',()=>{
 const r=room();activateSecond(r.players[0]);at(r,2);
 r.game.attackSelections=[{type:'DIRECT',seat:5},{type:'POISON',seat:3},{type:'DIRECT',seat:1},{type:'DIRECT',seat:5},{type:'LETHAL',seat:6}];
 assert.deepEqual(game.selfActionView(r,r.players[0]).spiritTargets,[5,1]);
 game.submitAction(r,r.players[0],{type:'SAVE',seat:1});game.advance(r);at(r,2,3);
 const v=game.selfActionView(r,r.players[0]);assert.equal(v.canSave,false);assert.equal(v.spiritTargets,undefined);assert.equal(v.usedPoison,false);
 assert.doesNotThrow(()=>game.submitAction(r,r.players[0],{type:'POISON',seat:6}));
});
test('all active witches resolve independently and copied identity has fresh medicine',()=>{
 const r=room();activateSecond(r.players[0]);witchWindow(r);
 game.submitAction(r,r.players[0],{type:'SAVE',seat:1});game.submitAction(r,r.players[3],{type:'POISON',seat:6});game.advance(r);
 assert.equal(game.current(r.players[0]).usedSave,true);assert.equal(game.current(r.players[3]).usedPoison,true);
 finish(r);assert.equal(game.role(r.players[0]),'WITCH');assert.equal(game.role(r.players[5]),'STALKER');
 activateSecond(r.players[3]);at(r,2,3);const v=game.selfActionView(r,r.players[3]);assert.equal(v.usedSave,false);assert.equal(v.usedPoison,false);assert.equal(v.canSave,true);
});
test('witch activated at night settlement cannot retroactively act; next witch window is available',()=>{
 const r=room();witchWindow(r);assert.equal(game.selfActionView(r,r.players[0]),null);finish(r);
 assert.equal(game.role(r.players[0]),'WITCH');assert.equal(game.current(r.players[0]).usedSave,undefined);
 at(r,2,3);assert.equal(game.selfActionView(r,r.players[0]).canSave,true);
});
test('night losses publish first-identity numbers, deduplicate double losses, and distinguish peaceful nights',()=>{
 for(const [knife,poison,expected] of [[1,null,[1]],[1,1,[1]],[1,5,[1,5]],[null,null,[]]]){
  const r=room();witchWindow(r,knife);if(poison!==null)game.submitAction(r,r.players[3],{type:'POISON',seat:poison});finish(r);
  assert.equal(r.game.phase,'DISCUSSION');assert.deepEqual(r.game.dawnResults.at(-1).seats,expected);
  if(!expected.length)assert.ok(r.game.events.includes('昨夜平安夜'));
  else assert.ok(r.game.events.includes(expected.map(n=>`${n}号昨夜失去${knife===poison?'两张身份牌，完全出局':'一张身份牌，剩余一张身份牌'}。`).join('')));
  if(knife===poison&&knife!==null)assert.equal(game.publiclyAlive(r,r.players[0]),false);
  assert.doesNotMatch(r.game.events.join('\n'),/女巫|村民|普通狼人|隐狼|守卫|潜行者/);
  const losses=r.game.nightHistory.length;game.tick(r,Date.now()+100000);assert.equal(r.game.nightHistory.length,losses);
 }
});
test('first-night losses stay private until election finishes, then automatically publish once',()=>{
 const r=room();at(r,2,1);game.submitAction(r,r.players[3],{type:'POISON',seat:1});finish(r);
 assert.equal(r.game.phase,'SHERIFF');assert.equal(r.game.events.length,0);assert.equal(game.publiclyAlive(r,r.players[0]),true);
 assert.equal(game.visibleCards(r,r.players[0]).find(c=>c.status==='ACTIVE').effectiveRole,'VILLAGER');
 for(const p of r.players)game.submitAction(r,p,{type:'SIGNUP',run:false});game.advance(r);
 assert.equal(r.game.phase,'DISCUSSION');assert.deepEqual(r.game.dawnResults[0].seats,[1]);
 const index=r.game.events.indexOf('1号昨夜失去一张身份牌，剩余一张身份牌。');assert.ok(index>r.game.events.findIndex(x=>x.includes('无警长')));
 const restored=JSON.parse(JSON.stringify(r));game.upgrade(restored);game.tick(restored,Date.now()+100000);
 assert.equal(restored.game.events.filter(x=>x==='1号昨夜失去一张身份牌，剩余一张身份牌。').length,1);
});
