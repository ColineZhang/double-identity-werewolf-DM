'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8').replace(/refresh\(true\);loadNetwork\(\);setInterval\([\s\S]*$/,'');
function boot(){
 const app={innerHTML:'',addEventListener(){}};
 const document={getElementById(){return app;},addEventListener(){}};
 const context=vm.createContext({document,location:{search:'',pathname:'/'},URLSearchParams,localStorage:{getItem(){return null;},setItem(){}},history:{replaceState(){}},setInterval(){},window:{addEventListener(){}},EventSource:class{},navigator:{},confirm(){return true}});
 vm.runInContext(source,context);return {context,app,run:code=>vm.runInContext(code,context)};
}
const players=Array.from({length:6},(_,i)=>({id:`p${i}`,seat:i+1,name:'玩家 '+(i+1),online:true,locked:true,eliminated:false}));
const game={phase:'NIGHT',title:'第 1 夜 · 守卫',night:1,day:0,step:0,sheriff:null,winner:null,events:[]};

test('skill and vote target options include escaped nicknames and retain numeric submitted values',()=>{
 const {run}=boot();
 run(`data=${JSON.stringify({room:{players:[{seat:1,name:'阿明'},{seat:2,name:'<小红>'}]},self:{action:{step:'VOTE'}}})}`);
 const html=run('targetSelect([1,2])');assert.match(html,/value="1"[^>]*>1 号 · 阿明/);assert.match(html,/2 号 · &lt;小红&gt;/);
 run("data.self.action.step='SEER'");assert.match(run('targetSelect([2],true)'),/2 号 · &lt;小红&gt;/);
});

test('host and phone see ordered postgame recap and copy identities with escaped content',()=>{
 const {app,run}=boot();
 const final={...game,phase:'FINISHED',winner:'WOLF',reveal:[{seat:2,name:'<img>',cards:[{role:'女巫',status:'LOST'},{role:'女巫',printedRole:'COPYCAT',status:'ACTIVE'}]}],recap:{partial:false,rounds:[{title:'第一夜',lines:['狼队空刀（主动选择）。']},{title:'第一天',lines:['2号获得3票，本轮被放逐。']},{title:'第二夜',lines:['2号使用毒药毒3号。']}]}};
 for(const isHost of [true,false]){
  run(`applyState(${JSON.stringify({joined:true,room:{code:'123456',status:'FINISHED',players,game:final},self:{isHost,cards:[]}})});render(true)`);
  assert.match(app.innerHTML,/第一身份：女巫/);assert.match(app.innerHTML,/第二身份：复制人 → 女巫/);
  assert.match(app.innerHTML,/第一夜[\s\S]*主动选择[\s\S]*第一天[\s\S]*第二夜/);
  assert.match(app.innerHTML,/&lt;img&gt;/);assert.doesNotMatch(app.innerHTML,/<img>/);
 }
});

test('badge follows its holder and last words expose only the host continuation button',()=>{
 const {app,run}=boot();const view={joined:true,room:{code:'123456',status:'GAME',players,game:{...game,phase:'LAST_WORDS',lastWordsSeat:2,sheriff:2}},self:{isHost:true}};
 run(`applyState(${JSON.stringify(view)});render(true)`);
 assert.match(app.innerHTML,/结束遗言，进入黑夜/);assert.doesNotMatch(app.innerHTML,/data-deadline=/);
 assert.match(run('seatCard(data.room.players[1])'),/>警徽</);assert.doesNotMatch(run('seatCard(data.room.players[0])'),/>警徽</);
 view.self={isHost:false,id:'p1',seat:2,cards:[]};view.room.game.sheriff=1;run(`applyState(${JSON.stringify(view)});render(true)`);
 assert.match(app.innerHTML,/2号正在发表遗言/);assert.doesNotMatch(app.innerHTML,/data-action="advance"/);
 assert.match(run('seatCard(data.room.players[0])'),/>警徽</);assert.doesNotMatch(run('seatCard(data.room.players[1])'),/>警徽</);
});

test('public seat cards display two identities, one identity and eliminated on host and phone',()=>{
 const {app,run}=boot();
 const view={joined:true,room:{code:'123456',status:'GAME',players:players.map((p,i)=>({...p,remainingCards:i%3})),game:{...game,phase:'DISCUSSION'}},self:{isHost:true}};
 for(const self of [{isHost:true},{isHost:false,id:'p0',seat:1,cards:[]}]){
  view.self=self;run(`applyState(${JSON.stringify(view)});render(true)`);
  assert.match(app.innerHTML,/剩余两张身份牌/);assert.match(app.innerHTML,/剩余一张身份牌/);assert.match(app.innerHTML,/>已出局</);
 }
});

test('legacy debug payload cannot render any Bot controls or private hands',()=>{
 const {app,run}=boot();
 const view={joined:true,room:{code:'123456',status:'GAME',testMode:true,players,game,debugBotHands:[{seat:2,cards:[{effectiveLabel:'秘密身份'}]}],debugBotActions:[{seat:2,phase:'SEER',result:'秘密查验'}]},self:{isHost:true}};
 run(`applyState(${JSON.stringify(view)});render(true)`);
 assert.doesNotMatch(app.innerHTML,/Bot|测试模式|秘密身份|秘密查验|create-test|test-mode/);
});

test('private identity drawer defaults closed, shows both states, closes on refresh, and is absent for host',()=>{
 const {app,run}=boot();
 const view={joined:true,room:{code:'123456',status:'GAME',players,playerCount:6,game:{...game,phase:'DISCUSSION'}},self:{isHost:false,id:'p0',seat:1,locked:true,cards:[{order:0,printedLabel:'村民',effectiveLabel:'村民',status:'LOST'},{order:1,printedLabel:'女巫',effectiveLabel:'女巫',status:'ACTIVE'}]}};
 run(`applyState(${JSON.stringify(view)});render(true)`);assert.match(app.innerHTML,/查看我的身份/);assert.doesNotMatch(app.innerHTML,/identity-dialog|第一身份.*村民/);
 run('identityOpen=true;render(true)');assert.match(app.innerHTML,/第一身份 · 村民/);assert.match(app.innerHTML,/第二身份 · 女巫/);assert.match(app.innerHTML,/已失效/);assert.match(app.innerHTML,/当前生效/);
 run(`applyState(${JSON.stringify(view)});render(true)`);assert.doesNotMatch(app.innerHTML,/identity-dialog/);
 view.room.status='READY';run(`applyState(${JSON.stringify(view)});render(true)`);assert.match(app.innerHTML,/查看我的身份/);assert.doesNotMatch(app.innerHTML,/card-choice/);
 view.self={isHost:true};run(`applyState(${JSON.stringify(view)});render(true)`);assert.doesNotMatch(app.innerHTML,/查看我的身份|identity-dialog/);
});
test('witch UI separates spirit targets from medicine and permits any target including self',()=>{
 const {app,run}=boot();const view={joined:true,room:{code:'123456',status:'GAME',players,playerCount:6,game:{...game,step:2}},self:{isHost:false,id:'p0',seat:1,cards:[],action:{step:'WITCH',targets:[1,2,3,4,5,6],canSave:true,usedSave:false,usedPoison:false,spiritTargets:[3,1]}}};
 run(`applyState(${JSON.stringify(view)});actionType='SAVE';render(true)`);assert.match(app.innerHTML,/指杀选择目标：3号、1号/);assert.match(app.innerHTML,/value="1"/);assert.match(app.innerHTML,/value="6"/);assert.match(app.innerHTML,/使用解药/);
 view.self.action.spiritTargets=[];run(`applyState(${JSON.stringify(view)});render(true)`);assert.match(app.innerHTML,/没有指杀选择目标/);assert.match(app.innerHTML,/使用解药/);
 view.self.action.usedSave=true;view.self.action.canSave=false;delete view.self.action.spiritTargets;run(`applyState(${JSON.stringify(view)});render(true)`);assert.doesNotMatch(app.innerHTML,/使用解药/);assert.match(app.innerHTML,/使用毒药/);
});
test('host skip controls are always available in game and absent for players or after finish',()=>{
 const {app,run}=boot();const view={joined:true,room:{code:'123456',status:'GAME',players,playerCount:6,game},self:{isHost:true}};
 run(`applyState(${JSON.stringify(view)});render(true)`);assert.match(app.innerHTML,/data-action="skip"/);assert.match(app.innerHTML,/直接到天亮/);
 view.self={isHost:false,id:'p0',seat:1,cards:[]};run(`applyState(${JSON.stringify(view)});render(true)`);assert.doesNotMatch(app.innerHTML,/data-action="skip"/);
 view.self={isHost:true};view.room.status='FINISHED';view.room.game={...game,phase:'FINISHED',winner:'WOLF'};
 run(`applyState(${JSON.stringify(view)});render(true)`);assert.doesNotMatch(app.innerHTML,/data-action="skip"/);
});

test('frontend render: host separate from six players; ordering; actions; result',()=>{
 const {app,run}=boot();
 run('data={joined:false}');run('render(true)');assert.match(app.innerHTML,/创建六人房间/);assert.doesNotMatch(app.innerHTML,/Bot|测试模式|测试版|create-test/);
 run(`data=${JSON.stringify({joined:true,room:{code:'123456',status:'LOBBY',capacity:6,playerCount:6,players},self:{isHost:true,name:'房主'}})}`);
 run('render(true)');assert.doesNotMatch(app.innerHTML,/Bot|测试模式|测试对局/);assert.match(app.innerHTML,/房主控制台/);assert.doesNotMatch(app.innerHTML,/房主也是玩家/);
 run(`data=${JSON.stringify({joined:true,room:{code:'123456',status:'ORDERING',capacity:6,playerCount:6,players},self:{isHost:false,id:'p0',name:'真人',seat:1,team:'VILLAGE',locked:false,cards:[{id:'a',printedRole:'SEER',effectiveRole:'SEER',printedLabel:'预言家',effectiveLabel:'预言家',status:'UNORDERED'},{id:'b',printedRole:'VILLAGER',effectiveRole:'VILLAGER',printedLabel:'村民',effectiveLabel:'村民',status:'UNORDERED'}]}})}`);
 run('render(true)');assert.match(app.innerHTML,/确认牌序/);assert.match(app.innerHTML,/预言家/);
 run(`data=${JSON.stringify({joined:true,room:{code:'123456',status:'GAME',capacity:6,playerCount:6,players,game},self:{isHost:false,id:'p0',name:'真人',seat:1,activeRole:'GUARD',cards:[{id:'a',effectiveLabel:'守卫',status:'ACTIVE'}],action:{step:'GUARD',targets:[1,2,3],submitted:false}}})}`);
 run('render(true)');assert.match(app.innerHTML,/确认操作/);
 run(`data=${JSON.stringify({joined:true,room:{code:'123456',status:'GAME',capacity:6,playerCount:6,players,game},self:{isHost:true,name:'房主'}})}`);
 run('render(true)');assert.match(app.innerHTML,/夜间按固定时间自动推进/);assert.doesNotMatch(app.innerHTML,/你查验了/);
 const final={...game,phase:'FINISHED',winner:'WOLF',reveal:[{seat:1,name:'真人',cards:[{role:'村民',status:'LOST'}]}]};
 run(`data=${JSON.stringify({joined:true,room:{code:'123456',status:'FINISHED',capacity:6,playerCount:6,players,game:final},self:{isHost:true,name:'房主'}})}`);
 run('render(true)');assert.match(app.innerHTML,/狼人获胜/);assert.match(app.innerHTML,/身份复盘/);
});

test('seer UI requires confirmation, renders persistent private results, and removes repeat-scan controls',()=>{
 const {app,run}=boot();
 const view={joined:true,room:{code:'123456',status:'GAME',playerCount:6,players,game:{...game,step:3,stepKey:'NIGHT:1:0:3'}},
  self:{isHost:false,id:'p0',seat:1,name:'真人',cards:[{effectiveLabel:'预言家',status:'ACTIVE'}],inspections:[],action:{step:'SEER',targets:[1,2,3],submitted:false,locked:false}}};
 run(`applyState(${JSON.stringify(view)})`);run('render(true)');
 assert.match(app.innerHTML,/选择玩家后点击「确认查验」/);
 assert.match(app.innerHTML,/首夜查验真实阵营/);
 assert.match(app.innerHTML,/data-action="submit" disabled>确认查验/);
 run('actionSeat=3;render(true)');assert.match(app.innerHTML,/data-action="submit" >确认查验/);
 view.self.inspections=[{night:1,seat:3,team:'狼人',basis:'REAL'}];view.self.action.locked=true;view.self.action.submitted=true;
 run(`applyState(${JSON.stringify(view)})`);run('render(true)');
 assert.match(app.innerHTML,/3 号：<strong>狼人/);
 assert.match(app.innerHTML,/（真实阵营）/);
 assert.doesNotMatch(app.innerHTML,/id="targetSelect"/);
 view.room.game={...game,phase:'DISCUSSION',stepKey:'DISCUSSION:1:1:0'};view.self.action=null;
 run(`applyState(${JSON.stringify(view)})`);run('render(true)');
 assert.match(app.innerHTML,/你的查验记录/);assert.match(app.innerHTML,/3 号：<strong>狼人/);
 run('render(true)');assert.match(app.innerHTML,/3 号：<strong>狼人/);
 view.self={isHost:true};run(`applyState(${JSON.stringify(view)})`);run('render(true)');
 assert.doesNotMatch(app.innerHTML,/你的查验记录|3 号：<strong>狼人/);
});

test('election UI exposes explicit signup, withdrawal outside own speech, countdown and voting restrictions',()=>{
 const {app,run}=boot();
 const view={joined:true,room:{code:'123456',status:'GAME',playerCount:6,players,game:{...game,phase:'SHERIFF',
  election:{stage:'SIGNUP',deadline:Date.now()+20000,candidates:[],withdrawn:[],submittedCount:0,total:6}}},
  self:{isHost:false,id:'p0',seat:1,name:'真人',cards:[],action:{step:'SHERIFF_SIGNUP',targets:[]},election:{signup:null,canSignup:true}}};
 run(`data=${JSON.stringify(view)}`);run('render(true)');
 assert.match(app.innerHTML,/上警，参与竞选/);assert.match(app.innerHTML,/留在警下/);
 view.room.game.election={stage:'SPEECH',deadline:null,candidates:[1,2],withdrawn:[]};
 view.self.action=null;view.self.election={signup:true,canWithdraw:true};
 run(`data=${JSON.stringify(view)}`);run('render(true)');
 assert.match(app.innerHTML,/发言不限时/);assert.match(app.innerHTML,/data-action="withdraw"/);
 assert.doesNotMatch(app.innerHTML,/data-deadline=|当前由/);
 assert.doesNotMatch(app.innerHTML,/结束我的竞选发言/);
 view.room.game.election.stage='WITHDRAW';view.room.game.election.deadline=Date.now()+10000;view.self.canExplode=true;
 run(`data=${JSON.stringify(view)}`);run('render(true)');
 assert.match(app.innerHTML,/最后退水与自爆窗口/);assert.match(app.innerHTML,/data-deadline=/);assert.match(app.innerHTML,/发动自爆/);
 view.room.game.election.stage='VOTE';view.self.election.canWithdraw=false;view.self.canExplode=false;
 run(`data=${JSON.stringify(view)}`);run('render(true)');
 assert.doesNotMatch(app.innerHTML,/data-action="withdraw"|data-action="explode"/);
 assert.match(app.innerHTML,/平票直接无警长/);
});

test('new stage clears a stale target, while a same-stage refresh preserves a pending selection',()=>{
 const {run}=boot();
 const view={joined:true,room:{code:'123456',status:'GAME',game:{stepKey:'NIGHT:1:0:3'}},self:{id:'p0',action:{step:'SEER'}}};
 run(`applyState(${JSON.stringify(view)});actionSeat=3`);
 run(`applyState(${JSON.stringify(view)})`);assert.equal(run('actionSeat'),3);
 view.room.game.stepKey='SHERIFF:1:VOTE:2';view.self.action={step:'SHERIFF',choice:{seat:null}};
 run(`applyState(${JSON.stringify(view)})`);assert.equal(run('actionSeat'),null);
});
