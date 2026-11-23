import Fastify from 'fastify';
import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { openDatabase } from './database.js';
import { createGrsu } from './grsu.js';
import { registerAssistant } from './assistant.js';
import { registerExpansion } from './expansion.js';
import { registerPublicRoutes } from './public-routes.js';
import { demoCatalog, demoSchedule } from './demo.js';
import { validDate, weekStart } from '../shared/calendar.js';
const scrypt=promisify(scryptCallback);
const hash=s=>createHash('sha256').update(s).digest('hex');
const ttl=30*86400;
const str=(max=200)=>({type:'string',maxLength:max});
const obj=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const scopeSchema={type:'string',enum:['live','demo'],default:'live'};
function fail(status,message){const e=new Error(message);e.statusCode=status;throw e;}
function cleanDate(value){if(value!==''&&!validDate(value))fail(400,'Некорректная дата.');return value;}
function taskJson(row){return {id:row.id,title:row.title,subject:row.subject,notes:row.notes,dueDate:row.due_date,planDate:row.plan_date,priority:row.priority,done:!!row.done,createdAt:row.created_at,updatedAt:row.updated_at};}
async function passwordHash(password){const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64);return `${salt}:${key.toString('hex')}`;}
async function passwordMatches(password,stored){const [salt,encoded]=stored.split(':');const key=await scrypt(password,salt,64);return timingSafeEqual(key,Buffer.from(encoded,'hex'));}
const taskFields={title:{...str(200),minLength:1},subject:str(200),notes:str(4000),dueDate:str(10),planDate:str(10),priority:{enum:['normal','high'],type:'string'},done:{type:'boolean'}};

export function buildApp({dbPath=process.env.DB_PATH||'data/kupala.sqlite',fetchImpl=fetch,secureCookies=process.env.COOKIE_SECURE==='true',allowedOrigins=(process.env.APP_ORIGIN||'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001').split(','),grsuOptions={},assistantOptions={},logger=false}={}) {
  const db=openDatabase(dbPath);const grsu=createGrsu(db,{fetchImpl,...grsuOptions});
  const app=Fastify({logger,bodyLimit:16384,ajv:{customOptions:{removeAdditional:false}}});
  const rate=new Map();let requests=0;
  const sessionFrom=req=>{
    const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kh_session='))?.slice(11);
    if(!raw||!/^[a-f0-9]{64}$/.test(raw))return null;
    return db.prepare('SELECT sessions.*,users.email,users.name,users.settings FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(hash(raw),Date.now())||null;
  };
  function issueSession(uid,reply){const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),uid,csrf,Date.now()+ttl*1000);reply.header('Set-Cookie',`kh_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}${secureCookies?'; Secure':''}`);return csrf;}
  const profile=s=>({name:s.name,email:s.email||null,settings:JSON.parse(s.settings),csrf:s.csrf});
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','same-origin').header('X-Frame-Options','DENY');
    if(req.url.startsWith('/api/'))reply.header('Cache-Control','no-store');
    const mutating=!['GET','HEAD','OPTIONS'].includes(req.method);
    if(mutating){if(req.headers['sec-fetch-site']==='cross-site')fail(403,'Запрос с другого сайта отклонён.');if(req.headers.origin&&!allowedOrigins.includes(req.headers.origin))fail(403,'Недопустимый источник запроса.');}
    const key=req.ip+(req.url.startsWith('/api/auth')?':auth':':all');const limit=key.endsWith(':auth')?15:240;const current=rate.get(key)||{n:0,end:Date.now()+60000};if(current.end<Date.now()){current.n=0;current.end=Date.now()+60000;}current.n++;rate.set(key,current);if(current.n>limit){reply.header('Retry-After','60');fail(429,'Слишком много запросов. Подождите минуту.');}
    if(++requests%200===0){for(const [k,v]of rate)if(v.end<Date.now())rate.delete(k);db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());}
    req.session=sessionFrom(req);
    if(mutating&&req.url!=='/api/session'&&req.url.startsWith('/api/')){if(!req.session)fail(401,'Сессия истекла. Обновите страницу.');if(req.headers['x-csrf-token']!==req.session.csrf)fail(403,'Обновите страницу и повторите действие.');}
  });
  app.setErrorHandler((error,req,reply)=>{const code=error.validation?400:error.statusCode||500;reply.code(code).send({error:code>=500?(code===502?error.message:'Ошибка сервера. Повторите действие позже.'):error.validation?'Проверьте заполненные поля.':error.message});});
  app.get('/api/health',async()=>({status:'ok'}));
  app.post('/api/session',async(req,reply)=>{if(req.session)return profile(req.session);const id=randomUUID();db.prepare('INSERT INTO users (id) VALUES(?)').run(id);const csrf=issueSession(id,reply);return {name:'Студент',email:null,settings:{},csrf};});
  app.get('/api/session',async req=>{if(!req.session)fail(401,'Сессия истекла.');return profile(req.session);});
  app.post('/api/auth/register',{schema:{body:obj({email:{...str(254),format:'email'},password:{...str(128),minLength:10},name:{...str(80),minLength:1}},['email','password','name'])}},async(req,reply)=>{
    const email=req.body.email.trim().toLowerCase(),name=req.body.name.trim();if(!name)fail(400,'Укажите имя.');if(req.session.email)fail(409,'Вы уже вошли в аккаунт.');
    const password=await passwordHash(req.body.password);
    try{db.prepare('UPDATE users SET email=?,password=?,name=? WHERE id=?').run(email,password,name,req.session.user_id);}catch(e){if(String(e.code).includes('CONSTRAINT')||String(e.message).includes('UNIQUE'))fail(409,'Этот email уже используется.');throw e;}
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.session.user_id);const csrf=issueSession(req.session.user_id,reply);return {name,email,csrf,settings:JSON.parse(req.session.settings)};
  });
  app.post('/api/auth/login',{schema:{body:obj({email:{...str(254),format:'email'},password:{...str(128),minLength:1}},['email','password'])}},async(req,reply)=>{
    const user=db.prepare('SELECT * FROM users WHERE email=?').get(req.body.email.trim().toLowerCase());
    const dummy='00000000000000000000000000000000:'+ '0'.repeat(128);
    if(!await passwordMatches(req.body.password,user?.password||dummy)||!user)fail(401,'Неверный email или пароль.');
    db.prepare('DELETE FROM sessions WHERE token=?').run(req.session.token);const csrf=issueSession(user.id,reply);return {...profile({...user,csrf}),csrf};
  });
  app.post('/api/auth/logout',async(req,reply)=>{db.prepare('DELETE FROM sessions WHERE token=?').run(req.session.token);reply.header('Set-Cookie',`kh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies?'; Secure':''}`);return {ok:true};});
  const settingsSchema=obj({mode:{type:'string',enum:['live','demo']},departmentId:str(20),facultyId:str(20),course:{type:'integer',minimum:1,maximum:6},groupId:str(20),groupTitle:str(120),subgroups:{type:'array',maxItems:50,items:str(30)}},['mode']);
  app.put('/api/settings',{schema:{body:settingsSchema}},async req=>{db.prepare('UPDATE users SET settings=? WHERE id=?').run(JSON.stringify(req.body),req.session.user_id);return req.body;});
  for(const kind of ['departments','faculties','groups'])app.get(`/api/catalog/${kind}`,{schema:{querystring:obj({mode:{type:'string',enum:['live','demo'],default:'live'},departmentId:{type:'string',pattern:'^\\d{1,10}$'},facultyId:{type:'string',pattern:'^\\d{1,10}$'},course:{type:'integer',minimum:1,maximum:6}})}},async req=>{
    if(req.query.mode==='demo')return {items:demoCatalog[kind],source:'demo',stale:false};
    const {departmentId,facultyId,course}=req.query;if(kind==='groups'&&(!departmentId||!facultyId||!course))fail(400,'Выберите форму обучения, факультет и курс.');return grsu.catalog(kind,kind==='groups'?{departmentId,facultyId,course}:{});
  });
  app.get('/api/schedule',{schema:{querystring:obj({groupId:{...str(20),pattern:'^(demo|[0-9]{1,10})$'},start:{...str(10),format:'date'},mode:{type:'string',enum:['live','demo'],default:'live'},refresh:{type:'boolean',default:false}},['start','groupId'])}},async req=>{
    if(!validDate(req.query.start)||weekStart(req.query.start)!==req.query.start)fail(400,'Дата должна быть понедельником выбранной недели.');
    if(req.query.mode==='demo')return {...demoSchedule(req.query.start),source:'demo',stale:false,fetchedAt:new Date().toISOString()};
    if(req.query.groupId==='demo')fail(400,'Выберите реальную группу.');return grsu.schedule(req.query.groupId,req.query.start,req.query.refresh);
  });
  const querySchema=obj({scope:scopeSchema});
  app.get('/api/tasks',{schema:{querystring:querySchema}},async req=>{if(!req.session)fail(401,'Сессия истекла.');return {items:db.prepare('SELECT * FROM tasks WHERE user_id=? AND scope=? ORDER BY created_at DESC').all(req.session.user_id,req.query.scope).map(taskJson)};});
  app.post('/api/tasks',{schema:{querystring:querySchema,body:obj(taskFields,['title'])}},async(req,reply)=>{
    const b=req.body,title=b.title.trim();if(!title)fail(400,'Введите название задачи.');const id=randomUUID(),now=new Date().toISOString();
    db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,req.session.user_id,req.query.scope,title,b.subject?.trim()||'',b.notes||'',cleanDate(b.dueDate||''),cleanDate(b.planDate||''),b.priority||'normal',b.done?1:0,now,now);
    reply.code(201);return taskJson(db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
  });
  app.patch('/api/tasks/:id',{schema:{querystring:querySchema,params:obj({id:{type:'string',format:'uuid'}},['id']),body:obj(taskFields)}},async req=>{
    const old=db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=? AND scope=?').get(req.params.id,req.session.user_id,req.query.scope);if(!old)fail(404,'Задача не найдена.');const b={...taskJson(old),...req.body};b.title=b.title.trim();if(!b.title)fail(400,'Введите название задачи.');
    db.prepare('UPDATE tasks SET title=?,subject=?,notes=?,due_date=?,plan_date=?,priority=?,done=?,updated_at=? WHERE id=? AND user_id=?').run(b.title,b.subject,b.notes,cleanDate(b.dueDate),cleanDate(b.planDate),b.priority,b.done?1:0,new Date().toISOString(),old.id,req.session.user_id);return taskJson(db.prepare('SELECT * FROM tasks WHERE id=?').get(old.id));
  });
  app.delete('/api/tasks/:id',{schema:{querystring:querySchema,params:obj({id:{type:'string',format:'uuid'}},['id'])}},async req=>{const result=db.prepare('DELETE FROM tasks WHERE id=? AND user_id=? AND scope=?').run(req.params.id,req.session.user_id,req.query.scope);if(!result.changes)fail(404,'Задача не найдена.');return {ok:true};});
  registerExpansion(app, { db, grsu });
  registerPublicRoutes(app, { grsu });
  registerAssistant(app, { db, grsu, ...assistantOptions });
  const root=resolve('dist'),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon'};
  app.get('/*',async(req,reply)=>{if(req.url.startsWith('/api/'))return reply.code(404).send({error:'Маршрут не найден.'});let path;try{path=decodeURIComponent(req.url.split('?')[0]);}catch{fail(400,'Некорректный адрес.');}const target=resolve(root,'.'+path);if(target!==root&&!target.startsWith(root+sep))fail(403,'Недопустимый путь.');const filename=path==='/'?resolve(root,'index.html'):target;
    try{const content=await readFile(filename);reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");return reply.type(types[extname(filename)]||'application/octet-stream').send(content);}catch(e){if(e.code==='ENOENT')return reply.code(404).send({error:'Страница не найдена. Выполните npm run build.'});throw e;}});
  app.addHook('onClose',async()=>db.close());
  return app;
}
