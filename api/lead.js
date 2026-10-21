// Vercel / Cloudflare Function — POST /api/lead
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, RESEND_API_KEY, EMAIL_TO

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit (memory, for demo — use Upstash in prod)
  // ...

  const body = req.body || await req.json?.() || {};
  const { brand, model, year, vin, faults, description, name, phone, messenger, segment, id } = body;

  // Validation (Zod in prod)
  if (!name || name.length < 2) return res.status(400).json({ error: 'name required' });
  const phoneDigits = (phone || '').replace(/\D/g, '');
  if (phoneDigits.length < 10) return res.status(400).json({ error: 'phone invalid' });
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin.toUpperCase())) return res.status(400).json({ error: 'VIN invalid' });
  if (body._trap) return res.status(400).json({ error: 'spam' }); // honeypot

  const lead = { ...body, createdAt: new Date().toISOString(), ip: req.headers['x-forwarded-for'] || req.ip };

  // Save (Turso / Postgres in prod)
  // await db.insert(leads).values(lead)

  // Parallel send
  const tasks = [];

  // Email via Resend
  if (process.env.RESEND_API_KEY) {
    tasks.push(
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'АвтоТехСервис <noreply@portovaya439.ru>',
          to: [process.env.EMAIL_TO || 'info@portovaya439.ru'],
          subject: `Новая заявка ${id} — ${brand} ${model} — ${(faults||[]).join(', ')}`,
          html: `
            <h2>🔧 Новая заявка ${id}</h2>
            <table cellpadding="8" style="border-collapse:collapse">
              <tr><td><b>Авто:</b></td><td>${segment} ${brand} ${model} ${year}</td></tr>
              <tr><td><b>VIN:</b></td><td><code>${vin||'не указан'}</code></td></tr>
              <tr><td><b>Неисправности:</b></td><td>${(faults||[]).join(', ')}</td></tr>
              <tr><td><b>Описание:</b></td><td>${description||'—'}</td></tr>
              <tr><td><b>Клиент:</b></td><td>${name} — <a href="tel:${phone}">${phone}</a> (${messenger})</td></tr>
              <tr><td><b>Время:</b></td><td>${lead.createdAt}</td></tr>
              <tr><td><b>UTM:</b></td><td>${JSON.stringify(lead.utm||{})}</td></tr>
            </table>
            <p><a href="https://portovaya439.ru/admin">Открыть админку</a></p>
          `
        })
      }).then(r=> r.ok ? console.log('email sent') : console.error('email fail', r.status))
    );
  }

  // Telegram
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const text =
      `🔧 <b>Новая заявка ${id}</b>\n` +
      `<b>Авто:</b> ${segment} ${brand} ${model} ${year}\n` +
      `<b>VIN:</b> <code>${vin||'—'}</code>\n` +
      `<b>Неисправности:</b> ${(faults||[]).join(', ')}\n` +
      `<b>Описание:</b> ${description||'—'}\n` +
      `<b>Клиент:</b> ${name} — ${phone} (${messenger})\n` +
      `<b>Время:</b> ${lead.createdAt}\n` +
      `<b>Ссылка:</b> https://portovaya439.ru/admin`;

    tasks.push(
      fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📞 Позвонить', url: `tel:${phone}` }],
              [{ text: '💬 WhatsApp', url: `https://wa.me/${phoneDigits}` }]
            ]
          }
        })
      })
    );

    // If files: sendMediaGroup (requires file_id or URL)
    // ...
  }

  await Promise.allSettled(tasks);

  return res.status(200).json({ ok: true, id });
}
