import {pool,migrate,passwordHash} from './db.js';

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await migrate(pool);
  const {ADMIN_USERNAME:username, ADMIN_PASSWORD:password}=process.env;
  if (username || password) {
    if (!/^[\w.-]{3,64}$/.test(username||'') || !password || password.length<14 || password.length>160) throw new Error('Invalid administrator bootstrap credentials');
    await pool.query('INSERT INTO admins(username,password) VALUES ($1,$2) ON CONFLICT(username) DO NOTHING',[username,passwordHash(password)]);
  }
  console.log('Database migration completed');
} finally {
  await pool.end();
}
