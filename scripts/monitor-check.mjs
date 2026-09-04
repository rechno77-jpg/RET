const base=String(process.env.SERVICE_URL||'').replace(/\/$/,'');
if(!base)throw new Error('SERVICE_URL is required');
let ok=false,message='';
try{
  const r=await fetch(base+'/api/health/deep',{signal:AbortSignal.timeout(15000)});
  const d=await r.json().catch(()=>({}));
  ok=r.ok&&d.ok===true&&d.database===true;
  message=ok?`RET healthy (${d.latencyMs}ms)`:`RET unhealthy HTTP ${r.status}`;
}catch(e){message='RET health check failed: '+e.message}
console.log(message);
if(!ok&&process.env.ALERT_WEBHOOK_URL){
  await fetch(process.env.ALERT_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:message,service:'RET',time:new Date().toISOString()})}).catch(()=>{});
}
if(!ok)process.exitCode=1;
