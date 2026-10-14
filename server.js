'use strict';
/* Сириус — сервер. Без зависимостей: только Node.js 18+.  Запуск: node server.js */
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=+process.env.PORT||3000,DIR=process.env.DATA_DIR||path.join(__dirname,'data'),MEDIA=path.join(DIR,'media'),FILE=path.join(DIR,'db.json');
fs.mkdirSync(MEDIA,{recursive:true});
const COLS=['users','friends','blocks','posts','groups','stories','calls','msgs'];
const DB={tokens:{}};COLS.forEach(c=>DB[c]={});
try{const d=JSON.parse(fs.readFileSync(FILE,'utf8'));Object.keys(DB).forEach(k=>{if(d[k])DB[k]=d[k]})}catch(e){}
for(const[id,c]of Object.entries(DB.calls))if(Date.now()-(c.t||0)>36e5)delete DB.calls[id];
let timer=0;const save=()=>{if(timer)return;timer=setTimeout(()=>{timer=0;fs.writeFile(FILE+'.tmp',JSON.stringify(DB),e=>{if(!e)fs.rename(FILE+'.tmp',FILE,()=>{})})},500)};
const hash=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sd=(a,b)=>{a=a||[];b=b||[];return[...a.filter(x=>!b.includes(x)),...b.filter(x=>!a.includes(x))]};
const isAdm=(g,u)=>!!g&&(g.by===u||(g.adm||[]).includes(u)),isMem=(g,u)=>!!g&&(g.mem||[]).includes(u);
const deny=m=>Object.assign(new Error(m||'Запрещено'),{code:403});
const PUB=['name','un','bio','av','cv','st','bd','hbd','seen','invisible','hidden','fonly','nopost','fph','nocall'];
const viewUser=(v,u,id)=>{if(id===u)return v;const o={};PUB.forEach(k=>{if(v[k]!==undefined)o[k]=v[k]});if(v.fph&&v.ph)o.ph=v.ph;return o};
function canSee(c,v,u){
  if(c==='msgs'){const g=DB.groups[v.c];if(g)return isMem(g,u)||!!(g.ch&&g.pub);return String(v.c).split('_').includes(u)}
  if(c==='blocks')return v.by===u||v.to===u;
  if(c==='calls')return v.from===u||v.to===u;
  return true}
function state(u){const s={};for(const c of COLS){s[c]={};for(const[id,v]of Object.entries(DB[c])){if(canSee(c,v,u))s[c][id]=c==='users'?viewUser(v,u,id):v}}return s}
const clients=new Set();
const send=(cl,o)=>{try{cl.res.write('data: '+JSON.stringify(o)+'\n\n')}catch(e){}};
function broadcast(c,id,v){
  if(c==='groups'){clients.forEach(cl=>send(cl,{t:'init',s:state(cl.u)}));return}
  clients.forEach(cl=>{if(v===undefined)send(cl,{t:'del',c,id});else if(canSee(c,v,cl.u))send(cl,{t:'set',c,id,v:c==='users'?viewUser(v,cl.u,id):v});else send(cl,{t:'del',c,id})})}
function canDel(c,id,old,u){
  switch(c){
    case'users':return id===u;
    case'friends':return id.split('_').includes(u);
    case'blocks':return old.by===u;
    case'posts':case'stories':return old.by===u;
    case'groups':return old.by===u;
    case'calls':return old.from===u||old.to===u;
    case'msgs':{const g=DB.groups[old.c];return old.from===u||(g?isAdm(g,u):String(old.c).split('_').includes(u))}}
  return false}
function canWrite(c,id,old,nv,u){
  switch(c){
    case'users':{if(id!==u)return false;if(nv.un!==undefined){const un=String(nv.un);if(!/^[a-z0-9_]{3,20}$/.test(un))return false;if(Object.entries(DB.users).some(([i,x])=>i!==id&&x.un===un))return false}return true}
    case'friends':{const[f,t]=id.split('_');if(!f||!t||f===t||nv.from!==f||nv.to!==t)return false;if(!old)return u===f&&nv.st==='p';return(u===t&&nv.st==='ok')||(u===f&&nv.st==='p'&&old.st==='p')}
    case'blocks':{const[b,t]=id.split('_');return u===b&&nv.by===b&&nv.to===t}
    case'posts':{if(!old)return nv.by===u;if(old.by===u)return nv.by===old.by;
      return sd(old.lk,nv.lk).every(x=>x===u)&&eq((old.cm||[]).filter(x=>x.by!==u),(nv.cm||[]).filter(x=>x.by!==u))&&(nv.cm||[]).filter(x=>x.by===u).length<=200&&Object.keys({...old,...nv}).every(k=>k==='lk'||k==='cm'||eq(old[k],nv[k]))}
    case'groups':{
      if(nv.un&&Object.entries(DB.groups).some(([i,x])=>i!==id&&x.un===nv.un))return false;
      if(!old)return nv.by===u&&Array.isArray(nv.mem)&&nv.mem.includes(u);
      if(nv.by!==old.by)return false;
      if(isAdm(old,u))return Array.isArray(nv.mem);
      const ch=sd(old.mem,nv.mem);if(!ch.every(x=>x===u))return false;
      if((nv.mem||[]).includes(u)&&!(old.mem||[]).includes(u)&&!old.ch)return false;
      const oa=old.adm||[old.by],na=nv.adm||oa;if(!sd(oa,na).every(x=>x===u)||(na.includes(u)&&!oa.includes(u)))return false;
      return Object.keys({...old,...nv}).every(k=>k==='mem'||k==='adm'||eq(old[k],nv[k]))}
    case'msgs':{const g=DB.groups[old?old.c:nv.c];
      if(!old){if(nv.from!==u||typeof nv.c!=='string')return false;if(g)return isMem(g,u)&&(!g.ch||isAdm(g,u));return nv.c.split('_').includes(u)}
      if(nv.c!==old.c||nv.from!==old.from)return false;
      if(old.from===u)return true;
      if(!canSee('msgs',old,u))return false;
      const rxk=new Set([...Object.keys(old.rx||{}),...Object.keys(nv.rx||{})]);
      for(const k of rxk)if(!sd((old.rx||{})[k],(nv.rx||{})[k]).every(x=>x===u))return false;
      return Object.keys({...old,...nv}).every(k=>k==='rx'||k==='rd'||eq(old[k],nv[k]))}
    case'stories':{if(!old)return nv.by===u;if(old.by===u)return nv.by===u;
      const ks=new Set([...Object.keys(old.rx||{}),...Object.keys(nv.rx||{})]);for(const k of ks)if(k!==u&&!eq((old.rx||{})[k],(nv.rx||{})[k]))return false;
      return Object.keys({...old,...nv}).every(k=>k==='rx'||eq(old[k],nv[k]))}
    case'calls':{if(!old)return nv.from===u&&!!nv.to;return(old.from===u||old.to===u)&&nv.from===old.from&&nv.to===old.to}
  }
  return false}
function apply(u,op,c,id,v){
  const old=DB[c][id];
  if(op==='delete'){if(!old)return;if(!canDel(c,id,old,u))throw deny();delete DB[c][id];save();broadcast(c,id,undefined);return}
  v=v&&typeof v==='object'&&!Array.isArray(v)?v:{};
  const nv=op==='update'?Object.assign({},old||{},v):v;
  if(!canWrite(c,id,old,nv,u))throw deny();
  DB[c][id]=nv;save();broadcast(c,id,nv)}
function auth(u,t){if(!/^[A-Za-z0-9_\-]{3,40}$/.test(u||'')||!t||String(t).length<8)return false;const h=hash(t);if(!DB.tokens[u]){DB.tokens[u]=h;save();return true}return DB.tokens[u]===h}
const body=req=>new Promise((res,rej)=>{let n=0;const b=[];req.on('data',c=>{n+=c.length;if(n>1.5e6){rej(new Error('Слишком большой запрос'));req.destroy()}else b.push(c)});req.on('end',()=>res(Buffer.concat(b).toString()));req.on('error',rej)});
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://x');
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  const J=(code,o)=>{if(res.headersSent)return;res.writeHead(code,{...cors,'Content-Type':'application/json'});res.end(JSON.stringify(o))};
  if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end()}
  try{
    if(url.pathname==='/api/ping')return J(200,{ok:1});
    if(url.pathname==='/api/stream'){
      const u=url.searchParams.get('u'),t=url.searchParams.get('t');if(!auth(u,t))return J(401,{err:'Нет доступа'});
      res.writeHead(200,{...cors,'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      const cl={res,u};clients.add(cl);send(cl,{t:'init',s:state(u)});
      const ka=setInterval(()=>{try{res.write(': ka\n\n')}catch(e){}},20000);req.on('close',()=>{clearInterval(ka);clients.delete(cl)});return}
    if(url.pathname==='/api/w'&&req.method==='POST'){
      const{u,t,op,c,id,v}=JSON.parse(await body(req));
      if(!auth(u,t))return J(401,{err:'Нет доступа'});
      if(typeof id!=='string'||!/^[A-Za-z0-9_\-]{1,100}$/.test(id))return J(400,{err:'Неверный id'});
      if(c==='media'){if(op!=='set'||!v||typeof v.d!=='string'||v.d.length>250000)return J(400,{err:'Неверный файл'});
        const f=path.join(MEDIA,id);if(fs.existsSync(f))return J(409,{err:'Уже есть'});
        return fs.writeFile(f,v.d,e=>e?J(500,{err:'Ошибка диска'}):J(200,{ok:1}))}
      if(!COLS.includes(c)||!['set','update','delete'].includes(op))return J(400,{err:'Неверная операция'});
      apply(u,op,c,id,v);return J(200,{ok:1})}
    const m=/^\/api\/doc\/media\/([A-Za-z0-9_\-]{1,100})$/.exec(url.pathname);
    if(m)return fs.readFile(path.join(MEDIA,m[1]),(e,d)=>{if(e)return J(404,{err:'Нет файла'});res.writeHead(200,{...cors,'Content-Type':'application/json','Cache-Control':'public, max-age=31536000'});res.end(JSON.stringify({d:d.toString()}))});
    if(url.pathname==='/'||url.pathname==='/index.html')return fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{if(e){res.writeHead(404);return res.end('index.html не найден рядом с server.js')}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(d)});
    J(404,{err:'Не найдено'})
  }catch(e){J(e.code||400,{err:e.message||'Ошибка'})}
});
server.listen(PORT,()=>console.log('Сириус запущен: http://localhost:'+PORT+'  (данные: '+DIR+')'));
