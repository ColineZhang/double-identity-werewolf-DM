'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {clipText}=require('../lib/votes');
const losses=require('../lib/losses');
const source=fs.readFileSync(path.join(__dirname,'../NARRATOR_SCRIPT_2023_6P_v0.2.md'),'utf8');
function section(id){const start=source.indexOf(`### ${id} —`);if(start<0)throw Error(`Missing ${id}`);const end=source.indexOf('\n### ',start+1);return source.slice(start,end<0?undefined:end);}
function quotes(text){return text.split(/\r?\n/).filter(x=>/^>\s+/.test(x)).map(x=>x.replace(/^>\s+/,''));}
const lines={'test':'语音测试。请确认音量合适。'};
lines['N00']=quotes(section('N00')).join('');
const roles=['GUARD','WOLF','WITCH','SEER','STALKER'];
roles.forEach((role,i)=>{const q=quotes(section(`N0${i+1}`));lines[`${role}.open`]=q.slice(0,-1).join('');lines[`${role}.close`]=q.at(-1);});
const end=quotes(section('N06'));lines['N06.settle']=end.slice(0,-1).join('');lines['N06.dawn']=end.at(-1);
const startQuotes=quotes(source.slice(source.indexOf('## A.'),source.indexOf('## B.')));
lines['A.order']=startQuotes.slice(0,-1).join('');lines['A.begin']=startQuotes.at(-1);
Object.assign(lines,{
 'D00.signup':'现在进行警长竞选。想要参选的玩家，请在手机上报名。',
 'D00.speeches':'报名结束。请候选人发言。',
 'D00.vote':'现在开始投票。请在手机上选择你支持的候选人，也可以弃票。',
 'D00.count':'投票结束。现在公布票型。',
 'D00.tie':'本轮竞选平票，本局没有警长。',
 'D00.none':'警长竞选结束，本局没有警长。',
 'D01':quotes(section('D01')).join(''),
 'D04':'现在进入白天讨论。请各位玩家按屏幕显示的顺序发言。',
 'D05.vote':'发言结束。现在开始放逐投票。请在手机上选择放逐目标，也可以弃票。',
 'D05.count':'投票结束。现在公布票型。',
 'D05.none':'本轮平票，无玩家因本次投票出局。',
 'D05.abstain':'本轮全员弃票，无人被放逐。',
 'D06':'警长已出局。请在手机上选择是否移交警徽。',
 'D06.none':'警徽作废。本局接下来没有警长。',
 'D06B.end':'遗言结束。',
 'D06C.end':'当前白天阶段结束。',
 'D07':'白天阶段结束。',
 'D08.VILLAGE':'游戏结束。好人阵营获胜。',
 'D08.WOLF':'游戏结束。狼人阵营获胜。',
 'withdraw':'现在进入退水与自爆倒计时。',
});
const numbers=['一','二','三','四','五','六'];
for(let seat=1;seat<=6;seat++)for(const direction of ['CW','CCW']){
 lines[`speaking.${seat}.${direction}`]=`根据随机点数，从${numbers[seat-1]}号玩家开始${direction==='CW'?'顺时针':'逆时针'}发言。`;
}
for(let i=1;i<=6;i++){
 const n=numbers[i-1];
 lines[`speaker.${i}`]=`请${n}号玩家发言。`;
 lines[`withdrew.${i}`]=`${n}号玩家选择退水。`;
 lines[`elected.${i}`]=`${n}号玩家当选警长。`;
 lines[`exploded.${i}`]=`${n}号玩家发动自爆。`;
 lines[`eliminated.${i}`]=`${n}号玩家完全出局。`;
 lines[`exiled.${i}`]=`${n}号玩家获得最高票，本轮放逐结算完成。`;
 lines[`tie.exiled.${i}`]=`本轮出现平票。根据警长带队规则，本轮放逐结算目标为${n}号玩家。`;
 lines[`transfer.${i}`]=`警徽移交给${n}号玩家。`;
 lines[`lastwords.${i}`]=`${n}号玩家，请发表遗言。`;
 lines[`ballot.${i}.0`]=`${n}号玩家弃票。`;
 for(let j=1;j<=6;j++)lines[`ballot.${i}.${j}`]=`${n}号玩家投给${numbers[j-1]}号玩家。`;
}
for(let mask=1;mask<64;mask++){
 const seats=Array.from({length:6},(_,i)=>i+1).filter(i=>mask&(1<<(i-1)));
 lines[`deaths.${seats.join('-')}`]='公布昨夜出局情况。'+seats.map(i=>numbers[i-1]+'号').join('、')+'玩家出局。';
}
for(let i=1;i<=5;i++)lines[`count.${i}`]=numbers[i-1];
for(let seat=1;seat<=6;seat++){
 for(let count=0;count<=6;count++)for(const kind of ['ballot','tally','electedVotes','exiledVotes']){const id=`${kind}.${seat}.${count}`;lines[id]=clipText(id);}
 lines[`sole.${seat}`]=clipText(`sole.${seat}`);
}
for(const id of ['vote.sheriff.tie','vote.sheriff.abstain','vote.sheriff.empty','vote.sheriff.noVoters','vote.exile.tie','vote.exile.abstain','vote.exile.sheriff'])lines[id]=clipText(id);
for(const kind of losses.kinds)for(let seat=1;seat<=6;seat++){
 const id=`loss.${kind}.${seat}`;
 lines[id]=losses.clipText(id).replace(/^([1-6])号/,(_,n)=>numbers[Number(n)-1]+'号');
}
const cues=Object.fromEntries(Object.entries(lines).map(([id,text])=>[id,{text,file:id+'.wav',durationMs:0}]));
const pack={id:'narrator-2023-6p-v02',playbackRate:1.5,label:'2023 六人播报稿 v0.2',source:'NARRATOR_SCRIPT_2023_6P_v0.2.md',voice:'Microsoft Huihui Desktop',windows:{GUARD:10000,WOLF:40000,WITCH:30000,SEER:10000,STALKER:10000},cues};
const dest=path.join(__dirname,'../public/voicepacks/2023-6p-v02');
fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'pack.json'),JSON.stringify(pack,null,2)+'\n');
console.log(`Prepared ${Object.keys(cues).length} script-based clips`);
