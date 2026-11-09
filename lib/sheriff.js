'use strict';
const {randomInt}=require('node:crypto');
const votes=require('./votes');
const botDebug=require('./bot-debug');
const speaking=require('./speaking');

// Local table settings. Campaign speeches end only on the host's command.
const TIMING=Object.freeze({signup:10,withdraw:10,vote:30,exileVote:10});
const active=cards=>cards.some(c=>c.status==='ACTIVE');
function participants(room){
  const g=room.game;
  return room.players.filter(p=>active(g.dawnPending&&g.nightSnapshot?.[p.id] || p.hand.cards));
}
function candidates(room){
  const e=room.game.election;
  return participants(room).filter(p=>e.signups[p.id]===true&&!e.withdrawn.includes(p.id)).sort((a,b)=>a.seat-b.seat);
}
function log(room,message){const g=room.game;g.eventSeq=(g.eventSeq??g.events.length)+1;g.events.push(message);if(g.events.length>60)g.events.shift();}
function stamp(room){const g=room.game,e=g.election;g.stepKey=`SHERIFF:${g.night}:${e.stage}`;}
function stage(room,value,now){const e=room.game.election;e.stage=value;e.deadline=value==='SPEECH'?null:now+TIMING[value.toLowerCase()]*1000;stamp(room);}
function upgrade(room){
 const e=room.game?.election;if(!e)return;
 delete e.speechOrder;delete e.speakerIndex;
 if(room.game.phase==='SHERIFF'&&e.stage==='SPEECH'){e.deadline=null;stamp(room);}
}
function start(room,now=Date.now()){
  const g=room.game;
  g.phase='SHERIFF';g.actions={};
  g.election={stage:'SIGNUP',signups:{},withdrawn:[],votes:{},finished:false};
  for(const p of participants(room).filter(p=>p.bot)){
    const cards=g.nightSnapshot?.[p.id]||p.hand.cards;
    g.election.signups[p.id]=cards.some(c=>c.status==='ACTIVE'&&c.effectiveRole==='SEER')||randomInt(3)===0;
    botDebug.record(room,p,'SHERIFF_SIGNUP',{type:'SIGNUP',run:g.election.signups[p.id]});
  }
  stage(room,'SIGNUP',now);
}
function finish(room,winner,reason){
  const g=room.game,e=g.election;
  g.sheriff=winner?.id||null;e.finished=true;e.deadline=null;e.stage='RESULT';
  if(reason)log(room,reason);
  g.phase='DAWN';g.actions={};g.stepKey=`DAWN:${g.night}`;
}
function openVote(room,now){
  const e=room.game.election,list=candidates(room);
  log(room,`最终参选：${list.map(p=>p.seat+'号').join('、')||'无人'}`);
  if(list.length===0){votes.publish(room.game,votes.result('SHERIFF',[],[] ,null,'NO_CANDIDATES'));return finish(room,null);}
  if(list.length===1){votes.publish(room.game,votes.result('SHERIFF',[],list.map(p=>p.seat),null,'SOLE',list[0].seat));return finish(room,list[0]);}
  const voters=participants(room).filter(p=>e.signups[p.id]!==true);
  if(!voters.length){votes.publish(room.game,votes.result('SHERIFF',[],list.map(p=>p.seat),null,'NO_VOTERS'));return finish(room,null);}
  stage(room,'VOTE',now);
  for(const p of voters.filter(p=>p.bot)){
    e.votes[p.id]=list[randomInt(list.length)].seat;
    botDebug.record(room,p,'SHERIFF_VOTE',{type:'VOTE',seat:e.votes[p.id]});
  }
}
function resolveVote(room){
  const e=room.game.election,list=candidates(room),voters=participants(room).filter(p=>e.signups[p.id]!==true).sort((a,b)=>a.seat-b.seat);
  const r=votes.publish(room.game,votes.result('SHERIFF',voters.map(p=>({voter:p.seat,target:e.votes[p.id]??null})),list.map(p=>p.seat)));
  finish(room,list.find(p=>p.seat===r.selected));
}
function ready(room,now=Date.now()){
  const e=room.game.election;
  if(e.deadline!==null&&now>=e.deadline)return true;
  if(e.stage==='SIGNUP')return participants(room).every(p=>typeof e.signups[p.id]==='boolean');
  if(e.stage==='VOTE')return participants(room).filter(p=>e.signups[p.id]!==true).every(p=>Object.hasOwn(e.votes,p.id));
  return false;
}
function advance(room,now=Date.now()){
  const e=room.game.election;
  if(e.stage==='SIGNUP'){
    if(!ready(room,now))throw Error('等待所有玩家选择上警或警下，或等待上警倒计时结束');
    for(const p of participants(room))if(typeof e.signups[p.id]!=='boolean')e.signups[p.id]=false;
    log(room,'上警名单：'+(candidates(room).map(p=>p.seat+'号').join('、')||'无人'));
    if(!candidates(room).length){votes.publish(room.game,votes.result('SHERIFF',[],[],null,'NO_CANDIDATES'));return finish(room,null);}
    stage(room,'SPEECH',now);
    e.speaking=speaking.draw(candidates(room));
    if(e.speaking)log(room,speaking.message(e.speaking));
  }else if(e.stage==='SPEECH'){
    stage(room,'WITHDRAW',now);
  }else if(e.stage==='WITHDRAW'){
    if(!ready(room,now))throw Error('退水与自爆倒计时尚未结束');
    openVote(room,now);
  }else if(e.stage==='VOTE'){
    if(!ready(room,now))throw Error('等待警下玩家投票，或等待投票倒计时结束');
    resolveVote(room);
  }else throw Error('竞选已经结束');
}
function selfView(room,p,now=Date.now()){
  const e=room.game.election,inside=participants(room).some(x=>x.id===p.id);
  const open=e.stage==='SPEECH'||now<e.deadline;
  return {signup:e.signups[p.id]??null,
    canSignup:inside&&e.stage==='SIGNUP'&&open,
    canWithdraw:inside&&e.signups[p.id]===true&&!e.withdrawn.includes(p.id)&&['SPEECH','WITHDRAW'].includes(e.stage)&&open,
    canVote:inside&&e.stage==='VOTE'&&e.signups[p.id]!==true&&open,
    submitted:Object.hasOwn(e.votes,p.id),vote:e.votes[p.id]??null};
}
function submit(room,p,choice,now=Date.now()){
  const e=room.game.election,v=selfView(room,p,now);
  if(choice.type==='SIGNUP'){
    if(!v.canSignup||typeof choice.run!=='boolean')throw Error('当前不能选择上警或警下');
    e.signups[p.id]=choice.run;
  }else if(choice.type==='WITHDRAW'){
    if(!v.canWithdraw)throw Error('当前不能退水；投票开始后不能退水');
    e.withdrawn.push(p.id);log(room,`${p.seat}号玩家选择退水`);
  }else if(choice.type==='VOTE'){
    if(!v.canVote)throw Error('只有最初在警下的玩家可以投警长票，退水玩家不能投票');
    if(choice.seat!==null&&!candidates(room).some(x=>x.seat===choice.seat))throw Error('只能投仍在参选的玩家');
    e.votes[p.id]=choice.seat;
  }else throw Error('竞选操作无效');
}
function publicView(room,now=Date.now()){
  const e=room.game.election,hidden=e.stage==='SIGNUP';
  return {stage:e.stage,deadline:e.deadline,
    speaking:hidden?null:speaking.view(e.speaking,candidates(room)),
    candidates:hidden?[]:candidates(room).map(p=>p.seat),
    withdrawn:e.withdrawn.map(id=>room.players.find(p=>p.id===id)?.seat).filter(Boolean),
    submittedCount:e.stage==='SIGNUP'?Object.keys(e.signups).length:null,
    total:participants(room).length,canAdvance:ready(room,now)||e.stage==='SPEECH'};
}
function tick(room,now=Date.now()){
  const g=room.game;
  if(g.phase!=='SHERIFF'||!g.election||g.election.stage==='SPEECH'||g.election.deadline==null||now<g.election.deadline)return false;
  advance(room,now);return true;
}
module.exports={TIMING,start,advance,submit,selfView,publicView,participants,candidates,tick,upgrade};
