'use strict';
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes, randomInt } = require('node:crypto');
const { URL } = require('node:url');
const QRCode = require('./vendor/QRCode');
const QRLevel = require('./vendor/QRCode/QRErrorCorrectLevel');
const { SEATS, deal, lockOrder, publicCard } = require('./lib/rules');
const game = require('./lib/game');
const sheriff = require('./lib/sheriff');
const narrator = require('./lib/narrator');
const recap = require('./lib/recap');
const speaking = require('./lib/speaking');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB = process.env.DATA_FILE || path.join(__dirname,'data','rooms.production.json');
const PUBLIC = path.join(__dirname,'public');
const MAX_ROOMS=100;
const sessions=new Map(), connections=new Set();
let db={rooms:{}};
try{if(fs.existsSync(DB))db=JSON.parse(fs.readFileSync(DB,'utf8'));}
catch(e){console.error('无法读取房间存档',e);process.exit(1);}
if(!db.rooms||typeof db.rooms!=='object')throw Error('房间存档格式错误');
// Old v0.2 rooms had a host occupying seat 1. This version uses a separate host session.
for(const room of Object.values(db.rooms)){
  // Do not revive debug rooms if an old store is explicitly supplied.
  if(room.testMode===true||room.players.some(p=>p.bot)){delete db.rooms[room.code];continue;}
  delete room.testMode;
  if(!room.host){
    const old=room.players.find(p=>p.isHost);
    if(old){room.host={id:old.id,sid:old.sid,name:'房主',lastSeen:old.lastSeen};room.players=room.players.filter(p=>p!==old);}
    else continue;
    // Pre-v0.3 hands cannot be retained after changing player membership.
    room.status='LOBBY';room.game=null;room.players.forEach(p=>{p.hand=null;});
  }
  sessions.set(room.host.sid,{code:room.code,role:'host'});
  for(const p of room.players)sessions.set(p.sid,{code:room.code,role:'player',playerId:p.id});
  game.upgrade(room);
  narrator.restore(room);
}
function save(){fs.mkdirSync(path.dirname(DB),{recursive:true});const temp=DB+'.tmp';fs.writeFileSync(temp,JSON.stringify(db,null,2),{mode:0o600});fs.renameSync(temp,DB);}
function sessionCookie(res,sid){res.setHeader('Set-Cookie',`werewolf_sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);}
function clearCookie(res){res.setHeader('Set-Cookie','werewolf_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');}
function getSid(req){return (req.headers.cookie||'').match(/(?:^|;\s*)werewolf_sid=([a-f0-9]{64})(?:;|$)/)?.[1]||null;}
function auth(req){
  const sid=getSid(req), ref=sid&&sessions.get(sid), room=ref&&db.rooms[ref.code];
  if(!room)return null;
  if(ref.role==='host' && room.host.sid===sid)return{room,sid,host:true,player:null};
  const player=room.players.find(p=>p.sid===sid&&p.id===ref.playerId);
  return player?{room,sid,host:false,player}:null;
}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function fail(status,message){const e=Error(message);e.status=status;throw e;}
function requireAuth(req){const ctx=auth(req);if(!ctx)fail(401,'请先创建房间或加入房间');if(ctx.host)ctx.room.host.lastSeen=Date.now();else ctx.player.lastSeen=Date.now();return ctx;}
function requireHost(ctx){if(!ctx.host)fail(403,'仅房主控制台可执行');}
function requireStage(ctx,status){if(ctx.room.status!==status)fail(409,'当前阶段不允许此操作');}
function publish(room){narrator.sync(room);save();for(const conn of connections){if(conn.code===room.code){try{conn.res.write('event: change\ndata: {}\n\n');}catch{connections.delete(conn);}}}}
function tickRoom(room,now=Date.now()){
 let changed=narrator.maintain(room,now);
 if(room.narration?.enabled&&room.narration.paused)return changed;
 if(narrator.due(room,now)){game.advance(room,now);changed=true;}
 else if(game.tick(room,now))changed=true;
 return narrator.sync(room,now)||changed;
}
function normalizeName(name){if(typeof name!=='string')fail(400,'请输入昵称');const n=name.trim().replace(/\s+/g,' ');if(n.length<1||n.length>16||/[\x00-\x1f\x7f]/.test(n))fail(400,'昵称需为1到16个字符');return n;}
function roomView(ctx){
 const {room,player}=ctx,g=room.game;
 return {joined:true,room:{code:room.code,status:room.status,capacity:SEATS,playerCount:room.players.length,narration:narrator.view(room),
  readyCount:room.players.filter(p=>p.hand?.locked).length,
  ruleset:'六人双身份 · 调整版',hostOnline:Date.now()-(room.host.lastSeen||0)<40000,
  players:room.players.slice().sort((a,b)=>a.seat-b.seat).map(p=>({id:p.id,seat:p.seat,name:p.name,online:Date.now()-(p.lastSeen||0)<40000,locked:Boolean(p.hand?.locked),remainingCards:p.hand?game.visibleCards(room,p).filter(c=>c.status!=='LOST').length:null,eliminated:!!(g&&!game.publiclyAlive(room,p))})),
  game:g?{id:g.id,phase:g.phase,title:game.phaseTitle(g),night:g.night,day:g.day,step:g.step,stepKey:g.stepKey,serverNow:Date.now(),sheriff:room.players.find(p=>p.id===g.sheriff)?.seat||null,winner:g.winner,events:g.events.slice(-30),voteResults:g.voteResults||[],...(g.phase==='LAST_WORDS'?{lastWordsSeat:g.lastWordsSeat}:{}),...(g.phase==='VOTE'?{voteDeadline:g.voteDeadline}:{}),dawnResults:g.dawnResults||[],...(g.phase==='SHERIFF'?{election:sheriff.publicView(room)}:{}),...(g.phase==='BADGE'?{badgeDeadline:g.badgeDeadline}:{}),...(g.phase==='DISCUSSION'&&!g.sheriff&&g.discussionSpeaking?.day===g.day?{speaking:speaking.view(g.discussionSpeaking,room.players.filter(game.alive))}:{}),...recap.view(room)}:null},
  self:ctx.host?{isHost:true,name:room.host.name}:{isHost:false,id:player.id,seat:player.seat,name:player.name,locked:Boolean(player.hand?.locked),
   ...(room.status!=='LOBBY'&&player.hand?{cards:game.visibleCards(room,player).map(publicCard),team:player.hand.team,golden:player.hand.golden}:{}),
   ...(g?{activeRole:game.visibleCards(room,player).find(c=>c.status==='ACTIVE')?.effectiveRole||null,action:narrator.windowOpen(room)?game.selfActionView(room,player):null,canExplode:narrator.windowOpen(room)&&game.canExplode(room,player),...(g.phase==='SHERIFF'?{election:sheriff.selfView(room,player)}:{}),...(g.phase==='NIGHT'&&g.step===1&&game.wolves(room).some(p=>p.id===player.id)?{wolfTeammates:game.wolves(room).map(p=>p.seat)}:{}),inspections:game.inspections(player).map(({night,seat,team,basis})=>({night,seat,team,basis:basis||'CURRENT'}))}:{})}
 };
}
function ips(){const set=new Set();for(const nics of Object.values(os.networkInterfaces()))for(const n of nics||[])if(n.family==='IPv4'&&!n.internal)set.add(n.address);return [...set].sort((a,b)=>Number(/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(b))-Number(/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)));}
function code(){for(let i=0;i<40;i++){const v=String(randomInt(100000,1000000));if(!db.rooms[v])return v;}fail(503,'无法生成房间号');}
function nextSeat(room){for(let n=1;n<=SEATS;n++)if(!room.players.some(p=>p.seat===n))return n;return null;}
function noSession(req){if(auth(req))fail(409,'你已处于房间中，请先退出');}
function newHuman(name,seat){return{id:randomBytes(12).toString('hex'),sid:randomBytes(32).toString('hex'),name,seat,lastSeen:Date.now(),hand:null};}
async function bodyOf(req){const parts=[];let n=0;for await(const chunk of req){n+=chunk.length;if(n>8192)fail(413,'请求过大');parts.push(chunk);}let o;try{o=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail(400,'JSON格式错误');}if(!o||typeof o!=='object'||Array.isArray(o))fail(400,'参数格式错误');return o;}
function svgQr(str){const qr=new QRCode(-1,QRLevel.M);qr.addData(str);qr.make();const n=qr.getModuleCount(),size=n+8,r=[];for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qr.isDark(y,x))r.push(`<rect x="${x+4}" y="${y+4}" width="1" height="1"/>`);return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><g fill="#132033">${r.join('')}</g></svg>`;}
const STATIC={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/voice.js':['voice.js','text/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml']};
const VOICE_PREFIX='/voicepacks/2023-6p-v02/';
const VOICE_FILES=new Set(['pack.json',...Object.values(narrator.pack.cues).map(c=>c.file)]);
function voiceFile(req,res,pathname){
 const filename=pathname.slice(VOICE_PREFIX.length);
 if(!VOICE_FILES.has(filename))return send(res,404,{error:'找不到语音文件'});
 const file=path.join(narrator.packRoot,filename),size=fs.statSync(file).size;
 const headers={'Content-Type':filename.endsWith('.wav')?'audio/wav':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Accept-Ranges':'bytes'};
 let start=0,end=size-1,status=200;
 if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m||Number(m[1])>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;if(end<start){res.writeHead(416);return res.end();}status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;}
 res.writeHead(status,{...headers,'Content-Length':end-start+1});if(req.method==='HEAD')return res.end();fs.createReadStream(file,{start,end}).pipe(res);
}
function staticFile(res,p){const entry=STATIC[p];if(!entry)return send(res,404,{error:'找不到页面'});res.writeHead(200,{'Content-Type':entry[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"});fs.createReadStream(path.join(PUBLIC,entry[0])).pipe(res);}
const handler=async(req,res)=>{
 const origin=`http://${req.headers.host||'localhost'}`;let parsed;try{parsed=new URL(req.url,origin);}catch{return send(res,400,{error:'URL错误'});}
 const pathname=parsed.pathname;
 try{
  if(req.method==='GET'&&pathname==='/api/health')return send(res,200,{ok:true,rooms:Object.keys(db.rooms).length});
  if(req.method==='GET'&&pathname==='/api/network')return send(res,200,{ips:ips(),port:PORT});
  if((req.method==='GET'||req.method==='HEAD')&&pathname.startsWith(VOICE_PREFIX))return voiceFile(req,res,pathname);
  if(req.method==='GET'&&pathname==='/api/state'){const c=auth(req);if(!c)return send(res,200,{joined:false});if(tickRoom(c.room))publish(c.room);if(c.host)c.room.host.lastSeen=Date.now();else c.player.lastSeen=Date.now();return send(res,200,roomView(c));}
  if(req.method==='GET'&&pathname==='/api/events'){
    const c=requireAuth(req);res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');const conn={res,code:c.room.code};connections.add(conn);
    const timer=setInterval(()=>{try{res.write(': ping\n\n');}catch{clearInterval(timer);connections.delete(conn);}},15000);
    req.on('close',()=>{clearInterval(timer);connections.delete(conn);});return;
  }
  if(req.method==='GET'&&pathname==='/api/qr'){const c=requireAuth(req),ip=parsed.searchParams.get('ip');if(!ips().includes(ip))fail(400,'网络地址无效');const link=`http://${ip}:${PORT}/?room=${c.room.code}`;res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(svgQr(link));return;}
  if(req.method!=='POST')return staticFile(res,pathname);
  if(!pathname.startsWith('/api/'))return send(res,405,{error:'不支持'});
  if(req.headers.origin&&req.headers.origin!==origin)fail(403,'跨站请求已被拒绝');
  const body=await bodyOf(req);
  if(pathname==='/api/create'){
    noSession(req);if(Object.keys(db.rooms).length>=MAX_ROOMS)fail(503,'房间数已达上限');
    const host={id:randomBytes(12).toString('hex'),sid:randomBytes(32).toString('hex'),name:'房主控制台',lastSeen:Date.now()};
    if(Object.hasOwn(body,'testMode'))fail(400,'此版本仅支持正式房间');
    const room={code:code(),status:'LOBBY',host,players:[],game:null,createdAt:new Date().toISOString()};
    db.rooms[room.code]=room;sessions.set(host.sid,{code:room.code,role:'host'});sessionCookie(res,host.sid);publish(room);return send(res,200,{ok:true,code:room.code});
  }
  if(pathname==='/api/join'){
    noSession(req);const roomCode=String(body.code||'').trim();if(!/^\d{6}$/.test(roomCode))fail(400,'需要六位房间号');
    const room=db.rooms[roomCode];if(!room)fail(404,'房间不存在');if(room.status!=='LOBBY')fail(409,'已经发牌，不能加入');
    const seat=nextSeat(room);if(!seat)fail(409,'房间已满');const name=normalizeName(body.name);
    if(room.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))fail(409,'昵称已经存在');
    const p=newHuman(name,seat);room.players.push(p);sessions.set(p.sid,{code:room.code,role:'player',playerId:p.id});sessionCookie(res,p.sid);publish(room);return send(res,200,{ok:true,code:room.code});
  }
  const ctx=requireAuth(req),{room,player}=ctx;
  if(tickRoom(room))publish(room);
  if(pathname==='/api/skip'){
    requireHost(ctx);
    try{const changed=game.hostSkip(room,body);if(changed)publish(room);return send(res,200,{ok:true,changed});}
    catch(e){fail(409,e.message);}
  }
  if(pathname==='/api/narration'){
    requireHost(ctx);
    try{
      const {clientId,action}=body;
      if(action==='heartbeat'){
        if(!narrator.owns(room,clientId))fail(409,'播放端已失效，请重新开启语音');
        const lease=narrator.claim(room,clientId);save();return send(res,200,{ok:true,lease});
      }
      if(action==='enable'||action==='attach')narrator.claim(room,clientId);
      narrator.control(room,clientId,action);publish(room);
      return send(res,200,{ok:true,...(action!=='disable'?{lease:narrator.claim(room,clientId)}:{})});
    }catch(e){fail(e.status||409,e.message);}
  }
  if(pathname==='/api/leave'){
    requireStage(ctx,'LOBBY');
    if(ctx.host){for(const p of room.players)sessions.delete(p.sid);sessions.delete(room.host.sid);delete db.rooms[room.code];}
    else{room.players=room.players.filter(p=>p.id!==player.id);sessions.delete(player.sid);}
    clearCookie(res);publish(room);return send(res,200,{ok:true});
  }
  if(pathname==='/api/remove'){
    requireHost(ctx);requireStage(ctx,'LOBBY');const p=room.players.find(x=>x.id===body.playerId);if(!p)fail(404,'找不到玩家');
    room.players=room.players.filter(x=>x.id!==p.id);sessions.delete(p.sid);publish(room);return send(res,200,{ok:true});
  }
  if(pathname==='/api/start'){
    requireHost(ctx);requireStage(ctx,'LOBBY');if(room.players.length!==SEATS)fail(409,'需要六名玩家');
    const hands=deal(),ps=room.players.slice().sort((a,b)=>a.seat-b.seat);
    ps.forEach((p,i)=>{p.hand=hands[i];p.lastInspection=null;p.inspections=[];});
    room.status=ps.every(p=>p.hand.locked)?'READY':'ORDERING';publish(room);return send(res,200,{ok:true});
  }
  if(pathname==='/api/lock'){
    if(ctx.host)fail(403,'房主不能替玩家选牌');requireStage(ctx,'ORDERING');
    if(typeof body.topCardId!=='string')fail(400,'请选择第一身份');
    try{player.hand=lockOrder(player.hand,body.topCardId);}catch(e){fail(409,e.message);}
    if(room.players.every(p=>p.hand?.locked))room.status='READY';publish(room);return send(res,200,{ok:true});
  }
  if(pathname==='/api/begin'){
    requireHost(ctx);requireStage(ctx,'READY');game.createGame(room);room.status='GAME';publish(room);return send(res,200,{ok:true});
  }
  if(pathname==='/api/action'){
    if(ctx.host)fail(403,'房主不能使用玩家技能');requireStage(ctx,'GAME');
    if(!narrator.windowOpen(room))fail(409,room.narration?.paused?'游戏已暂停，请等待恢复':'当前不在本角色的行动窗口内');
    try{game.submitAction(room,player,body);}catch(e){fail(409,e.message);}publish(room);return send(res,200,{ok:true});
  }
  if(pathname==='/api/advance'){
    requireHost(ctx);requireStage(ctx,'GAME');if(room.narration?.enabled&&room.narration.paused)fail(409,'请先恢复语音主持');if(room.game.phase==='NIGHT')fail(409,'夜间自动推进；如需提前结束，请使用房主跳过控制');if(body.stepKey&&body.stepKey!==room.game.stepKey)fail(409,'阶段已经改变，请刷新后重新操作');try{game.advance(room);}catch(e){fail(409,e.message);}publish(room);return send(res,200,{ok:true});
  }
  if(pathname==='/api/restart'){
    requireHost(ctx);if(room.status==='LOBBY')fail(409,'尚未发牌');room.status='LOBBY';room.game=null;
    for(const p of room.players){p.hand=null;p.lastInspection=null;p.inspections=[];}
    publish(room);return send(res,200,{ok:true});
  }
  fail(404,'未知操作');
 }catch(e){if(!res.headersSent)send(res,e.status||500,{error:e.status?e.message:'服务器出错'});if(!e.status)console.error(e);}
};
const server=http.createServer(handler);
let phaseTimer;
server.on('listening',()=>{
  phaseTimer=setInterval(()=>{
    for(const room of Object.values(db.rooms)){
      try{if(tickRoom(room))publish(room);}catch(e){console.error('阶段计时处理失败',e);}
    }
  },250);
  phaseTimer.unref();
});
server.on('close',()=>clearInterval(phaseTimer));
if(require.main===module)server.listen(PORT,HOST,()=>{
 console.log('\n双身份狼人杀 · 六人局域网版\n');console.log(`房主电脑：http://localhost:${PORT}`);
 const all=ips();for(const ip of all)console.log(`手机加入：http://${ip}:${PORT}`);
 if(!all.length)console.log('未检测到局域网地址');console.log('\n电脑和手机连接同一 Wi-Fi，按 Ctrl+C 停止。\n');
});
module.exports={server,handler,ips};
