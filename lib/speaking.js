'use strict';
const {randomInt}=require('node:crypto');
function draw(players,random=randomInt){
 const seats=players.map(p=>p.seat).sort((a,b)=>a-b);
 if(!seats.length)return null;
 const point=random(seats.length)+1,direction=random(2)===0?'CW':'CCW',start=seats[point-1];
 const order=Array.from({length:seats.length},(_,i)=>seats[(point-1+(direction==='CW'?i:-i)+seats.length)%seats.length]);
 return {point,sides:seats.length,start,direction,order};
}
function message(s){return `根据随机点数，从${s.start}号玩家开始${s.direction==='CW'?'顺时针':'逆时针'}发言。`;}
function cue(s){return `speaking.${s.start}.${s.direction}`;}
function view(s,players){return s?{...s,order:s.order.filter(seat=>players.some(p=>p.seat===seat)),message:message(s)}:null;}
module.exports={draw,message,cue,view};
