
(function(){
'use strict';
const API_BASE=String(window.RET_API_BASE||'').replace(/\/$/,'');
const backendBanner=document.getElementById('retBackendState');
function backendState(ok){
  if(!backendBanner)return;
  backendBanner.textContent=ok?'متصل به سرور':'سرور متصل نیست';
  backendBanner.classList.toggle('show',!ok);
}
const api=async(path,opt={})=>{
  if(!API_BASE){
    backendState(false);
    throw Object.assign(new Error('BACKEND_NOT_CONFIGURED'),{code:'BACKEND_NOT_CONFIGURED',status:0});
  }
  let r;
  try{
    r=await fetch(API_BASE+'/api'+path,{credentials:'include',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});
  }catch(e){
    backendState(false);
    throw Object.assign(e,{code:'NETWORK_ERROR',status:0});
  }
  backendState(true);
  let j={};try{j=await r.json()}catch{}
  if(!r.ok)throw Object.assign(new Error(j.error||'API_ERROR'),{code:j.error,status:r.status});
  return j;
};
let me=null,reservations=[],wallet={balance:0,asset:'USDT'},wheel={chances:0,lastPrize:null},refs=null,txs=[];

window.currentUser=()=>me;
window.loadUsers=()=>me?[me]:[];
window.saveUsers=()=>false;

function cloneById(id){
  const old=document.getElementById(id);if(!old)return null;
  const neu=old.cloneNode(true);old.replaceWith(neu);return neu;
}
function msg(id,text,bad=true){const e=document.getElementById(id);if(e){e.className='authMsg '+(bad?'bad':'good');e.textContent=text}}
function errText(e){
  return ({BACKEND_NOT_CONFIGURED:'آدرس سرور Backend هنوز در config.js تنظیم نشده است.',NETWORK_ERROR:'ارتباط با سرور برقرار نشد.',DUPLICATE:'نام کاربری، ایمیل، موبایل یا شماره مدرک قبلاً ثبت شده است.',BAD_LOGIN:'نام کاربری/ایمیل یا رمز عبور نادرست است.',
  BAD_REFERRER:'کد معرف معتبر نیست.',PASSWORD_SHORT:'رمز عبور باید حداقل ۸ کاراکتر باشد.',MIN_100:'حداقل برداشت 100 USDT است.',
  ADDRESS_REQUIRED:'آدرس کیف پول را وارد کنید.',INSUFFICIENT_BALANCE:'موجودی کافی نیست.',NO_CHANCE:'شانس گردونه ندارید.',
  MARKET_UNAVAILABLE:'اتصال بازار موقتاً در دسترس نیست.',ACTIVE_EXISTS:'یک رزرو فعال دارید.',ORDER:'رزروها باید به ترتیب انجام شوند.',COOLDOWN:'چرخه رزرو هنوز در قفل ۲۴ ساعته است.'}[e.code]||'خطایی در ارتباط با سرور رخ داد.');
}
async function refreshAll(){
  const calls=await Promise.allSettled([api('/wallet'),api('/reservations'),api('/wheel'),api('/referrals'),api('/transactions')]);
  if(calls[0].status==='fulfilled')wallet=calls[0].value.wallet;
  if(calls[1].status==='fulfilled')reservations=calls[1].value.items||[];
  if(calls[2].status==='fulfilled')wheel=calls[2].value;
  if(calls[3].status==='fulfilled')refs=calls[3].value;
  if(calls[4].status==='fulfilled')txs=calls[4].value.items||[];
  paintServerData();
}
function paintServerData(){
  const hb=document.getElementById('headerUser');if(hb&&me)hb.textContent='@'+me.username;
  const rc=document.getElementById('referralCodeUltra');if(rc&&me)rc.textContent='کد معرف: '+me.refCode;
  const wc=document.getElementById('wheelChanceCount');if(wc)wc.textContent=Number(wheel.chances||0).toLocaleString('fa-IR');
  const wl=document.getElementById('wheelLastPrize');if(wl)wl.textContent=wheel.lastPrize||'—';
  const refChance=document.getElementById('refChanceUltra');if(refChance)refChance.textContent=Number(wheel.chances||0).toLocaleString('fa-IR');
  if(refs){
    [['refG1Ultra',refs.g1?.length||0],['refG2Ultra',refs.g2?.length||0],['refG3Ultra',refs.g3?.length||0]].forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.textContent=Number(v).toLocaleString('fa-IR')});
    const field=document.getElementById('referralLinkUltra');if(field&&me){const u=new URL(location.origin+location.pathname);u.searchParams.set('ref',me.refCode);u.hash='register';field.value=u.toString()}
  }
  paintReservations();
  paintTransactions();
}
function paintReservations(){
  const completed=reservations.filter(x=>x.status==='completed');
  const active=reservations.find(x=>x.status==='active');
  const order=['BTC','ETH','SOL','BNB'];
  const cycle=completed.slice(-4); const next=order[cycle.length]||null;
  document.querySelectorAll('[data-reserve]').forEach(btn=>{
    const a=btn.dataset.reserve,done=cycle.find(x=>x.asset===a),act=active?.asset===a,isNext=!active&&!done&&a===next;
    btn.disabled=!isNext;
    btn.textContent=done?'رزرو تکمیل شد ✓':act?'رزرو در حال بررسی…':isNext?'شروع رزرو ۱۰ دقیقه‌ای':'ابتدا رزرو قبلی را تکمیل کنید';
  });
  const hist=document.getElementById('reservationHistory');
  if(hist)hist.innerHTML=completed.length?completed.slice().reverse().map(x=>`<div class="row"><span>${x.asset} — ۱۰ دقیقه</span><b class="${x.result==='موفق'?'good':'bad'}">${x.result||'—'}</b></div>`).join(''):'<div class="row"><span class="muted">هنوز رزروی ثبت نشده</span><span>—</span></div>';
}
function fmt(v){return Number(v||0).toLocaleString('en-US',{maximumFractionDigits:2})+' USDT'}
function paintTransactions(){
  const box=document.getElementById('txHistoryList');if(!box)return;
  if(!txs.length){box.innerHTML='<div class="txEmpty"><div class="txEmptyIcon">↕</div><b>تراکنشی ثبت نشده است</b></div>';return}
  box.innerHTML=txs.map(x=>`<div class="txRow" data-tx-detail='${JSON.stringify(x).replace(/'/g,"&#39;")}'>
    <div class="txType ${x.type}"><i>${x.type==='deposit'?'↑':'↓'}</i><span>${x.type==='deposit'?'واریز':'برداشت'}</span></div>
    <div class="txAmount">${fmt(x.amount)}</div><div class="txDate">${new Date(x.time).toLocaleString('fa-IR')}</div>
    <div class="txState ${x.status}">${x.status||'pending'}</div></div>`).join('');
}
async function bootstrap(){
  try{me=(await api('/me')).user}catch{me=null}
  if(me){
    document.getElementById('authGate')?.classList.add('hidden');
    document.getElementById('appShell')?.classList.remove('hidden');
    if(typeof route==='function')route();
    if(typeof loadMarket==='function')loadMarket();
    await refreshAll();
  }else{
    document.getElementById('authGate')?.classList.remove('hidden');
    document.getElementById('appShell')?.classList.add('hidden');
  }
}

/* Replace old local auth handlers */
const rf=cloneById('registerForm');
if(rf)rf.addEventListener('submit',async e=>{
  e.preventDefault();
  if(document.getElementById('password').value!==document.getElementById('password2').value)return msg('registerMsg','رمز عبور و تکرار آن یکسان نیست.');
  try{
    const j=await api('/auth/register',{method:'POST',body:JSON.stringify({
      firstName:document.getElementById('firstName').value,lastName:document.getElementById('lastName').value,
      phone:document.getElementById('phone').value,email:document.getElementById('email').value,
      docType:document.getElementById('docType').value,doc:document.getElementById('docNumber').value,
      username:document.getElementById('username').value,password:document.getElementById('password').value,
      referrer:document.getElementById('referrer').value
    })});me=j.user;enterApp();await refreshAll();
  }catch(e2){msg('registerMsg',errText(e2))}
});
const lf=cloneById('loginForm');
if(lf)lf.addEventListener('submit',async e=>{
  e.preventDefault();
  try{const j=await api('/auth/login',{method:'POST',body:JSON.stringify({id:document.getElementById('loginId').value,password:document.getElementById('loginPass').value})});me=j.user;enterApp();await refreshAll()}
  catch(e2){msg('loginMsg',errText(e2))}
});
const lo=cloneById('logoutBtn');
if(lo)lo.addEventListener('click',async()=>{try{await api('/auth/logout',{method:'POST'})}catch{} location.reload()});

/* Withdraw server-side. Address field is injected because server must know destination. */
const wa=document.getElementById('withdrawAmount');
if(wa && !document.getElementById('withdrawAddress')){
  const input=document.createElement('input');input.id='withdrawAddress';input.placeholder='آدرس کیف پول مقصد';input.autocomplete='off';
  input.style.cssText='width:100%;margin-top:10px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#07111c;color:#fff';
  wa.closest('.withdrawRequestCard')?.insertBefore(input,document.getElementById('withdrawBtn'));
}
const wb=cloneById('withdrawBtn');
if(wb)wb.addEventListener('click',async()=>{
  try{
    await api('/withdrawals',{method:'POST',body:JSON.stringify({amount:Number(document.getElementById('withdrawAmount').value),network:'TRC20',address:document.getElementById('withdrawAddress')?.value||''})});
    toast('درخواست برداشت روی سرور ثبت شد');await refreshAll();
  }catch(e){toast(errText(e))}
});

/* Reservation buttons */
document.querySelectorAll('[data-reserve]').forEach(old=>{
  const b=old.cloneNode(true);old.replaceWith(b);
  b.addEventListener('click',async()=>{try{await api('/reservations/start',{method:'POST',body:JSON.stringify({asset:b.dataset.reserve})});toast(`رزرو ${b.dataset.reserve} روی سرور شروع شد`);await refreshAll()}catch(e){toast(errText(e))}});
});

/* Wheel: outcome is generated by server */
const sw=cloneById('spinWheelBtn');
if(sw)sw.addEventListener('click',async()=>{
  if(window.__retServerWheelBusy)return;
  try{
    window.__retServerWheelBusy=true;sw.disabled=true;sw.textContent='در حال چرخش...';
    const j=await api('/wheel/spin',{method:'POST'});
    const prizes=['3 USDT','5 USDT','8 USDT','10 USDT','هندزفری بلوتوث','پاوربانک'];
    const idx=Math.max(0,prizes.indexOf(j.prize)),slice=60,target=360-(idx*slice+slice/2);
    const disc=document.getElementById('wheelDisc');if(disc)disc.style.transform=`rotate(${7*360+target}deg)`;
    setTimeout(async()=>{wheel={chances:j.chances,lastPrize:j.prize};paintServerData();document.getElementById('wheelResultBox').textContent=`جایزه این نوبت: ${j.prize}`;sw.disabled=false;sw.textContent='چرخاندن دوباره';window.__retServerWheelBusy=false},4900);
  }catch(e){toast(errText(e));sw.disabled=false;sw.textContent='چرخاندن گردونه';window.__retServerWheelBusy=false}
});

/* Profile password: server hash, no local user database */
const pb=cloneById('retChangePasswordBtn');
if(pb)pb.addEventListener('click',async()=>{
  const cur=document.getElementById('retCurrentPassword').value,n=document.getElementById('retNewPassword').value,n2=document.getElementById('retNewPassword2').value;
  const m=document.getElementById('retProfileMsg');if(n!==n2){m.textContent='تکرار رمز یکسان نیست.';m.className='retProfileMsg bad';return}
  try{await api('/me/password',{method:'POST',body:JSON.stringify({currentPassword:cur,newPassword:n})});m.textContent='رمز عبور با موفقیت تغییر کرد.';m.className='retProfileMsg good'}
  catch(e){m.textContent=errText(e);m.className='retProfileMsg bad'}
});

/* Server-backed notifications */
async function syncNotifications(){
  try{
    const j=await api('/notifications'),items=j.items||[],badge=document.getElementById('retNotifBadge'),list=document.getElementById('retNotifList');
    const unread=items.filter(x=>!x.is_read).length;if(badge){badge.textContent=unread>99?'99+':String(unread);badge.classList.toggle('show',unread>0)}
    if(list)list.innerHTML=items.length?items.map(n=>`<div class="retNotifItem ${n.is_read?'':'unread'}"><div class="retNotifBody"><b>${n.title}</b><p>${n.message}</p><small>${new Date(n.created_at).toLocaleString('fa-IR')}</small></div></div>`).join(''):'<div class="retNotifEmpty">هنوز اعلانی ندارید.</div>';
  }catch{}
}
document.getElementById('retNotifBell')?.addEventListener('click',syncNotifications,true);
const ra=cloneById('retNotifReadAll');if(ra)ra.addEventListener('click',async()=>{try{await api('/notifications/read-all',{method:'POST'});await syncNotifications()}catch{}});

setInterval(()=>{if(me)refreshAll().catch(()=>{})},30000);
bootstrap();
})();
