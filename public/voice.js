(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WerewolfVoice=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const BASE='/voicepacks/2023-6p-v02/';
 function create(options){
  const env=options.env||globalThis;
  const audio=new env.Audio();audio.preload='auto';
  let pack=null,state=null,active=false,loading=false,message='',leaseUntil=0,offset=0,currentId=null,preview=false,heartbeatPending=false,heartbeatAt=0,playSequence=0;
  let attemptedRoom=null,activation=null,prepared=null;
  const clientId=env.crypto?.randomUUID?.()||`voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now=()=>Date.now()+offset;
  const notify=()=>options.onChange?.();
  const url=id=>BASE+pack.cues[id].file;
  const host=()=>Boolean(state?.joined&&state.self.isHost);
  async function load(){
   if(pack)return pack;
   const r=await env.fetch(BASE+'pack.json');if(!r.ok)throw Error('无法加载语音包');pack=await r.json();return pack;
  }
  async function request(action){
   const result=await options.request({action,clientId});
   if(result.lease){leaseUntil=result.lease.until;offset=result.lease.serverNow-Date.now();}
   return result;
  }
  function halt(){playSequence++;audio.pause();}
  function stop(){halt();currentId=null;preview=false;}
  async function play(rate=pack?.playbackRate||1.5){
   audio.playbackRate=rate;audio.preservesPitch=true;
   const attempt=++playSequence;
   try{await audio.play();}catch(e){if(attempt===playSequence)fail(e);}
  }
  function fail(err){
   stop();message=err?.message||'语音播放失败，请检查音频设备';
   if(active)request('pause').then(()=>options.refresh?.()).catch(()=>{});
   notify();
  }
  audio.onerror=()=>fail(Error('语音文件播放失败，游戏已请求暂停；请检查连接后重播'));
  audio.onended=()=>{if(preview){preview=false;notify();}};
  function accept(next){
   state=next;
   if(!host()){
    if(active)request('pause').catch(()=>{});
    active=false;stop();return;
   }
   const n=state.room.narration;
   if(n?.serverNow)offset=n.serverNow-Date.now();
   if(active&&!n?.enabled){active=false;stop();}
   if(n?.paused&&!preview)halt();
   pump();
   if(options.autoStart&&!active&&!loading&&state.room.status!=='FINISHED'&&attemptedRoom!==state.room.code){
    attemptedRoom=state.room.code;
    enable('attach');
   }
  }
  // Called directly by the host's normal click, before any network await.
  function prepare(){
   if(active||prepared)return prepared||Promise.resolve(true);
   audio.src=BASE+'test.wav';audio.volume=0;
   prepared=(async()=>{try{await audio.play();halt();return true;}catch{return false;}finally{audio.volume=1;}})();
   return prepared;
  }
  function enable(action='enable'){
   if(activation)return activation;
   if(!host())return Promise.resolve(false);
   if(active)return Promise.resolve(true);
   const unlock=prepared||prepare();
   activation=activate(action,unlock).finally(()=>{activation=null;prepared=null;});
   return activation;
  }
  async function activate(action,unlock){
   if(!host()||loading)return false;
   loading=true;message='正在准备语音包';notify();
   try{
    if(!await unlock)throw Error('浏览器尚未允许播放声音，请点击测试音量。');
    await load();
    // Ensure the fixed night script is available before its server clock starts.
    const ids=['N00','N06.settle','N06.dawn',...['GUARD','WOLF','WITCH','SEER','STALKER'].flatMap(r=>[r+'.open',r+'.close'])];
    await Promise.all(ids.map(async id=>{const r=await env.fetch(url(id));if(!r.ok)throw Error('夜间语音资源不完整');await r.arrayBuffer();}));
    await request(action);active=true;message='';heartbeatAt=now();
    await options.refresh?.();return true;
   }catch(e){active=false;stop();message=e.message;return false;}
   finally{loading=false;notify();}
  }
  async function control(action){
   if(!active)return;
   try{await request(action);if(action==='disable'){active=false;stop();}else if(action==='pause')halt();else if(action==='resume')stop();message='';await options.refresh?.();}
   catch(e){message=e.message;if(action==='disable'){active=false;stop();}}
   notify();
  }
  async function replay(){
   if(!active||!pack)return;
   try{
    if(!state.room.narration.paused)await control('pause');
    if(!state.room.narration.paused)return;
    const n=state.room.narration,elapsed=n.pausedAt-n.origin;
    const cue=n.plan.filter(c=>c.at<=elapsed).at(-1);
    if(!cue){message='当前还没有可重播的口令';notify();return;}
    stop();preview=true;audio.src=url(cue.cue);audio.currentTime=0;await play();notify();
   }catch(e){fail(e);}
  }
  async function test(){
   if(!host())return;
   if(!active&&!await enable('attach'))return;
   if(state.room.status==='GAME'&&!state.room.narration.paused)await control('pause');
   if(state.room.status==='GAME'&&!state.room.narration.paused)return;
   stop();preview=true;audio.src=url('test');audio.currentTime=0;play();notify();
  }
  function pump(){
   if(!active||!host()||!pack)return;
   const n=state.room.narration;
   if(now()>=leaseUntil-500){active=false;stop();message='播放端连接已过期，请重新开启语音';notify();return;}
   if(!n?.enabled||n.paused||preview)return;
   const elapsed=now()-n.origin,c=n.plan.find(c=>c.at<=elapsed&&elapsed<c.at+c.duration);
   if(!c){if(currentId!==null){halt();currentId=null;}return;}
   const id=`${n.gameId}:${c.id}`;
   if(currentId!==id){
    const rate=c.playbackRate||1;
    currentId=id;audio.src=url(c.cue);audio.currentTime=Math.max(0,elapsed-c.at)*rate/1000;
    play(rate);notify();
   }else if(audio.paused)play(c.playbackRate||1);
  }
  async function heartbeat(){
   if(!active||heartbeatPending||now()-heartbeatAt<4000)return;
   heartbeatPending=true;heartbeatAt=now();
   try{await request('heartbeat');}
   catch(e){active=false;stop();message='语音播放端连接中断，请重新开启语音';notify();}
   finally{heartbeatPending=false;}
  }
  function status(){
   const n=state?.room?.narration;
   const elapsed=n?(n.paused?n.pausedAt:now())-n.origin:0;
   const cue=n?.plan?.find(c=>c.at<=elapsed&&elapsed<c.at+c.duration);
   return {active,loading,message,pack:pack?.label||'2023 六人播报稿 v0.2',caption:cue&&pack?pack.cues[cue.cue].text:'',paused:Boolean(n?.paused),preview,playing:!audio.paused};
  }
  function disconnect(){if(active){stop();request('pause').then(()=>options.refresh?.()).catch(()=>{});}}
  const timer=env.setInterval?.(()=>{pump();heartbeat();},100);
  env.addEventListener?.('pagehide',()=>{
   if(active){stop();env.fetch('/api/narration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pause',clientId}),keepalive:true}).catch(()=>{});}
  });
  return {accept,prepare,enable,control,replay,test,status,disconnect,load,pump,heartbeat,destroy(){env.clearInterval?.(timer);stop();}};
 }
 return {create};
});
