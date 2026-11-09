'use strict';
// Optional real-browser smoke test. Node >=22 and a local Chrome/Edge are required.
// Uses isolated browser profiles, ephemeral HTTP ports and a temporary database.
const fs=require('node:fs');
const path=require('node:path');
const {tmpdir}=require('node:os');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {makeRoom,openWindow}=require('./helpers');
const game=require('../lib/game');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const dir=fs.mkdtempSync(path.join(tmpdir(),'werewolf-browser-'));
const profile=path.join(dir,'profile');
process.env.DATA_FILE=path.join(dir,'rooms.json');
function fixture(code){
 const room=makeRoom();room.code=code;room.host={id:'host',sid:code.padEnd(64,'a'),lastSeen:Date.now()};
 room.players.forEach((p,i)=>{p.sid=(code+i).padEnd(64,'b');p.lastSeen=Date.now();});
 game.createGame(room);return room;
}
const seer=fixture('999991');seer.game.step=3;game.initStep(seer);openWindow(seer);
const election=fixture('999992');
while(election.game.phase==='NIGHT')game.advance(election);
election.game.election.signups={p1:true,p2:false,p3:false,p4:false,p5:false};
election.game.election.deadline=Date.now()+120000;
const witch=fixture('999993');witch.players[0].hand.cards[0].effectiveRole='VILLAGER';witch.players[0].hand.cards[0].printedRole='VILLAGER';witch.players[0].hand.cards[0].status='LOST';witch.players[0].hand.cards[1].effectiveRole='WITCH';witch.players[0].hand.cards[1].printedRole='WITCH';witch.players[0].hand.cards[1].status='ACTIVE';game.createGame(witch);
witch.game.night=2;witch.game.day=1;witch.game.step=1;game.initStep(witch);game.submitAction(witch,witch.players[2],{type:'TARGET',seat:1});game.advance(witch);openWindow(witch);
const farewell=fixture('999994');farewell.players[1].hand.cards[0].status='LOST';farewell.players[1].hand.cards[1].status='ACTIVE';
farewell.game.phase='VOTE';farewell.game.day=1;farewell.game.sheriff='p0';game.initStep(farewell);
game.submitAction(farewell,farewell.players[0],{type:'VOTE',seat:2});game.advance(farewell,farewell.game.voteDeadline);
const completed=fixture('999995');
game.advance(completed);game.advance(completed);game.submitAction(completed,completed.players[3],{type:'POISON',seat:5});
while(completed.game.phase==='NIGHT')game.advance(completed);
game.advance(completed,completed.game.election.deadline);game.advance(completed);
game.submitAction(completed,completed.players[0],{type:'VOTE',seat:5});game.advance(completed,completed.game.voteDeadline);game.advance(completed);
assert.equal(completed.status,'FINISHED');
const discussion=fixture('999996');
while(discussion.game.phase==='NIGHT')game.advance(discussion);
game.advance(discussion,discussion.game.election.deadline);
fs.writeFileSync(process.env.DATA_FILE,JSON.stringify({rooms:{[seer.code]:seer,[election.code]:election,[witch.code]:witch,[farewell.code]:farewell,[completed.code]:completed,[discussion.code]:discussion}}));
const {server}=require('../server');
let chrome,ws;
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=process.env.BROWSER_PATH||[
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
 ].find(p=>fs.existsSync(p));
 if(!browser)throw Error('Set BROWSER_PATH to a Chromium-based browser');
 chrome=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:'ignore'});
 const activePort=path.join(profile,'DevToolsActivePort');
 for(let i=0;i<100&&!fs.existsSync(activePort);i++)await delay(100);
 const lines=fs.readFileSync(activePort,'utf8').trim().split(/\r?\n/);
 ws=new WebSocket(`ws://127.0.0.1:${lines[0]}${lines[1]}`);await once(ws,'open');
 let serial=0;const pending=new Map(),errors=[];
 function send(method,params={},sessionId){return new Promise((resolve,reject)=>{
  const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},10000);
  pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
 });}
 ws.addEventListener('message',event=>{
  const m=JSON.parse(event.data);
  if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+': '+(m.params.exceptionDetails.exception?.description||''));
  if(m.method==='Page.javascriptDialogOpening')send('Page.handleJavaScriptDialog',{accept:true},m.sessionId).catch(()=>{});
 });
 ws.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Browser closed'));}pending.clear();});
 async function evaluate(sessionId,expression){
  const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
 }
 async function waitFor(sessionId,expression,timeout=6000){
  const until=Date.now()+timeout;
  while(Date.now()<until){if(await evaluate(sessionId,expression))return;await delay(100);}
  throw Error(`Browser assertion timed out: ${expression}; voice=${await evaluate(sessionId,'JSON.stringify({status:voice?.status(),narration:data?.room?.narration})')}`);
 }
 async function page(room,actor,mobile=false){
  const {browserContextId}=await send('Target.createBrowserContext');
  const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Runtime.enable',{},sessionId);await send('Page.enable',{},sessionId);
  if(mobile)await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
  if(room){const sid=actor==='host'?room.host.sid:room.players[actor].sid;
  await send('Network.setCookie',{name:'werewolf_sid',value:sid,url:base,httpOnly:true,sameSite:'Strict'},sessionId);}
  await send('Page.navigate',{url:base},sessionId);
  await waitFor(sessionId,room?'typeof data!=="undefined" && data?.joined===true':'typeof data!=="undefined" && data!==null');
  return sessionId;
 }
 const fresh=await page(null);
 await evaluate(fresh,'document.querySelector("[data-action=create]").click()');
 await waitFor(fresh,'data?.joined && voice.status().active',12000);
 assert.equal(await evaluate(fresh,'!!document.querySelector("[data-action=voice-enable]")'),false);
 await evaluate(fresh,'document.querySelector("[data-action=voice-test]").click()');
 await waitFor(fresh,'voice.status().preview && voice.status().playing');
 assert.equal(await evaluate(fresh,'document.querySelector("[data-action=voice-test]").textContent'),'测试音量');
 const player=await page(seer,0,true),host=await page(seer,'host'),other=await page(seer,1);
 assert.equal(await evaluate(player,'Array.from(document.querySelector("#targetSelect").options).find(o=>o.value==="3").textContent.includes("玩家 3")'),true);
 assert.equal(await evaluate(player,'document.querySelector("[data-action=submit]").disabled'),true);
 await evaluate(player,'document.querySelector("#targetSelect").value="3";document.querySelector("#targetSelect").dispatchEvent(new Event("change",{bubbles:true}))');
 await evaluate(player,'document.querySelector("[data-action=submit]").click()');
 await waitFor(player,'document.querySelector(".inspection-result")?.textContent.includes("狼人")');
 assert.equal(await evaluate(host,'document.body.textContent.includes("你的查验记录")'),false);
 assert.equal(await evaluate(other,'document.body.textContent.includes("你的查验记录")'),false);
 await evaluate(host,'document.querySelector("[data-action=skip][data-mode=PHASE]").click()');
 await waitFor(player,'data.room.game.phase==="SHERIFF"');
 assert.equal(await evaluate(player,'document.querySelector(".inspection-result").textContent.includes("狼人")'),true);
 await send('Page.reload',{},player);
 await waitFor(player,'document.querySelector(".inspection-result")?.textContent.includes("狼人")');
 const screenshot=await send('Page.captureScreenshot',{format:'png'},player);
 fs.writeFileSync(path.join(dir,'seer-mobile.png'),Buffer.from(screenshot.data,'base64'));
 const candidate=await page(election,0,true),ehost=await page(election,'host');
 await evaluate(candidate,'document.querySelector("[data-action=signup][data-run=true]").click()');
 await waitFor(ehost,'data.room.game.election.canAdvance');
 await evaluate(ehost,'document.querySelector("[data-action=advance]").click()');
 await waitFor(candidate,'data.room.game.election.stage==="SPEECH"');
 const campaignOrder=await evaluate(candidate,'data.room.game.election.speaking');
 assert.equal(await evaluate(candidate,'document.body.textContent.includes("根据随机点数")'),true);
 assert.deepEqual(await evaluate(ehost,'data.room.game.election.speaking'),campaignOrder);
 assert.equal(await evaluate(candidate,'!!document.querySelector("[data-action=withdraw]")'),true);
 await evaluate(candidate,'document.querySelector("[data-action=withdraw]").click()');
 await waitFor(ehost,'data.room.game.election.withdrawn.includes(1)');
 assert.equal(await evaluate(ehost,'data.room.game.election.deadline'),null);
 await evaluate(ehost,'document.querySelector("[data-action=advance]").click()');
 await waitFor(candidate,'data.room.game.election.stage==="WITHDRAW"');
 assert.equal(await evaluate(candidate,'data.self.election.canWithdraw'),false);
 const electionScreenshot=await send('Page.captureScreenshot',{format:'png'},candidate);
 fs.writeFileSync(path.join(dir,'election-mobile.png'),Buffer.from(electionScreenshot.data,'base64'));
 await waitFor(candidate,'data.room.game.phase==="DISCUSSION"',35000);
 await waitFor(ehost,'data.room.game.phase==="DISCUSSION"');
 assert.equal(await evaluate(candidate,'data.room.game.sheriff'),2);
 await waitFor(candidate,'data.room.game.phase==="DISCUSSION"');
 await evaluate(ehost,'document.querySelector("[data-action=voice-test]").click()');
 await waitFor(ehost,'voice.status().preview');
 await evaluate(ehost,'document.querySelector("[data-action=voice-resume]").click()');
 await waitFor(ehost,'voice.status().active && voice.status().playing && !voice.status().preview && !data.room.narration.paused',12000);
 assert.equal(await evaluate(candidate,'voice.status().active'),false);
 await evaluate(ehost,'document.querySelector("[data-action=voice-pause]").click()');
 await waitFor(ehost,'data.room.narration.paused && !voice.status().playing');
 await evaluate(ehost,'document.querySelector("[data-action=voice-replay]").click()');
 await waitFor(ehost,'voice.status().preview && voice.status().playing');
 assert.equal(await evaluate(ehost,'data.room.narration.paused'),true);
 await evaluate(ehost,'document.querySelector("[data-action=voice-resume]").click()');
 await waitFor(ehost,'!data.room.narration.paused && !voice.status().preview');
 await evaluate(ehost,'document.querySelector("[data-action=voice-disable]").click()');
 await waitFor(ehost,'!data.room.narration.enabled && !voice.status().playing');
 const witchPhone=await page(witch,0,true),witchHost=await page(witch,'host');
 assert.equal(await evaluate(witchPhone,'document.body.textContent.includes("指杀选择目标：1号")'),true);
 assert.equal(await evaluate(witchPhone,'!!document.querySelector(".identity-dialog")'),false);
 await evaluate(witchPhone,'document.querySelector("[data-action=toggle-identity]").click()');
 assert.equal(await evaluate(witchPhone,'document.querySelector(".identity-dialog").textContent.includes("第二身份 · 女巫")'),true);
 await evaluate(witchPhone,'document.querySelector("[data-action=close-identity]").click()');
 assert.equal(await evaluate(witchPhone,'!!document.querySelector(".identity-dialog")'),false);
 await evaluate(witchPhone,'document.querySelector("#typeSelect").value="SAVE";document.querySelector("#typeSelect").dispatchEvent(new Event("change",{bubbles:true}))');
 assert.equal(await evaluate(witchPhone,'document.querySelector("#targetSelect").options.length'),7);
 await evaluate(witchPhone,'document.querySelector("#targetSelect").value="1";document.querySelector("#targetSelect").dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("[data-action=submit]").click()');
 await waitFor(witchPhone,'data.self.action.submitted');
 await evaluate(witchHost,'document.querySelector("[data-action=skip][data-mode=DAWN]").click()');
 await waitFor(witchPhone,'data.room.game.phase==="DISCUSSION"');
 assert.equal(await evaluate(witchPhone,'data.self.cards[1].status'), 'ACTIVE');
 assert.equal(await evaluate(witchPhone,'data.room.game.events.includes("昨夜平安夜")'),true);
 await send('Page.reload',{},witchPhone);await waitFor(witchPhone,'typeof data!=="undefined" && data?.joined && !!document.querySelector("[data-action=toggle-identity]")');
 assert.equal(await evaluate(witchPhone,'!!document.querySelector(".identity-dialog")'),false);
 assert.deepEqual(errors,[]);
 const farewellHost=await page(farewell,'host'),farewellPhone=await page(farewell,1,true);
 assert.equal(await evaluate(farewellPhone,'document.querySelector(".roster .player").textContent.includes("警徽")'),true);
 assert.equal(await evaluate(farewellPhone,'data.room.game.phase'), 'LAST_WORDS');
 assert.equal(await evaluate(farewellPhone,'!!document.querySelector("[data-deadline]")'),false);
 assert.equal(await evaluate(farewellPhone,'fetch("/api/advance",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(r=>r.status)'),403);
 await waitFor(farewellHost,'voice.status().active');
 await send('Page.reload',{},farewellHost);await waitFor(farewellHost,'typeof data!=="undefined" && data?.room?.game?.phase==="LAST_WORDS"');
 assert.equal(await evaluate(farewellHost,'document.querySelector("[data-action=advance]").textContent'),'结束遗言，进入黑夜');
 await waitFor(farewellHost,'data.room.narration.paused && !voice.status().loading');
 // A refreshed document must wait for the previous playback lease to expire.
 if(!await evaluate(farewellHost,'voice.status().active'))await delay(16000);
 await evaluate(farewellHost,'document.querySelector("[data-action=voice-test]").click()');
 await waitFor(farewellHost,'voice.status().preview && data.room.narration.paused');
 await evaluate(farewellHost,'document.querySelector("[data-action=voice-resume]").click()');
 await waitFor(farewellHost,'!data.room.narration.paused && !voice.status().preview');
 await evaluate(farewellHost,'document.querySelector("[data-action=advance]").click()');
 await waitFor(farewellPhone,'data.room.game.phase==="NIGHT"');
 assert.equal(await evaluate(farewellPhone,'data.room.game.night'),2);
 const discussionHost=await page(discussion,'host'),discussionPhone=await page(discussion,0,true);
 const initialOrder=await evaluate(discussionPhone,'data.room.game.speaking');
 assert.equal(await evaluate(discussionPhone,'document.body.textContent.includes("根据随机点数")'),true);
 await evaluate(discussionHost,'document.querySelector("[data-action=voice-test]").click()');
 await waitFor(discussionHost,'data.room.narration.plan?.some(c=>c.cue.startsWith("speaking."))');
 await send('Page.reload',{},discussionPhone);await waitFor(discussionPhone,'typeof data!=="undefined" && !!data?.room?.game?.speaking');
 assert.deepEqual(await evaluate(discussionPhone,'data.room.game.speaking'),initialOrder);
 for(const actor of ['host',0]){
  const endPage=await page(completed,actor,actor!== 'host');
  assert.equal(await evaluate(endPage,'data.room.game.reveal.length'),6);
  assert.equal(await evaluate(endPage,'data.room.game.recap.partial'),false);
  assert.equal(await evaluate(endPage,'/第一夜[\\s\\S]*未提交或跳过[\\s\\S]*第一天[\\s\\S]*完全出局/.test(document.body.textContent)'),true);
  assert.equal(await evaluate(endPage,'document.body.textContent.includes("第二身份：复制人 → 潜行者")'),true);
  assert.equal(await evaluate(endPage,'document.documentElement.scrollWidth <= innerWidth'),true);
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,checks:['fresh room defaults to voice hosting; volume test plays without enable switch','host reload stays paused; volume test reconnects; manual resume continues','seer click -> private result','result survives host skip and reload','host and other player privacy','mobile signup -> speech -> withdrawal','10-second countdown -> sheriff result -> automatic dawn announcement','host WAV playback -> pause -> replay -> resume -> disable; player stays silent','mobile identity drawer open/close/reload','second witch sees knife -> saves self -> host skip dawn -> survives'],screenshots:[path.join(dir,'seer-mobile.png'),path.join(dir,'election-mobile.png')]}));
 await send('Browser.close').catch(()=>{});
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 ws?.close();
 if(chrome&&chrome.exitCode===null){chrome.kill();await Promise.race([once(chrome,'exit'),delay(2000)]);}
 server.closeAllConnections();await new Promise(r=>server.close(r));
 if(!path.resolve(profile).startsWith(path.resolve(dir)+path.sep))throw Error('unexpected profile path');
 try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch{}
});
