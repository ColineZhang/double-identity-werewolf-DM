'use strict';
const { publicCard } = require('./rules');

// Private, persistent history. Never include this journal in an ongoing room view.
function record(g, entry) {
  (g.recapEvents ||= []).push({...entry, index:entry.period==='NIGHT'?g.night:g.day});
}
function number(n) {
  const digits='零一二三四五六七八九';
  if(n<10)return digits[n];
  if(n<100)return `${n<20?'':digits[Math.floor(n/10)]}十${n%10?digits[n%10]:''}`;
  return String(n);
}
function view(room) {
  const g=room.game;
  if(room.status!=='FINISHED'||g?.phase!=='FINISHED')return {};
  const entries=(g.recapEvents||[]).slice(), keys=new Set(entries.map(e=>e.key));
  // Older saves have public outcomes but no complete private skill history.
  const legacy=[];
  for(const r of g.voteResults||[])if(!keys.has(`vote:${r.id}`))legacy.push({period:'DAY',index:r.day,text:r.message});
  for(const [i,r] of (g.lossResults||[]).entries())if(!keys.has(`loss:${i}`))legacy.push({period:r.context,index:r.context==='NIGHT'?r.night:r.day,text:r.message});
  if(!(g.lossResults||[]).some(r=>r.context==='NIGHT'))for(const r of g.dawnResults||[])if(r.message)legacy.push({period:'NIGHT',index:r.night,text:r.message});
  const rounds=[];
  for(let index=1;index<=Math.max(g.night,g.day);index++)for(const period of ['NIGHT','DAY']){
    if(period==='DAY'&&index>g.day)continue;
    const lines=[...legacy,...entries].filter(e=>e.period===period&&e.index===index&&e.text).map(e=>e.text);
    if(lines.length)rounds.push({period,index,title:`第${number(index)}${period==='NIGHT'?'夜':'天'}`,lines});
  }
  return {
    reveal:room.players.slice().sort((a,b)=>a.seat-b.seat).map(p=>({seat:p.seat,name:p.name,bot:!!p.bot,
      cards:p.hand.cards.slice().sort((a,b)=>a.order-b.order).map(c=>{const v=publicCard(c);return {order:c.order,role:v.effectiveLabel,printedRole:c.printedRole,printedLabel:v.printedLabel,status:c.status};})})),
    recap:{partial:g.recapComplete!==true,rounds},
  };
}
module.exports={record,view};
