import { createHmac, timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { transaction } from './database.js';
import { validDate, weekStart, shiftDay, todayInMinsk, selectLessons } from '../shared/calendar.js';
import { demoSchedule } from './demo.js';

const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const string = max => ({ type: 'string', maxLength: max });
const scopeField = { type: 'string', enum: ['live', 'demo'], default: 'live' };
const scopeQuery = object({ scope: scopeField });
const fields = { title: { ...string(200), minLength: 1 }, subject: string(200), notes: string(4000), dueDate: string(10), planDate: string(10), priority: { type:'string', enum:['normal','high'] }, done: { type:'boolean' } };
const allowedSources = new Map([['/#tasks','Личные задачи'],['/#schedule','Расписание'],['/#materials','Личные материалы'],['/#profile','Профиль Kupala Hub']]);
const fail = (statusCode,message) => { const e=new Error(message);e.statusCode=statusCode;throw e; };
const equal = (a,b) => { const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y); };
const fingerprint = task => createHash('sha256').update(JSON.stringify(task)).digest('hex');
const taskJson = r => ({id:r.id,title:r.title,subject:r.subject,notes:r.notes,dueDate:r.due_date,planDate:r.plan_date,priority:r.priority,done:!!r.done,createdAt:r.created_at,updatedAt:r.updated_at});
const json = v => JSON.stringify(v);
function safeSources(values) { return [...new Set((Array.isArray(values)?values:[]).map(s=>s?.url).filter(u=>allowedSources.has(u)))].map(url=>({title:allowedSources.get(url),url})); }
function validateTask(args, update=false) {
  if(!args||typeof args!=='object'||Array.isArray(args))fail(400,'Некорректное предложение задачи.');
  if(Object.keys(args).some(k=>!(k in fields)&&!(update&&k==='taskId')))fail(400,'Неизвестное поле задачи.');
  const out={};
  for(const [k,v]of Object.entries(args)){
    if(k==='taskId')continue;
    const f=fields[k];if(f.type==='boolean'){if(typeof v!=='boolean')fail(400,'Некорректный статус.');}
    else if(typeof v!=='string'||v.length>(f.maxLength||50))fail(400,'Некорректное поле задачи.');
    if(f.enum&&!f.enum.includes(v))fail(400,'Некорректный приоритет.');
    if(['dueDate','planDate'].includes(k)&&v!==''&&!validDate(v))fail(400,'Некорректная дата.');
    out[k]=k==='title'?v.trim():v;
  }
  if((!update||'title'in out)&&!out.title)fail(400,'Введите название задачи.');
  if(update&&(!/^[a-f\d-]{36}$/i.test(args.taskId||'')||!Object.keys(out).length))fail(400,'Нужна задача и конкретное изменение.');
  return out;
}

export function registerAssistant(app,{db,grsu,fetchImpl=fetch,serviceUrl=process.env.AI_SERVICE_URL||'http://127.0.0.1:8001',serviceToken=process.env.AGENT_SERVICE_TOKEN||'',now=()=>Date.now()}={}){
  const tokenReady=serviceToken.length>=32;
  const url=new URL(serviceUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]','ai'].includes(url.hostname)))throw Error('Invalid AI_SERVICE_URL');
  const endpoint=path=>new URL(path,url).href;
  db.exec(`CREATE TABLE IF NOT EXISTS assistant_messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),scope TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,sources TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS assistant_owner ON assistant_messages(user_id,scope,created_at);
  CREATE TABLE IF NOT EXISTS assistant_proposals(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),scope TEXT NOT NULL,request_id TEXT NOT NULL,message_id TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL,base_hash TEXT,expires INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',task_id TEXT);
  CREATE INDEX IF NOT EXISTS assistant_action_owner ON assistant_proposals(user_id,scope);`);
  const active=new Map(),budgets=new Map();
  const source=url=>({title:allowedSources.get(url),url});
  const ownTask=(uid,scope,id)=>{const row=db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=? AND scope=?').get(id,uid,scope);if(!row)fail(404,'Задача не найдена.');return taskJson(row);};
  const getTasks=(uid,scope)=>{const total=db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id=? AND scope=?').get(uid,scope).n;const items=db.prepare("SELECT * FROM tasks WHERE user_id=? AND scope=? ORDER BY done,CASE WHEN due_date='' THEN '9999' ELSE due_date END,created_at DESC LIMIT 40").all(uid,scope).map(taskJson).map(t=>({...t,notes:t.notes.slice(0,320)}));return {items,total,truncated:total>items.length,source:scope==='demo'?'demo':'user'};};
  const settingsFor=uid=>JSON.parse(db.prepare('SELECT settings FROM users WHERE id=?').get(uid).settings);
  async function scheduleFor(uid,scope,start){
    if(!validDate(start)||weekStart(start)!==start||Math.abs(new Date(start)-new Date(todayInMinsk()))>42*86400000)fail(400,'Расписание доступно в пределах шести недель от сегодня.');
    const s=settingsFor(uid);if(scope==='demo')return {...demoSchedule(start),source:'demo',fetchedAt:null,stale:false,coverage:{start,end:shiftDay(start,6)}};
    if(!/^\d{1,10}$/.test(s.groupId||''))return {status:'unavailable',days:[],message:'Реальная группа не выбрана.',coverage:{start,end:shiftDay(start,6)}};
    try{const result=await grsu.schedule(s.groupId,start);return {...result,days:result.days.map(d=>({...d,lessons:selectLessons(d.lessons,s.subgroups||[])})),coverage:{start,end:shiftDay(start,6),groupTitle:s.groupTitle,complete:false},subgroupFilterApplied:!!s.subgroups?.length};}
    catch{return {status:'unavailable',days:[],message:'Не удалось получить расписание ГрГУ.',coverage:{start,end:shiftDay(start,6)}};}
  }
  function materialsFor(uid,scope,query=''){
    const rows=db.prepare('SELECT id,title,subject,notes FROM materials WHERE user_id=? AND scope=? ORDER BY updated_at DESC LIMIT 100').all(uid,scope);
    const matched=rows.filter(m=>`${m.title} ${m.subject} ${m.notes}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    return {items:matched.slice(0,8).map(m=>({...m,notes:m.notes.slice(0,600)})),searched:rows.length,truncated:matched.length>8,source:scope==='demo'?'demo':'user',note:'Только сохранённые заметки и названия; содержимое внешних ссылок не скачивалось.'};
  }
  function proposalsFor(messageId,uid,scope){return db.prepare('SELECT * FROM assistant_proposals WHERE message_id=? AND user_id=? AND scope=?').all(messageId,uid,scope).map(r=>({id:r.id,kind:r.kind,task:JSON.parse(r.payload),expiresAt:new Date(r.expires).toISOString(),status:r.status==='pending'&&r.expires<now()?'expired':r.status}));}
  const messageJson=(r,uid,scope)=>({id:r.id,role:r.role,content:r.content,createdAt:r.created_at,sources:JSON.parse(r.sources),proposals:proposalsFor(r.id,uid,scope)});
  function grant(uid,scope,requestId){const payload=Buffer.from(json({uid,scope,requestId,exp:now()+120000})).toString('base64url');return payload+'.'+createHmac('sha256',serviceToken).update(payload).digest('base64url');}
  function verifyGrant(value){try{const [payload,signature,...extra]=(value||'').split('.');if(extra.length||!payload||!equal(signature,createHmac('sha256',serviceToken).update(payload).digest('base64url')))throw Error();const p=JSON.parse(Buffer.from(payload,'base64url').toString());const a=active.get(p.uid+':'+p.scope);if(p.exp<now()||!a||a.id!==p.requestId||!['live','demo'].includes(p.scope))throw Error();return p;}catch{fail(403,'Недействительное разрешение агента.');}}
  app.post('/internal/assistant/tools',{schema:{body:object({name:{type:'string',enum:['get_tasks','get_schedule','search_materials','propose_task','propose_task_update']},arguments:{type:'object'}},['name','arguments'])}},async req=>{
    if(!tokenReady||!equal(req.headers.authorization,'Bearer '+serviceToken))fail(401,'Недопустимый сервис.');
    const p=verifyGrant(req.headers['x-agent-grant']),a=active.get(p.uid+':'+p.scope);if(++a.toolCalls>8)fail(429,'Лимит инструментов.');
    const args=req.body.arguments;
    if(req.body.name==='get_tasks'){if(Object.keys(args).length)fail(400,'Аргументы не поддерживаются.');return {data:getTasks(p.uid,p.scope),sources:[source('/#tasks')]};}
    if(req.body.name==='get_schedule'){if(Object.keys(args).some(k=>k!=='start'))fail(400,'Неизвестный аргумент.');return {data:await scheduleFor(p.uid,p.scope,args.start),sources:[source('/#schedule')]};}
    if(req.body.name==='search_materials'){if(typeof args.query!=='string'||args.query.length>200||Object.keys(args).some(k=>k!=='query'))fail(400,'Некорректный поиск.');return {data:materialsFor(p.uid,p.scope,args.query),sources:[source('/#materials')]};}
    const update=req.body.name==='propose_task_update';const fields=validateTask(args,update);const before=update?ownTask(p.uid,p.scope,args.taskId):null;
    const task=update?{...before,...fields}:{subject:'',notes:'',dueDate:'',planDate:'',priority:'normal',done:false,...fields};
    const id=randomUUID(),expires=now()+600000,kind=update?'update_task':'create_task';
    db.prepare('INSERT INTO assistant_proposals(id,user_id,scope,request_id,kind,payload,base_hash,expires) VALUES(?,?,?,?,?,?,?,?)').run(id,p.uid,p.scope,p.requestId,kind,json(task),before?fingerprint(before):null,expires);
    const proposal={id,kind,task,expiresAt:new Date(expires).toISOString(),status:'pending'};return {data:{message:'Предложение подготовлено. Ничего не изменено до подтверждения пользователем.'},sources:[source('/#tasks')],proposal};
  });
  app.register(async routes=>{
    routes.addHook('preHandler',async req=>{if(!req.session)fail(401,'Войдите в приложение.');});
    routes.get('/api/assistant/status',async()=>{
      if(!tokenReady)return {available:false,configured:false,reason:'Сервис ассистента ещё не настроен.'};
      try{const r=await fetchImpl(endpoint('/health'),{headers:{Authorization:'Bearer '+serviceToken},signal:AbortSignal.timeout(4000),redirect:'error'});if(!r.ok)throw Error();const d=await r.json();return {available:d.configured===true,configured:d.configured===true,model:typeof d.model==='string'?d.model.slice(0,80):'',reason:d.configured===true?'':'Ключ DeepSeek ещё не настроен на сервере.'};}catch{return {available:false,configured:false,reason:'Сервис ассистента временно недоступен.'};}
    });
    routes.get('/api/assistant/history',{schema:{querystring:scopeQuery}},async req=>{const uid=req.session.user_id,scope=req.query.scope;const rows=db.prepare('SELECT * FROM (SELECT rowid,* FROM assistant_messages WHERE user_id=? AND scope=? ORDER BY rowid DESC LIMIT 40) ORDER BY rowid').all(uid,scope);return {items:rows.map(r=>messageJson(r,uid,scope))};});
    routes.delete('/api/assistant/history',{schema:{querystring:scopeQuery}},async req=>{const uid=req.session.user_id,scope=req.query.scope;if(active.has(uid+':'+scope))fail(409,'Дождитесь завершения ответа.');transaction(db,()=>{db.prepare('DELETE FROM assistant_proposals WHERE user_id=? AND scope=?').run(uid,scope);db.prepare('DELETE FROM assistant_messages WHERE user_id=? AND scope=?').run(uid,scope);});return {ok:true};});
    routes.post('/api/assistant/chat',{schema:{body:object({message:{...string(4000),minLength:1},scope:scopeField,shareContext:{type:'boolean',const:true}},['message','scope','shareContext'])}},async req=>{
      if(!tokenReady)fail(503,'Сервис ассистента ещё не настроен.');const text=req.body.message.trim();if(!text)fail(400,'Введите сообщение.');
      const uid=req.session.user_id,scope=req.body.scope,key=uid+':'+scope;if(active.has(key))fail(409,'Дождитесь предыдущего ответа.');
      const budget=budgets.get(uid)||{count:0,until:now()+3600000};if(budget.until<=now()){budget.count=0;budget.until=now()+3600000;}if(budget.count>=30)fail(429,'Лимит: 30 сообщений в час.');budget.count++;budgets.set(uid,budget);
      if(budgets.size>1000)for(const [id,b]of budgets)if(b.until<now())budgets.delete(id);
      const requestId=randomUUID();active.set(key,{id:requestId,toolCalls:0});
      try{
        const s=settingsFor(uid),tasks=getTasks(uid,scope),start=weekStart(todayInMinsk()),schedule=await scheduleFor(uid,scope,start),materials=materialsFor(uid,scope);
        const history=db.prepare('SELECT role,content FROM (SELECT rowid,role,content FROM assistant_messages WHERE user_id=? AND scope=? ORDER BY rowid DESC LIMIT 12) ORDER BY rowid').all(uid,scope).map(r=>({...r,content:r.content.slice(0,4000)}));
        const context={today:todayInMinsk(),now:new Date(now()).toISOString(),timezone:'Europe/Minsk',mode:scope,profile:{name:req.session.name,groupTitle:scope==='demo'?'Демонстрационная группа':s.groupTitle||'',verified:false},tasks,materials,schedule,sources:[source('/#tasks'),source('/#schedule'),source('/#materials')],limits:'Показано не более 40 задач, 8 заметок по 600 символов и одной недели расписания. Закрытые учебные данные недоступны.'};
        // Bound the schedule without dropping its provenance or hiding truncation.
        let count=0;context.schedule={...schedule,days:schedule.days.map(d=>({...d,lessons:d.lessons.filter(()=>++count<=70)})),truncated:count>70};
        if(Buffer.byteLength(json(context),'utf8')>58000){context.schedule={status:'unavailable',days:[],message:'Расписание слишком велико; запросите нужную неделю инструментом.',coverage:schedule.coverage};}
        if(Buffer.byteLength(json(context),'utf8')>58000){context.tasks={...tasks,items:tasks.items.slice(0,25).map(t=>({...t,notes:t.notes.slice(0,120)})),truncated:true};context.materials={...materials,items:materials.items.slice(0,3).map(m=>({...m,notes:m.notes.slice(0,200)})),truncated:true};}
        const r=await fetchImpl(endpoint('/chat'),{method:'POST',headers:{Authorization:'Bearer '+serviceToken,'Content-Type':'application/json'},body:json({message:text,history,context,grant:grant(uid,scope,requestId)}),signal:AbortSignal.timeout(75000),redirect:'error'});
        if(!r.ok)fail(r.status===503?503:502,r.status===503?'DeepSeek пока не настроен или занят.':'Не удалось получить ответ DeepSeek. Повторите позже.');
        const raw=await r.text();if(raw.length>100000)throw Error();const answer=JSON.parse(raw);if(typeof answer.answer!=='string'||!answer.answer.trim()||answer.answer.length>16000)throw Error();
        const id=randomUUID(),createdAt=new Date(now()).toISOString(),sources=safeSources(answer.sources);
        transaction(db,()=>{db.prepare('INSERT INTO assistant_messages VALUES(?,?,?,?,?,?,?)').run(randomUUID(),uid,scope,'user',text,'[]',createdAt);db.prepare('INSERT INTO assistant_messages VALUES(?,?,?,?,?,?,?)').run(id,uid,scope,'assistant',answer.answer,json(sources),createdAt);db.prepare('UPDATE assistant_proposals SET message_id=? WHERE user_id=? AND scope=? AND request_id=?').run(id,uid,scope,requestId);
          const old=db.prepare('SELECT id FROM assistant_messages WHERE user_id=? AND scope=? ORDER BY rowid DESC LIMIT -1 OFFSET 40').all(uid,scope);for(const row of old){db.prepare('DELETE FROM assistant_proposals WHERE message_id=?').run(row.id);db.prepare('DELETE FROM assistant_messages WHERE id=?').run(row.id);}
        });return {message:messageJson(db.prepare('SELECT * FROM assistant_messages WHERE id=?').get(id),uid,scope)};
      }catch(e){db.prepare('DELETE FROM assistant_proposals WHERE request_id=? AND message_id IS NULL').run(requestId);if(e.statusCode)throw e;fail(e.name==='TimeoutError'?504:502,'Ассистент не смог завершить ответ. Изменения не применены.');}
      finally{active.delete(key);}
    });
    routes.post('/api/assistant/proposals/:id/confirm',{schema:{params:object({id:{type:'string',format:'uuid'}},['id']),body:object({scope:scopeField},['scope'])}},async req=>{
      const uid=req.session.user_id,scope=req.body.scope;
      return transaction(db,()=>{
        const p=db.prepare('SELECT * FROM assistant_proposals WHERE id=? AND user_id=? AND scope=? AND message_id IS NOT NULL').get(req.params.id,uid,scope);if(!p)fail(404,'Предложение не найдено.');
        if(p.status==='confirmed')return {task:ownTask(uid,scope,p.task_id),proposalId:p.id,alreadyConfirmed:true};
        if(p.expires<now())fail(410,'Срок предложения истёк. Попросите новый план.');
        const task=JSON.parse(p.payload),stamp=new Date(now()).toISOString();let taskId;
        if(p.kind==='create_task'){taskId=randomUUID();db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(taskId,uid,scope,task.title,task.subject,task.notes,task.dueDate,task.planDate,task.priority,task.done?1:0,stamp,stamp);}
        else{const current=ownTask(uid,scope,task.id);if(fingerprint(current)!==p.base_hash)fail(409,'Задача уже изменилась. Попросите новое предложение.');taskId=task.id;db.prepare('UPDATE tasks SET title=?,subject=?,notes=?,due_date=?,plan_date=?,priority=?,done=?,updated_at=? WHERE id=? AND user_id=? AND scope=?').run(task.title,task.subject,task.notes,task.dueDate,task.planDate,task.priority,task.done?1:0,stamp,taskId,uid,scope);}
        db.prepare("UPDATE assistant_proposals SET status='confirmed',task_id=? WHERE id=?").run(taskId,p.id);return {task:ownTask(uid,scope,taskId),proposalId:p.id,alreadyConfirmed:false};
      });
    });
  });
}
