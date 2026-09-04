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
import fs from 'fs';
import { fileURLToPath } from 'url';

const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const app=express();
const APP_ORIGIN=process.env.APP_ORIGIN || '';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const rootDir=path.join(__dirname,'..');
const publicDir=path.join(rootDir,'public');
const rootIndexFile=path.join(rootDir,'index.html');
const publicIndexFile=path.join(publicDir,'index.html');
const schemaFile=path.join(rootDir,'schema.sql');
const PgSession=connectPgSimple(session);

app.set('trust proxy',1);
app.use(cors({
  origin:(origin,cb)=>{
    if(!origin || !APP_ORIGIN || origin===APP_ORIGIN) return cb(null,true);
    return cb(null,false);
  },
  credentials:true,
  methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders:['Content-Type','Authorization','Idempotency-Key']
}));

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'64kb'}));
app.use(rateLimit({windowMs:60_000,limit:180,standardHeaders:true,legacyHeaders:false}));
app.use(session({
  store:new PgSession({pool,tableName:'session'}),
  secret:process.env.SESSION_SECRET || 'development-only-change-me',
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:7*24*60*60*1000}
}));
if(fs.existsSync(publicDir)) app.use(express.static(publicDir,{extensions:['html']}));

const asyncHandler=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

const resetLimiter=rateLimit({windowMs:15*60_000,limit:8,standardHeaders:true,legacyHeaders:false});
const sha256=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');

async function sendResetEmail(email,token){
  if(!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return false;
  const base=String(process.env.APP_ORIGIN||'').replace(/\/$/,'');
  if(!base) throw new Error('APP_ORIGIN_REQUIRED_FOR_RESET');
  const url=`${base}/?reset=${encodeURIComponent(token)}`;
  const r=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      from:process.env.MAIL_FROM,
      to:[email],
      subject:'بازیابی رمز عبور RET',
      html:`<div dir="rtl" style="font-family:sans-serif"><h2>بازیابی رمز عبور RET</h2><p>این لینک ۳۰ دقیقه معتبر است.</p><p><a href="${url}">تنظیم رمز عبور جدید</a></p><p>اگر شما این درخواست را نداده‌اید، پیام را نادیده بگیرید.</p></div>`
    })
  });
  if(!r.ok) throw new Error('RESET_MAIL_FAILED');
  return true;
}

async function systemEvent(req,level,event,message,details={}){
  try{
    await pool.query(
      `INSERT INTO system_events(level,event,message,request_id,ip,details)
       VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
      [level,event,String(message||'').slice(0,1000),
       String(req?.headers?.['x-request-id']||'').slice(0,100),
       req?requestIp(req):null,JSON.stringify(details||{})]
    );
  }catch(e){console.error('SYSTEM_EVENT',e.message)}
}


async function initDatabase(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if(!fs.existsSync(schemaFile)) throw new Error(`schema.sql not found at ${schemaFile}`);
  const sql=fs.readFileSync(schemaFile,'utf8');
  await pool.query(sql);
  await pool.query('SELECT 1');
  console.log('Database schema ready');
}

const norm=s=>String(s||'').trim().toLowerCase();
const auth=(req,res,next)=>req.session.userId?next():res.status(401).json({error:'AUTH_REQUIRED'});

const adminAuth=asyncHandler(async(req,res,next)=>{
  if(!req.session?.userId)return res.status(401).json({error:'AUTH_REQUIRED'});
  const u=await one('SELECT id,role,account_status FROM users WHERE id=$1',[req.session.userId]);
  if(!u || u.account_status!=='active' || u.role!=='admin'){
    return res.status(403).json({error:'ADMIN_REQUIRED'});
  }
  const a2=await one('SELECT two_factor_enabled FROM users WHERE id=$1',[req.session.userId]);
  if(!a2?.two_factor_enabled)return res.status(403).json({error:'TWO_FA_SETUP_REQUIRED'});
  if(!req.session.twoFactorVerified)return res.status(403).json({error:'TWO_FA_REQUIRED'});
  req.adminUser=u;
  next();
});

async function auditAdmin(req,action,targetType=null,targetId=null,details={}){
  try{
    await pool.query(
      `INSERT INTO admin_audit_log(admin_user_id,action,target_type,target_id,details,ip)
       VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
      [req.session.userId,action,targetType,targetId?String(targetId):null,JSON.stringify(details||{}),requestIp(req)]
    );
  }catch(e){console.error('ADMIN_AUDIT',e)}
}

async function bootstrapAdminRole(){
  const username=norm(process.env.ADMIN_USERNAME||'');
  const email=norm(process.env.ADMIN_EMAIL||'');
  if(username)await pool.query("UPDATE users SET role='admin' WHERE username=$1",[username]);
  if(email)await pool.query("UPDATE users SET role='admin' WHERE email=$1",[email]);
}

const publicUser=r=>({
  id:r.id,firstName:r.first_name,lastName:r.last_name,phone:r.phone,email:r.email,
  docType:r.doc_type,doc:r.doc_number,username:r.username,refCode:r.ref_code,
  accountStatus:r.account_status,role:r.role||'user',twoFactorEnabled:!!r.two_factor_enabled,createdAt:r.created_at
});
async function one(q,p=[]){const r=await pool.query(q,p);return r.rows[0]||null}
async function notify(userId,type,title,message){
  await pool.query('INSERT INTO notifications(user_id,type,title,message) VALUES($1,$2,$3,$4)',[userId,type,title,message]);
}

const REFERRAL_REWARD_USDT=(()=>{
  const n=Number(process.env.REFERRAL_REWARD_USDT||0);
  return Number.isFinite(n)&&n>0?+n.toFixed(8):0;
})();

async function postLedger(db,{
  userId,type,amount,referenceId=null,description=null,entryKey=null,metadata={}
}){
  const r=await db.query(
    `SELECT * FROM ret_post_ledger($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      userId,
      String(type||''),
      Number(amount),
      referenceId||null,
      description||null,
      entryKey||null,
      JSON.stringify(metadata||{})
    ]
  );
  return r.rows[0]||null;
}

async function ledgerBalance(db,userId,{lock=false}={}){
  const q=`SELECT balance FROM wallets WHERE user_id=$1${lock?' FOR UPDATE':''}`;
  const r=await db.query(q,[userId]);
  return Number(r.rows[0]?.balance||0);
}


function parseAuditDate(value,endOfDay=false){
  if(!value)return null;
  const s=String(value).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const d=new Date(`${s}T${endOfDay?'23:59:59.999':'00:00:00.000'}Z`);
  return Number.isNaN(d.getTime())?null:d;
}

function buildLedgerFilter(query={},alias='l'){
  const params=[];
  const where=[];
  const add=v=>{params.push(v);return `$${params.length}`};

  const from=parseAuditDate(query.from,false);
  const to=parseAuditDate(query.to,true);
  const type=String(query.type||'').trim();
  const q=String(query.q||'').trim();
  const user=String(query.user||'').trim();
  const minRaw=String(query.min||'').trim();
  const maxRaw=String(query.max||'').trim();

  if(from)where.push(`${alias}.created_at>=${add(from)}`);
  if(to)where.push(`${alias}.created_at<=${add(to)}`);
  if(type && type!=='all')where.push(`${alias}.type=${add(type)}`);
  if(minRaw!=='' && Number.isFinite(Number(minRaw)))where.push(`${alias}.amount>=${add(Number(minRaw))}`);
  if(maxRaw!=='' && Number.isFinite(Number(maxRaw)))where.push(`${alias}.amount<=${add(Number(maxRaw))}`);

  if(user){
    const p=add(`%${user.toLowerCase()}%`);
    where.push(`(
      lower(u.username) LIKE ${p}
      OR lower(u.email) LIKE ${p}
      OR lower(COALESCE(u.phone,'')) LIKE ${p}
      OR u.id::text LIKE ${p}
    )`);
  }

  if(q){
    const p=add(`%${q.toLowerCase()}%`);
    where.push(`(
      lower(${alias}.type) LIKE ${p}
      OR lower(COALESCE(${alias}.description,'')) LIKE ${p}
      OR lower(COALESCE(${alias}.entry_key,'')) LIKE ${p}
      OR COALESCE(${alias}.reference_id::text,'') LIKE ${p}
      OR lower(u.username) LIKE ${p}
      OR lower(u.email) LIKE ${p}
    )`);
  }

  return {
    params,
    clause:where.length?`WHERE ${where.join(' AND ')}`:'',
    from,to,type:type||'all',q,user
  };
}

const csvCell=value=>{
  const s=String(value??'').replace(/\r?\n/g,' ');
  return `"${s.replace(/"/g,'""')}"`;
};

function asciiPdfText(value){
  return String(value??'')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}


function b32Encode(buf){const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='',out='';for(const b of buf)bits+=b.toString(2).padStart(8,'0');for(let i=0;i<bits.length;i+=5)out+=A[parseInt(bits.slice(i,i+5).padEnd(5,'0'),2)];return out}
function b32Decode(v){const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const ch of String(v||'').replace(/=+$/,'').toUpperCase()){const i=A.indexOf(ch);if(i>=0)bits+=i.toString(2).padStart(5,'0')}const a=[];for(let i=0;i+8<=bits.length;i+=8)a.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(a)}
function totp(secret,step=Math.floor(Date.now()/30000)){const m=Buffer.alloc(8);m.writeBigUInt64BE(BigInt(step));const x=crypto.createHmac('sha1',b32Decode(secret)).update(m).digest(),o=x[x.length-1]&15,n=(x.readUInt32BE(o)&0x7fffffff)%1000000;return String(n).padStart(6,'0')}
function validTotp(secret,code){const c=String(code||'').replace(/\s/g,'');if(!/^\d{6}$/.test(c))return false;const n=Math.floor(Date.now()/30000);return[-1,0,1].some(d=>{const a=Buffer.from(totp(secret,n+d)),b=Buffer.from(c);return a.length===b.length&&crypto.timingSafeEqual(a,b)})}
function twoFaKey(){const raw=process.env.TWO_FA_ENCRYPTION_KEY||process.env.SESSION_SECRET||'';if(!raw)throw new Error('TWO_FA_KEY_REQUIRED');return crypto.createHash('sha256').update(raw).digest()}
function enc2fa(v){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',twoFaKey(),iv),x=Buffer.concat([c.update(v,'utf8'),c.final()]);return[iv,c.getAuthTag(),x].map(b=>b.toString('base64url')).join('.')}
function dec2fa(v){const[a,b,c]=String(v||'').split('.'),d=crypto.createDecipheriv('aes-256-gcm',twoFaKey(),Buffer.from(a,'base64url'));d.setAuthTag(Buffer.from(b,'base64url'));return Buffer.concat([d.update(Buffer.from(c,'base64url')),d.final()]).toString()}
function riskFp(req){return crypto.createHash('sha256').update(`${requestIp(req)}|${String(req.headers['user-agent']||'').slice(0,500)}`).digest('hex')}
async function riskEvent(req,userId,type,score,reason,metadata={}){
 const severity=score>=80?'critical':score>=55?'high':score>=30?'medium':'low',fp=riskFp(req);
 await pool.query(`INSERT INTO risk_events(user_id,event_type,risk_score,severity,reason,ip,device_fingerprint,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
 [userId,type,score,severity,reason,requestIp(req),fp,JSON.stringify(metadata)]);
 await pool.query(`INSERT INTO user_risk_state(user_id,risk_score,flagged,reason) VALUES($1,$2,$3,$4)
 ON CONFLICT(user_id) DO UPDATE SET risk_score=GREATEST(user_risk_state.risk_score,EXCLUDED.risk_score),
 flagged=(user_risk_state.flagged OR EXCLUDED.flagged),reason=CASE WHEN EXCLUDED.risk_score>=user_risk_state.risk_score THEN EXCLUDED.reason ELSE user_risk_state.reason END,updated_at=now()`,
 [userId,score,score>=55,reason]);
}
async function assessLoginRisk(req,userId){
 const fp=riskFp(req),ip=requestIp(req),known=await one('SELECT id FROM login_fingerprints WHERE user_id=$1 AND fingerprint=$2',[userId,fp]);
 if(!known)await riskEvent(req,userId,'new_device',30,'ورود از دستگاه یا شبکه جدید',{ip});
 await pool.query(`INSERT INTO login_fingerprints(user_id,fingerprint,ip,user_agent) VALUES($1,$2,$3,$4)
 ON CONFLICT(user_id,fingerprint) DO UPDATE SET last_seen_at=now(),seen_count=login_fingerprints.seen_count+1,ip=EXCLUDED.ip`,
 [userId,fp,ip,String(req.headers['user-agent']||'').slice(0,1000)]);
 const x=await one(`SELECT COUNT(DISTINCT user_id)::int c FROM login_fingerprints WHERE ip=$1 AND last_seen_at>now()-interval '24 hours'`,[ip]);
 if(Number(x?.c||0)>=3)await riskEvent(req,userId,'shared_network_accounts',55,'چند حساب از یک شبکه در ۲۴ ساعت مشاهده شد',{accounts:Number(x.c)});
}
async function assessWithdrawalRisk(req,userId,amount,balance){
 let score=0,r=[];if(amount>=500){score+=25;r.push('مبلغ بالا')}if(balance>0&&amount/balance>=.5){score+=30;r.push('بیش از ۵۰٪ موجودی')}
 const x=await one(`SELECT COUNT(*)::int c FROM withdrawals WHERE user_id=$1 AND created_at>now()-interval '24 hours'`,[userId]);
 if(Number(x?.c||0)>=2){score+=25;r.push('برداشت پرتکرار')}
 const a=await one('SELECT created_at FROM auth_sessions WHERE session_id=$1',[req.sessionID]);
 if(a?.created_at&&Date.now()-new Date(a.created_at).getTime()<3600000){score+=20;r.push('نشست جدید')}
 if(score>=30)await riskEvent(req,userId,'withdrawal_risk',score,r.join('، '),{amount,balance});
 return{score,flagged:score>=55,reasons:r};
}
async function sensitive2FA(req,res,next){
 const u=await one('SELECT role,two_factor_enabled FROM users WHERE id=$1',[req.session.userId]);
 if(u?.role==='admin'&&!u.two_factor_enabled)return res.status(403).json({error:'TWO_FA_SETUP_REQUIRED'});
 if(u?.two_factor_enabled&&!req.session.twoFactorVerified)return res.status(403).json({error:'TWO_FA_REQUIRED'});
 next();
}

function buildSimpleAuditPdf({title,lines=[]}){
  const pages=[];
  const maxLines=46;
  for(let i=0;i<lines.length;i+=maxLines)pages.push(lines.slice(i,i+maxLines));
  if(!pages.length)pages.push([]);

  const objects=[null];
  const add=obj=>{objects.push(obj);return objects.length-1};
  const catalogId=add('');
  const pagesId=add('');
  const fontId=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds=[];

  for(let p=0;p<pages.length;p++){
    const contentLines=['BT','/F1 15 Tf','48 800 Td'];
    contentLines.push(`(${asciiPdfText(title).replace(/([\\()])/g,'\\$1')}) Tj`);
    contentLines.push('/F1 8 Tf','0 -22 Td',`(Page ${p+1} of ${pages.length}) Tj`,'0 -18 Td');

    for(const raw of pages[p]){
      const txt=asciiPdfText(raw).slice(0,118).replace(/([\\()])/g,'\\$1');
      contentLines.push(`(${txt}) Tj`,'0 -15 Td');
    }
    contentLines.push('ET');

    const stream=contentLines.join('\n');
    const contentId=add(`<< /Length ${Buffer.byteLength(stream,'ascii')} >>\nstream\n${stream}\nendstream`);
    const pageId=add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[catalogId]=`<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf='%PDF-1.4\n';
  const offsets=[0];
  for(let i=1;i<objects.length;i++){
    offsets[i]=Buffer.byteLength(pdf,'binary');
    pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref=Buffer.byteLength(pdf,'binary');
  pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf,'binary');
}
function refCode(){return 'RET'+crypto.randomBytes(5).toString('hex').slice(0,8).toUpperCase()}

function parseSessionDevice(uaRaw=''){
  const ua=String(uaRaw||'');
  let browser='مرورگر';
  if(/Edg\//i.test(ua))browser='Microsoft Edge';
  else if(/OPR\//i.test(ua))browser='Opera';
  else if(/SamsungBrowser\//i.test(ua))browser='Samsung Internet';
  else if(/Chrome\//i.test(ua))browser='Chrome';
  else if(/Firefox\//i.test(ua))browser='Firefox';
  else if(/Safari\//i.test(ua))browser='Safari';

  let os='دستگاه ناشناس';
  if(/Android/i.test(ua))os='Android';
  else if(/iPhone|iPad|iPod/i.test(ua))os='iOS / iPadOS';
  else if(/Windows/i.test(ua))os='Windows';
  else if(/Mac OS X/i.test(ua))os='macOS';
  else if(/Linux/i.test(ua))os='Linux';

  let device='دستگاه فعلی';
  if(/Mobile|Android|iPhone|iPod/i.test(ua))device='موبایل';
  else if(/iPad|Tablet/i.test(ua))device='تبلت';
  else if(ua)device='کامپیوتر';

  return {device,browser,os};
}


function requestIp(req){
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  return forwarded || req.ip || '';
}

async function ensureSecuritySession(req){
  if(!req.session?.userId || !req.sessionID)return null;
  const ua=req.get('user-agent')||'';
  const parsed=parseSessionDevice(ua);
  const ip=requestIp(req);
  const expiresAt=req.session?.cookie?.expires
    ? new Date(req.session.cookie.expires)
    : new Date(Date.now()+7*24*60*60*1000);

  const r=await pool.query(
    `INSERT INTO auth_sessions(session_id,user_id,device,browser,os,ip,user_agent,expires_at,last_seen_at,revoked_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),NULL)
     ON CONFLICT(session_id) DO UPDATE SET
       user_id=EXCLUDED.user_id,
       device=EXCLUDED.device,
       browser=EXCLUDED.browser,
       os=EXCLUDED.os,
       ip=EXCLUDED.ip,
       user_agent=EXCLUDED.user_agent,
       expires_at=EXCLUDED.expires_at,
       last_seen_at=now(),
       revoked_at=NULL
     RETURNING *`,
    [req.sessionID,req.session.userId,parsed.device,parsed.browser,parsed.os,ip,ua,expiresAt]
  );
  return r.rows[0]||null;
}

async function recordLoginHistory(req,userId,identifier,success,reason=null){
  const ua=req.get('user-agent')||'';
  const parsed=parseSessionDevice(ua);
  await pool.query(
    `INSERT INTO login_history(user_id,identifier,ip,device,browser,os,success,reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [userId||null,String(identifier||'').slice(0,180),requestIp(req),parsed.device,parsed.browser,parsed.os,!!success,reason]
  );
}

async function checkLoginLock(identifier,ip){
  const row=await one(
    `SELECT failed_count,first_failed_at,locked_until
     FROM login_attempts WHERE identifier=$1 AND ip=$2`,
    [identifier,ip]
  );
  if(!row)return {locked:false};
  if(row.locked_until && new Date(row.locked_until).getTime()>Date.now()){
    return {locked:true,lockedUntil:row.locked_until};
  }
  return {locked:false};
}

async function registerFailedLogin(identifier,ip){
  const row=await one(
    `INSERT INTO login_attempts(identifier,ip,failed_count,first_failed_at,last_failed_at)
     VALUES($1,$2,1,now(),now())
     ON CONFLICT(identifier,ip) DO UPDATE SET
       failed_count=CASE
         WHEN login_attempts.first_failed_at < now()-interval '15 minutes' THEN 1
         ELSE login_attempts.failed_count+1
       END,
       first_failed_at=CASE
         WHEN login_attempts.first_failed_at < now()-interval '15 minutes' THEN now()
         ELSE login_attempts.first_failed_at
       END,
       last_failed_at=now(),
       locked_until=CASE
         WHEN (
           CASE WHEN login_attempts.first_failed_at < now()-interval '15 minutes'
             THEN 1 ELSE login_attempts.failed_count+1 END
         ) >= 5
         THEN now()+interval '15 minutes'
         ELSE NULL
       END
     RETURNING failed_count,locked_until`,
    [identifier,ip]
  );
  return row;
}

async function clearLoginAttempts(identifier,ip){
  await pool.query('DELETE FROM login_attempts WHERE identifier=$1 AND ip=$2',[identifier,ip]);
}

async function createNewLoginAlert(req,userId){
  const ua=req.get('user-agent')||'';
  const d=parseSessionDevice(ua);
  const ip=requestIp(req);
  await notify(
    userId,
    'security',
    'ورود جدید به حساب',
    `ورود جدید با ${d.device} • ${d.browser} • ${d.os}${ip?` • IP ${ip}`:''}`
  );
}

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
  5% monthly simple return, accrued once per completed UTC day.
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
        const targetDay=new Date(nowDay).toISOString().slice(0,10);
        await postLedger(c,{
          userId,
          type:'daily_profit',
          amount:profit,
          referenceId:inv.id,
          description:`سود ${days} روز با نرخ ماهانه ${(monthlyRate*100).toFixed(2)}٪`,
          entryKey:`daily_profit:${inv.id}:${targetDay}`,
          metadata:{
            investmentId:inv.id,
            days,
            monthlyRate,
            targetDay
          }
        });
        totalProfit+=profit;
      }

      await c.query(
        `UPDATE investments
         SET last_profit_at=date_trunc('day',now())
         WHERE id=$1`,
        [inv.id]
      );
    }

    if(totalProfit>0){
      await c.query(
        `INSERT INTO notifications(user_id,type,title,message)
         VALUES($1,'profit','سود روزانه اضافه شد',$2)`,
        [userId,`مبلغ ${(+totalProfit.toFixed(8))} USDT سود به موجودی قابل برداشت شما اضافه شد.`]
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
app.get('/api/health/deep',asyncHandler(async(req,res)=>{
  const started=Date.now();
  try{
    await pool.query('SELECT 1');
    res.json({ok:true,database:true,latencyMs:Date.now()-started,time:new Date().toISOString()});
  }catch(e){
    await systemEvent(req,'error','HEALTH_DB_UNAVAILABLE',e.message,{latencyMs:Date.now()-started});
    res.status(503).json({ok:false,database:false,error:'DB_UNAVAILABLE'});
  }
}));

app.post('/api/auth/register',asyncHandler(async(req,res)=>{
  const {firstName,lastName,phone,email,docType,doc,username,password,referrer}=req.body||{};
  if(!firstName||!lastName||!phone||!email||!docType||!doc||!username||!password) return res.status(400).json({error:'REQUIRED'});
  if(String(password).length<6)return res.status(400).json({error:'PASSWORD_SHORT'});
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
    if(referrerUserId){
      if(REFERRAL_REWARD_USDT>0){
        await postLedger(client,{
          userId:referrerUserId,
          type:'referral_reward',
          amount:REFERRAL_REWARD_USDT,
          referenceId:u.id,
          description:'پاداش دعوت کاربر جدید',
          entryKey:`referral_reward:${u.id}`,
          metadata:{referredUserId:u.id,reward:REFERRAL_REWARD_USDT}
        });
        await client.query(
          `INSERT INTO notifications(user_id,type,title,message)
           VALUES($1,'referral','پاداش دعوت اضافه شد',$2)`,
          [referrerUserId,`کاربر جدید ثبت‌نام کرد و ${REFERRAL_REWARD_USDT} USDT پاداش دعوت به موجودی شما اضافه شد.`]
        );
      }else{
        await client.query(
          `INSERT INTO notifications(user_id,type,title,message)
           VALUES($1,'referral','دعوت موفق','یک کاربر جدید با کد دعوت شما ثبت‌نام کرد.')`,
          [referrerUserId]
        );
      }
    }
    await client.query('COMMIT');
    req.session.userId=u.id;
    req.session.save(async err=>{
      if(err)return res.status(500).json({error:'SERVER'});
      try{
        await ensureSecuritySession(req);
        await recordLoginHistory(req,u.id,u.username,true,'REGISTER');
        res.json({user:publicUser(u)});
      }catch(secErr){
        console.error(secErr);
        res.status(500).json({error:'SERVER'});
      }
    });
  }catch(e){
    await client.query('ROLLBACK');
    if(e.code==='23505')return res.status(409).json({error:'DUPLICATE'});
    console.error(e);res.status(500).json({error:'SERVER'});
  }finally{client.release()}
}));

app.post('/api/auth/login',asyncHandler(async(req,res)=>{
  const id=norm(req.body?.id).replace(/^@/,'');
  const password=String(req.body?.password||'');
  const ip=requestIp(req);

  const lock=await checkLoginLock(id,ip);
  if(lock.locked){
    return res.status(429).json({error:'LOGIN_LOCKED',lockedUntil:lock.lockedUntil});
  }

  const u=await one('SELECT * FROM users WHERE username=$1 OR email=$1',[id]);
  const ok=!!u && await bcrypt.compare(password,u.password_hash);

  if(!ok){
    const failed=await registerFailedLogin(id,ip);
    await recordLoginHistory(req,u?.id||null,id,false,'BAD_LOGIN');
    if(failed?.locked_until){
      return res.status(429).json({error:'LOGIN_LOCKED',lockedUntil:failed.locked_until});
    }
    return res.status(401).json({error:'BAD_LOGIN'});
  }

  await clearLoginAttempts(id,ip);
  await assessLoginRisk(req,u.id);
  if(u.two_factor_enabled){
    req.session.pending2FAUserId=u.id;req.session.pending2FAExpiresAt=Date.now()+300000;
    delete req.session.userId;delete req.session.twoFactorVerified;
    return req.session.save(err=>err?res.status(500).json({error:'SERVER'}):res.json({requires2FA:true}));
  }
  req.session.userId=u.id;req.session.twoFactorVerified=false;
  req.session.save(async err=>{
    if(err)return res.status(500).json({error:'SERVER'});
    try{
      await ensureSecuritySession(req);await recordLoginHistory(req,u.id,id,true,null);await createNewLoginAlert(req,u.id);
      res.json({user:publicUser(u),twoFactorSetupRequired:u.role==='admin'});
    }catch(e){console.error(e);res.status(500).json({error:'SERVER'})}
  });
}));


app.post('/api/auth/2fa/verify-login',asyncHandler(async(req,res)=>{
 const id=req.session?.pending2FAUserId;
 if(!id||Date.now()>Number(req.session.pending2FAExpiresAt||0))return res.status(401).json({error:'TWO_FA_CHALLENGE_EXPIRED'});
 const u=await one('SELECT * FROM users WHERE id=$1',[id]);
 if(!u?.two_factor_enabled||!u.two_factor_secret_enc)return res.status(400).json({error:'TWO_FA_NOT_ENABLED'});
 if(!validTotp(dec2fa(u.two_factor_secret_enc),req.body?.code)){await riskEvent(req,id,'bad_2fa',35,'کد 2FA ورود نامعتبر');return res.status(401).json({error:'BAD_2FA'})}
 req.session.userId=id;req.session.twoFactorVerified=true;delete req.session.pending2FAUserId;delete req.session.pending2FAExpiresAt;
 req.session.save(async err=>{if(err)return res.status(500).json({error:'SERVER'});await ensureSecuritySession(req);await recordLoginHistory(req,u.id,u.username,true,'2FA');await createNewLoginAlert(req,u.id);res.json({user:publicUser(u)})});
}));
app.get('/api/security/2fa',auth,asyncHandler(async(req,res)=>{
 const u=await one('SELECT role,two_factor_enabled,two_factor_enabled_at FROM users WHERE id=$1',[req.session.userId]);
 res.json({enabled:!!u?.two_factor_enabled,required:u?.role==='admin',enabledAt:u?.two_factor_enabled_at||null,verifiedThisSession:!!req.session.twoFactorVerified});
}));
app.post('/api/security/2fa/setup',auth,asyncHandler(async(req,res)=>{
 const u=await one('SELECT username,two_factor_enabled FROM users WHERE id=$1',[req.session.userId]);
 if(u?.two_factor_enabled)return res.status(409).json({error:'TWO_FA_ALREADY_ENABLED'});
 const secret=b32Encode(crypto.randomBytes(20));req.session.pending2FASecret=enc2fa(secret);req.session.pending2FASetupExpiresAt=Date.now()+600000;
 const uri=`otpauth://totp/${encodeURIComponent('RET:'+u.username)}?secret=${secret}&issuer=RET&algorithm=SHA1&digits=6&period=30`;
 res.json({secret,uri});
}));
app.post('/api/security/2fa/enable',auth,asyncHandler(async(req,res)=>{
 if(!req.session.pending2FASecret||Date.now()>Number(req.session.pending2FASetupExpiresAt||0))return res.status(400).json({error:'TWO_FA_SETUP_EXPIRED'});
 const secret=dec2fa(req.session.pending2FASecret);if(!validTotp(secret,req.body?.code))return res.status(400).json({error:'BAD_2FA'});
 await pool.query('UPDATE users SET two_factor_enabled=true,two_factor_secret_enc=$1,two_factor_enabled_at=now() WHERE id=$2',[enc2fa(secret),req.session.userId]);
 req.session.twoFactorVerified=true;delete req.session.pending2FASecret;delete req.session.pending2FASetupExpiresAt;res.json({ok:true});
}));
app.post('/api/security/2fa/disable',auth,asyncHandler(async(req,res)=>{
 const u=await one('SELECT role,password_hash,two_factor_enabled,two_factor_secret_enc FROM users WHERE id=$1',[req.session.userId]);
 if(u?.role==='admin')return res.status(403).json({error:'TWO_FA_ADMIN_REQUIRED'});
 if(!u?.two_factor_enabled)return res.json({ok:true});
 if(!(await bcrypt.compare(String(req.body?.password||''),u.password_hash)))return res.status(400).json({error:'BAD_CURRENT_PASSWORD'});
 if(!validTotp(dec2fa(u.two_factor_secret_enc),req.body?.code))return res.status(400).json({error:'BAD_2FA'});
 await pool.query('UPDATE users SET two_factor_enabled=false,two_factor_secret_enc=NULL,two_factor_enabled_at=NULL WHERE id=$1',[req.session.userId]);
 req.session.twoFactorVerified=false;res.json({ok:true});
}));


app.post('/api/auth/password-reset/start',resetLimiter,asyncHandler(async(req,res)=>{
  const email=norm(req.body?.email);
  const u=await one('SELECT id,email FROM users WHERE email=$1',[email]);
  if(u){
    const token=crypto.randomBytes(32).toString('hex');
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id=$1 OR expires_at<now()',[u.id]);
    await pool.query(
      `INSERT INTO password_reset_tokens(user_id,token_hash,expires_at)
       VALUES($1,$2,now()+interval '30 minutes')`,
      [u.id,sha256(token)]
    );
    try{await sendResetEmail(u.email,token)}
    catch(e){await systemEvent(req,'error','PASSWORD_RESET_MAIL_FAILED',e.message,{userId:u.id})}
  }
  // Same response for existing/non-existing email to prevent account enumeration.
  res.json({ok:true});
}));

app.post('/api/auth/password-reset/complete',resetLimiter,asyncHandler(async(req,res)=>{
  const token=String(req.body?.token||''),password=String(req.body?.password||'');
  if(password.length<8)return res.status(400).json({error:'PASSWORD_SHORT'});
  const row=await one(
    `SELECT * FROM password_reset_tokens
     WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()`,
    [sha256(token)]
  );
  if(!row)return res.status(400).json({error:'RESET_TOKEN_INVALID'});

  const hash=await bcrypt.hash(password,12);
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query('UPDATE users SET password_hash=$1,password_changed_at=now() WHERE id=$2',[hash,row.user_id]);
    await c.query('UPDATE password_reset_tokens SET used_at=now() WHERE id=$1',[row.id]);

    const sessions=(await c.query(
      `SELECT session_id FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL`,
      [row.user_id]
    )).rows;
    for(const x of sessions) await c.query('DELETE FROM "session" WHERE sid=$1',[x.session_id]);
    await c.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[row.user_id]);

    await c.query('COMMIT');
    await notify(row.user_id,'security','رمز عبور تغییر کرد','رمز عبور حساب شما از طریق بازیابی تغییر کرد.');
    res.json({ok:true});
  }catch(e){
    await c.query('ROLLBACK');throw e;
  }finally{c.release()}
}));

app.post('/api/auth/logout',auth,asyncHandler(async(req,res)=>{
  await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE session_id=$1',[req.sessionID]);
  req.session.destroy(()=>res.json({ok:true}));
}));

app.get('/api/me',auth,asyncHandler(async(req,res)=>{
  const u=await one(`SELECT u.*,
    r.username AS referrer_username,
    r.ref_code AS referrer_code
    FROM users u
    LEFT JOIN users r ON r.id=u.referrer_user_id
    WHERE u.id=$1`,[req.session.userId]);
  if(!u)return res.status(401).json({error:'AUTH_REQUIRED'});
  const user=publicUser(u);
  user.referrer=u.referrer_username
    ? {username:u.referrer_username,refCode:u.referrer_code}
    : null;
  res.json({user});
}));
app.post('/api/me/password',auth,sensitive2FA,asyncHandler(async(req,res)=>{
  const {currentPassword,newPassword}=req.body||{};
  if(String(newPassword||'').length<6)return res.status(400).json({error:'PASSWORD_SHORT'});
  const u=await one('SELECT password_hash FROM users WHERE id=$1',[req.session.userId]);
  if(!u || !(await bcrypt.compare(String(currentPassword||''),u.password_hash)))return res.status(400).json({error:'BAD_CURRENT_PASSWORD'});
  const hash=await bcrypt.hash(String(newPassword),12);
  await pool.query('UPDATE users SET password_hash=$1,password_changed_at=now() WHERE id=$2',[hash,req.session.userId]);
  res.json({ok:true});
}));

app.get('/api/security/session',auth,asyncHandler(async(req,res)=>{
  const current=await ensureSecuritySession(req);
  res.json({
    session:{
      id:current?.id,
      current:true,
      sessionId:String(req.sessionID||'').slice(0,8)+'…',
      device:current?.device||'دستگاه فعلی',
      browser:current?.browser||'مرورگر',
      os:current?.os||'نامشخص',
      ip:current?.ip||requestIp(req),
      active:true,
      expiresAt:current?.expires_at||req.session?.cookie?.expires||null,
      checkedAt:new Date().toISOString()
    }
  });
}));

app.get('/api/security/overview',auth,asyncHandler(async(req,res)=>{
  await ensureSecuritySession(req);

  const sessions=(await pool.query(
    `SELECT a.id,a.session_id,a.device,a.browser,a.os,a.ip,a.created_at,a.last_seen_at,a.expires_at,
            (a.session_id=$2) AS current
     FROM auth_sessions a
     JOIN session s ON s.sid=a.session_id
     WHERE a.user_id=$1
       AND a.revoked_at IS NULL
       AND a.expires_at>now()
       AND s.expire>now()
     ORDER BY current DESC,a.last_seen_at DESC
     LIMIT 20`,
    [req.session.userId,req.sessionID]
  )).rows.map(x=>({
    id:x.id,
    device:x.device,
    browser:x.browser,
    os:x.os,
    ip:x.ip,
    createdAt:x.created_at,
    lastSeenAt:x.last_seen_at,
    expiresAt:x.expires_at,
    current:x.current,
    sessionId:String(x.session_id||'').slice(0,8)+'…'
  }));

  const history=(await pool.query(
    `SELECT id,ip,device,browser,os,success,reason,created_at
     FROM login_history
     WHERE user_id=$1
     ORDER BY created_at DESC
     LIMIT 30`,
    [req.session.userId]
  )).rows.map(x=>({
    id:x.id,ip:x.ip,device:x.device,browser:x.browser,os:x.os,
    success:x.success,reason:x.reason,createdAt:x.created_at
  }));

  res.json({sessions,history});
}));

app.post('/api/security/logout-others',auth,asyncHandler(async(req,res)=>{
  await ensureSecuritySession(req);
  const rows=(await pool.query(
    `SELECT session_id FROM auth_sessions
     WHERE user_id=$1 AND session_id<>$2 AND revoked_at IS NULL`,
    [req.session.userId,req.sessionID]
  )).rows;
  const ids=rows.map(x=>x.session_id);

  if(ids.length){
    await pool.query('DELETE FROM session WHERE sid=ANY($1::text[])',[ids]);
    await pool.query(
      `UPDATE auth_sessions SET revoked_at=now()
       WHERE user_id=$1 AND session_id<>$2 AND revoked_at IS NULL`,
      [req.session.userId,req.sessionID]
    );
  }

  await notify(req.session.userId,'security','خروج از دستگاه‌های دیگر',`${ids.length} نشست دیگر از حساب خارج شد.`);
  res.json({ok:true,count:ids.length});
}));

app.delete('/api/security/sessions/:id',auth,asyncHandler(async(req,res)=>{
  const sid=Number(req.params.id);
  if(!Number.isInteger(sid)||sid<=0)return res.status(400).json({error:'BAD_SESSION'});

  const row=await one(
    `SELECT id,session_id FROM auth_sessions
     WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
    [sid,req.session.userId]
  );
  if(!row)return res.status(404).json({error:'SESSION_NOT_FOUND'});
  if(row.session_id===req.sessionID)return res.status(400).json({error:'CURRENT_SESSION'});

  await pool.query('DELETE FROM session WHERE sid=$1',[row.session_id]);
  await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1',[row.id]);
  await notify(req.session.userId,'security','یک دستگاه خارج شد','یکی از نشست‌های فعال حساب شما با موفقیت بسته شد.');
  res.json({ok:true});
}));


app.get('/api/wallet',auth,asyncHandler(async(req,res)=>{
  await accrueDailyProfit(req.session.userId);
  const w=await one(
    `SELECT
       COALESCE(SUM(l.amount),0) ledger_balance,
       MAX(l.created_at) updated_at,
       COALESCE(MAX(w.asset),'USDT') asset
     FROM wallets w
     LEFT JOIN wallet_ledger l ON l.user_id=w.user_id
     WHERE w.user_id=$1
     GROUP BY w.user_id`,
    [req.session.userId]
  );
  res.json({wallet:{
    asset:w?.asset||'USDT',
    balance:Number(w?.ledger_balance||0),
    updatedAt:w?.updated_at||null
  }});
}));

app.get('/api/dashboard/financials',auth,asyncHandler(async(req,res)=>{
  await accrueDailyProfit(req.session.userId);

  const [wallet,capital,today,total]=await Promise.all([
    one('SELECT COALESCE(SUM(amount),0) balance FROM wallet_ledger WHERE user_id=$1',[req.session.userId]),
    one(`SELECT COALESCE(SUM(principal),0) value
         FROM investments
         WHERE user_id=$1 AND status='active'`,[req.session.userId]),
    one(`SELECT COALESCE(SUM(amount),0) value
         FROM wallet_ledger
         WHERE user_id=$1
           AND type='daily_profit'
           AND created_at >= date_trunc('day',now())`,[req.session.userId]),
    one(`SELECT COALESCE(SUM(amount),0) value
         FROM wallet_ledger
         WHERE user_id=$1
           AND type='daily_profit'`,[req.session.userId])
  ]);

  res.json({
    financials:{
      withdrawableBalance:Number(wallet?.balance||0),
      activeCapital:Number(capital?.value||0),
      todayProfit:Number(today?.value||0),
      totalProfit:Number(total?.value||0)
    }
  });
}));

app.get('/api/wallet/ledger',auth,asyncHandler(async(req,res)=>{
  const rows=(await pool.query(
    `SELECT id,type,amount,reference_id,description,entry_key,balance_after,metadata,created_at
     FROM wallet_ledger WHERE user_id=$1
     ORDER BY created_at DESC LIMIT 200`,
    [req.session.userId]
  )).rows;
  res.json({items:rows});
}));

app.get('/api/investments',auth,asyncHandler(async(req,res)=>{
  await accrueDailyProfit(req.session.userId);
  const rows=(await pool.query(
    `SELECT id,principal,monthly_rate,started_at,last_profit_at,status,closed_at
     FROM investments WHERE user_id=$1 ORDER BY started_at DESC`,
    [req.session.userId]
  )).rows;
  res.json({items:rows});
}));

app.post('/api/investments/start',auth,asyncHandler(async(req,res)=>{
  const amount=Number(req.body?.amount);
  if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'BAD_AMOUNT'});

  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const bal=await ledgerBalance(c,req.session.userId,{lock:true});
    if(bal<amount){await c.query('ROLLBACK');return res.status(400).json({error:'INSUFFICIENT_BALANCE'})}

    const r=await c.query(
      `INSERT INTO investments(user_id,principal,monthly_rate)
       VALUES($1,$2,0.05) RETURNING *`,
      [req.session.userId,amount]
    );

    await postLedger(c,{
      userId:req.session.userId,
      type:'investment_start',
      amount:-amount,
      referenceId:r.rows[0].id,
      description:'انتقال موجودی به سرمایه‌گذاری',
      entryKey:`investment_start:${r.rows[0].id}`,
      metadata:{investmentId:r.rows[0].id,principal:amount,monthlyRate:0.05}
    });

    await c.query('COMMIT');
    res.json({investment:r.rows[0]});
  }catch(e){
    await c.query('ROLLBACK');
    console.error(e);
    res.status(500).json({error:'SERVER'});
  }finally{c.release()}
}));

app.post('/api/investments/:id/close',auth,asyncHandler(async(req,res)=>{
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
    await postLedger(c,{
      userId:req.session.userId,
      type:'investment_close',
      amount:principal,
      referenceId:inv.id,
      description:'بازگشت اصل سرمایه به کیف پول',
      entryKey:`investment_close:${inv.id}`,
      metadata:{investmentId:inv.id,principal}
    });

    await c.query('COMMIT');
    res.json({ok:true,returnedPrincipal:principal});
  }catch(e){
    await c.query('ROLLBACK');
    console.error(e);
    res.status(500).json({error:'SERVER'});
  }finally{c.release()}
}));

app.get('/api/transactions',auth,asyncHandler(async(req,res)=>{
  await accrueDailyProfit(req.session.userId);
  const rows=(await pool.query(
    `SELECT
       l.id,
       l.type,
       l.amount,
       l.reference_id,
       l.description,
       l.entry_key,
       l.balance_after,
       l.metadata,
       l.created_at AS time,
       d.status AS deposit_status,
       d.network AS deposit_network,
       d.txid AS deposit_txid,
       w.status AS withdrawal_status,
       w.network AS withdrawal_network,
       w.txid AS withdrawal_txid,
       w.fee AS withdrawal_fee,
       w.net AS withdrawal_net,
       i.status AS investment_status
     FROM wallet_ledger l
     LEFT JOIN deposits d
       ON l.type='deposit' AND d.id=l.reference_id
     LEFT JOIN withdrawals w
       ON l.type IN ('withdrawal','withdrawal_refund') AND w.id=l.reference_id
     LEFT JOIN investments i
       ON l.type IN ('investment_start','investment_close','daily_profit') AND i.id=l.reference_id
     WHERE l.user_id=$1
     ORDER BY l.created_at DESC,l.id DESC
     LIMIT 250`,
    [req.session.userId]
  )).rows;
  res.json({items:rows});
}));

app.post('/api/withdrawals',auth,sensitive2FA,asyncHandler(async(req,res)=>{
  await accrueDailyProfit(req.session.userId);
  const amount=Number(req.body?.amount),network=String(req.body?.network||'TRC20').trim(),address=String(req.body?.address||'').trim();
  if(!Number.isFinite(amount)||amount<100)return res.status(400).json({error:'MIN_100'});
  if(!address)return res.status(400).json({error:'ADDRESS_REQUIRED'});
  const fee=+(amount*.05).toFixed(8),net=+(amount-fee).toFixed(8);
  const preBalance=await ledgerBalance(pool,req.session.userId);
  const risk=await assessWithdrawalRisk(req,req.session.userId,amount,preBalance);
  if(risk.flagged)await notify(req.session.userId,'security','برداشت نیازمند بررسی','این برداشت توسط سیستم کنترل ریسک برای بررسی علامت‌گذاری شد.');
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const bal=await ledgerBalance(c,req.session.userId,{lock:true});
    if(bal<amount){await c.query('ROLLBACK');return res.status(400).json({error:'INSUFFICIENT_BALANCE'})}

    const r=await c.query(
      `INSERT INTO withdrawals(user_id,amount,fee,net,network,address)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.session.userId,amount,fee,net,network,address]
    );

    await postLedger(c,{
      userId:req.session.userId,
      type:'withdrawal',
      amount:-amount,
      referenceId:r.rows[0].id,
      description:`برداشت؛ کارمزد ۵٪ = ${fee} USDT`,
      entryKey:`withdrawal:${r.rows[0].id}`,
      metadata:{
        withdrawalId:r.rows[0].id,
        fee,
        net,
        network,
        address
      }
    });
    await c.query(`INSERT INTO notifications(user_id,type,title,message) VALUES($1,'withdraw','درخواست برداشت','درخواست برداشت شما ثبت شد.')`,[req.session.userId]);
    await c.query('COMMIT');
    res.json({withdrawal:r.rows[0]});
  }catch(e){await c.query('ROLLBACK');console.error(e);res.status(500).json({error:'SERVER'})}finally{c.release()}
}));

app.get('/api/referrals',auth,asyncHandler(async(req,res)=>{
  const me=await one('SELECT ref_code FROM users WHERE id=$1',[req.session.userId]);
  const g1=(await pool.query('SELECT id,username,ref_code,created_at FROM users WHERE referrer_user_id=$1 ORDER BY created_at DESC',[req.session.userId])).rows;
  const g1ids=g1.map(x=>x.id);
  let g2=[],g3=[];
  if(g1ids.length)g2=(await pool.query('SELECT id,username,ref_code,created_at,referrer_user_id FROM users WHERE referrer_user_id=ANY($1::uuid[])',[g1ids])).rows;
  const g2ids=g2.map(x=>x.id);
  if(g2ids.length)g3=(await pool.query('SELECT id,username,ref_code,created_at,referrer_user_id FROM users WHERE referrer_user_id=ANY($1::uuid[])',[g2ids])).rows;
  res.json({refCode:me.ref_code,g1,g2,g3});
}));

app.get('/api/reservations',auth,asyncHandler(async(req,res)=>{
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
}));

app.post('/api/reservations/start',auth,asyncHandler(async(req,res)=>{
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
}));

app.get('/api/wheel',auth,asyncHandler(async(req,res)=>{
  const s=await one('SELECT chances,last_prize FROM wheel_state WHERE user_id=$1',[req.session.userId]);
  res.json({chances:Number(s?.chances||0),lastPrize:s?.last_prize||null});
}));
app.post('/api/wheel/spin',auth,asyncHandler(async(req,res)=>{
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
}));

app.get('/api/notifications',auth,asyncHandler(async(req,res)=>{
  const rows=(await pool.query(
    'SELECT id,type,title,message,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 80',
    [req.session.userId]
  )).rows;
  const unread=rows.reduce((n,x)=>n+(x.is_read?0:1),0);
  res.json({items:rows,unread});
}));
app.post('/api/notifications/read-all',auth,asyncHandler(async(req,res)=>{
  await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1',[req.session.userId]);res.json({ok:true});
}));



// ===== RET ADMIN API =====
app.get('/api/admin/me',adminAuth,asyncHandler(async(req,res)=>{
  const u=await one('SELECT * FROM users WHERE id=$1',[req.session.userId]);
  res.json({admin:publicUser(u)});
}));

app.get('/api/admin/stats',adminAuth,asyncHandler(async(req,res)=>{
  const [users,wallets,investments,deposits,withdrawals,reservations,profit,integrity]=await Promise.all([
    one(`SELECT COUNT(*)::int total,
                COUNT(*) FILTER (WHERE account_status='active')::int active
         FROM users`),
    one(`SELECT COALESCE(SUM(balance),0) value FROM wallets`),
    one(`SELECT COALESCE(SUM(principal),0) value FROM investments WHERE status='active'`),
    one(`SELECT COUNT(*) FILTER (WHERE status='pending')::int pending,
                COALESCE(SUM(amount) FILTER (WHERE status='approved'),0) approved_amount
         FROM deposits`),
    one(`SELECT COUNT(*) FILTER (WHERE status='pending')::int pending,
                COALESCE(SUM(net) FILTER (WHERE status='approved'),0) approved_amount
         FROM withdrawals`),
    one(`SELECT COUNT(*) FILTER (WHERE status='active')::int active FROM reservations`),
    one(`SELECT COALESCE(SUM(amount),0) value FROM wallet_ledger WHERE type='daily_profit'`),
    one(`SELECT COUNT(*)::int value
         FROM (
           SELECT w.user_id
           FROM wallets w
           LEFT JOIN wallet_ledger l ON l.user_id=w.user_id
           GROUP BY w.user_id,w.balance
           HAVING w.balance<>COALESCE(SUM(l.amount),0)
         ) x`)
  ]);

  res.json({stats:{
    users:Number(users?.total||0),
    activeUsers:Number(users?.active||0),
    walletBalance:Number(wallets?.value||0),
    activeCapital:Number(investments?.value||0),
    depositsPending:Number(deposits?.pending||0),
    depositsApprovedAmount:Number(deposits?.approved_amount||0),
    withdrawalsPending:Number(withdrawals?.pending||0),
    withdrawalsApprovedAmount:Number(withdrawals?.approved_amount||0),
    activeReservations:Number(reservations?.active||0),
    totalProfit:Number(profit?.value||0),
    ledgerMismatchUsers:Number(integrity?.value||0)
  }});
}));

app.get('/api/admin/users',adminAuth,asyncHandler(async(req,res)=>{
  const q=String(req.query.q||'').trim().toLowerCase();
  const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
  const params=[];
  let where='';
  if(q){
    params.push('%'+q+'%');
    where=`WHERE lower(u.username) LIKE $1
           OR lower(u.email) LIKE $1
           OR lower(COALESCE(u.first_name,'')) LIKE $1
           OR lower(COALESCE(u.last_name,'')) LIKE $1
           OR lower(COALESCE(u.phone,'')) LIKE $1`;
  }
  params.push(limit);

  const rows=(await pool.query(
    `SELECT u.id,u.first_name,u.last_name,u.username,u.email,u.phone,
            u.account_status,u.role,u.created_at,
            COALESCE(w.balance,0) wallet_balance,
            COALESCE((
              SELECT SUM(i.principal) FROM investments i
              WHERE i.user_id=u.id AND i.status='active'
            ),0) active_capital
     FROM users u
     LEFT JOIN wallets w ON w.user_id=u.id
     ${where}
     ORDER BY u.created_at DESC
     LIMIT $${params.length}`,
    params
  )).rows;
  res.json({items:rows});
}));

app.patch('/api/admin/users/:id/status',adminAuth,asyncHandler(async(req,res)=>{
  const id=String(req.params.id||'');
  const status=String(req.body?.status||'');
  if(!['active','suspended'].includes(status))return res.status(400).json({error:'BAD_STATUS'});
  if(id===String(req.session.userId) && status!=='active')return res.status(400).json({error:'CANNOT_DISABLE_SELF'});

  const u=await one(
    `UPDATE users SET account_status=$1 WHERE id=$2
     RETURNING id,username,account_status`,
    [status,id]
  );
  if(!u)return res.status(404).json({error:'USER_NOT_FOUND'});
  await auditAdmin(req,'USER_STATUS','user',id,{status});
  res.json({ok:true,user:u});
}));

app.get('/api/admin/deposits',adminAuth,asyncHandler(async(req,res)=>{
  const rows=(await pool.query(
    `SELECT d.id,d.user_id,d.amount,d.network,d.txid,d.status,d.created_at,
            u.username,u.email
     FROM deposits d
     JOIN users u ON u.id=d.user_id
     ORDER BY d.created_at DESC LIMIT 100`
  )).rows;
  res.json({items:rows});
}));

app.patch('/api/admin/deposits/:id/status',adminAuth,asyncHandler(async(req,res)=>{
  const id=String(req.params.id||'');
  const status=String(req.body?.status||'');
  if(!['approved','rejected'].includes(status))return res.status(400).json({error:'BAD_STATUS'});

  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const d=(await c.query('SELECT * FROM deposits WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!d){await c.query('ROLLBACK');return res.status(404).json({error:'DEPOSIT_NOT_FOUND'})}
    if(d.status!=='pending'){await c.query('ROLLBACK');return res.status(409).json({error:'ALREADY_PROCESSED'})}

    await c.query('UPDATE deposits SET status=$1 WHERE id=$2',[status,id]);

    if(status==='approved'){
      await postLedger(c,{
        userId:d.user_id,
        type:'deposit',
        amount:Number(d.amount),
        referenceId:d.id,
        description:'تأیید واریز توسط مدیریت',
        entryKey:`deposit:${d.id}`,
        metadata:{depositId:d.id,network:d.network,txid:d.txid||null}
      });
    }

    await c.query('COMMIT');
    await auditAdmin(req,'DEPOSIT_STATUS','deposit',id,{status,amount:Number(d.amount),userId:d.user_id});
    res.json({ok:true});
  }catch(e){
    try{await c.query('ROLLBACK')}catch(_){}
    throw e;
  }finally{c.release()}
}));

app.get('/api/admin/withdrawals',adminAuth,asyncHandler(async(req,res)=>{
  const rows=(await pool.query(
    `SELECT w.id,w.user_id,w.amount,w.fee,w.net,w.network,w.address,w.txid,w.status,w.created_at,
            u.username,u.email
     FROM withdrawals w
     JOIN users u ON u.id=w.user_id
     ORDER BY w.created_at DESC LIMIT 100`
  )).rows;
  res.json({items:rows});
}));

app.patch('/api/admin/withdrawals/:id/status',adminAuth,asyncHandler(async(req,res)=>{
  const id=String(req.params.id||'');
  const status=String(req.body?.status||'');
  const txid=String(req.body?.txid||'').trim();
  if(!['approved','rejected'].includes(status))return res.status(400).json({error:'BAD_STATUS'});

  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const w=(await c.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!w){await c.query('ROLLBACK');return res.status(404).json({error:'WITHDRAWAL_NOT_FOUND'})}
    if(w.status!=='pending'){await c.query('ROLLBACK');return res.status(409).json({error:'ALREADY_PROCESSED'})}

    await c.query(
      `UPDATE withdrawals SET status=$1,txid=COALESCE(NULLIF($2,''),txid) WHERE id=$3`,
      [status,txid,id]
    );

    // Wallet is already debited when the user creates the withdrawal.
    // On rejection, refund the original requested amount exactly once.
    if(status==='rejected'){
      await postLedger(c,{
        userId:w.user_id,
        type:'withdrawal_refund',
        amount:Number(w.amount),
        referenceId:w.id,
        description:'بازگشت مبلغ برداشت ردشده توسط مدیریت',
        entryKey:`withdrawal_refund:${w.id}`,
        metadata:{withdrawalId:w.id,reason:'admin_rejected'}
      });
    }

    await c.query('COMMIT');
    await auditAdmin(req,'WITHDRAWAL_STATUS','withdrawal',id,{status,txid:txid||null,amount:Number(w.amount),userId:w.user_id});
    res.json({ok:true});
  }catch(e){
    try{await c.query('ROLLBACK')}catch(_){}
    throw e;
  }finally{c.release()}
}));

app.get('/api/admin/reservations',adminAuth,asyncHandler(async(req,res)=>{
  const rows=(await pool.query(
    `SELECT r.id,r.user_id,r.asset,r.started_at,r.ends_at,r.start_price,r.end_price,r.result,r.status,
            u.username,u.email
     FROM reservations r
     JOIN users u ON u.id=r.user_id
     ORDER BY r.started_at DESC LIMIT 100`
  )).rows;
  res.json({items:rows});
}));



app.get('/api/admin/finance/report',adminAuth,asyncHandler(async(req,res)=>{
  const mode=String(req.query.mode||'daily')==='monthly'?'monthly':'daily';
  const f=buildLedgerFilter(req.query,'l');
  const bucket=mode==='monthly'?`date_trunc('month',l.created_at)`:`date_trunc('day',l.created_at)`;

  const summary=(await pool.query(
    `SELECT
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='deposit'),0) deposits,
       COALESCE(ABS(SUM(l.amount) FILTER (WHERE l.type='withdrawal')),0) withdrawals,
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='withdrawal_refund'),0) withdrawal_refunds,
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='daily_profit'),0) profit,
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='referral_reward'),0) referral_rewards,
       COALESCE(ABS(SUM(l.amount) FILTER (WHERE l.type='investment_start')),0) invested,
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='investment_close'),0) investment_returns,
       COUNT(*)::int ledger_entries
     FROM wallet_ledger l
     JOIN users u ON u.id=l.user_id
     ${f.clause}`,
    f.params
  )).rows[0]||{};

  const series=(await pool.query(
    `SELECT
       ${bucket} bucket,
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='deposit'),0) deposits,
       COALESCE(ABS(SUM(l.amount) FILTER (WHERE l.type='withdrawal')),0) withdrawals,
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='daily_profit'),0) profit,
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='referral_reward'),0) referral_rewards,
       COALESCE(ABS(SUM(l.amount) FILTER (WHERE l.type='investment_start')),0) invested
     FROM wallet_ledger l
     JOIN users u ON u.id=l.user_id
     ${f.clause}
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT 90`,
    f.params
  )).rows;

  const activeCapital=await one(`SELECT COALESCE(SUM(principal),0) value FROM investments WHERE status='active'`);
  const integrity=await one(
    `SELECT COUNT(*)::int value
     FROM (
       SELECT w.user_id
       FROM wallets w
       LEFT JOIN wallet_ledger l ON l.user_id=w.user_id
       GROUP BY w.user_id,w.balance
       HAVING w.balance<>COALESCE(SUM(l.amount),0)
     ) x`
  );

  res.json({
    mode,
    summary:{
      deposits:Number(summary.deposits||0),
      withdrawals:Number(summary.withdrawals||0),
      withdrawalRefunds:Number(summary.withdrawal_refunds||0),
      profit:Number(summary.profit||0),
      referralRewards:Number(summary.referral_rewards||0),
      invested:Number(summary.invested||0),
      investmentReturns:Number(summary.investment_returns||0),
      ledgerEntries:Number(summary.ledger_entries||0),
      activeCapital:Number(activeCapital?.value||0),
      integrityMismatchUsers:Number(integrity?.value||0)
    },
    series:series.map(x=>({
      bucket:x.bucket,
      deposits:Number(x.deposits||0),
      withdrawals:Number(x.withdrawals||0),
      profit:Number(x.profit||0),
      referralRewards:Number(x.referral_rewards||0),
      invested:Number(x.invested||0)
    }))
  });
}));

app.get('/api/admin/finance/ledger',adminAuth,asyncHandler(async(req,res)=>{
  const f=buildLedgerFilter(req.query,'l');
  const limit=Math.min(200,Math.max(10,Number(req.query.limit)||50));
  const page=Math.max(1,Number(req.query.page)||1);
  const offset=(page-1)*limit;

  const total=Number((await pool.query(
    `SELECT COUNT(*)::int total
     FROM wallet_ledger l
     JOIN users u ON u.id=l.user_id
     ${f.clause}`,
    f.params
  )).rows[0]?.total||0);

  const params=[...f.params,limit,offset];
  const rows=(await pool.query(
    `SELECT
       l.id,l.user_id,l.type,l.amount,l.reference_id,l.description,
       l.entry_key,l.balance_after,l.metadata,l.created_at,
       u.username,u.email,u.phone
     FROM wallet_ledger l
     JOIN users u ON u.id=l.user_id
     ${f.clause}
     ORDER BY l.created_at DESC,l.id DESC
     LIMIT $${f.params.length+1}
     OFFSET $${f.params.length+2}`,
    params
  )).rows;

  res.json({page,limit,total,pages:Math.max(1,Math.ceil(total/limit)),items:rows});
}));

app.get('/api/admin/finance/export.csv',adminAuth,asyncHandler(async(req,res)=>{
  const f=buildLedgerFilter(req.query,'l');
  const rows=(await pool.query(
    `SELECT
       l.id,l.created_at,u.username,u.email,l.type,l.amount,l.balance_after,
       l.reference_id,l.entry_key,l.description
     FROM wallet_ledger l
     JOIN users u ON u.id=l.user_id
     ${f.clause}
     ORDER BY l.created_at DESC,l.id DESC
     LIMIT 10000`,
    f.params
  )).rows;

  const header=['Ledger ID','Created At UTC','Username','Email','Type','Amount USDT','Balance After USDT','Reference ID','Entry Key','Description'];
  const csv=[
    header.map(csvCell).join(','),
    ...rows.map(r=>[
      r.id,new Date(r.created_at).toISOString(),r.username,r.email,r.type,r.amount,
      r.balance_after,r.reference_id||'',r.entry_key||'',r.description||''
    ].map(csvCell).join(','))
  ].join('\r\n');

  await auditAdmin(req,'FINANCE_EXPORT_CSV','finance',null,{
    rows:rows.length,from:req.query.from||null,to:req.query.to||null,type:req.query.type||'all'
  });

  const stamp=new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="RET-ledger-${stamp}.csv"`);
  res.send('\ufeff'+csv);
}));

app.get('/api/admin/finance/export.pdf',adminAuth,asyncHandler(async(req,res)=>{
  const f=buildLedgerFilter(req.query,'l');

  const rows=(await pool.query(
    `SELECT l.id,l.created_at,u.username,l.type,l.amount,l.balance_after,l.reference_id
     FROM wallet_ledger l
     JOIN users u ON u.id=l.user_id
     ${f.clause}
     ORDER BY l.created_at DESC,l.id DESC
     LIMIT 1500`,
    f.params
  )).rows;

  const summary=(await pool.query(
    `SELECT
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='deposit'),0) deposits,
       COALESCE(ABS(SUM(l.amount) FILTER (WHERE l.type='withdrawal')),0) withdrawals,
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='daily_profit'),0) profit,
       COALESCE(SUM(l.amount) FILTER (WHERE l.type='referral_reward'),0) referral_rewards,
       COALESCE(ABS(SUM(l.amount) FILTER (WHERE l.type='investment_start')),0) invested
     FROM wallet_ledger l
     JOIN users u ON u.id=l.user_id
     ${f.clause}`,
    f.params
  )).rows[0]||{};

  const activeCapital=Number((await one(
    `SELECT COALESCE(SUM(principal),0) value FROM investments WHERE status='active'`
  ))?.value||0);

  const lines=[
    `Generated UTC: ${new Date().toISOString()}`,
    `Period: ${req.query.from||'ALL'} to ${req.query.to||'ALL'}`,
    `Type: ${req.query.type||'all'} | User: ${req.query.user||'all'} | Search: ${req.query.q||'-'}`,
    `Deposits: ${Number(summary.deposits||0).toFixed(8)} USDT`,
    `Withdrawals: ${Number(summary.withdrawals||0).toFixed(8)} USDT`,
    `Daily profit: ${Number(summary.profit||0).toFixed(8)} USDT`,
    `Referral rewards: ${Number(summary.referral_rewards||0).toFixed(8)} USDT`,
    `Invested in period: ${Number(summary.invested||0).toFixed(8)} USDT`,
    `Current active capital: ${activeCapital.toFixed(8)} USDT`,
    `Ledger rows in export: ${rows.length}`,
    '',
    'LEDGER AUDIT',
    'UTC Time | User | Type | Amount | Balance After | Ledger ID | Reference'
  ];

  for(const r of rows){
    lines.push(
      `${new Date(r.created_at).toISOString()} | ${r.username||'-'} | ${r.type} | ${Number(r.amount).toFixed(8)} | ${Number(r.balance_after||0).toFixed(8)} | ${r.id} | ${r.reference_id||'-'}`
    );
  }

  const pdf=buildSimpleAuditPdf({title:'RET Financial Audit Report',lines});

  await auditAdmin(req,'FINANCE_EXPORT_PDF','finance',null,{
    rows:rows.length,from:req.query.from||null,to:req.query.to||null,type:req.query.type||'all'
  });

  const stamp=new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="RET-audit-${stamp}.pdf"`);
  res.setHeader('Content-Length',String(pdf.length));
  res.end(pdf);
}));


app.get('/api/admin/transactions',adminAuth,asyncHandler(async(req,res)=>{
  const rows=(await pool.query(
    `SELECT l.id,l.user_id,l.type,l.amount,l.reference_id,l.description,
            l.entry_key,l.balance_after,l.metadata,l.created_at,
            u.username,u.email
     FROM wallet_ledger l
     JOIN users u ON u.id=l.user_id
     ORDER BY l.created_at DESC LIMIT 150`
  )).rows;
  res.json({items:rows});
}));

app.get('/api/admin/audit',adminAuth,asyncHandler(async(req,res)=>{
  const rows=(await pool.query(
    `SELECT a.id,a.action,a.target_type,a.target_id,a.details,a.ip,a.created_at,
            u.username admin_username
     FROM admin_audit_log a
     JOIN users u ON u.id=a.admin_user_id
     ORDER BY a.created_at DESC LIMIT 100`
  )).rows;
  res.json({items:rows});
}));




app.get('/api/admin/finance/integrity',adminAuth,asyncHandler(async(req,res)=>{
  const rows=(await pool.query(
    `SELECT
       w.user_id,
       u.username,
       w.balance AS wallet_projection,
       COALESCE(SUM(l.amount),0)::numeric(24,8) AS ledger_balance,
       (w.balance-COALESCE(SUM(l.amount),0))::numeric(24,8) AS difference
     FROM wallets w
     JOIN users u ON u.id=w.user_id
     LEFT JOIN wallet_ledger l ON l.user_id=w.user_id
     GROUP BY w.user_id,u.username,w.balance
     HAVING w.balance<>COALESCE(SUM(l.amount),0)
     ORDER BY ABS(w.balance-COALESCE(SUM(l.amount),0)) DESC`,
    []
  )).rows;

  res.json({
    ok:rows.length===0,
    mismatchCount:rows.length,
    items:rows
  });
}));


app.get('/api/admin/risk',adminAuth,asyncHandler(async(req,res)=>{
 const rows=(await pool.query(`SELECT r.*,u.username,u.email,s.flagged,s.risk_score current_risk_score FROM risk_events r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN user_risk_state s ON s.user_id=r.user_id WHERE r.reviewed_at IS NULL ORDER BY r.risk_score DESC,r.created_at DESC LIMIT 200`)).rows;
 const stats=await one(`SELECT COUNT(*) FILTER(WHERE reviewed_at IS NULL)::int open,COUNT(*) FILTER(WHERE reviewed_at IS NULL AND severity IN('high','critical'))::int high,COUNT(DISTINCT user_id) FILTER(WHERE reviewed_at IS NULL)::int users FROM risk_events`);
 res.json({stats,items:rows});
}));
app.post('/api/admin/risk/:id/review',adminAuth,asyncHandler(async(req,res)=>{
 const id=Number(req.params.id),r=await one('UPDATE risk_events SET reviewed_at=now(),reviewed_by=$1 WHERE id=$2 RETURNING user_id',[req.session.userId,id]);
 if(!r)return res.status(404).json({error:'RISK_EVENT_NOT_FOUND'});
 const x=await one('SELECT COALESCE(MAX(risk_score),0)::int score FROM risk_events WHERE user_id=$1 AND reviewed_at IS NULL',[r.user_id]),score=Number(x?.score||0);
 await pool.query(`INSERT INTO user_risk_state(user_id,risk_score,flagged,reason) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET risk_score=$2,flagged=$3,reason=$4,updated_at=now()`,[r.user_id,score,score>=55,score>=55?'ریسک باز نیازمند بررسی':null]);
 await auditAdmin(req,'RISK_REVIEW','risk_event',id,{userId:r.user_id});res.json({ok:true});
}));


app.get('/api/admin/system',adminAuth,asyncHandler(async(req,res)=>{
  const db=await one('SELECT current_database() db,now() now');
  const activeSessions=Number((await one(
    `SELECT count(*) n FROM auth_sessions
     WHERE revoked_at IS NULL AND expires_at>now()`
  ))?.n||0);
  const failedLogins24h=Number((await one(
    `SELECT count(*) n FROM login_history
     WHERE success=false AND created_at>now()-interval '24 hours'`
  ))?.n||0);
  const errors24h=Number((await one(
    `SELECT count(*) n FROM system_events
     WHERE level='error' AND created_at>now()-interval '24 hours'`
  ))?.n||0);
  const riskOpen=Number((await one(
    `SELECT count(*) n FROM risk_events WHERE reviewed_at IS NULL`
  ))?.n||0);

  res.json({
    ok:true,db:db?.db,time:db?.now,uptimeSeconds:Math.round(process.uptime()),
    counts:{activeSessions,failedLogins24h,errors24h,riskOpen}
  });
}));

app.get('*',(req,res,next)=>{
  const indexFile=fs.existsSync(rootIndexFile)?rootIndexFile:(fs.existsSync(publicIndexFile)?publicIndexFile:null);
  if(!indexFile) return res.status(404).json({error:'INDEX_NOT_FOUND'});
  res.sendFile(indexFile,err=>err?next(err):undefined);
});
app.use(async(err,req,res,next)=>{
  console.error(err);
  await systemEvent(req,'error','HTTP_ERROR',err?.message||String(err),{path:req.path,method:req.method});
  res.status(500).json({error:'SERVER'});
});

const port=Number(process.env.PORT||3000);
try{
  await initDatabase();
  await bootstrapAdminRole();
  app.listen(port,()=>console.log(`RET server on :${port}`));
}catch(err){
  console.error('Startup failed:',err);
  process.exit(1);
}
