let csrf='';
export function setCsrf(value){csrf=value||'';}
export async function api(path,{method='GET',body,signal}={}) {
  let response;try{response=await fetch('/api'+path,{method,credentials:'same-origin',signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});}catch(e){if(e.name==='AbortError')throw e;throw new Error('Нет связи с сервером. Проверьте подключение и повторите действие.');}
  let data;try{data=await response.json();}catch{throw new Error('Сервер вернул некорректный ответ.');}
  if(!response.ok){const e=new Error(data.error||'Не удалось выполнить действие.');e.status=response.status;throw e;}return data;
}
export function downloadCalendar(lessons){
  const esc=v=>String(v).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const utc=(d,t)=>new Date(`${d}T${t}:00+03:00`).toISOString().replace(/[-:]/g,'').replace('.000','');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kupala Hub//Schedule//RU','CALSCALE:GREGORIAN'];
  for(const l of lessons)lines.push('BEGIN:VEVENT',`UID:${l.key}@kupalahub.local`,`DTSTAMP:${utc(l.date,l.start)}`,`DTSTART:${utc(l.date,l.start)}`,`DTEND:${utc(l.date,l.end)}`,`SUMMARY:${esc(l.title)}`,`LOCATION:${esc([l.address,l.room].filter(Boolean).join(', '))}`,`DESCRIPTION:${esc(l.teacher)}`,'END:VEVENT');
  lines.push('END:VCALENDAR');const url=URL.createObjectURL(new Blob([lines.join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='kupala-schedule.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
