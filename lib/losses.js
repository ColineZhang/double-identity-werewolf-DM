'use strict';
const recap=require('./recap');
// Public card-count announcements share their text with the offline voice pack.
const kinds=['first','last','nightFirst','nightLast','nightDouble'];
function clipText(id){
 const [,kind,seat]=id.split('.');
 const prefix=`${seat}号${kind.startsWith('night')?'昨夜':''}`;
 const detail=kind==='nightDouble'?'失去两张身份牌，完全出局。':
  ['last','nightLast'].includes(kind)?'失去最后一张身份牌，完全出局。':'失去一张身份牌，剩余一张身份牌。';
 return prefix+detail;
}
function cues(result){
 return result.losses.map(x=>`loss.${result.context==='NIGHT'?(x.lost===2?'nightDouble':x.remaining===0?'nightLast':'nightFirst'):(x.remaining===0?'last':'first')}.${x.seat}`);
}
function publish(g,context,losses){
 const result={context,night:g.night,day:g.day,losses:losses.slice().sort((a,b)=>a.seat-b.seat)};
 result.message=losses.length?cues(result).map(clipText).join(''):'昨夜平安夜';
 (g.lossResults||=[]).push(result);
 recap.record(g,{period:context,key:`loss:${g.lossResults.length-1}`,text:result.message});
 g.eventSeq=(g.eventSeq??g.events.length)+1;g.events.push(result.message);if(g.events.length>60)g.events.shift();
 return result;
}
module.exports={kinds,clipText,cues,publish};
