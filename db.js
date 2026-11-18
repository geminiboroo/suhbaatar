import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash, randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password,salt,64).toString('hex');
}
export function equal(left,right) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a,b);
}
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
export async function atomic(fn, db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(db) {
  await db.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
}
export const audit = (db, admin, action, target) =>
  db.query('INSERT INTO audit_logs(admin_id,action,target) VALUES ($1,$2,$3)',[admin,action,String(target)]);
export const one = async (db,sql,params=[]) => (await db.query(sql,params)).rows[0];
export const active = "c.active AND c.public AND NOT c.archived AND (c.starts IS NULL OR c.starts<=now()) AND (c.ends IS NULL OR c.ends>now())";
export async function lockCampaign(db,id) {
  const campaign = await one(db,'SELECT * FROM campaigns WHERE id=$1 AND NOT archived FOR UPDATE',[id]);
  if (!campaign) throw new Error('Сугалаа олдсонгүй');
  return campaign;
}
export async function allocate(db,campaign,transaction,requested,count) {
  if (requested.length && requested.length !== count) throw new Error('Эрхийн тоо, дугаарын тоо зөрүүтэй');
  const used = new Set((await db.query('SELECT number FROM lottery_tickets WHERE campaign_id=$1',[campaign.id])).rows.map(row=>row.number));
  if (used.size+count>campaign.total) throw new Error('Үлдэгдэл эрх хүрэлцэхгүй');
  if (requested.some(n=>n>campaign.total || used.has(n))) throw new Error('Эрхийн дугаар ашиглагдсан эсвэл хязгаараас хэтэрсэн');
  const numbers = [...requested];
  if (!requested.length) {
    for (let n=1;n<=campaign.total && numbers.length<count;n++) if (!used.has(n)) numbers.push(n);
  }
  await db.query('INSERT INTO lottery_tickets(campaign_id,transaction_id,number) SELECT $1,$2,unnest($3::integer[])',[campaign.id,transaction,numbers]);
}
export async function addTransaction(db,campaign,entry,status,importId=null) {
  const participant = await one(db,'INSERT INTO participants(phone) VALUES ($1) ON CONFLICT(phone) DO UPDATE SET phone=excluded.phone RETURNING id',[entry.phone]);
  const row = await one(db,`INSERT INTO transactions(campaign_id,participant_id,import_id,occurred_at,amount,bank,memo,count,requested,status,dedupe,provider,external_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [campaign.id,participant.id,importId,entry.date,entry.amount,entry.bank||'',entry.memo||'',entry.count,entry.tickets,status,entry.key||null,entry.provider||null,entry.externalId||null]);
  if (status==='confirmed') await allocate(db,campaign,row.id,entry.tickets,entry.count);
  return row.id;
}
