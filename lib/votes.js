'use strict';
const recap=require('./recap');
// Shared authoritative text for public records, UI and offline speech generation.
function clipText(id){
 const [kind,a,b]=id.split('.');
 const n=['零','一','二','三','四','五','六'];
 if(kind==='ballot')return b==='0'?`${n[a]}号弃票。`:`${n[a]}号投给${n[b]}号。`;
 if(kind==='tally')return `${n[a]}号获得${n[b]}票。`;
 if(kind==='electedVotes')return `${n[a]}号获得${n[b]}票，当选警长。`;
 if(kind==='exiledVotes')return `${n[a]}号获得${n[b]}票，本轮被放逐。`;
 if(kind==='sole')return `${n[a]}号是唯一候选人，无需投票，当选警长。`;
 return {
  'vote.sheriff.tie':'本轮竞选平票，本局没有警长。',
  'vote.sheriff.abstain':'全员弃票，所有候选人均为零票，本局没有警长。',
  'vote.sheriff.empty':'无人参选，本局没有警长。',
  'vote.sheriff.noVoters':'没有警下选民，本局没有警长。',
  'vote.exile.tie':'本轮平票，无人被放逐。',
  'vote.exile.abstain':'全员弃票，所有玩家均为零票，无人被放逐。',
  'vote.exile.sheriff':'本轮平票，按警长投票对象裁决。',
 }[id];
}
function cues(r){
 const items=r.ballots.map(b=>`ballot.${b.voter}.${b.target??0}`);
 if(r.reason==='SOLE')return [`sole.${r.selected}`];
 if(r.reason==='NO_CANDIDATES')return ['vote.sheriff.empty'];
 if(r.reason==='NO_VOTERS')return ['vote.sheriff.noVoters'];
 if(r.reason==='ABSTAIN')return [...items,`vote.${r.kind==='SHERIFF'?'sheriff':'exile'}.abstain`];
 if(['TIE','SHERIFF'].includes(r.reason)){
  items.push(...r.leaders.map(seat=>`tally.${seat}.${r.maxVotes}`));
  items.push(r.reason==='SHERIFF'?'vote.exile.sheriff':`vote.${r.kind==='SHERIFF'?'sheriff':'exile'}.tie`);
 }
 if(r.selected!==null)items.push(`${r.kind==='SHERIFF'?'electedVotes':'exiledVotes'}.${r.selected}.${r.selectedVotes}`);
 return items;
}
function result(kind,ballots,candidates,sheriffTarget=null,reason=null,selected=null){
 const tallies=Object.fromEntries(candidates.slice().sort((a,b)=>a-b).map(s=>[s,0]));
 const ordered=ballots.slice().sort((a,b)=>a.voter-b.voter).map(b=>({voter:b.voter,target:Object.hasOwn(tallies,b.target)?b.target:null}));
 for(const b of ordered)if(b.target!==null)tallies[b.target]++;
 const maxVotes=Math.max(0,...Object.values(tallies)),leaders=Object.keys(tallies).map(Number).filter(s=>tallies[s]===maxVotes);
 if(!reason){
  reason=maxVotes===0?'ABSTAIN':leaders.length===1?'UNIQUE':kind==='EXILE'&&leaders.includes(sheriffTarget)?'SHERIFF':'TIE';
  selected=reason==='UNIQUE'?leaders[0]:reason==='SHERIFF'?sheriffTarget:null;
 }
 return {kind,ballots:ordered,tallies,maxVotes,leaders,reason,selected,selectedVotes:selected===null?null:tallies[selected]||0};
}
function publish(g,r){
 g.voteResults||=[];r.id=`${g.id}:${r.kind}:${g.day}:${g.voteResults.length}`;r.night=g.night;r.day=g.day;
 r.message=cues(r).map(clipText).join('').replace(/[零一二三四五六](?=号|票)/g,c=>'零一二三四五六'.indexOf(c));
 recap.record(g,{period:'DAY',key:`vote:${r.id}`,text:`${r.kind==='SHERIFF'?'警长竞选':'放逐投票'}：${r.message}`});
 g.voteResults.push(r);g.eventSeq=(g.eventSeq??g.events.length)+1;g.events.push(r.message);if(g.events.length>60)g.events.shift();return r;
}
module.exports={result,publish,cues,clipText};
