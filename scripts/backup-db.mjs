import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const db=process.env.DATABASE_URL;
const secret=process.env.BACKUP_ENCRYPTION_KEY;
if(!db||!secret)throw new Error('DATABASE_URL and BACKUP_ENCRYPTION_KEY are required');

const chunks=[];
await new Promise((resolve,reject)=>{
  const p=spawn('pg_dump',['--no-owner','--no-privileges',db]);
  p.stdout.on('data',d=>chunks.push(d));
  p.stderr.on('data',d=>process.stderr.write(d));
  p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error('pg_dump failed '+c)));
});
const plain=Buffer.concat(chunks),iv=crypto.randomBytes(12);
const key=crypto.createHash('sha256').update(secret).digest();
const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
const enc=Buffer.concat([cipher.update(plain),cipher.final()]);
const payload=Buffer.concat([Buffer.from('RETBACKUP1'),iv,cipher.getAuthTag(),enc]);
const name=`ret-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.bin`;

if(process.env.BACKUP_UPLOAD_URL){
  const r=await fetch(process.env.BACKUP_UPLOAD_URL,{
    method:'POST',
    headers:{'Content-Type':'application/octet-stream','X-Backup-Name':name,
      ...(process.env.BACKUP_UPLOAD_TOKEN?{Authorization:`Bearer ${process.env.BACKUP_UPLOAD_TOKEN}`}:{})},
    body:payload
  });
  if(!r.ok)throw new Error('backup upload failed '+r.status);
  console.log('Encrypted backup uploaded:',name);
}else{
  await fs.writeFile(name,payload);
  console.log('Encrypted backup written:',name);
}
