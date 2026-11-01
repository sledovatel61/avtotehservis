/** Создание администратора: npm run admin:create -- <login> <пароль≥12> (или интерактивно из stdin).
 *  Пароль хешируется scrypt и НЕ сохраняется в логах. */
import { createInterface } from 'node:readline';
import { db } from '../src/server/db.ts';
import { runMigrations } from './migrate.ts';
import { hashPassword } from '../src/server/auth.ts';

function ask(q: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const out = rl as unknown as { output: import('node:stream').Writable };
    const stdin = process.stdin;
    const onData = (ch: Buffer) => { /* глушим эхо */ void out; void ch; };
    stdin.on('data', onData);
    return new Promise((res) => rl.question(q, (a) => { stdin.off('data', onData); rl.close(); res(a.trim()); }));
  }
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

async function main(): Promise<void> {
  runMigrations();
  let [login, password] = process.argv.slice(2);
  if (!login) login = await ask('Логин администратора: ');
  if (!password) password = await ask('Пароль (≥12 символов): ', true);
  if (!login || !/^[a-z0-9._-]{3,32}$/i.test(login)) { console.error('Логин: 3–32 символа, латиница/цифры/._-'); process.exit(1); }
  if (!password || password.length < 12) { console.error('Пароль должен быть ≥12 символов.'); process.exit(1); }
  const hash = await hashPassword(password);
  try {
    db().prepare(`INSERT INTO admin_users(login, password_hash, role) VALUES(?, ?, 'owner')`).run(login, hash);
  } catch {
    db().prepare('UPDATE admin_users SET password_hash=? WHERE login=?').run(hash, login);
    console.log(`Пароль существующего администратора «${login}» обновлён.`);
    return;
  }
  console.log(`Администратор «${login}» создан (роль owner). Пароль напечатан один раз — сохраните его сейчас: ${password}`);
  console.log('Вход: /admin/login');
}

const isMain = process.argv[1] && process.argv[1].endsWith('create-admin.ts');
if (isMain) void main();
