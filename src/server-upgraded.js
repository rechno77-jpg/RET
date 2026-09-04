import express from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const app=express();
const APP_ORIGIN=process.env.APP_ORIGIN || 'http://localhost:3000';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const publicDir=path.join(__dirname,'..','public');
const PgSession=connectPgSimple(session);

app.set('trust proxy',1);
app.use(cors({
  origin:APP_ORIGIN,
  credentials:true,
  methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders:['Content-Type','Authorization','Idempotency-Key']
}));

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'64kb'}));
app.use(rateLimit({windowMs:60_000,limit:180,standardHeaders:true,legacyHeaders:false}));
const loginLimiter=rateLimit({windowMs:15*60_000,limit:8,standardHeaders:true,legacyHeaders:false,message:{error:'TOO_MANY_LOGIN_ATTEMPTS'}});
const resetLimiter=rateLimit({windowMs:30*60_000,limit:5,standardHeaders:true,legacyHeaders:false,message:{error:'TOO_MANY_REQUESTS'}});
app.use(session({
  store:new PgSession({pool,tableName:'session'}),
  secret:process.env.SESSION_SECRET || 'development-only-change-me',
  name:'ret.sid',resave:false,saveUninitialized:false,rolling:true,
  cookie:{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:process.env.SESSION_SAMESITE||'lax',maxAge:7*24*60*60*1000}
}));
app.use(express.static(publicDir,{extensions:['html']}));

app.disable('x-powered-by');

const norm=s=>String(s||'').trim().toLowerCase();
const sha256=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const cleanIp=req=>String(req.headers['cf-connecting-ip']||req.headers['x-forwarded-for']||req.ip||'').split(',')[0].trim().slice(0,120);
function clientMeta(req){
  const ua=String(req.get('user-agent')||'').slice(0,500);
  let browser='مرورگر',os='نامشخص',device='دستگاه';
  if(/Edg\//i.test(ua))browser='Edge'; else if(/Chrome\//i.test(ua))browser='Chrome'; else if(/Firefox\//i.test(ua))browser='Firefox'; else if(/Safari\//i.test(ua))browser='Safari';
  if(/Android/i.test(ua))os='Android'; else if(/iPhone|iPad/i.test(ua))os='iOS/iPadOS'; else if(/Windows/i.test(ua))os='Windows'; else if(/Mac OS/i.test(ua))os='macOS'; else if(/Linux/i.test(ua))os='Linux';
  device=/Mobile|Android|iPhone/i.test(ua)?'موبایل':/iPad|Tablet/i.test(ua)?'تبلت':'رایانه';
  return {ip:cleanIp(req),ua,browser,os,device};
}
async function one(q,p=[]){const r=await pool.query(q,p);return r.rows[0]||null}
async function audit(req,action,targetType=null,targetId=null,details={}){
  try{await pool.query(`INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,ip,user_agent,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[req.session?.userId||null,action,targetType,targetId,cleanIp(req),String(req.get('user-agent')||'').slice(0,500),JSON.stringify(details||{})])}catch(e){console.error('audit',e.message)}
}
async function recordLogin(req,userId,success,reason){
  const m=clientMeta(req);try{await pool.query(`INSERT INTO login_history(user_id,identifier,success,reason,ip,user_agent,device,browser,os) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[userId||null,norm(req.body?.id||req.body?.email||'').slice(0,160),!!success,String(reason||'').slice(0,120),m.ip,m.ua,m.device,m.browser,m.os])}catch(e){console.error('login-history',e.message)}
}
async function trackSession(req,userId){
  if(!req.sessionID||!userId)return;const m=clientMeta(req);const expiresAt=new Date(Date.now()+(req.session.cookie?.maxAge||7*86400000));
  try{await pool.query(`INSERT INTO user_sessions(session_id,user_id,ip,user_agent,device,browser,os,last_seen_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8) ON CONFLICT(session_id) DO UPDATE SET ip=excluded.ip,user_agent=excluded.user_agent,device=excluded.device,browser=excluded.browser,os=excluded.os,last_seen_at=now(),expires_at=excluded.expires_at`,[req.sessionID,userId,m.ip,m.ua,m.device,m.browser,m.os,expiresAt])}catch(e){console.error('session-track',e.message)}
}
const auth=async(req,res,next)=>{
  if(!req.session?.userId)return res.status(401).json({error:'AUTH_REQUIRED'});
  try{const u=await one('SELECT id,account_status FROM users WHERE id=$1',[req.session.userId]);if(!u||u.account_status!=='active'){return req.session.destroy(()=>res.status(403).json({error:u?'ACCOUNT_SUSPENDED':'AUTH_REQUIRED'}))}await trackSession(req,u.id);next()}catch(e){next(e)}
};
const admin=async(req,res,next)=>{try{const u=await one('SELECT id,role FROM users WHERE id=$1',[req.session.userId]);if(!u||u.role!=='admin')return res.status(403).json({error:'ADMIN_REQUIRED'});next()}catch(e){next(e)}};
const publicUser=r=>({
  id:r.id,firstName:r.first_name,lastName:r.last_name,phone:r.phone,email:r.email,
  docType:r.doc_type,doc:r.doc_number,username:r.username,refCode:r.ref_code,
  accountStatus:r.account_status,createdAt:r.created_at,twoFactorEnabled:!!r.two_factor_enabled
});

const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf){let bits=0,val=0,out='';for(const b of buf){val=(val<<8)|b;bits+=8;while(bits>=5){out+=B32[(val>>>(bits-5))&31];bits-=5}}if(bits>0)out+=B32[(val<<(5-bits))&31];return out}
function b32dec(s){s=String(s||'').toUpperCase().replace(/[^A-Z2-7]/g,'');let bits=0,val=0,arr=[];for(const c of s){val=(val<<5)|B32.indexOf(c);bits+=5;if(bits>=8){arr.push((val>>>(bits-8))&255);bits-=8}}return Buffer.from(arr)}
function totp(secret,step=Math.floor(Date.now()/30000)){const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(step));const h=crypto.createHmac('sha1',b32dec(secret)).update(b).digest();const o=h[h.length-1]&15;return String(((h.readUInt32BE(o)&0x7fffffff)%1000000)).padStart(6,'0')}
function verifyTotp(secret,code){code=String(code||'').replace(/\D/g,'');if(code.length!==6)return false;const t=Math.floor(Date.now()/30000);return [-1,0,1].some(d=>crypto.timingSafeEqual(Buffer.from(totp(secret,t+d)),Buffer.from(code)))}
function secretKey(){return crypto.createHash('sha256').update(String(process.env.TWO_FACTOR_SECRET||process.env.SESSION_SECRET||'')).digest()}
function encSecret(s){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',secretKey(),iv);const ct=Buffer.concat([c.update(s,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),ct]).toString('base64')}
function decSecret(s){const b=Buffer.from(String(s),'base64'),iv=b.subarray(0,12),tag=b.subarray(12,28),ct=b.subarray(28);const d=crypto.createDecipheriv('aes-256-gcm',secretKey(),iv);d.setAuthTag(tag);return Buffer.concat([d.update(ct),d.final()]).toString('utf8')}
async function sendResetEmail(email,token){
  if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM)return false;
  const base=String(process.env.APP_ORIGIN||APP_ORIGIN).replace(/\/$/,'');const url=`${base}/?reset=${encodeURIComponent(token)}`;
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM,to:[email],subject:'بازیابی رمز عبور RET',html:`<div dir="rtl" style="font-family:sans-serif"><h2>بازیابی رمز عبور RET</h2><p>این لینک فقط ۳۰ دقیقه معتبر است.</p><p><a href="${url}">تنظیم رمز عبور جدید</a></p><p>اگر شما این درخواست را نداده‌اید، این پیام را نادیده بگیرید.</p></div>`})});
  return r.ok;
}
async function notify(userId,type,title,message){
  await pool.query('INSERT INTO notifications(user_id,type,title,message) VALUES($1,$2,$3,$4)',[userId,type,title,message]);
}
function refCode(){return 'RET'+crypto.randomBytes(5).toString('hex').slice(0,8).toUpperCase()}
async function marketPrice(asset){
  const ids={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',BNB:'binancecoin'};
  const id=ids[asset]; if(!id)return null;
  try{
    const r=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,{signal:AbortSignal.timeout(6000)});
    if(!r.ok)return null;
    const j=await r.json(); const n=Number(j?.[id]?.usd); return Number.isFinite(n)?n:null;
  }catch{return null}
}

/*
  12% monthly simple return, accrued once per completed UTC day.
  Daily rate = monthly_rate / 30.
  Profit is credited to wallet and is NOT added to principal, so there is no daily compounding.
*/
async function accrueDailyProfit(userId){
  const c=await pool.connect();
  try{
    await c.query('BEGIN');

    const investments=(await c.query(
      `SELECT * FROM investments
       WHERE user_id=$1 AND status='active'
       FOR UPDATE`,
      [userId]
    )).rows;

    let totalProfit=0;

    for(const inv of investments){
      const now=new Date();
      const last=new Date(inv.last_profit_at);

      const nowDay=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
      const lastDay=Date.UTC(last.getUTCFullYear(),last.getUTCMonth(),last.getUTCDate());
      const days=Math.floor((nowDay-lastDay)/86400000);

      if(days<=0)continue;

      const principal=Number(inv.principal);
      const monthlyRate=Number(inv.monthly_rate);
      const profit=+(principal*(monthlyRate/30)*days).toFixed(8);

      if(profit>0){
        await c.query(
          'UPDATE wallets SET balance=balance+$1,updated_at=now() WHERE user_id=$2',
          [profit,userId]
        );

        await c.query(
          `INSERT INTO wallet_ledger(user_id,type,amount,reference_id,description)
           VALUES($1,'daily_profit',$2,$3,$4)`,
          [userId,profit,inv.id,`سود ${days} روز با نرخ ماهانه ${(monthlyRate*100).toFixed(2)}٪`]
        );

        totalProfit+=profit;
      }

      await c.query(
        `UPDATE investments
         SET last_profit_at=date_trunc('day',now())
         WHERE id=$1`,
        [inv.id]
      );
    }

    await c.query('COMMIT');
    return +totalProfit.toFixed(8);
  }catch(e){
    await c.query('ROLLBACK');
    throw e;
  }finally{
    c.release();
  }
}

app.get('/api/health',(_,res)=>res.json({ok:true,service:'RET',time:new Date().toISOString()}));
app.get('/api/health/deep',async(req,res)=>{const started=Date.now();try{await pool.query('SELECT 1');res.json({ok:true,database:true,latencyMs:Date.now()-started,time:new Date().toISOString()})}catch(e){res.status(503).json({ok:false,database:false,error:'DB_UNAVAILABLE'})}});

app.post('/api/auth/register',async(req,res)=>{
  const {firstName,lastName,phone,email,docType,doc,username,password,referrer}=req.body||{};
  if(!firstName||!lastName||!phone||!email||!docType||!doc||!username||!password) return res.status(400).json({error:'REQUIRED'});
  if(String(password).length<8)return res.status(400).json({error:'PASSWORD_SHORT'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let referrerUserId=null;
    if(referrer){
      const rr=await client.query('SELECT id FROM users WHERE ref_code=$1',[String(referrer).trim().toUpperCase()]);
      referrerUserId=rr.rows[0]?.id||null;
      if(!referrerUserId){await client.query('ROLLBACK');return res.status(400).json({error:'BAD_REFERRER'})}
    }
    const hash=await bcrypt.hash(String(password),12);
    let code=refCode();
    while((await client.query('SELECT 1 FROM users WHERE ref_code=$1',[code])).rowCount)code=refCode();
    const r=await client.query(`INSERT INTO users(first_name,last_name,phone,email,doc_type,doc_number,username,password_hash,ref_code,referrer_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [String(firstName).trim(),String(lastName).trim(),String(phone).trim(),norm(email),String(docType),norm(doc).replace(/\s+/g,''),norm(username).replace(/^@/,''),hash,code,referrerUserId]);
    const u=r.rows[0];
    await client.query('INSERT INTO wallets(user_id) VALUES($1)',[u.id]);
    await client.query('INSERT INTO wheel_state(user_id) VALUES($1)',[u.id]);
    if(referrerUserId) await client.query(`INSERT INTO notifications(user_id,type,title,message) VALUES($1,'referral','دعوت موفق','یک کاربر جدید با کد دعوت شما ثبت‌نام کرد.')`,[referrerUserId]);
    await client.query('COMMIT');
    req.session.userId=u.id;
    res.json({user:publicUser(u)});
  }catch(e){
    await client.query('ROLLBACK');
    if(e.code==='23505')return res.status(409).json({error:'DUPLICATE'});
    console.error(e);res.status(500).json({error:'SERVER'});
  }finally{client.release()}
});

app.post('/api/auth/login',loginLimiter,async(req,res)=>{
  const id=norm(req.body?.id).replace(/^@/,''); const password=String(req.body?.password||'');
  const u=await one('SELECT * FROM users WHERE username=$1 OR email=$1',[id]);
  const ok=!!u && await bcrypt.compare(password,u.password_hash);
  if(!ok){await recordLogin(req,u?.id,false,'BAD_CREDENTIALS');return res.status(401).json({error:'BAD_LOGIN'})}
  if(u.account_status!=='active'){await recordLogin(req,u.id,false,'ACCOUNT_SUSPENDED');return res.status(403).json({error:'ACCOUNT_SUSPENDED'})}
  if(u.two_factor_enabled){req.session.pending2faUserId=u.id;req.session.pending2faAt=Date.now();await recordLogin(req,u.id,true,'PASSWORD_OK_2FA_PENDING');return res.json({twoFactorRequired:true})}
  req.session.userId=u.id;delete req.session.pending2faUserId;await trackSession(req,u.id);await recordLogin(req,u.id,true,'LOGIN_OK');await notify(u.id,'security','ورود جدید','ورود جدیدی به حساب شما ثبت شد.');res.json({user:publicUser(u)});
});
app.post('/api/auth/2fa',loginLimiter,async(req,res)=>{
  const uid=req.session?.pending2faUserId;if(!uid||Date.now()-Number(req.session.pending2faAt||0)>5*60_000)return res.status(401).json({error:'TWO_FACTOR_EXPIRED'});
  const u=await one('SELECT * FROM users WHERE id=$1',[uid]);if(!u?.two_factor_enabled||!u.two_factor_secret_enc)return res.status(400).json({error:'TWO_FACTOR_NOT_ENABLED'});
  let valid=false;try{valid=verifyTotp(decSecret(u.two_factor_secret_enc),req.body?.code)}catch{}
  if(!valid){await recordLogin(req,u.id,false,'BAD_2FA');return res.status(401).json({error:'BAD_2FA'})}
  req.session.userId=u.id;delete req.session.pending2faUserId;delete req.session.pending2faAt;await trackSession(req,u.id);await recordLogin(req,u.id,true,'LOGIN_2FA_OK');await notify(u.id,'security','ورود دومرحله‌ای','ورود موفق با تأیید دومرحله‌ای ثبت شد.');res.json({user:publicUser(u)});
});
app.post('/api/auth/password-reset/start',resetLimiter,async(req,res)=>{const email=norm(req.body?.email);const u=await one('SELECT id,email FROM users WHERE email=$1',[email]);if(u){const token=crypto.randomBytes(32).toString('hex');await pool.query('DELETE FROM password_reset_tokens WHERE user_id=$1 OR expires_at<now()',[u.id]);await pool.query(`INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes')`,[u.id,sha256(token)]);try{await sendResetEmail(u.email,token)}catch(e){console.error('reset-mail',e.message)}}res.json({ok:true})});
app.post('/api/auth/password-reset/complete',resetLimiter,async(req,res)=>{const token=String(req.body?.token||''),password=String(req.body?.password||'');if(password.length<8)return res.status(400).json({error:'PASSWORD_SHORT'});const row=await one(`SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()`,[sha256(token)]);if(!row)return res.status(400).json({error:'RESET_TOKEN_INVALID'});const hash=await bcrypt.hash(password,12);const c=await pool.connect();try{await c.query('BEGIN');await c.query('UPDATE users SET password_hash=$1,password_changed_at=now() WHERE id=$2',[hash,row.user_id]);await c.query('UPDATE password_reset_tokens SET used_at=now() WHERE id=$1',[row.id]);const sessions=(await c.query('SELECT session_id FROM user_sessions WHERE user_id=$1',[row.user_id])).rows;for(const s of sessions)await c.query('DELETE FROM "session" WHERE sid=$1',[s.session_id]);await c.query('DELETE FROM user_sessions WHERE user_id=$1',[row.user_id]);await c.query('COMMIT');await notify(row.user_id,'security','رمز عبور تغییر کرد','رمز عبور حساب شما از طریق بازیابی تغییر کرد.');res.json({ok:true})}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}});
app.post('/api/auth/logout',auth,async(req,res)=>{try{await pool.query('DELETE FROM user_sessions WHERE session_id=$1',[req.sessionID])}catch{}req.session.destroy(()=>res.json({ok:true}))});

app.get('/api/me',auth,async(req,res)=>{
  const u=await one('SELECT * FROM users WHERE id=$1',[req.session.userId]);
  if(!u)return res.status(401).json({error:'AUTH_REQUIRED'});
  res.json({user:publicUser(u)});
});
app.post('/api/me/password',auth,async(req,res)=>{
  const {currentPassword,newPassword}=req.body||{};
  if(String(newPassword||'').length<8)return res.status(400).json({error:'PASSWORD_SHORT'});
  const u=await one('SELECT password_hash FROM users WHERE id=$1',[req.session.userId]);
  if(!u || !(await bcrypt.compare(String(currentPassword||''),u.password_hash)))return res.status(400).json({error:'BAD_CURRENT_PASSWORD'});
  const hash=await bcrypt.hash(String(newPassword),12);
  await pool.query('UPDATE users SET password_hash=$1,password_changed_at=now() WHERE id=$2',[hash,req.session.userId]);
  await audit(req,'PASSWORD_CHANGED','user',req.session.userId);res.json({ok:true});
});
app.get('/api/security/session',auth,async(req,res)=>{const m=clientMeta(req);res.json({session:{sessionId:String(req.sessionID).slice(0,12)+'…',device:m.device,browser:m.browser,os:m.os,ip:m.ip,expiresAt:req.session.cookie?.expires||new Date(Date.now()+(req.session.cookie?.maxAge||0))}})});
app.get('/api/security/overview',auth,async(req,res)=>{const sessions=(await pool.query(`SELECT id,session_id,device,browser,os,ip,last_seen_at,expires_at FROM user_sessions WHERE user_id=$1 AND expires_at>now() ORDER BY last_seen_at DESC LIMIT 20`,[req.session.userId])).rows.map(s=>({id:s.id,device:s.device,browser:s.browser,os:s.os,ip:s.ip,lastSeenAt:s.last_seen_at,expiresAt:s.expires_at,current:s.session_id===req.sessionID}));const history=(await pool.query(`SELECT success,reason,ip,device,browser,os,created_at FROM login_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,[req.session.userId])).rows.map(h=>({...h,createdAt:h.created_at}));res.json({sessions,history})});
app.post('/api/security/logout-others',auth,async(req,res)=>{const rows=(await pool.query('SELECT session_id FROM user_sessions WHERE user_id=$1 AND session_id<>$2',[req.session.userId,req.sessionID])).rows;for(const r of rows)await pool.query('DELETE FROM "session" WHERE sid=$1',[r.session_id]);await pool.query('DELETE FROM user_sessions WHERE user_id=$1 AND session_id<>$2',[req.session.userId,req.sessionID]);await audit(req,'LOGOUT_OTHER_SESSIONS','user',req.session.userId,{count:rows.length});res.json({ok:true,count:rows.length})});
app.delete('/api/security/sessions/:id',auth,async(req,res)=>{const s=await one('SELECT * FROM user_sessions WHERE id=$1 AND user_id=$2',[req.params.id,req.session.userId]);if(!s)return res.status(404).json({error:'NOT_FOUND'});if(s.session_id===req.sessionID)return res.status(400).json({error:'CURRENT_SESSION'});await pool.query('DELETE FROM "session" WHERE sid=$1',[s.session_id]);await pool.query('DELETE FROM user_sessions WHERE id=$1',[s.id]);await audit(req,'SESSION_REVOKED','session',String(s.id));res.json({ok:true})});
app.get('/api/security/2fa',auth,async(req,res)=>{const u=await one('SELECT two_factor_enabled FROM users WHERE id=$1',[req.session.userId]);res.json({enabled:!!u?.two_factor_enabled})});
app.post('/api/security/2fa/setup',auth,async(req,res)=>{const u=await one('SELECT username,email FROM users WHERE id=$1',[req.session.userId]);const secret=b32enc(crypto.randomBytes(20));req.session.twoFactorSetup=encSecret(secret);req.session.twoFactorSetupAt=Date.now();res.json({secret,otpauth:`otpauth://totp/RET:${encodeURIComponent(u.email||u.username)}?secret=${secret}&issuer=RET&digits=6&period=30`})});
app.post('/api/security/2fa/enable',auth,async(req,res)=>{if(!req.session.twoFactorSetup||Date.now()-Number(req.session.twoFactorSetupAt||0)>10*60_000)return res.status(400).json({error:'TWO_FACTOR_SETUP_EXPIRED'});const secret=decSecret(req.session.twoFactorSetup);if(!verifyTotp(secret,req.body?.code))return res.status(400).json({error:'BAD_2FA'});await pool.query('UPDATE users SET two_factor_enabled=true,two_factor_secret_enc=$1 WHERE id=$2',[encSecret(secret),req.session.userId]);delete req.session.twoFactorSetup;delete req.session.twoFactorSetupAt;await audit(req,'TWO_FACTOR_ENABLED','user',req.session.userId);res.json({ok:true})});
app.post('/api/security/2fa/disable',auth,async(req,res)=>{const u=await one('SELECT password_hash,two_factor_secret_enc FROM users WHERE id=$1',[req.session.userId]);if(!u||!(await bcrypt.compare(String(req.body?.password||''),u.password_hash)))return res.status(400).json({error:'BAD_CURRENT_PASSWORD'});if(u.two_factor_secret_enc&&!verifyTotp(decSecret(u.two_factor_secret_enc),req.body?.code))return res.status(400).json({error:'BAD_2FA'});await pool.query('UPDATE users SET two_factor_enabled=false,two_factor_secret_enc=NULL WHERE id=$1',[req.session.userId]);await audit(req,'TWO_FACTOR_DISABLED','user',req.session.userId);res.json({ok:true})});

app.get('/api/wallet',auth,async(req,res)=>{
  await accrueDailyProfit(req.session.userId);
  const w=await one('SELECT asset,balance,updated_at FROM wallets WHERE user_id=$1',[req.session.userId]);
  res.json({wallet:{asset:w?.asset||'USDT',balance:Number(w?.balance||0),updatedAt:w?.updated_at}});
});

app.get('/api/wallet/ledger',auth,async(req,res)=>{
  const rows=(await pool.query(
    `SELECT id,type,amount,reference_id,description,created_at
     FROM wallet_ledger WHERE user_id=$1
     ORDER BY created_at DESC LIMIT 200`,
    [req.session.userId]
  )).rows;
  res.json({items:rows});
});

app.get('/api/investments',auth,async(req,res)=>{
  await accrueDailyProfit(req.session.userId);
  const rows=(await pool.query(
    `SELECT id,principal,monthly_rate,started_at,last_profit_at,status,closed_at
     FROM investments WHERE user_id=$1 ORDER BY started_at DESC`,
    [req.session.userId]
  )).rows;
  res.json({items:rows});
});

app.post('/api/investments/start',auth,async(req,res)=>{
  const amount=Number(req.body?.amount);
  if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'BAD_AMOUNT'});

  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const wr=await c.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE',[req.session.userId]);
    const bal=Number(wr.rows[0]?.balance||0);
    if(bal<amount){await c.query('ROLLBACK');return res.status(400).json({error:'INSUFFICIENT_BALANCE'})}

    await c.query('UPDATE wallets SET balance=balance-$1,updated_at=now() WHERE user_id=$2',[amount,req.session.userId]);

    const r=await c.query(
      `INSERT INTO investments(user_id,principal,monthly_rate)
       VALUES($1,$2,0.12) RETURNING *`,
      [req.session.userId,amount]
    );

    await c.query(
      `INSERT INTO wallet_ledger(user_id,type,amount,reference_id,description)
       VALUES($1,'investment_start',$2,$3,'انتقال موجودی به سرمایه‌گذاری')`,
      [req.session.userId,-amount,r.rows[0].id]
    );

    await c.query('COMMIT');
    res.json({investment:r.rows[0]});
  }catch(e){
    await c.query('ROLLBACK');
    console.error(e);
    res.status(500).json({error:'SERVER'});
  }finally{c.release()}
});

app.post('/api/investments/:id/close',auth,async(req,res)=>{
  await accrueDailyProfit(req.session.userId);

  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const r=await c.query(
      `SELECT * FROM investments
       WHERE id=$1 AND user_id=$2 AND status='active'
       FOR UPDATE`,
      [req.params.id,req.session.userId]
    );
    const inv=r.rows[0];
    if(!inv){await c.query('ROLLBACK');return res.status(404).json({error:'NOT_FOUND'})}

    const principal=Number(inv.principal);

    await c.query(
      `UPDATE investments SET status='closed',closed_at=now() WHERE id=$1`,
      [inv.id]
    );
    await c.query(
      'UPDATE wallets SET balance=balance+$1,updated_at=now() WHERE user_id=$2',
      [principal,req.session.userId]
    );
    await c.query(
      `INSERT INTO wallet_ledger(user_id,type,amount,reference_id,description)
       VALUES($1,'investment_close',$2,$3,'بازگشت اصل سرمایه به کیف پول')`,
      [req.session.userId,principal,inv.id]
    );

    await c.query('COMMIT');
    res.json({ok:true,returnedPrincipal:principal});
  }catch(e){
    await c.query('ROLLBACK');
    console.error(e);
    res.status(500).json({error:'SERVER'});
  }finally{c.release()}
});

app.get('/api/transactions',auth,async(req,res)=>{
  await accrueDailyProfit(req.session.userId);
  const [d,w]=await Promise.all([
    pool.query(`SELECT id,'deposit' type,amount,network,txid,status,created_at time FROM deposits WHERE user_id=$1`,[req.session.userId]),
    pool.query(`SELECT id,'withdraw' type,amount,network,txid,status,created_at time,fee,net FROM withdrawals WHERE user_id=$1`,[req.session.userId])
  ]);
  res.json({items:[...d.rows,...w.rows].sort((a,b)=>new Date(b.time)-new Date(a.time))});
});

app.post('/api/withdrawals',auth,async(req,res)=>{
  await accrueDailyProfit(req.session.userId);
  const amount=Number(req.body?.amount),network=String(req.body?.network||'TRC20').trim(),address=String(req.body?.address||'').trim();
  if(!Number.isFinite(amount)||amount<100)return res.status(400).json({error:'MIN_100'});
  if(!address)return res.status(400).json({error:'ADDRESS_REQUIRED'});
  const fee=+(amount*.05).toFixed(8),net=+(amount-fee).toFixed(8);
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const wr=await c.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE',[req.session.userId]);
    const bal=Number(wr.rows[0]?.balance||0);
    if(bal<amount){await c.query('ROLLBACK');return res.status(400).json({error:'INSUFFICIENT_BALANCE'})}
    await c.query('UPDATE wallets SET balance=balance-$1,updated_at=now() WHERE user_id=$2',[amount,req.session.userId]);
    const r=await c.query(`INSERT INTO withdrawals(user_id,amount,fee,net,network,address) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.session.userId,amount,fee,net,network,address]);
    await c.query(
      `INSERT INTO wallet_ledger(user_id,type,amount,reference_id,description)
       VALUES($1,'withdrawal',$2,$3,$4)`,
      [req.session.userId,-amount,r.rows[0].id,`برداشت؛ کارمزد ۵٪ = ${fee} USDT`]
    );
    await c.query(`INSERT INTO notifications(user_id,type,title,message) VALUES($1,'withdraw','درخواست برداشت','درخواست برداشت شما ثبت شد.')`,[req.session.userId]);
    await c.query('COMMIT');
    res.json({withdrawal:r.rows[0]});
  }catch(e){await c.query('ROLLBACK');console.error(e);res.status(500).json({error:'SERVER'})}finally{c.release()}
});

app.get('/api/referrals',auth,async(req,res)=>{
  const me=await one('SELECT ref_code FROM users WHERE id=$1',[req.session.userId]);
  const g1=(await pool.query('SELECT id,username,ref_code,created_at FROM users WHERE referrer_user_id=$1 ORDER BY created_at DESC',[req.session.userId])).rows;
  const g1ids=g1.map(x=>x.id);
  let g2=[],g3=[];
  if(g1ids.length)g2=(await pool.query('SELECT id,username,ref_code,created_at,referrer_user_id FROM users WHERE referrer_user_id=ANY($1::uuid[])',[g1ids])).rows;
  const g2ids=g2.map(x=>x.id);
  if(g2ids.length)g3=(await pool.query('SELECT id,username,ref_code,created_at,referrer_user_id FROM users WHERE referrer_user_id=ANY($1::uuid[])',[g2ids])).rows;
  res.json({refCode:me.ref_code,g1,g2,g3});
});

app.get('/api/reservations',auth,async(req,res)=>{
  const rows=(await pool.query('SELECT * FROM reservations WHERE user_id=$1 ORDER BY started_at ASC',[req.session.userId])).rows;
  const active=rows.find(x=>x.status==='active');
  if(active && new Date(active.ends_at)<=new Date()){
    const p=await marketPrice(active.asset);
    if(p!==null && active.start_price!==null){
      const result=p>=Number(active.start_price)?'موفق':'سوخته';
      await pool.query(`UPDATE reservations SET end_price=$1,result=$2,status='completed' WHERE id=$3`,[p,result,active.id]);
      await notify(req.session.userId,'reservation','نتیجه رزرو',`نتیجه رزرو ${active.asset}: ${result}`);
    }
  }
  const fresh=(await pool.query('SELECT * FROM reservations WHERE user_id=$1 ORDER BY started_at ASC',[req.session.userId])).rows;
  res.json({items:fresh});
});

app.post('/api/reservations/start',auth,async(req,res)=>{
  const asset=String(req.body?.asset||'').toUpperCase();
  const order=['BTC','ETH','SOL','BNB'];
  if(!order.includes(asset))return res.status(400).json({error:'BAD_ASSET'});
  const rows=(await pool.query(`SELECT * FROM reservations WHERE user_id=$1 AND started_at > now()-interval '48 hours' ORDER BY started_at ASC`,[req.session.userId])).rows;
  if(rows.some(x=>x.status==='active'))return res.status(409).json({error:'ACTIVE_EXISTS'});
  const completed=rows.filter(x=>x.status==='completed').slice(-4);
  if(completed.length===4){
    const last=new Date(completed[3].started_at).getTime();
    if(Date.now()-last<24*60*60*1000)return res.status(429).json({error:'COOLDOWN'});
  }
  const cycle=completed.length===4?[]:completed;
  const expected=order[cycle.length];
  if(asset!==expected)return res.status(409).json({error:'ORDER'});
  const price=await marketPrice(asset);
  if(price===null)return res.status(503).json({error:'MARKET_UNAVAILABLE'});
  const r=await pool.query(`INSERT INTO reservations(user_id,asset,ends_at,start_price) VALUES($1,$2,now()+interval '10 minutes',$3) RETURNING *`,
    [req.session.userId,asset,price]);
  res.json({reservation:r.rows[0]});
});

app.get('/api/wheel',auth,async(req,res)=>{
  const s=await one('SELECT chances,last_prize FROM wheel_state WHERE user_id=$1',[req.session.userId]);
  res.json({chances:Number(s?.chances||0),lastPrize:s?.last_prize||null});
});
app.post('/api/wheel/spin',auth,async(req,res)=>{
  const prizes=[['3 USDT',50],['5 USDT',10],['8 USDT',10],['10 USDT',10],['هندزفری بلوتوث',10],['پاوربانک',10]];
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const s=await c.query('SELECT chances FROM wheel_state WHERE user_id=$1 FOR UPDATE',[req.session.userId]);
    const chances=Number(s.rows[0]?.chances||0);
    if(chances<=0){await c.query('ROLLBACK');return res.status(400).json({error:'NO_CHANCE'})}
    const n=crypto.randomInt(100); let acc=0,prize=prizes[0][0];
    for(const [p,w] of prizes){acc+=w;if(n<acc){prize=p;break}}
    await c.query('UPDATE wheel_state SET chances=chances-1,last_prize=$1,updated_at=now() WHERE user_id=$2',[prize,req.session.userId]);
    await c.query('INSERT INTO wheel_spins(user_id,prize) VALUES($1,$2)',[req.session.userId,prize]);
    await c.query('COMMIT');
    res.json({prize,chances:chances-1});
  }catch(e){await c.query('ROLLBACK');console.error(e);res.status(500).json({error:'SERVER'})}finally{c.release()}
});


// --- Professional admin dashboard API (additive; existing user routes stay unchanged) ---
app.get('/api/admin/me',auth,admin,async(req,res)=>{const u=await one('SELECT id,username,email,role FROM users WHERE id=$1',[req.session.userId]);res.json({admin:u})});
app.get('/api/admin/stats',auth,admin,async(req,res)=>{const q=async sql=>Number((await one(sql))?.n||0);const stats={users:await q('SELECT count(*) n FROM users'),activeUsers:await q("SELECT count(*) n FROM users WHERE account_status='active'"),walletBalance:await q('SELECT coalesce(sum(balance),0) n FROM wallets'),activeCapital:await q("SELECT coalesce(sum(principal),0) n FROM investments WHERE status='active'"),depositsPending:await q("SELECT count(*) n FROM deposits WHERE status='pending'"),depositsApprovedAmount:await q("SELECT coalesce(sum(amount),0) n FROM deposits WHERE status='approved'"),withdrawalsPending:await q("SELECT count(*) n FROM withdrawals WHERE status='pending'"),withdrawalsApprovedAmount:await q("SELECT coalesce(sum(amount),0) n FROM withdrawals WHERE status='approved'"),activeReservations:await q("SELECT count(*) n FROM reservations WHERE status='active'"),totalProfit:await q("SELECT coalesce(sum(amount),0) n FROM wallet_ledger WHERE type='daily_profit' AND amount>0")};res.json({stats})});
app.get('/api/admin/users',auth,admin,async(req,res)=>{const q='%'+norm(req.query.q||'')+'%';const rows=(await pool.query(`SELECT u.id,u.username,u.email,u.phone,u.account_status,u.role,u.created_at,coalesce(w.balance,0) wallet_balance,coalesce((SELECT sum(i.principal) FROM investments i WHERE i.user_id=u.id AND i.status='active'),0) active_capital FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE $1='%%' OR lower(u.username) LIKE $1 OR lower(u.email) LIKE $1 OR u.phone LIKE $1 ORDER BY u.created_at DESC LIMIT 200`,[q])).rows;res.json({items:rows})});
app.patch('/api/admin/users/:id/status',auth,admin,async(req,res)=>{const status=String(req.body?.status||'');if(!['active','suspended'].includes(status))return res.status(400).json({error:'BAD_STATUS'});if(req.params.id===req.session.userId&&status!=='active')return res.status(400).json({error:'CANNOT_SUSPEND_SELF'});await pool.query('UPDATE users SET account_status=$1 WHERE id=$2',[status,req.params.id]);if(status==='suspended'){const ss=(await pool.query('SELECT session_id FROM user_sessions WHERE user_id=$1',[req.params.id])).rows;for(const s of ss)await pool.query('DELETE FROM "session" WHERE sid=$1',[s.session_id]);await pool.query('DELETE FROM user_sessions WHERE user_id=$1',[req.params.id])}await audit(req,'ADMIN_USER_STATUS','user',req.params.id,{status});res.json({ok:true})});
app.get('/api/admin/deposits',auth,admin,async(req,res)=>{const rows=(await pool.query(`SELECT d.*,u.username FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC LIMIT 300`)).rows;res.json({items:rows})});
app.patch('/api/admin/deposits/:id/status',auth,admin,async(req,res)=>{const status=String(req.body?.status||'');if(!['approved','rejected'].includes(status))return res.status(400).json({error:'BAD_STATUS'});const c=await pool.connect();try{await c.query('BEGIN');const d=(await c.query('SELECT * FROM deposits WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!d){await c.query('ROLLBACK');return res.status(404).json({error:'NOT_FOUND'})}if(d.status!=='pending'){await c.query('ROLLBACK');return res.status(409).json({error:'ALREADY_REVIEWED'})}await c.query('UPDATE deposits SET status=$1 WHERE id=$2',[status,d.id]);if(status==='approved'){await c.query('UPDATE wallets SET balance=balance+$1,updated_at=now() WHERE user_id=$2',[d.amount,d.user_id]);await c.query(`INSERT INTO wallet_ledger(user_id,type,amount,reference_id,description) VALUES($1,'deposit',$2,$3,'واریز تأییدشده توسط مدیریت')`,[d.user_id,d.amount,d.id])}await c.query(`INSERT INTO notifications(user_id,type,title,message) VALUES($1,'deposit',$2,$3)`,[d.user_id,status==='approved'?'واریز تأیید شد':'واریز رد شد',status==='approved'?'واریز شما تأیید و به کیف پول اضافه شد.':'درخواست واریز شما رد شد.']);await c.query('COMMIT');await audit(req,'ADMIN_DEPOSIT_STATUS','deposit',d.id,{status});res.json({ok:true})}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}});
app.get('/api/admin/withdrawals',auth,admin,async(req,res)=>{const rows=(await pool.query(`SELECT w.*,u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.created_at DESC LIMIT 300`)).rows;res.json({items:rows})});
app.patch('/api/admin/withdrawals/:id/status',auth,admin,async(req,res)=>{const status=String(req.body?.status||''),txid=String(req.body?.txid||'').trim().slice(0,200);if(!['approved','rejected'].includes(status))return res.status(400).json({error:'BAD_STATUS'});const c=await pool.connect();try{await c.query('BEGIN');const w=(await c.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!w){await c.query('ROLLBACK');return res.status(404).json({error:'NOT_FOUND'})}if(w.status!=='pending'){await c.query('ROLLBACK');return res.status(409).json({error:'ALREADY_REVIEWED'})}await c.query('UPDATE withdrawals SET status=$1,txid=coalesce(nullif($2,\'\'),txid) WHERE id=$3',[status,txid,w.id]);if(status==='rejected'){await c.query('UPDATE wallets SET balance=balance+$1,updated_at=now() WHERE user_id=$2',[w.amount,w.user_id]);await c.query(`INSERT INTO wallet_ledger(user_id,type,amount,reference_id,description) VALUES($1,'withdrawal_refund',$2,$3,'بازگشت وجه برداشت ردشده')`,[w.user_id,w.amount,w.id])}await c.query(`INSERT INTO notifications(user_id,type,title,message) VALUES($1,'withdraw',$2,$3)`,[w.user_id,status==='approved'?'برداشت انجام شد':'برداشت رد شد',status==='approved'?'درخواست برداشت شما تأیید شد.':'درخواست برداشت رد شد و مبلغ به کیف پول برگشت.']);await c.query('COMMIT');await audit(req,'ADMIN_WITHDRAWAL_STATUS','withdrawal',w.id,{status,txid:!!txid});res.json({ok:true})}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}});
app.get('/api/admin/reservations',auth,admin,async(req,res)=>{const rows=(await pool.query(`SELECT r.*,u.username FROM reservations r JOIN users u ON u.id=r.user_id ORDER BY r.started_at DESC LIMIT 300`)).rows;res.json({items:rows})});
app.get('/api/admin/transactions',auth,admin,async(req,res)=>{const rows=(await pool.query(`SELECT l.*,u.username FROM wallet_ledger l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 500`)).rows;res.json({items:rows})});
app.get('/api/admin/audit',auth,admin,async(req,res)=>{const rows=(await pool.query(`SELECT a.*,u.username actor_username FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 300`)).rows;res.json({items:rows})});
app.get('/api/admin/system',auth,admin,async(req,res)=>{const db=await one('SELECT current_database() db,now() now');const counts={sessions:Number((await one('SELECT count(*) n FROM user_sessions WHERE expires_at>now()')).n),failedLogins24h:Number((await one("SELECT count(*) n FROM login_history WHERE success=false AND created_at>now()-interval '24 hours'")).n),errors24h:Number((await one("SELECT count(*) n FROM system_events WHERE level='error' AND created_at>now()-interval '24 hours'")).n)};res.json({ok:true,db:db.db,time:db.now,uptimeSeconds:Math.round(process.uptime()),counts})});

app.get('/api/notifications',auth,async(req,res)=>{
  const rows=(await pool.query('SELECT id,type,title,message,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 80',[req.session.userId])).rows;
  res.json({items:rows});
});
app.post('/api/notifications/read-all',auth,async(req,res)=>{
  await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1',[req.session.userId]);res.json({ok:true});
});

app.get('*',(req,res)=>res.sendFile(path.join(publicDir,'index.html')));
app.use(async(err,req,res,next)=>{console.error(err);try{await pool.query(`INSERT INTO system_events(level,event,message,request_id,ip,details) VALUES('error','HTTP_ERROR',$1,$2,$3,$4::jsonb)`,[String(err?.message||err).slice(0,1000),String(req.headers['x-request-id']||'').slice(0,100),cleanIp(req),JSON.stringify({path:req.path,method:req.method})])}catch{}res.status(500).json({error:'SERVER'})});

const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`RET server on :${port}`));
