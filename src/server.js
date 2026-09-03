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
app.use(session({
  store:new PgSession({pool,tableName:'session'}),
  secret:process.env.SESSION_SECRET || 'development-only-change-me',
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:process.env.NODE_ENV==='production'?'none':'lax',maxAge:7*24*60*60*1000}
}));
app.use(express.static(publicDir,{extensions:['html']}));

const norm=s=>String(s||'').trim().toLowerCase();
const auth=(req,res,next)=>req.session.userId?next():res.status(401).json({error:'AUTH_REQUIRED'});
const publicUser=r=>({
  id:r.id,firstName:r.first_name,lastName:r.last_name,phone:r.phone,email:r.email,
  docType:r.doc_type,doc:r.doc_number,username:r.username,refCode:r.ref_code,
  accountStatus:r.account_status,createdAt:r.created_at
});
async function one(q,p=[]){const r=await pool.query(q,p);return r.rows[0]||null}
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

app.get('/api/health',(_,res)=>res.json({ok:true}));

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

app.post('/api/auth/login',async(req,res)=>{
  const id=norm(req.body?.id).replace(/^@/,''); const password=String(req.body?.password||'');
  const u=await one('SELECT * FROM users WHERE username=$1 OR email=$1',[id]);
  if(!u || !(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:'BAD_LOGIN'});
  req.session.userId=u.id;res.json({user:publicUser(u)});
});
app.post('/api/auth/logout',auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));

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
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,req.session.userId]);
  res.json({ok:true});
});

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

app.get('/api/notifications',auth,async(req,res)=>{
  const rows=(await pool.query('SELECT id,type,title,message,is_read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 80',[req.session.userId])).rows;
  res.json({items:rows});
});
app.post('/api/notifications/read-all',auth,async(req,res)=>{
  await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1',[req.session.userId]);res.json({ok:true});
});

app.get('*',(req,res)=>res.sendFile(path.join(publicDir,'index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'SERVER'})});

const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`RET server on :${port}`));
