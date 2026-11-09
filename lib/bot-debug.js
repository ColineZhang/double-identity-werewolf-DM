'use strict';
// Explicit test-only projection: never store or publish a human action here.
function record(room,p,phase,choice,inspection){
 if(room.testMode!==true||p.bot!==true||!room.game)return;
 const g=room.game,log=g.debugBotActions||=[];
 log.push({id:log.length+1,seat:p.seat,night:g.night,day:g.day,phase,
  type:choice.type,target:choice.seat??null,
  ...(typeof choice.run==='boolean'?{run:choice.run}:{}),
  ...(inspection?{result:inspection.team}:{}),
 });
}
function view(room){
 return (room.game?.debugBotActions||[]).filter(a=>room.players.some(p=>p.bot===true&&p.seat===a.seat)).map(a=>({
  id:a.id,seat:a.seat,night:a.night,day:a.day,phase:a.phase,type:a.type,target:a.target,
  ...(typeof a.run==='boolean'?{run:a.run}:{}),...(a.result?{result:a.result}:{}),
 }));
}
module.exports={record,view};
