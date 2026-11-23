import {spawn} from 'node:child_process';
try { process.loadEnvFile('.env'); } catch(e) { if(e.code!=='ENOENT')throw e; }
const python=process.env.PYTHON_BIN||(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
const child=spawn(python,['-m','uvicorn','ai_service.app:app','--host','127.0.0.1','--port','8001','--no-access-log'],{stdio:'inherit'});
child.on('error',()=>{console.error('Не удалось запустить Python: установите зависимости в .venv.');process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=signal?1:code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
