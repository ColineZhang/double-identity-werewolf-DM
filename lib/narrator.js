'use strict';
const fs=require('node:fs');
const path=require('node:path');
const votes=require('./votes');
const losses=require('./losses');
const speaking=require('./speaking');
const packRoot=path.join(__dirname,'../public/voicepacks/2023-6p-v02');
const pack=JSON.parse(fs.readFileSync(path.join(packRoot,'pack.json'),'utf8'));
const ROLES=['GUARD','WOLF','WITCH','SEER','STALKER'];
const leases=new Map();
const LEASE_MS=15000;
const PLAYBACK_RATE=pack.playbackRate||1.5;
const duration=id=>{const c=pack.cues[id];if(!c||c.durationMs<=0)throw Error(`Invalid voice clip: ${id}`);return Math.ceil(c.durationMs/PLAYBACK_RATE);};
function nightPlan(night=2){
  const cues=[],windows=[];let at=0;
  const add=id=>{cues.push({cue:id,at,duration:duration(id),playbackRate:PLAYBACK_RATE});at+=duration(id);};
  add('N00');at+=5000;
  for(const [step,role] of ROLES.entries()){
    if(night===1&&role==='STALKER')continue;
    add(role+'.open');const opens=at;at+=pack.windows[role];const closes=at;
    add(role+'.close');at+=3000;windows.push({step,role,opens,closes,advance:at});
  }
  add('N06.settle');at+=5000;add('N06.dawn');
  windows.at(-1).advance=at;
  return {cues,windows,duration:at};
}
function makeNightClock(night,now=Date.now()){
  const fixed=nightPlan(night),offset=duration(night===1?'A.begin':'D07')+150;
  return {night,origin:now,windows:fixed.windows.map(w=>({...w,opens:w.opens+offset,closes:w.closes+offset,advance:w.advance+offset}))};
}
function eventCues(message,room){
  const loss=room?.game?.lossResults?.find(r=>r.message===message);
  if(loss)return loss.losses.length?losses.cues(loss):['D01'];
  const result=room?.game?.voteResults?.find(r=>r.message===message);
  if(result)return [...(result.ballots.length?[result.kind==='SHERIFF'?'D00.count':'D05.count']:[]),...votes.cues(result)];
  let m;
  if((m=/^([1-6])号玩家选择退水$/.exec(message)))return ['withdrew.'+m[1]];
  if((m=/^(警长选举|放逐投票)：(.+)$/.exec(message))){
    const list=[m[1]==='警长选举'?'D00.count':'D05.count'];
    for(const vote of m[2].split('、')){const v=/^([1-6])→([1-6]|弃票)$/.exec(vote);if(v)list.push(`ballot.${v[1]}.${v[2]==='弃票'?0:v[2]}`);}
    return list;
  }
  if(message==='昨夜平安夜'||message==='昨夜无人完全出局')return ['D01'];
  if(message.startsWith('昨夜出局：')||message.startsWith('昨夜完全出局：')){
    const seats=[...message.matchAll(/([1-6])号/g)].map(m=>Number(m[1])).sort((a,b)=>a-b);
    return seats.length?[`deaths.${seats.join('-')}`]:[];
  }
  if((m=/^([1-6]) 号当选警长$/.exec(message)))return ['elected.'+m[1]];
  if((m=/^([1-6]) 号发动自爆$/.exec(message)))return ['exploded.'+m[1]];
  if((m=/^([1-6]) 号完全出局$/.exec(message)))return ['eliminated.'+m[1]];
  if((m=/^([1-6]) 号为本轮放逐结算目标$/.exec(message)))return ['exiled.'+m[1]];
  if((m=/^平票，警长带队目标为 ([1-6]) 号$/.exec(message)))return ['tie.exiled.'+m[1]];
  if((m=/^([1-6]) 号放逐失去一张身份$/.exec(message)))return ['exiled.'+m[1]];
  if((m=/^警徽移交给 ([1-6]) 号$/.exec(message)))return ['transfer.'+m[1]];
  if(message.includes('警长选举平票'))return ['D00.tie'];
  if(message.includes('本局无警长')||message.includes('本局没有警长'))return ['D00.none'];
  if(message==='本日无人被放逐')return ['D05.none'];
  if(message==='本轮全员弃票，无人被放逐')return ['D05.abstain'];
  if(message.includes('警长放弃移交'))return ['D06.none'];
  return [];
}
function phaseKey(room){const g=room.game;if(!g)return room.status;if(g.phase==='NIGHT')return `NIGHT:${g.night}`;return `${g.phase}:${g.stepKey}`;}
function phaseCues(room,previous){
  const g=room.game;
  if(!g)return room.status==='ORDERING'?['A.order']:[];
  if(g.phase==='LAST_WORDS')return ['lastwords.'+g.lastWordsSeat];
  if(g.phase==='SHERIFF'){
    const e=g.election;
    if(e.stage==='SIGNUP')return ['D00.signup'];
    if(e.stage==='WITHDRAW')return ['withdraw'];
    if(e.stage==='VOTE')return ['D00.vote'];
    if(e.stage==='SPEECH')return ['D00.speeches',...(e.speaking?[speaking.cue(e.speaking)]:[])];
  }
  if(g.phase==='DISCUSSION')return ['D04',...(!g.sheriff&&g.discussionSpeaking?.day===g.day?[speaking.cue(g.discussionSpeaking)]:[])];
  return {DISCUSSION:['D04'],VOTE:['D05.vote'],BADGE:['D06'],FINISHED:['D08.'+g.winner]}[g.phase]||[];
}
function ensure(room){return room.narration||=( {enabled:false,paused:false,sequence:0,ordinal:0,plan:[],windows:[],origin:0,lastEventSeq:room.game?.eventSeq??room.game?.events.length??0} );}
function sync(room,now=Date.now()){
  const n=ensure(room);if(!n.enabled)return false;
  const g=room.game,key=phaseKey(room),gameId=g?.id||room.roundId||'lobby';
  const serial=g?.eventSeq??g?.events.length??0;
  const changed=key!==n.phaseKey||gameId!==n.gameId;
  const count=Math.max(0,serial-n.lastEventSeq);
  const messages=count?g.events.slice(-count):[];
  const announcements=messages.flatMap(message=>eventCues(message,room));
  n.lastEventSeq=serial;
  if(!changed&&!announcements.length)return false;
  const clock=n.paused?n.pausedAt:now,elapsed=clock-n.origin;
  const previous=n.phaseKey;
  // Finish already-started public announcements, but never carry private night cues into the day.
  let carry=n.gameId===gameId&&!previous?.startsWith('NIGHT:')?n.plan.filter(c=>c.at+c.duration>elapsed&&(!changed||c.kind==='event')).map(c=>({...c,at:c.at-elapsed})):[];
  // Announce withdrawal now rather than queueing it behind future countdowns.
  const countdowns=announcements.some(id=>id.startsWith('withdrew.'))?carry.filter(c=>c.cue.startsWith('count.')&&c.at>0):[];
  carry=carry.filter(c=>!countdowns.includes(c));
  n.plan=carry;n.windows=[];n.origin=clock;n.phaseKey=key;n.gameId=gameId;n.sequence++;
  let at=Math.max(0,...carry.map(c=>c.at+c.duration));
  const add=(id,kind='phase')=>{n.plan.push({id:++n.ordinal,cue:id,kind,at,duration:duration(id),playbackRate:PLAYBACK_RATE});at+=duration(id)+150;};
  announcements.forEach(id=>add(id,'event'));
  n.plan.push(...countdowns.filter(c=>c.at>=at));
  if(g?.phase==='NIGHT'){
    add(g.night===1?'A.begin':'D07');
    const fixed=nightPlan(g.night);n.nightOffset=at;
    n.plan.push(...fixed.cues.map(c=>({...c,at:c.at+at,id:++n.ordinal})));
    n.windows=fixed.windows.map(w=>({...w,opens:w.opens+at,closes:w.closes+at,advance:w.advance+at}));
    n.endsAt=clock+at+fixed.duration;
    g.nightClock={night:g.night,origin:clock,windows:n.windows.map(w=>({...w}))};
  }else{
    if(changed)phaseCues(room,previous).forEach(id=>add(id));
    n.endsAt=null;
    // Keep the full interaction window after its introduction has finished.
    if(changed&&g?.phase==='SHERIFF'&&g.election.deadline){
      g.election.deadline+=at;
      if(g.election.stage==='WITHDRAW')for(let s=5;s>=1;s--)n.plan.push({id:++n.ordinal,cue:'count.'+s,at:g.election.deadline-clock-s*1000,duration:duration('count.'+s),playbackRate:PLAYBACK_RATE});
    }
    if(changed&&g?.phase==='BADGE')g.badgeDeadline+=at;
    if(changed&&g?.phase==='VOTE')g.voteDeadline+=at;
  }
  n.checkpointAt=clock;
  return true;
}
function pause(room,reason='房主已暂停',now=Date.now()){
  const n=ensure(room);if(!n.enabled||n.paused)return false;
  n.paused=true;n.pausedAt=now;n.reason=reason;n.checkpointAt=now;return true;
}
function resume(room,now=Date.now()){
  const n=ensure(room);if(!n.paused)return;
  const delta=Math.max(0,now-n.pausedAt),g=room.game;
  n.origin+=delta;if(n.endsAt)n.endsAt+=delta;
  if(g?.phase==='NIGHT'&&g.nightClock)g.nightClock.origin+=delta;
  if(g?.phase==='SHERIFF'&&g.election.deadline)g.election.deadline+=delta;
  if(g?.phase==='BADGE'&&g.badgeDeadline)g.badgeDeadline+=delta;
  if(g?.phase==='VOTE'&&g.voteDeadline)g.voteDeadline+=delta;
  n.paused=false;n.pausedAt=null;n.reason='';n.checkpointAt=now;
}
function claim(room,clientId,now=Date.now()){
  if(typeof clientId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(clientId))throw Error('播放设备标识无效');
  const old=leases.get(room.code);
  if(old&&old.until>now&&old.clientId!==clientId)throw Error('另一个房主页面正在播报，请先在该页面关闭语音');
  leases.set(room.code,{clientId,until:now+LEASE_MS});return {until:now+LEASE_MS,serverNow:now};
}
function owns(room,clientId,now=Date.now()){const l=leases.get(room.code);return Boolean(l&&l.clientId===clientId&&l.until>now);}
function control(room,clientId,action,now=Date.now()){
  if(!owns(room,clientId,now))throw Error('此页面不是当前语音播放端，请重新开启语音');
  const n=ensure(room);
  if(action==='enable'||action==='attach'){
    if(!n.enabled&&room.game?.phase==='NIGHT'&&room.game.step>0)throw Error('本夜已进行中，请完成本夜后开启语音，或重新开局');
    if(!n.enabled){n.enabled=true;n.phaseKey=null;n.gameId=null;n.lastEventSeq=room.game?.eventSeq??room.game?.events.length??0;}
    if(action==='enable')resume(room,now);
    sync(room,now);
  }else if(action==='pause')pause(room,'房主已暂停',now);
  else if(action==='resume')resume(room,now);
  else if(action==='disable'){resume(room,now);n.enabled=false;n.plan=[];n.windows=[];leases.delete(room.code);}
  else throw Error('语音控制指令无效');
}
function maintain(room,now=Date.now()){
  const n=ensure(room);
  if(!n.enabled){const key=`${room.game?.stepKey}:${windowOpen(room,now)}`;if(key!==n.windowKey){n.windowKey=key;return true;}return false;}
  const lease=leases.get(room.code);
  if(!lease||lease.until<=now)return pause(room,'语音播放端已断开，请重新开启语音',lease?.until||now);
  n.checkpointAt=n.paused?n.pausedAt:now;
  let changed=sync(room,now);
  const windowKey=`${room.game?.step}:${windowOpen(room,now)}`;
  if(n.windowKey!==windowKey){n.windowKey=windowKey;changed=true;}
  return changed;
}
function restore(room,now=Date.now()){
  const n=room.narration;
  // Keep already-promised window deadlines on upgrade; new plans use shorter
  // audio offsets. Old pending clips also play faster without replaying at EOF.
  if(n?.plan?.some(c=>!c.playbackRate)){
    n.plan=n.plan.map(c=>c.playbackRate?c:{...c,playbackRate:PLAYBACK_RATE,duration:duration(c.cue)});n.sequence++;
  }
  if(!n?.enabled||n.paused)return;
  pause(room,'服务已重启，请在房主端恢复语音',Math.min(now,n.checkpointAt||now));
}
function windowOpen(room,now=Date.now()){
  const n=room.narration,g=room.game;
  if(!n?.enabled){
    if(g?.phase!=='NIGHT')return true;
    const c=g.nightClock,w=c?.windows.find(w=>w.step===g.step),elapsed=now-(c?.origin||0);
    return Boolean(w&&elapsed>=w.opens&&elapsed<w.closes);
  }
  if(n.paused)return false;
  if(g?.phase!=='NIGHT')return true;
  const w=n.windows.find(x=>x.step===g.step),elapsed=now-n.origin;
  return Boolean(w&&elapsed>=w.opens&&elapsed<w.closes);
}
function due(room,now=Date.now()){
  const n=room.narration,g=room.game;
  if(!n?.enabled||n.paused||g?.phase!=='NIGHT')return false;
  const w=n.windows.find(x=>x.step===g.step);
  return Boolean(w&&now>=n.origin+w.advance);
}
function view(room,now=Date.now()){
  const n=room.narration;
  if(!n?.enabled){const g=room.game,c=g?.phase==='NIGHT'?g.nightClock:null,w=c?.windows.find(w=>w.step===g.step);return {enabled:false,packId:pack.id,serverNow:now,windowOpen:windowOpen(room,now),actionClosesAt:w?c.origin+w.closes:null,actionOpensAt:w?c.origin+w.opens:null};}
  const g=room.game,w=g?.phase==='NIGHT'?n.windows.find(x=>x.step===g.step):null;
  return {enabled:true,packId:pack.id,paused:n.paused,reason:n.reason||'',sequence:n.sequence,gameId:n.gameId,origin:n.origin,pausedAt:n.pausedAt,serverNow:now,plan:n.plan,nightOffset:n.nightOffset,endsAt:n.endsAt,actionOpensAt:w?n.origin+w.opens:null,actionClosesAt:w?n.origin+w.closes:null,windowOpen:windowOpen(room,now)};
}
function skipToCurrent(room,now=Date.now()){
  const g=room.game;if(g?.phase!=='NIGHT')return;
  const n=room.narration,c=g.nightClock,w=c.windows.find(w=>w.step===g.step);
  const start=w.opens-duration(ROLES[g.step]+'.open');c.origin=now-start;
  if(n?.enabled){n.origin=c.origin;n.plan=n.plan.filter(cue=>cue.at>=start).map(cue=>({...cue,id:++n.ordinal}));n.endsAt=n.origin+n.windows.at(-1).advance;n.sequence++;n.checkpointAt=now;}
}
module.exports={pack,packRoot,nightPlan,makeNightClock,eventCues,phaseCues,sync,pause,resume,claim,owns,control,maintain,restore,windowOpen,due,view,skipToCurrent,LEASE_MS};
