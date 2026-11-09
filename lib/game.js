'use strict';
const { randomUUID } = require('node:crypto');
const { isWolf } = require('./rules');
const sheriff = require('./sheriff');
const votes = require('./votes');
const narrator = require('./narrator');
const losses = require('./losses');
const recap = require('./recap');
const speaking = require('./speaking');
const NIGHT = ['GUARD','WOLF','WITCH','SEER','STALKER'];
const LABELS = {GUARD:'守卫',WOLF:'狼人',WITCH:'女巫',SEER:'预言家',STALKER:'潜行者',SHERIFF:'警长竞选',VOTE:'白天放逐'};
function cards(p) { return p.hand?.cards.slice().sort((a,b)=>a.order-b.order) || []; }
function current(p) { return cards(p).find(c=>c.status==='ACTIVE') || null; }
function alive(p) { return Boolean(current(p)); }
function role(p) { return current(p)?.effectiveRole || null; }
function visibleCards(room,p) {
  const g=room.game;
  return g?.dawnPending&&g.phase!=='FINISHED'&&g.nightSnapshot?.[p.id] || p.hand?.cards || [];
}
function publiclyAlive(room,p) { return visibleCards(room,p).some(c=>c.status==='ACTIVE'); }
function snapshotNight(room) {
  room.game.nightSnapshot=Object.fromEntries(room.players.map(p=>[p.id,p.hand.cards.map(c=>({...c}))]));
  room.game.pendingDeaths=[];
  room.game.pendingLosses=[];
  room.game.attackSelections=[];
}
function wolves(room) { return room.players.filter(p=>p.hand && cards(p).some(c=>isWolf(c.effectiveRole)&&c.status!=='LOST') && (role(p)==='WOLF'||cards(p).some(c=>c.effectiveRole==='HIDDEN_WOLF'&&c.status!=='LOST'))); }
function eligible(room,p,phase=room.game?.phase) {
  if(!p || !room.game) return false;
  if(phase==='BADGE')return room.game.sheriff===p.id;
  if(phase==='SHERIFF')return sheriff.selfView(room,p).canVote;
  if(!alive(p))return false;
  if(phase==='VOTE') return true;
  if(phase==='NIGHT') {
    const step=NIGHT[room.game.step];
    if(step==='WOLF') return wolves(room).some(x=>x.id===p.id);
    if(step==='STALKER') {
      if(room.game.night===1)return false;
      const ballot=room.game.lastVotes?.[p.id];
      // Existing v3 saves have dated voteResults but undated lastVotes.
      const day=ballot?.day??room.game.voteResults?.filter(v=>v.kind==='EXILE').at(-1)?.day;
      return role(p)==='STALKER' && !current(p).usedStalk && day===room.game.day && ballot?.cardId===current(p).id;
    }
    return role(p)===step;
  }
  return false;
}
function targets(room,p,phase=room.game?.phase) {
  const living=room.players.filter(alive);
  if(phase==='SHERIFF')return sheriff.candidates(room).map(x=>x.seat);
  if(phase==='VOTE'||phase==='BADGE') return living.map(x=>x.seat);
  const step=NIGHT[room.game.step];
  if(step==='STALKER') return living.filter(x=>x.id===room.game.lastVotes?.[p.id]?.targetId).map(x=>x.seat);
  if(step==='GUARD') return living.filter(x=>x.id!==current(p)?.lastGuardId).map(x=>x.seat);
  if(step==='WOLF') return living.map(x=>x.seat);
  if(step==='WITCH') return living.map(x=>x.seat);
  if(step==='SEER') return living.map(x=>x.seat);
  return [];
}
function stepKey(g) {return `${g.phase}:${g.night}:${g.day}:${g.step}`;}
function createGame(room) {
  room.game={id:randomUUID(),version:3,phase:'NIGHT',night:1,day:0,step:0,actions:{},stepKey:'',winner:null,sheriff:null,events:[],eventSeq:0,lastVotes:{},lastGuard:{},nightHistory:[],dawnResults:[],settledNights:[],result:null,dawnPending:false};
  room.game.recapComplete=true;room.game.recapEvents=[];
  snapshotNight(room);
  initStep(room);
}
function initStep(room) {
  const g=room.game; g.actions={};g.stepKey=stepKey(g);g.result=null;
  if(g.phase==='NIGHT'&&g.nightClock?.night!==g.night)g.nightClock=narrator.makeNightClock(g.night);
  if(g.phase==='VOTE')g.voteDeadline=Date.now()+sheriff.TIMING.exileVote*1000;
  if(g.phase==='DISCUSSION'&&!g.sheriff&&g.discussionSpeaking?.day!==g.day){
    const roll=speaking.draw(room.players.filter(alive));
    if(roll){g.discussionSpeaking={...roll,day:g.day};addPublic(g,speaking.message(roll));}
  }
}
function actionSeat(room,id) {return room.players.find(x=>x.id===id)?.seat || null;}
function validateAction(room,p,choice) {
  if(!eligible(room,p)) throw Error('当前阶段你没有可执行的操作');
  if(!choice || typeof choice!=='object') throw Error('操作格式错误');
  const phase=room.game.phase;
  const step=phase==='NIGHT'?NIGHT[room.game.step]:phase;
  const valid=targets(room,p);
  if(step==='SEER') {
    if(choice.type!=='TARGET' || !valid.includes(choice.seat)) throw Error('请选择查验对象，再确认查验');
    const previous=inspections(p).find(x=>x.night===room.game.night && (!x.cardId || x.cardId===current(p).id));
    if(previous && previous.seat!==choice.seat) throw Error('本夜已经完成查验，不能更换目标再次查验');
  }
  if(phase==='VOTE') {
    if(choice.type!=='VOTE') throw Error('请选择投票对象');
    if(choice.seat!==null && !valid.includes(choice.seat)) throw Error('投票对象无效');
  } else if(step==='WITCH') {
    if(!['SAVE','POISON','PASS'].includes(choice.type)) throw Error('操作无效');
    if(choice.type!=='PASS' && !valid.includes(choice.seat)) throw Error('目标无效');
    if(choice.type==='SAVE' && current(p).usedSave) throw Error('解药已经用过');
    if(choice.type==='POISON' && current(p).usedPoison) throw Error('毒药已经用过');
  } else if(choice.type!=='TARGET'||(choice.seat!==null && !valid.includes(choice.seat))) throw Error('目标不合法');
  return {type:choice.type,seat:choice.seat===null?null:Number(choice.seat)};
}
function submitAction(room,p,choice) {
  if(!choice||typeof choice!=='object')throw Error('操作格式错误');
  if(choice.stepKey && choice.stepKey!==room.game.stepKey)throw Error('阶段已经改变，请刷新后重新操作');
  if(choice.type==='EXPLODE')return explode(room,p);
  if(room.game.phase==='SHERIFF'){sheriff.submit(room,p,choice);return finishDawn(room);}
  if(room.game.phase==='BADGE'){
    if(!eligible(room,p)||choice.type!=='TRANSFER')throw Error('只有出局警长可以移交警徽');
    if(choice.seat!==null&&!targets(room,p).includes(choice.seat))throw Error('警徽只能移交给未完全出局的玩家');
    return transferBadge(room,choice.seat);
  }
  const g=room.game,action=validateAction(room,p,choice);
  g.actions[p.id]=action;
  if(g.phase==='NIGHT' && NIGHT[g.step]==='SEER')recordInspection(room,p,action);
}
function recordInspection(room,p,action) {
  const g=room.game;
  if(action.seat!==null) {
    const target=room.players.find(x=>x.seat===action.seat);
    if(!inspections(p).some(x=>x.night===g.night && (!x.cardId || x.cardId===current(p).id))) {
      const basis=g.night===1?'REAL':'CURRENT';
      const wolf=basis==='REAL'?target.hand.team==='WOLF':isWolf(role(target));
      const result={night:g.night,seat:target.seat,team:wolf?'狼人':'好人',basis,cardId:current(p).id};
      p.inspections=[...inspections(p),result];
      p.lastInspection=result;
      recap.record(g,{period:'NIGHT',text:`${p.seat}号查验${target.seat}号（${basis==='REAL'?'真实阵营':'当前身份'}）：${result.team}。`});
    }
  }
}
function inspections(p) { return p.inspections || (p.lastInspection?[p.lastInspection]:[]); }
function addPublic(g,message) {g.eventSeq=(g.eventSeq??g.events.length)+1;g.events.push(message);if(g.events.length>60)g.events.shift();}
function targetBySeat(room,seat) {return room.players.find(p=>p.seat===seat)||null;}
function targetFromActions(room,step) {
  const g=room.game;const candidates=Object.entries(g.actions).filter(([id])=>{
    const p=room.players.find(x=>x.id===id);
    return p && eligible(room,p);
  }).map(([,a])=>a.seat).filter(s=>s!==null);
  if(step!=='WOLF') return targetBySeat(room,candidates[0]);
  // Wolf ballots: majority wins; a tie produces no knife attack.
  const counts=new Map(); for(const n of candidates)counts.set(n,(counts.get(n)||0)+1);
  const max=Math.max(0,...counts.values());
  const leaders=[...counts].filter(([,v])=>v===max);
  return leaders.length===1?targetBySeat(room,leaders[0][0]):null;
}
function loseCard(room,p,cause) {
  const c=current(p);if(!c)return false;
  c.status='LOST';const next=cards(p).find(c=>c.status==='DORMANT');if(next)next.status='ACTIVE';
  const loss={night:room.game.night,phase:room.game.phase,seat:p.seat,cause,cardId:c.id};
  room.game.nightHistory.push(loss);
  if(room.game.phase==='NIGHT')(room.game.pendingLosses||=[]).push(loss);
  if(!next) {
    if(room.game.phase==='NIGHT'){
      room.game.pendingDeaths||=[];
      if(!room.game.pendingDeaths.includes(p.id))room.game.pendingDeaths.push(p.id);
    }
  }
  if(room.game.phase!=='NIGHT')losses.publish(room.game,'DAY',[{seat:p.seat,lost:1,remaining:next?1:0}]);
  return true;
}
function checkWinner(room) {
  const g=room.game;const allWolfCardsLost=room.players.every(p=>cards(p).filter(c=>isWolf(c.effectiveRole)).every(c=>c.status==='LOST'));
  const allGoldenLost=room.players.filter(p=>p.hand.golden).every(p=>!alive(p));
  // User-confirmed ordinary-game baseline: if both conditions hold at dawn,
  // wolf victory takes priority (狼刀在先). Keep all settled losses for the announcement.
  const winner=allGoldenLost?'WOLF':allWolfCardsLost?'VILLAGE':null;
  if(winner){g.winner=winner;g.phase='FINISHED';g.stepKey=stepKey(g);room.status='FINISHED';addPublic(g,winner==='VILLAGE'?'好人获胜':'狼人获胜');}
  return winner;
}
function closeNight(room) {
  const g=room.game;const acts=g.pending||{};
  g.settledNights||=[];if(g.settledNights.includes(g.night))return;
  const list=x=>Array.isArray(x)?x:x?[x]:[];
  const guards=new Set(list(acts.GUARD).map(a=>a.seat).filter(Number.isInteger));
  const meds=list(acts.WITCH),saves=new Set(meds.filter(a=>a.type==='SAVE').map(a=>a.seat));
  for(const seat of [...guards])if(saves.has(seat)){guards.delete(seat);saves.delete(seat);}
  const queue=[...list(acts.WOLF).map(a=>({...a,cause:'WOLF',damage:'DIRECT'})),...meds.filter(a=>a.type==='POISON').map(a=>({...a,cause:'POISON',damage:'POISON'})),...list(acts.STALKER).map(a=>({...a,cause:'STALKER',damage:'LETHAL'}))];
  for(const hit of queue){const victim=targetBySeat(room,hit.seat);if(!victim)continue;
    if(hit.damage!=='LETHAL'&&guards.has(hit.seat))continue;
    if(hit.damage==='DIRECT'&&saves.has(hit.seat))continue;
    loseCard(room,victim,hit.cause);
  }
  g.settledNights.push(g.night);
  g.pending={};g.day++;
  g.dawnPending=true;g.step=0;
  if(g.day===1)sheriff.start(room);
  else{g.phase='DAWN';initStep(room);announceDawn(room);}
}
function nextNight(room) {
  const g=room.game;
  g.night++;g.phase='NIGHT';g.step=0;g.pending={};g.wolfTargetId=null;
  snapshotNight(room);initStep(room);
}
function badgeOrContinue(room,resume) {
  const g=room.game,holder=room.players.find(p=>p.id===g.sheriff);
  if(holder&&!alive(holder)){
    g.phase='BADGE';g.badgeResume=resume;g.badgeDeadline=Date.now()+30000;initStep(room);
  }else if(resume==='NIGHT')nextNight(room);
  else{g.phase='DISCUSSION';initStep(room);}
}
function transferBadge(room,seat) {
  const g=room.game,resume=g.badgeResume;
  g.sheriff=targetBySeat(room,seat)?.id||null;g.badgeDeadline=null;
  addPublic(g,g.sheriff?`警徽移交给 ${seat} 号`:'警长放弃移交，本局此后无警长');
  if(resume==='NIGHT')nextNight(room);
  else{g.phase='DISCUSSION';initStep(room);}
}
function announceDawn(room,resume='DISCUSSION') {
  const g=room.game;
  if(g.dawnPending){
    const seats=[...new Set((g.pendingLosses||[]).map(x=>x.seat))].sort((a,b)=>a-b);
    const eliminated=seats.filter(seat=>!alive(targetBySeat(room,seat)));
    const details=seats.map(seat=>({seat,lost:g.pendingLosses.filter(x=>x.seat===seat).length,remaining:cards(targetBySeat(room,seat)).filter(c=>c.status!=='LOST').length}));
    const result=losses.publish(g,'NIGHT',details);
    (g.dawnResults||=[]).push({night:g.night,seats,eliminated,losses:details,message:result.message});
    g.dawnPending=false;g.pendingDeaths=[];g.pendingLosses=[];
  }
  if(checkWinner(room))return;
  badgeOrContinue(room,resume);
}
function finishDawn(room){if(room.game.phase==='DAWN')announceDawn(room);}
function canExplode(room,p,now=Date.now()) {
  const g=room.game;
  if(!g||room.status!=='GAME')return false;
  if(g.phase==='SHERIFF'){
    const e=g.election;
    if(!['SPEECH','WITHDRAW'].includes(e.stage)||(e.deadline!==null&&now>=e.deadline))return false;
    // The forum explicitly lets a wolf already lost on the first night act in
    // the election. Use the first-night active identity, never a dormant wolf.
    const c=(g.nightSnapshot?.[p.id]||p.hand.cards).find(c=>c.status==='ACTIVE');
    return Boolean(c&&isWolf(c.effectiveRole));
  }
  return g.phase==='DISCUSSION'&&alive(p)&&isWolf(role(p));
}
function explode(room,p) {
  if(!canExplode(room,p))throw Error('当前身份或阶段不能自爆');
  const g=room.game,inElection=g.phase==='SHERIFF';
  const firstCard=inElection?(g.nightSnapshot?.[p.id]||p.hand.cards).find(c=>c.status==='ACTIVE'):current(p);
  const actual=p.hand.cards.find(c=>c.id===firstCard.id);
  const alreadyLost=actual.status==='LOST';
  addPublic(g,`${p.seat} 号发动自爆`);
  recap.record(g,{period:'DAY',text:`${p.seat}号自爆。${inElection?'警徽流失，本局无警长。':''}`});
  if(inElection){g.sheriff=null;g.election.finished=true;g.election.stage='RESULT';g.election.deadline=null;addPublic(g,'竞选日自爆，警徽流失，本局无警长');}
  if(!alreadyLost)loseCard(room,p,'EXPLODE');
  // Dawn publication also checks victory. An election explosion must not
  // bypass the pending first-night announcement, even if the last wolf is lost.
  if(inElection)announceDawn(room,alreadyLost?'DISCUSSION':'NIGHT');
  else if(!checkWinner(room))badgeOrContinue(room,'NIGHT');
}
function tick(room,now=Date.now()) {
  if(room.narration?.enabled&&room.narration.paused)return false;
  if(!room.game||room.status!=='GAME')return false;
  if(!room.narration?.enabled&&room.game.phase==='NIGHT'){
    const g=room.game,w=g.nightClock?.windows.find(w=>w.step===g.step);
    if(w&&now>=g.nightClock.origin+w.advance){advance(room,now);return true;}
  }
  if(room.game.phase==='BADGE'&&now>=room.game.badgeDeadline){transferBadge(room,null);return true;}
  if(room.game.phase==='VOTE'&&now>=room.game.voteDeadline){resolveVotes(room);return true;}
  if(room.game.phase==='DAWN'){finishDawn(room);return true;}
  const changed=sheriff.tick(room,now);if(changed)finishDawn(room);return changed;
}
function upgrade(room) {
  sheriff.upgrade(room);
  const g=room.game;if(!g||g.version===3)return;
  if(g.version!==2){g.dawnPending=false;snapshotNight(room);if(g.phase==='SHERIFF')sheriff.start(room);}
  g.id||=randomUUID();g.version=3;g.dawnResults||=[];g.settledNights||=[];
  g.pendingLosses||=g.dawnPending?room.players.flatMap(p=>p.hand.cards.filter(c=>c.status==='LOST'&&g.nightSnapshot?.[p.id]?.some(old=>old.id===c.id&&old.status!=='LOST')).map(c=>({night:g.night,phase:'NIGHT',seat:p.seat,cardId:c.id,cause:'MIGRATED'}))):[];
  g.attackSelections||=g.wolfTargetId?[{type:'DIRECT',seat:actionSeat(room,g.wolfTargetId)}]:[];
  if(g.phase==='NIGHT'&&!g.nightClock)g.nightClock=narrator.makeNightClock(g.night);
  if(g.dawnPending&&!g.settledNights.includes(g.night))g.settledNights.push(g.night);
}
function resolveVotes(room) {
  const g=room.game;
  const entries=room.players.filter(alive).sort((a,b)=>a.seat-b.seat).map(p=>({p,seat:g.actions[p.id]?.seat??null}));
  const outcome=votes.publish(g,votes.result('EXILE',entries.map(e=>({voter:e.p.seat,target:e.seat})),entries.map(e=>e.p.seat),g.actions[g.sheriff]?.seat??null));
  const victim=targetBySeat(room,outcome.selected);
  g.lastVotes=Object.fromEntries(entries.map(e=>[e.p.id,{targetId:targetBySeat(room,e.seat)?.id||null,cardId:current(e.p)?.id||null,day:g.day}]));
  if(victim)loseCard(room,victim,'VOTE');
  if(victim&&!alive(victim)){
    g.lastWordsSeat=victim.seat;g.phase='LAST_WORDS';initStep(room);return;
  }
  if(checkWinner(room))return;
  badgeOrContinue(room,'NIGHT');
}
function advance(room,now=Date.now()) {
  const g=room.game;
  if(g.phase==='SHERIFF'){sheriff.advance(room,now);return finishDawn(room);}
  if(g.phase==='DAWN')return announceDawn(room);
  if(g.phase==='DISCUSSION'){g.phase='VOTE';initStep(room);return;}
  if(g.phase==='LAST_WORDS'){
    g.lastWordsSeat=null;
    if(!checkWinner(room))badgeOrContinue(room,'NIGHT');
    return;
  }
  if(g.phase==='BADGE'){
    if(now<g.badgeDeadline)throw Error('等待出局警长移交或放弃警徽');
    return transferBadge(room,null);
  }
  if(g.phase==='NIGHT'){
    const step=NIGHT[g.step];
    if(!g.pending)g.pending={};
    if(step==='WOLF') {
      const victim=targetFromActions(room,'WOLF');
      g.pending.WOLF={seat:victim?.seat??null};g.wolfTargetId=victim?.id||null;
      const actors=room.players.filter(p=>eligible(room,p));
      const choices=actors.map(p=>g.actions[p.id]);
      const reason=!actors.length?'无可行动狼人':choices.some(a=>Number.isInteger(a?.seat))?'平票':choices.every(a=>a&&a.type==='TARGET'&&a.seat===null)?'主动选择':'未提交或跳过';
      recap.record(g,{period:'NIGHT',text:victim?`狼队刀${victim.seat}号。`:`狼队空刀（${reason}）。`});
      if(victim)(g.attackSelections||=[]).push({type:'DIRECT',seat:victim.seat,source:'WOLF'});
    } else if(['WITCH','GUARD','STALKER'].includes(step)) {
      g.pending[step]=room.players.filter(p=>eligible(room,p)).sort((a,b)=>a.seat-b.seat).map(p=>{
        const a=g.actions[p.id]||{type:'PASS',seat:null},c=current(p);
        if(step==='WITCH'&&a.type==='SAVE')c.usedSave=true;
        if(step==='WITCH'&&a.type==='POISON')c.usedPoison=true;
        if(step==='GUARD')c.lastGuardId=targetBySeat(room,a.seat)?.id||null;
        if(step==='STALKER'&&a.seat!=null)c.usedStalk=true;
        if(Number.isInteger(a.seat)&&a.type!=='PASS'){
          const verb=step==='GUARD'?'守护':step==='STALKER'?'潜行袭击':a.type==='SAVE'?'使用解药救':'使用毒药毒';
          recap.record(g,{period:'NIGHT',text:`${p.seat}号${verb}${a.seat}号。`});
        }
        return {...a,playerId:p.id,cardId:c.id};
      });
    }
    if(g.step<(g.night===1?3:NIGHT.length-1)){g.step++;initStep(room);}else closeNight(room);
  } else if(g.phase==='VOTE'){
    if(now<g.voteDeadline&&!room.players.filter(alive).every(p=>Object.hasOwn(g.actions,p.id)))throw Error('等待所有玩家投票，或等待投票截止');
    resolveVotes(room);
  }
  else throw Error('当前无法推进');
}
function selfActionView(room,p){
  const g=room.game;if(!g)return null;
  if(g.phase==='SHERIFF'){
    const v=sheriff.selfView(room,p);
    if(v.canSignup)return {step:'SHERIFF_SIGNUP',targets:[],submitted:v.signup!==null,choice:{run:v.signup}};
    if(v.canVote)return {step:'SHERIFF',targets:targets(room,p),submitted:v.submitted,choice:{seat:v.vote}};
    return null;
  }
  if(!eligible(room,p))return null;
  if(g.phase==='BADGE')return {step:'BADGE',targets:targets(room,p),submitted:false};
  const step=g.phase==='NIGHT'?NIGHT[g.step]:g.phase;
  let options=targets(room,p);
  const c=current(p);
  const view={step,targets:options,submitted:Boolean(g.actions[p.id]),choice:g.actions[p.id]||null};
  if(step==='SEER'){view.locked=inspections(p).some(x=>x.night===g.night);view.inspectionBasis=g.night===1?'REAL':'CURRENT';}
  if(step==='WITCH'){
    view.usedSave=Boolean(c.usedSave);view.usedPoison=Boolean(c.usedPoison);
    view.canSave=!c.usedSave;view.hasSpirit=!c.usedSave;
    if(!c.usedSave)view.spiritTargets=[...new Set((g.attackSelections||[]).filter(a=>a.type==='DIRECT').map(a=>a.seat))];
  }
  if(step==='WOLF')view.wolfTeammates=wolves(room).map(x=>x.seat);
  if(step==='SEER' && p.lastInspection?.night===g.night)view.inspection=p.lastInspection;
  return view;
}
function phaseTitle(g){
  if(g.phase==='NIGHT')return `第 ${g.night} 夜 · ${LABELS[NIGHT[g.step]]}`;
  if(g.phase==='SHERIFF')return '第一天 · '+({SIGNUP:'选择上警或警下',SPEECH:'警长竞选发言',WITHDRAW:'退水与自爆倒计时',VOTE:'警下投票'}[g.election?.stage]||'警长竞选');
  return {DAWN:`第 ${g.day} 天 · 公布昨夜结果`,DISCUSSION:`第 ${g.day} 天 · 白天讨论`,LAST_WORDS:`${g.lastWordsSeat}号遗言`,BADGE:'警徽移交',VOTE:`第 ${g.day} 天 · 放逐投票`,FINISHED:'游戏结束'}[g.phase]||'';
}
function hostSkip(room,command,now=Date.now()){
  const g=room.game;
  if(room.status!=='GAME'||!g)throw Error('当前没有进行中的游戏');
  if(room.narration?.enabled&&room.narration.paused)throw Error('请先恢复语音主持');
  if(!command||!['PHASE','DAWN','NIGHT'].includes(command.mode)||!/^[a-zA-Z0-9-]{8,80}$/.test(command.commandId||''))throw Error('跳过命令无效');
  g.skipCommands||=[];
  if(g.skipCommands.some(c=>c.id===command.commandId))return false;
  if(command.gameId!==g.id||command.stepKey!==g.stepKey)throw Error('阶段已经改变，请刷新后重新操作');
  if(command.mode==='DAWN'&&g.phase!=='NIGHT')throw Error('只有夜间可以直接到天亮');
  if(command.mode==='NIGHT'&&g.phase==='NIGHT')throw Error('当前已经是夜间');
  const from=g.stepKey,fromTitle=phaseTitle(g),night=g.night;
  const once=()=>{
    if(g.phase==='NIGHT'||g.phase==='VOTE')for(const p of room.players.filter(p=>eligible(room,p)))g.actions[p.id]||={type:g.phase==='VOTE'?'VOTE':'PASS',seat:null};
    if(g.phase==='SHERIFF')g.election.deadline=now;
    if(g.phase==='BADGE')g.badgeDeadline=now;
    if(g.phase==='VOTE')g.voteDeadline=now;
    advance(room,now);
  };
  once();
  for(let i=0;i<30&&room.status==='GAME'&&((command.mode==='DAWN'&&g.phase==='NIGHT'&&g.night===night)||(command.mode==='NIGHT'&&g.phase!=='NIGHT'));i++)once();
  const event={id:command.commandId,mode:command.mode,from,to:g.stepKey,at:now};g.skipCommands.push(event);
  addPublic(g,`房主跳过：${fromTitle} → ${phaseTitle(g)}`);
  narrator.sync(room,now);
  if(g.phase==='NIGHT'&&g.night===night)narrator.skipToCurrent(room,now);
  return true;
}
module.exports={NIGHT,LABELS,cards,current,alive,role,wolves,eligible,targets,createGame,initStep,submitAction,advance,selfActionView,phaseTitle,checkWinner,inspections,visibleCards,publiclyAlive,canExplode,tick,upgrade,hostSkip};
