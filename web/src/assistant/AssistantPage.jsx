import React,{useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../api.js';
import {ArrowUpRight,Check,Clock3,LoaderCircle,MessageCircle,Send,ShieldCheck,Sparkles,Trash2} from 'lucide-react';
import './assistant.css';

const SUGGESTIONS=['Спланируй мой день','Что нужно сдать на этой неделе?','Разбей большую задачу на шаги'];
const ROUTES=new Set(['today','schedule','tasks','study','materials','exams','teachers','campus','community','finance','profile','notifications']);
const MAX_MESSAGE=4000;

function inAppSource(url){
  if(typeof url!=='string')return null;
  const match=url.match(/^\/#([a-z]+)$/);
  return match&&ROUTES.has(match[1])?url:null;
}

function SourceList({sources=[]}){
  const safe=sources.filter(source=>source&&typeof source.title==='string'&&source.title.trim());
  if(!safe.length)return null;
  return <div className="assistant-sources"><span>Источники</span>{safe.map((source,index)=>{const href=inAppSource(source.url);return href?<a key={`${href}-${index}`} href={href}>{source.title}<ArrowUpRight size={13}/></a>:<span key={`${source.title}-${index}`}>{source.title}</span>;})}</div>;
}

function ProposalCard({proposal,onConfirm,busy}){
  const task=proposal.task||{};
  const date=value=>value?new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}):'';
  const hasDueDate=Object.hasOwn(task,'dueDate'),hasPlanDate=Object.hasOwn(task,'planDate'),hasDone=Object.hasOwn(task,'done');
  const state=proposal.status==='confirmed'?'confirmed':proposal.status==='expired'||(proposal.expiresAt&&new Date(proposal.expiresAt)<=new Date())?'expired':'pending';
  return <section className={`assistant-proposal ${state}`} aria-label="Предложение задачи">
    <div className="assistant-proposal-head"><strong>{proposal.kind==='update_task'?'Изменить задачу':'Создать задачу'}</strong><span className={`assistant-proposal-state ${state}`}>{state==='confirmed'?'Подтверждено':state==='expired'?'Срок истёк':'Нужно подтверждение'}</span></div>
    <h4>{task.title||'Без названия'}</h4>
    <dl>{task.subject&&<div><dt>Предмет</dt><dd>{task.subject}</dd></div>}{hasDueDate&&<div><dt>Срок сдачи</dt><dd>{date(task.dueDate)||'Не задан'}</dd></div>}{hasPlanDate&&<div><dt>День работы</dt><dd>{date(task.planDate)||'Не задан'}</dd></div>}{task.priority&&<div><dt>Приоритет</dt><dd>{task.priority==='high'?'Высокий':task.priority==='low'?'Низкий':'Обычный'}</dd></div>}{hasDone&&<div><dt>Статус</dt><dd>{task.done?'Выполнена':'В работе'}</dd></div>}{task.notes&&<div className="notes"><dt>Заметка</dt><dd>{task.notes}</dd></div>}</dl>
    {state==='pending'&&<button className="assistant-confirm" type="button" disabled={busy} onClick={()=>onConfirm(proposal.id)}><Check size={15}/>{busy?'Применяем…':proposal.kind==='update_task'?'Применить изменения':'Подтвердить задачу'}</button>}
  </section>;
}

function Message({item,onConfirm,confirming}){
  const assistant=item.role==='assistant';
  return <article className={`assistant-message ${assistant?'assistant':'user'}`}>
    {assistant&&<div className="assistant-message-mark" aria-hidden="true"><Sparkles size={14}/></div>}
    <div className="assistant-message-content"><div className="assistant-bubble"><p>{item.content}</p></div>
      {assistant&&<><SourceList sources={item.sources}/>{item.proposals?.map(proposal=><ProposalCard key={proposal.id} proposal={proposal} onConfirm={onConfirm} busy={confirming===proposal.id}/>)}</>}
      <time dateTime={item.createdAt}>{item.createdAt?new Date(item.createdAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):''}</time>
    </div>
  </article>;
}

export default function AssistantPage({scope,settings,tasks,schedule,onReloadTasks}){
  const [status,setStatus]=useState(null),[items,setItems]=useState([]),[historyLoading,setHistoryLoading]=useState(true),[statusLoading,setStatusLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState(''),[shareContext,setShareContext]=useState(false),[busy,setBusy]=useState(false),[confirming,setConfirming]=useState(''),[resetting,setResetting]=useState(false);
  const logRef=useRef(null),textareaRef=useRef(null);
  const available=status?.available===true;
  const load=useCallback(async({signal}={})=>{
    setError('');setStatusLoading(true);setHistoryLoading(true);
    const statusRequest=api('/assistant/status',{signal}).then(setStatus);
    const historyRequest=api(`/assistant/history?scope=${scope}`,{signal}).then(data=>setItems(Array.isArray(data.items)?data.items:[]));
    const outcomes=await Promise.allSettled([statusRequest,historyRequest]);
    const failed=outcomes.find(result=>result.status==='rejected'&&result.reason?.name!=='AbortError');
    if(failed)setError(failed.reason?.message||'Не удалось загрузить ассистента.');
    if(!signal?.aborted){setStatusLoading(false);setHistoryLoading(false);}
  },[scope]);
  useEffect(()=>{const controller=new AbortController();load({signal:controller.signal});return()=>controller.abort();},[load]);
  useEffect(()=>{if(!logRef.current)return;logRef.current.scrollTop=logRef.current.scrollHeight;},[items,busy]);

  async function send(text=message){
    const content=text.trim();if(!content||content.length>MAX_MESSAGE||busy||!available||!shareContext)return;
    setBusy(true);setError('');
    try{const data=await api('/assistant/chat',{method:'POST',body:{message:content,scope,shareContext:true}});setItems(old=>[...old,{id:`local-${Date.now()}`,role:'user',content,createdAt:new Date().toISOString()},data.message].slice(-40));setMessage('');}
    catch(e){setError(e.message);}
    finally{setBusy(false);textareaRef.current?.focus();}
  }
  async function confirmProposal(id){
    if(!id||confirming)return;setConfirming(id);setError('');
    try{await api(`/assistant/proposals/${encodeURIComponent(id)}/confirm`,{method:'POST',body:{scope}});await onReloadTasks?.();const data=await api(`/assistant/history?scope=${scope}`);setItems(Array.isArray(data.items)?data.items:[]);}
    catch(e){setError(e.message);}
    finally{setConfirming('');}
  }
  async function resetHistory(){
    if(resetting||!window.confirm('Очистить историю диалога? Это действие нельзя отменить.'))return;
    setResetting(true);setError('');try{await api(`/assistant/history?scope=${scope}`,{method:'DELETE'});setItems([]);}catch(e){setError(e.message);}finally{setResetting(false);}
  }
  function submit(e){e.preventDefault();send();}
  function handleKeyDown(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}

  return <div className="assistant-page">
    <section className="assistant-chat panel" aria-label="Чат с ассистентом">
      <header className="assistant-chat-head"><div className="assistant-orb"><Sparkles size={19}/></div><div><h2>Твой учебный помощник</h2><p>{statusLoading?'Проверяем доступность…':available?'Помогу разобраться с планом и задачами':'Подключение сейчас недоступно'}</p></div><button type="button" className="assistant-reset" onClick={resetHistory} disabled={resetting||historyLoading||items.length===0} aria-label="Очистить историю диалога" title="Очистить историю">{resetting?<LoaderCircle size={17} className="assistant-spin"/>:<Trash2 size={17}/>}</button></header>
      {error&&<div className="assistant-error" role="alert"><span>{error}</span><button type="button" onClick={()=>load()}>Повторить</button></div>}
      {!statusLoading&&!available&&<div className="assistant-unavailable" role="status"><ShieldCheck size={20}/><div><strong>Ассистент пока недоступен</strong><p>Подключение нужно настроить на сервере. История и задачи остаются доступны.</p></div></div>}
      <div className="assistant-log" ref={logRef} role="log" aria-label="История сообщений" aria-live="polite" aria-relevant="additions text">
        {historyLoading?<div className="assistant-loading" role="status"><LoaderCircle className="assistant-spin" size={20}/>Загружаем историю…</div>:items.length?items.map(item=><Message key={item.id} item={item} onConfirm={confirmProposal} confirming={confirming}/>):available?<div className="assistant-welcome"><div className="assistant-welcome-mark"><MessageCircle size={22}/></div><h3>С чего начнём?</h3><p>Я могу помочь спланировать учебный день, увидеть сроки и превратить большой проект в понятные шаги.</p><div className="assistant-suggestions">{SUGGESTIONS.map(value=><button type="button" key={value} onClick={()=>{setMessage(value);textareaRef.current?.focus();}}>{value}<ArrowUpRight size={14}/></button>)}</div></div>:null}
        {busy&&<div className="assistant-thinking" role="status"><span/><span/><span/>Ассистент готовит ответ</div>}
      </div>
      <form className="assistant-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="assistant-message">Сообщение ассистенту</label><textarea id="assistant-message" ref={textareaRef} value={message} onChange={e=>setMessage(e.target.value.slice(0,MAX_MESSAGE))} onKeyDown={handleKeyDown} maxLength={MAX_MESSAGE} rows={2} placeholder={shareContext?'Напиши, чем помочь…':'Сначала включи передачу контекста ниже'} disabled={!available||busy} aria-describedby="assistant-consent-note"/>
        <div className="assistant-composer-bottom"><span>{message.length}/{MAX_MESSAGE} · Enter — отправить</span><button className="primary" type="submit" disabled={!available||busy||!shareContext||!message.trim()} aria-label="Отправить сообщение">{busy?<LoaderCircle size={17} className="assistant-spin"/>:<Send size={17}/>}<span>Отправить</span></button></div>
      </form>
    </section>
    <aside className="assistant-context panel" aria-label="Контекст и настройки передачи">
      <div className="assistant-context-title"><div className="assistant-context-icon"><ShieldCheck size={18}/></div><div><h2>Контекст</h2><p>Ты решаешь, чем делиться</p></div></div>
      <div className="assistant-context-data"><span>Учебная группа</span><strong>{settings?.groupTitle||'Не выбрана'}</strong><span>Активные задачи</span><strong>{tasks?.filter(task=>!task.done).length??0}</strong><span>Занятия в расписании</span><strong>{schedule?.days?.reduce((sum,day)=>sum+(day.lessons?.length||0),0)??0}</strong></div>
      <label className="assistant-consent"><input type="checkbox" checked={shareContext} onChange={e=>setShareContext(e.target.checked)}/><span><strong>Разрешить использовать контекст</strong><small>При отправке DeepSeek получит мои имя и группу, задачи, расписание, заметки и последние 12 сообщений истории. Сними галочку, чтобы не передавать эти данные.</small></span></label>
      <p className="assistant-consent-note" id="assistant-consent-note">История хранится здесь (до 40 сообщений) и очищается кнопкой с корзиной. Сообщение не отправится, пока согласие выключено.</p>
      <div className="assistant-context-foot"><Clock3 size={15}/><span>История сохраняется в аккаунте для выбранного пространства.</span></div>
    </aside>
  </div>;
}
