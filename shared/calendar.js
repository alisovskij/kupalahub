export function todayInMinsk(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Minsk', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function shiftDay(date, amount) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+amount); return d.toISOString().slice(0,10); }
export function weekStart(date) { return shiftDay(date, -((new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7)); }
export function weekDays(date) { const start=weekStart(date); return Array.from({length:7},(_,i)=>shiftDay(start,i)); }
export function minutes(time) { const [h,m]=time.split(':').map(Number); return h*60+m; }
export function minskMinutes(now = new Date()) { return minutes(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Minsk',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now)); }
export function selectLessons(lessons, subgroups = []) { return lessons.filter(l=>!l.subgroupId || l.subgroupId==='0' || !subgroups.length || subgroups.includes(l.subgroupId)); }
export function dayGaps(lessons) {
  const sorted=[...lessons].sort((a,b)=>minutes(a.start)-minutes(b.start)); const gaps=[]; let end=null;
  for(const l of sorted){ if(end!==null && minutes(l.start)-end>=30) gaps.push({start:`${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`,end:l.start,duration:minutes(l.start)-end}); end=Math.max(end??0,minutes(l.end)); } return gaps;
}
export function lessonStatus(l,date,now=new Date()) { if(date!==todayInMinsk(now)) return ''; const n=minskMinutes(now);return minutes(l.start)<=n && n<minutes(l.end)?'Сейчас':minutes(l.end)<=n?'Завершено':''; }
export function formatDate(date, options={day:'numeric',month:'long'}) { return new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`)); }
