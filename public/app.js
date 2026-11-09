'use strict';
const app=document.getElementById('app');
let data=null,network={ips:[],port:3000},chosenIp='',selectedTop='',busy=false,error='',disconnected=false,events=null,roomEvents='';
let actionType='TARGET',actionSeat=null;
let clockOffset=0,refreshSerial=0,appliedRefresh=0;
const params=new URLSearchParams(location.search),form={name:'',code:params.get('room')||''};
let lastRender='';
let identityOpen=false;
const voice=globalThis.WerewolfVoice?.create({request:body=>api('/api/narration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),refresh:()=>refresh(true),onChange:()=>{if(data)render(true);}});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tag=(txt,cls='')=>`<span class="badge ${cls}">${esc(txt)}</span>`;
async function api(path,options={}){let r;try{r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});}catch{throw Error('无法连接服务器，请检查电脑是否仍在运行，以及手机是否在同一个 Wi-Fi。');}let j;try{j=await r.json();}catch{throw Error('服务器返回了无效响应');}if(!r.ok)throw Error(j.error||`HTTP ${r.status}`);return j;}
async function post(path,body={}){if(busy)return;busy=true;error='';render(true);try{const r=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(path==='/api/leave'){data={joined:false};closeEvents();history.replaceState(null,'','/');}else await refresh(true);if(r.code)history.replaceState(null,'',`/?room=${r.code}`);}catch(e){error=e.message;}finally{busy=false;render(true);}}
function closeEvents(){events?.close();events=null;roomEvents='';}
function listen(code){closeEvents();roomEvents=code;events=new EventSource('/api/events');events.addEventListener('change',()=>refresh());events.onerror=()=>{disconnected=true;voice?.disconnect();render(true);};events.onopen=()=>{disconnected=false;refresh();};}
function applyState(next){
 identityOpen=false;
 const key=v=>v?.joined?`${v.room.code}:${v.self.id||'host'}:${v.room.status}:${v.room.game?.stepKey||''}`:'';
 if(key(data)!==key(next)){
  selectedTop='';actionSeat=next.self?.action?.choice?.seat??null;
  actionType=next.self?.action?.choice?.type||(next.self?.action?.step==='WITCH'?'PASS':'TARGET');
 }
 data=next;
 if(next.room?.game?.serverNow)clockOffset=next.room.game.serverNow-Date.now();
 if(next.room?.narration?.serverNow)clockOffset=next.room.narration.serverNow-Date.now();
 voice?.accept(next);
}
async function refresh(force=false){const serial=++refreshSerial;try{const next=await api('/api/state');if(serial<appliedRefresh)return;appliedRefresh=serial;disconnected=false;applyState(next);if(next.joined){if(roomEvents!==next.room.code)listen(next.room.code);if(params.get('room')!==next.room.code){history.replaceState(null,'',`/?room=${next.room.code}`);params.set('room',next.room.code);}}else{closeEvents();if(params.get('room'))form.code=params.get('room');}render(force);}catch(e){if(serial<appliedRefresh)return;disconnected=true;error=e.message;render(true);}}
function submitChoice(choice){return post('/api/action',{...choice,stepKey:data.room.game.stepKey});}
async function loadNetwork(){try{network=await api('/api/network');const saved=localStorage.getItem('werewolf_share_ip');chosenIp=network.ips.includes(saved)?saved:(network.ips[0]||'');render(true);}catch{}}
function head(){return `<header class="topbar"><div class="brand"><span class="brandmark">◇</span><div class="appname">双身份狼人杀</div></div><div class="connection"><span class="led ${disconnected?'off':'on'}"></span>${disconnected?'连接异常':'局域网'}</div></header>`;}
function home(){return `<div class="eyebrow">六人局域网测试版</div><h1 class="hero-title">创建房间或加入游戏</h1><p class="lead">电脑上的房主控制台不占玩家座位。你可以用手机加入，再从电脑添加测试 Bot。</p>
<div class="two-cols space-xxl"><section class="panel"><h2 class="section-title">房主 · 电脑端</h2><p class="subtle sm space-md">创建后管理房间、添加 Bot、控制夜晚与投票流程。房主不参与发牌和投票。</p><button class="button block space-xl" data-action="create" ${busy?'disabled':''}>创建六人房间</button><button class="button secondary block space-md" data-action="create-test">创建测试房间（Bot 明牌、可跳过）</button></section>
<section class="panel"><h2 class="section-title">玩家 · 手机端</h2><p class="subtle sm space-md">手机扫描二维码或输入房间号加入。</p><form class="formgrid space-xl" data-form="join"><div class="formfield"><label for="joinName">昵称</label><input class="input" id="joinName" name="name" maxlength="16" placeholder="输入昵称" required value="${esc(form.name)}"></div><div class="formfield"><label for="joinCode">房间号</label><input class="input code-entry" id="joinCode" name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required value="${esc(form.code)}"></div><button class="button secondary block" type="submit" ${busy?'disabled':''}>加入房间</button></form></section></div>`;}
function seatCard(p){if(!p)return `<div class="player empty"><span class="seat">空座位</span><span class="sm">等待加入</span></div>`;const self=p.id===data.self.id;return `<div class="player ${self?'is-self':''}"><div class="player-top"><span class="seat">${p.seat} 号</span>${p.bot?tag('Bot','muted'):self?tag('本人','gold'):''}</div><div class="player-name">${esc(p.name)}</div>${data.room.game?.sheriff===p.seat?'<div class="space-md">'+tag('警徽','gold')+'</div>':''}${Number.isInteger(p.remainingCards)?`<div class="sm space-md"><strong>${['已出局','剩余一张身份牌','剩余两张身份牌'][p.remainingCards]}</strong></div>`:''}<div class="player-meta"><span class="dot ${p.online?'on':''}"></span>${p.eliminated?'完全出局':p.bot?'自动操作':p.online?'在线':'离线'}${data.room.status==='ORDERING'||data.room.status==='READY'?' · '+(p.locked?'牌序已确认':'牌序未确认'):''}</div>${data.self.isHost&&data.room.status==='LOBBY'?`<button class="text-link" data-action="remove" data-id="${esc(p.id)}">移出</button>`:''}</div>`;}
function roster(){return `<div class="roster">${Array.from({length:6},(_,i)=>seatCard(data.room.players.find(p=>p.seat===i+1))).join('')}</div>`;}
function share(){const room=data.room,url=chosenIp?`http://${chosenIp}:${network.port}/?room=${room.code}`:'';return `<section class="panel"><h2 class="section-title">手机加入</h2>${url?`<div class="qrframe"><img alt="房间二维码" src="/api/qr?ip=${encodeURIComponent(chosenIp)}"></div><div class="join-link">${esc(url)}</div><button class="button secondary small space-md" data-action="copy" data-value="${esc(url)}">复制链接</button><div class="space-xl"><label class="xs subtle" for="shareIp">使用的局域网 IP</label><select id="shareIp" class="address-select">${network.ips.map(ip=>`<option value="${esc(ip)}" ${ip===chosenIp?'selected':''}>${esc(ip)}</option>`).join('')}</select></div>`:'<p class="subtle sm space-xl">未检测到局域网地址，请检查 Wi-Fi。</p>'}<p class="subtle xs space-md">手机需要与电脑连接同一个 Wi-Fi；电脑关闭后房间无法使用。</p></section>`;}
function titlebar(status){return `<div class="room-head"><div><div class="eyebrow">房间 ${esc(data.room.code)}</div><h1 class="room-heading">${status}</h1><p class="subtle sm">${data.self.isHost?'独立房主控制台 · 不占座位':`${data.self.seat} 号玩家 · ${esc(data.self.name)}`}</p></div>${tag(`${data.room.playerCount} / 6 玩家`,data.room.playerCount===6?'green':'gold')}</div>`;}
function hostLobby(){const r=data.room;return `${titlebar('等待玩家')}<div class="room-grid"><section class="panel"><div class="between"><h2 class="section-title">座位与测试 Bot</h2>${tag(`${r.botCount} 个 Bot`)}</div>${roster()}<div class="host-actions space-xl"><button class="button secondary small" data-action="add-bot" ${r.playerCount>=6?'disabled':''}>添加 1 个 Bot</button><button class="button secondary small" data-action="fill-bots" ${r.playerCount>=6?'disabled':''}>Bot 补满六人</button><button class="button ghost small" data-action="clear-bots" ${!r.botCount?'disabled':''}>清除 Bot</button></div><div class="tiny-rule"></div><div class="host-actions"><button class="button" data-action="start" ${r.playerCount!==6||busy?'disabled':''}>随机发牌</button><button class="button ghost small" data-action="leave">关闭房间</button></div><p class="subtle xs space-md">先用自己的手机扫码加入，再点击「Bot 补满六人」。</p></section>${share()}</div>`;}
function playerLobby(){return `${titlebar('等待发牌')}<section class="panel"><h2 class="section-title">房间玩家</h2>${roster()}<div class="tipstrip space-xl"><span class="tip-icon">i</span><span>房主会在电脑端添加 Bot 并发牌。你不需要留在电脑上。</span></div><button class="button ghost small space-xl" data-action="leave">退出房间</button></section>`;}
function availableTop(){const cards=data.self.cards||[];const opts=cards.filter(c=>!(data.self.team==='WOLF'&&c.effectiveRole==='WITCH'));if(!opts.some(c=>c.id===selectedTop))selectedTop=opts[0]?.id||'';return selectedTop;}
function identity(){const r=data.room,s=data.self;const host=s.isHost;if(!host&&s.locked)return `${titlebar('牌序已锁定')}<section class="panel"><p>等待房主开始，可点击「查看我的身份」检查两张牌。</p>${roster()}</section>`;if(host)return `${titlebar(r.status==='READY'?'等待开局':'等待玩家确认身份')}<div class="room-grid"><section class="panel"><h2 class="section-title">玩家确认情况</h2>${roster()}<div class="tipstrip space-xl"><span class="tip-icon">i</span><span>房主无权查看玩家底牌。测试 Bot 已自动选择牌序。</span></div>${r.status==='READY'?`<button class="button space-xl" data-action="begin">开始测试对局</button>`:'<p class="subtle sm space-xl">等待真人玩家选好上下身份。</p>'}<button class="button ghost small space-xl" data-action="restart">返回等待室</button></section>${share()}</div>`;
const cards=s.cards||[],top=availableTop();return `${titlebar(r.status==='READY'?'等待房主开局':'选择身份顺序')}<div class="phase-grid"><section class="panel"><h2 class="section-title">你的双身份</h2><p class="subtle sm space-md">仅你自己能看到身份。请选择当前第一张牌。</p><div class="cards-grid">${cards.map(c=>{const selected=s.locked?c.order===0:c.id===top;const blocked=s.team==='WOLF'&&c.effectiveRole==='WITCH';return `<button type="button" class="card-choice ${selected?'selected':''}" data-action="select-card" data-card="${esc(c.id)}" ${s.locked||blocked?'disabled':''}><div class="card-index">${s.locked?(c.order===0?'第一身份':'第二身份'):(selected?'第一身份 ✓':'点击设为第一身份')}</div><div><div class="role-name ${['WOLF','HIDDEN_WOLF'].includes(c.effectiveRole)?'wolf':'good'}">${esc(c.printedLabel)}</div>${c.printedRole==='COPYCAT'?`<div class="role-subtitle">复制为 ${esc(c.effectiveLabel)}</div>`:''}</div><div class="card-foot">${blocked?'狼人阵营女巫只能放第二张':selected?'当前选择':'未选择'}</div></button>`;}).join('')}</div>${s.locked?`<div class="tipstrip"><span class="tip-icon">✓</span><span>牌序已锁定，等待房主开始。</span></div>`:`<button class="button block" data-action="lock">确认牌序</button>`}</section><aside class="panel flat"><h2 class="section-title">其他玩家</h2>${roster()}</aside></div>`;}
function countdown(deadline){return deadline?`<p class="countdown space-md">剩余 <strong data-deadline="${deadline}">${Math.max(0,Math.ceil((deadline-Date.now()-clockOffset)/1000))}</strong> 秒</p>`:'';}
function updateCountdown(){
 const clock=data?.room?.narration?.paused?data.room.narration.pausedAt:Date.now()+clockOffset;
 for(const el of document.querySelectorAll?.('[data-deadline]')||[])el.textContent=String(Math.max(0,Math.ceil((Number(el.dataset.deadline)-clock)/1000)));
}
function voicePanel(){
 const n=data.room.narration||{},v=voice?.status()||{};
 if(!data.self.isHost){
  if(!n.enabled)return data.room.game?.phase==='NIGHT'?`<section class="tipstrip space-md">${n.windowOpen?'当前行动窗口已开放。':'等待当前身份行动窗口。'}${countdown(n.actionClosesAt)}</section>`:'';
  let text=n.paused?'主持已暂停，请等待房主恢复。':data.room.game?.phase==='NIGHT'?(n.windowOpen?'当前行动窗口已开放，请在手机上确认操作。':'正在播报，请保持安静并等待行动窗口。'):'由房主电脑播放公共语音。';
  return `<section class="tipstrip space-md">${text}${n.actionClosesAt&&n.windowOpen?countdown(n.actionClosesAt):''}</section>`;
 }
 return `<section class="panel voice-panel space-xl"><div class="between"><h2 class="section-title">法官语音</h2>${tag(n.paused?'已暂停':v.active?'本机播报':'未启用')}</div><p class="sm subtle">2023 六人播报稿 v0.2 · 离线中文语音。开启后夜间按固定时间自动推进；只由这台电脑发声。</p>${v.active?`<div class="host-actions"><button class="button small" data-action="voice-${n.paused?'resume':'pause'}">${n.paused?'恢复整场':'暂停整场'}</button><button class="button secondary small" data-action="voice-replay">重播当前口令并保持暂停</button><button class="button secondary small" data-action="voice-test">试听</button><button class="button ghost small" data-action="voice-disable">关闭语音</button></div>`:`<button class="button" data-action="voice-enable" ${v.loading?'disabled':''}>${v.loading?'正在准备语音…':'开启语音并自动主持夜间'}</button>`}${v.message?`<p class="voice-message">${esc(v.message)}</p>`:''}${n.paused?`<p class="sm">${esc(n.reason||'请恢复主持后继续游戏')}</p>`:''}${v.caption?`<div class="tipstrip space-md voice-caption">${esc(v.caption)}</div>`:''}${n.enabled&&data.room.game?.phase==='NIGHT'?`<p class="sm subtle">首夜不设潜行者窗口；第二夜起完整播报所有角色，死亡或没药不缩短等待。</p>${n.windowOpen?countdown(n.actionClosesAt):''}`:''}</section>`;
}
function speakingView(s){return s?`<div class="tipstrip space-md">随机点数：${s.point} / ${s.sides}<br>${esc(s.message)}<br>发言顺序：${s.order.map(n=>n+'号').join(' → ')}</div>`:'';}
function electionView(){
 const e=data.room.game.election,s=data.self.election;
 if(!e)return '';
 let body='';
 if(e.stage==='SIGNUP'){
  body=`<p class="sm subtle">首夜结果尚未公布。请在手机选择上警或留在警下；截止后统一公开名单，未选择视为警下。</p><p class="sm">已选择 ${e.submittedCount} / ${e.total} 人</p>`;
  if(s)body+=`<p class="sm">你的选择：${s.signup===null?'尚未选择':s.signup?'上警':'警下'}</p>${s.canSignup?'<div class="host-actions"><button class="button" data-action="signup" data-run="true">上警，参与竞选</button><button class="button secondary" data-action="signup" data-run="false">留在警下</button></div>':''}`;
 }else{
  body=`<p class="sm">仍在参选：${e.candidates.map(n=>n+'号').join('、')||'无人'}</p>${e.withdrawn.length?`<p class="sm subtle">已退水：${e.withdrawn.map(n=>n+'号').join('、')}</p>`:''}`;
  if(e.stage==='SPEECH')body+=speakingView(e.speaking)+'<div class="tipstrip">请候选人按顺序发言。发言不限时，由房主结束本阶段；投票开始前可以退水。</div>';
  if(e.stage==='WITHDRAW')body+='<div class="tipstrip">最后退水与自爆窗口。倒计时结束后锁定候选人并进入投票，之后不能退水。</div>';
  if(e.stage==='VOTE')body+='<p class="sm subtle">只有最初在警下的玩家投票；退水玩家不能投警长票。平票直接无警长。</p>';
  if(s?.canWithdraw)body+='<button class="button secondary space-md" data-action="withdraw">退水，退出竞选</button>';
 }
 return `<div class="stack space-xl">${body}${e.stage==='SPEECH'?'':countdown(e.deadline)}</div>`;
}
function hostGame(){
 const r=data.room,g=r.game,e=g.election;
 let label='',disabled=busy,help='';
 if(g.phase==='NIGHT'){
  disabled=true;label='夜间按固定时间自动推进';help='夜末自动结算并天亮；首日先完成警长竞选，再自动公布出局号码。'+(r.testMode?'测试控制可跳过阶段。':'');
 }else if(g.phase==='SHERIFF'){
  label={SIGNUP:'公布上警名单，开始竞选发言',SPEECH:'结束竞选发言',WITHDRAW:'等待退水与自爆倒计时',VOTE:'结束警长投票并唱票'}[e.stage];
  disabled||=!e.canAdvance;help='倒计时由服务器执行。竞选结束前不公布首夜结果。';
 }else if(g.phase==='DAWN'){label='正在公布昨夜结果';disabled=true;help='服务器自动公布昨夜身份牌出局号码。';}
 else if(g.phase==='DISCUSSION'){label='结束讨论，开始放逐投票';help='请在线下完成讨论，再开始手机投票。';}
 else if(g.phase==='LAST_WORDS'){label='结束遗言，进入黑夜';help=`${g.lastWordsSeat}号已完全出局，请发表遗言。不计时，结束后点击按钮继续；如需移交警徽，会先处理警徽。`;}
 else if(g.phase==='BADGE'){label='等待警长处理警徽';disabled=true;help='出局警长在自己的手机移交或放弃警徽，30 秒超时视为放弃。';}
 else{label='结束投票、唱票并结算';help='等玩家完成投票后，再公开唱票并结算。';}
 if(r.narration?.paused)disabled=true;
 return `${titlebar(g.title)}<div class="room-grid"><section class="panel"><div class="between"><h2 class="section-title">流程控制</h2>${tag(g.phase==='NIGHT'?'夜间':g.phase==='SHERIFF'?'竞选':'白天','gold')}</div><p class="subtle sm space-md">${help}</p>${electionView()}${speakingView(g.speaking)}${g.phase==='BADGE'?countdown(g.badgeDeadline):g.phase==='VOTE'?countdown(g.voteDeadline):''}<button class="button block space-xl" data-action="advance" ${disabled?'disabled':''}>${label}</button><div class="tiny-rule"></div><h2 class="section-title">玩家状态</h2>${roster()}<button class="button ghost small space-xl" data-action="restart">结束本局并返回等待室</button></section><aside class="panel flat"><h2 class="section-title">公开记录</h2>${logView(g)}</aside></div>`;
}
function logView(g){return g.events?.length?`<div class="stack space-md">${g.events.slice().reverse().map(m=>`<div class="tipstrip">${esc(m)}</div>`).join('')}</div>`:'<p class="subtle sm space-md">尚无公开结果。</p>';}
function targetSelect(options,required=false){if(actionSeat!==null&&!options.includes(actionSeat))actionSeat=null;const label=data.self.action?.step==='SEER'?'查验对象':'目标';return `<label class="formfield"><span class="xs subtle">选择${label}</span><select id="targetSelect" class="input"><option value="" ${required?'disabled':''} ${actionSeat===null?'selected':''}>${required?'请选择'+label:'不选择 / 弃票'}</option>${options.map(n=>`<option value="${n}" ${n===actionSeat?'selected':''}>${n} 号 · ${esc(data.room.players.find(p=>p.seat===n)?.name||'')}</option>`).join('')}</select></label>`;}
function inspectionView(){
 const s=data.self,records=s.inspections||(s.action?.inspection?[s.action.inspection]:[]);
 if(!records.length)return '';
 return `<section class="private-results space-xl" aria-label="私人查验记录"><h2 class="section-title">你的查验记录</h2><p class="sm subtle">仅你可见。每条记录标明本次查验的依据。</p><div class="stack">${records.slice().reverse().map(x=>`<div class="inspection-result ${x.team==='狼人'?'wolf-result':'village-result'}" role="status">第 ${x.night} 夜 · ${x.seat} 号：<strong>${esc(x.team)}</strong>（${x.basis==='REAL'?'真实阵营':'当前身份阵营'}）</div>`).join('')}</div></section>`;
}
function myIdentity(){
 const s=data.self;
 if(s.isHost||!s.locked||!s.cards?.length||data.room.status==='LOBBY')return '';
 return `<div class="identity-control"><button class="button secondary" data-action="toggle-identity" aria-expanded="${identityOpen}">${identityOpen?'收起我的身份':'查看我的身份'}</button></div>${identityOpen?`<div class="identity-backdrop"><section class="panel identity-dialog" role="dialog" aria-modal="true" aria-label="我的身份"><div class="between"><h2 class="section-title">我的两张身份</h2><button class="button ghost small" data-action="close-identity">关闭</button></div><div class="stack space-xl">${s.cards.slice().sort((a,b)=>a.order-b.order).map(c=>`<div class="identity-card ${c.status==='LOST'?'lost':''}"><div>${c.order===0?'第一身份':'第二身份'} · ${esc(c.printedLabel)}${c.printedRole==='COPYCAT'?`（复制为${esc(c.effectiveLabel)}）`:''}</div><strong>${{ACTIVE:'当前生效',DORMANT:'尚未生效',LOST:'已失效'}[c.status]||'未锁定'}</strong></div>`).join('')}</div></section></div>`:''}`;
}
function botActionView(){
 const actions=data.room.debugBotActions||[];
 const phases={GUARD:'守卫',WOLF:'狼刀',WITCH:'女巫',SEER:'预言家',STALKER:'潜行',SHERIFF_SIGNUP:'上警选择',SHERIFF_VOTE:'警长投票',VOTE:'放逐投票',BADGE:'警徽移交'};
 const describe=a=>{
  if(a.type==='SIGNUP')return a.run?'上警':'不上警';
  if(a.type==='PASS')return '不发动技能';
  if(a.target==null)return a.type==='VOTE'?'弃票':a.type==='TRANSFER'?'放弃移交':'不选择目标';
  const verb={SAVE:'解药救',POISON:'毒药毒',VOTE:'投给',TRANSFER:'移交给'}[a.type]||{GUARD:'守护',WOLF:'刀',SEER:'查验',STALKER:'潜行'}[a.phase]||'选择';
  return `${verb}${a.target}号${a.result?'，结果：'+a.result:''}`;
 };
 return `<h3 class="section-title space-xl">Bot 行动记录</h3><p class="sm subtle">仅测试模式公开 Bot 的选择；真人行动不在此展示。</p><div class="stack space-md">${actions.slice().reverse().map(a=>`<div class="tipstrip">${esc(['GUARD','WOLF','WITCH','SEER','STALKER'].includes(a.phase)?'第'+a.night+'夜':'第'+a.day+'天')} · ${a.seat}号 Bot · ${esc(phases[a.phase]||a.phase)}：${esc(describe(a))}</div>`).join('')||'<p class="sm subtle">尚无 Bot 行动。</p>'}</div>`;
}
function testPanel(){
 const r=data.room;
 if(!r.testMode){return data.self.isHost&&r.status==='LOBBY'?'<button class="button secondary small space-xl" data-action="test-mode" data-enabled="true">切换为测试模式（Bot 明牌、允许跳过）</button>':'';}
 return `<section class="panel space-xl"><div class="between"><h2 class="section-title">测试模式</h2>${data.self.isHost&&r.status==='LOBBY'?'<button class="button ghost small" data-action="test-mode" data-enabled="false">切换为正常模式</button>':''}</div>${data.self.isHost&&r.status==='GAME'?`<div class="host-actions space-xl"><button class="button secondary small" data-action="test-skip" data-mode="PHASE">跳过当前阶段</button><button class="button secondary small" data-action="test-skip" data-mode="DAWN" ${r.game.phase!=='NIGHT'?'disabled':''}>直接到天亮</button><button class="button secondary small" data-action="test-skip" data-mode="NIGHT" ${r.game.phase==='NIGHT'?'disabled':''}>跳过当前白天 / 进入下一夜</button></div><p class="sm subtle space-md">保留已提交行动；未提交技能视为不发动，未投票视为弃票。</p>`:''}<div class="stack space-xl">${(r.debugBotHands||[]).map(p=>`<div class="tipstrip"><div><strong>${p.seat}号 ${esc(p.name)}</strong>${p.cards.map(c=>`<div>${c.order===0?'第一身份':'第二身份'}：${esc(c.printedLabel)}${c.printedRole==='COPYCAT'?` → ${esc(c.effectiveLabel)}`:''} · ${{ACTIVE:'生效',DORMANT:'未生效',LOST:'失效'}[c.status]}</div>`).join('')}</div></div>`).join('')||'<p class="sm subtle">发牌后展示 Bot 的两张身份。真人底牌仅本人可见。</p>'}</div>${botActionView()}</section>`;
}
function playerGame(){
 const r=data.room,s=data.self,g=r.game,a=s.action,roleName=s.cards?.find(c=>c.status==='ACTIVE')?.effectiveLabel||'已出局';
 let actions='';
 if(a&&a.step!=='SHERIFF_SIGNUP'){
  let info='',fields='',buttonLabel=a.submitted?'修改操作':'确认操作';
  if(a.step==='WOLF')info=`<p class="subtle sm">狼队成员座位：${a.wolfTeammates.map(n=>n+'号').join('、')}。测试版刀口按多数票决定，平票空刀。</p>`;
  if(a.step==='WITCH'){
   info=`<p class="subtle sm">解药 ${a.usedSave?'已使用':'未使用'} · 毒药 ${a.usedPoison?'已使用':'未使用'}</p><p class="subtle sm">${a.usedSave?'你已失去通灵能力':a.spiritTargets?.length?`指杀选择目标：${a.spiritTargets.map(n=>n+'号').join('、')}`:'本夜没有指杀选择目标'}</p>`;
   if(!['PASS',a.canSave?'SAVE':'',!a.usedPoison?'POISON':''].includes(actionType))actionType='PASS';
   fields=`<label class="formfield"><span class="xs subtle">女巫操作</span><select id="typeSelect" class="input"><option value="PASS" ${actionType==='PASS'?'selected':''}>不用药</option>${a.canSave?`<option value="SAVE" ${actionType==='SAVE'?'selected':''}>使用解药</option>`:''}${!a.usedPoison?`<option value="POISON" ${actionType==='POISON'?'selected':''}>使用毒药</option>`:''}</select></label>`;
   if(actionType!=='PASS')fields+=targetSelect(a.targets,true);
  }else if(a.step==='SEER'){
   if(a.locked)info='<p class="sm">本夜查验已完成，结果保留在下方私人记录中。</p>';
   else{info=`<p class="sm subtle">${g.night===1?'首夜查验真实阵营：任一身份属于狼人阵营即验为狼人。':'本夜查验当前生效身份的阵营。'}选择玩家后点击「确认查验」，立即显示好人或狼人。确认后本夜不能换目标。</p>`;fields=targetSelect(a.targets,true);buttonLabel='确认查验';}
  }else{
   fields=targetSelect(a.targets);
   if(a.step==='BADGE'){info='<p class="sm">选择未完全出局的玩家移交警徽，或不选择并确认放弃移交。</p>';buttonLabel='确认处理警徽';}
   if(a.step==='SHERIFF'||a.step==='VOTE')buttonLabel=a.submitted?'修改选票':'确认投票';
  }
  const disabled=busy||(a.step==='SEER'&&actionSeat===null)||(a.step==='WITCH'&&actionType!=='PASS'&&actionSeat===null);
  actions=`<div class="stack space-xl">${info}${fields}${a.locked?'':`<button class="button block" data-action="submit" ${disabled?'disabled':''}>${buttonLabel}</button>`}${a.submitted&&!a.locked?'<p class="subtle sm">已提交，等待截止后统一唱票或结算。</p>':''}</div>`;
 }else if(g.phase!=='SHERIFF'){
  const message=g.phase==='NIGHT'?'当前阶段没有你可以执行的技能，请等待。':g.phase==='LAST_WORDS'?`${g.lastWordsSeat}号正在发表遗言，不计时。由房主结束遗言后继续。`:g.phase==='DISCUSSION'?'请在线下发言讨论，等待房主开启放逐投票。':g.phase==='DAWN'?'竞选已结束，等待房主公布昨夜结果。':g.phase==='BADGE'?'等待出局警长处理警徽。':'本阶段你没有可执行的操作。';
  actions=`<div class="tipstrip space-xl">${message}</div>`;
 }
 const explosion=s.canExplode?'<button class="button danger block space-xl" data-action="explode">发动自爆</button>':'';
 const wolfInfo=s.wolfTeammates&&!a?`<p class="sm">当前狼队成员：${s.wolfTeammates.map(n=>n+'号').join('、')}。${g.night===1?'第一夜不能出刀。':''}</p>`:'';
 const discussion=g.phase==='DISCUSSION'?speakingView(g.speaking):'';
 return `${titlebar(g.title)}<div class="phase-grid"><section class="panel"><div class="between"><h2 class="section-title">你的操作</h2>${tag('本人','gold')}</div>${discussion}${electionView()}${g.phase==='VOTE'?countdown(g.voteDeadline):''}${wolfInfo}${actions}${explosion}${inspectionView()}<div class="tiny-rule"></div><div class="sm subtle">你的位置：${s.seat} 号。游戏状态以服务器为准，刷新可恢复本局记录。</div></section><aside class="panel flat"><h2 class="section-title">玩家</h2>${roster()}<div class="tiny-rule"></div><h2 class="section-title">公开结果</h2>${logView(g)}</aside></div>`;
}
function recapView(recap){
 if(!recap)return '';
 return '<div class="tiny-rule"></div><h2 class="section-title">简短复盘</h2>'+
  (recap.partial?'<p class="subtle sm">旧存档未保存完整技能记录，以下仅展示已保存内容。</p>':'')+
  recap.rounds.map(r=>`<section class="space-md"><h3>${esc(r.title)}</h3><ul>${r.lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul></section>`).join('');
}
function finished(){
 const g=data.room.game;
 return `${titlebar('游戏结束')}<div class="panel"><h2 class="section-title">${g.winner==='VILLAGE'?'好人获胜':'狼人获胜'}</h2><div class="space-xl">${roster()}</div>
 ${g.reveal?`<div class="tiny-rule"></div><h2 class="section-title">身份复盘</h2><div class="stack space-md">${g.reveal.map(p=>`<div class="tipstrip">${p.seat}号 ${esc(p.name)}：${p.cards.map((c,i)=>`${i===0?'第一':'第二'}身份：${c.printedRole==='COPYCAT'?'复制人 → ':''}${esc(c.role)}（${c.status==='LOST'?'失效':'保留'}）`).join('；')}</div>`).join('')}</div>`:''}
 ${recapView(g.recap)}<details class="space-xl"><summary>公开记录</summary>${logView(g)}</details>
 ${data.self.isHost?'<button class="button space-xl" data-action="restart">返回等待室，重新发牌</button>':'<p class="subtle sm space-xl">等待房主重新开局。</p>'}</div>`;
}
function render(force=false){if(!data){app.innerHTML='<div class="loading-view">连接服务器中……</div>';return;}const state=JSON.stringify({data,network,chosenIp,selectedTop,actionType,actionSeat,busy,error,disconnected});if(state===lastRender&&!force)return;lastRender=state;let page;if(!data.joined)page=home();else if(data.room.status==='LOBBY')page=data.self.isHost?hostLobby():playerLobby();else if(['ORDERING','READY'].includes(data.room.status))page=identity();else if(data.room.status==='GAME')page=data.self.isHost?hostGame():playerGame();else page=finished();app.innerHTML=`${disconnected?'<div class="offline-banner">无法连接服务器，正在重试</div>':''}<div class="layout">${head()}${error?`<div class="errorbox">${esc(error)}</div>`:''}<main>${page}${data.joined?testPanel()+voicePanel()+myIdentity():''}</main><footer class="footer">2023 六人双身份 · 局域网测试流程</footer></div>`;updateCountdown();}
app.addEventListener('input',e=>{if(e.target.name==='name')form.name=e.target.value;if(e.target.name==='code')form.code=e.target.value;});
app.addEventListener('change',e=>{if(e.target.id==='shareIp'){chosenIp=e.target.value;localStorage.setItem('werewolf_share_ip',chosenIp);render(true);}if(e.target.id==='typeSelect'){actionType=e.target.value;actionSeat=null;render(true);}if(e.target.id==='targetSelect'){actionSeat=e.target.value===''?null:Number(e.target.value);render(true);}});
app.addEventListener('submit',e=>{const f=e.target.closest('form[data-form]');if(!f)return;e.preventDefault();form.name=f.querySelector('[name="name"]').value.trim();form.code=f.querySelector('[name="code"]').value;post('/api/join',{name:form.name,code:form.code});});
app.addEventListener('click',async e=>{const btn=e.target.closest('button[data-action]');if(!btn||busy||btn.disabled)return;const x=btn.dataset.action;
if(x==='toggle-identity'){identityOpen=!identityOpen;render(true);return;}
if(x==='close-identity'){identityOpen=false;render(true);return;}
if(x==='test-mode')return post('/api/test-mode',{enabled:btn.dataset.enabled==='true'});
if(x==='test-skip')return post('/api/test-skip',{mode:btn.dataset.mode,gameId:data.room.game.id,stepKey:data.room.game.stepKey,commandId:globalThis.crypto?.randomUUID?.()||'skip-'+Date.now()+'-'+Math.random().toString(36).slice(2)});
if(x==='create-test')return post('/api/create',{testMode:true});
if(x.startsWith('voice-')){const action=x.slice(6);if(action==='enable')await voice?.enable();else if(action==='test')await voice?.test();else if(action==='replay')await voice?.replay();else await voice?.control(action);return;}
if(x==='copy'){try{await navigator.clipboard.writeText(btn.dataset.value);btn.textContent='已复制';}catch{const el=document.createElement('textarea');el.value=btn.dataset.value;document.body.append(el);el.select();document.execCommand('copy');el.remove();btn.textContent='已复制';}return;}
if(x==='select-card'){selectedTop=btn.dataset.card;render(true);return;}
if(x==='create')return post('/api/create');
if(x==='add-bot')return post('/api/bots',{action:'add'});
if(x==='fill-bots')return post('/api/bots',{action:'fill'});
if(x==='clear-bots')return post('/api/bots',{action:'clear'});
if(x==='remove'){if(confirm('移出这位玩家？'))post('/api/remove',{playerId:btn.dataset.id});return;}
if(x==='start')return post('/api/start');
if(x==='lock')return post('/api/lock',{topCardId:availableTop()});
if(x==='begin')return post('/api/begin');
if(x==='signup')return submitChoice({type:'SIGNUP',run:btn.dataset.run==='true'});
if(x==='withdraw'){if(confirm('退水后不能重新上警，也不能投警长票。确认退水？'))return submitChoice({type:'WITHDRAW'});return;}
if(x==='explode'){if(confirm('确认发动自爆？竞选日自爆会吞警徽，其他情况按当前规则进入黑夜。'))return submitChoice({type:'EXPLODE'});return;}
if(x==='submit'){const a=data.self.action;const type=a.step==='WITCH'?actionType:a.step==='BADGE'?'TRANSFER':['VOTE','SHERIFF'].includes(a.step)?'VOTE':'TARGET';return submitChoice({type,seat:type==='PASS'?null:actionSeat});}
if(x==='advance')return post('/api/advance',{stepKey:data.room.game.stepKey});
if(x==='restart'){if(confirm('结束当前对局并重新发牌？'))post('/api/restart');return;}
if(x==='leave'){if(confirm(data.self.isHost?'关闭整个房间？':'退出房间？'))post('/api/leave');}
});
refresh(true);loadNetwork();setInterval(()=>refresh(),12000);setInterval(updateCountdown,250);document.addEventListener('visibilitychange',()=>{identityOpen=false;render(true);if(!document.hidden)refresh();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&identityOpen){identityOpen=false;render(true);}});window.addEventListener('online',()=>refresh(true));
