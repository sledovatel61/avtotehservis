import type { APIRoute } from 'astro';
import { processPhotoUpload, MediaError, PHOTO_MAX_BYTES } from '../../server/media.ts';
import { checkLimit, limitFromEnv, LIMITS } from '../../server/ratelimit.ts';
import { hashIp } from '../../server/leads.ts';
import { clientIp, json, err, bodyTooLarge } from '../../server/http.ts';
import { ensureWorkers } from '../../server/outbox.ts';

export const POST: APIRoute = async (ctx) => {
  ensureWorkers();
  const maxUploads = limitFromEnv('RATE_LIMIT_UPLOADS', LIMITS.uploads.max);
  const rl = checkLimit('uploads:' + (hashIp(clientIp(ctx)) ?? 'anon'), maxUploads, LIMITS.uploads.windowMs);
  if (!rl.ok) return err(429, 'too_many', 'Слишком много загрузок. Повторите позже.', {}, undefined, { 'Retry-After': String(rl.retryAfterSec) });

  // Один файл до 15 МБ + запас на multipart-обёртку: отклоняем по Content-Length,
  // не читая тело в память (minor-5 ревью).
  if (bodyTooLarge(ctx.request, PHOTO_MAX_BYTES + 1024 * 1024)) {
    return err(413, 'too_large', 'Файл больше 15 МБ');
  }

  let form: FormData;
  try { form = await ctx.request.formData(); } catch {
    return err(400, 'bad_multipart', 'Ожидался multipart/form-data с полем file');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return err(400, 'no_file', 'Файл не передан (поле file)');
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const p = await processPhotoUpload(buf);
    return json({ id: p.id, url: `/media/${p.id}/master.jpg`, width: p.width, height: p.height }, 201);
  } catch (e) {
    if (e instanceof MediaError) {
      return err(e.code === 'too_large' ? 413 : 400, e.code, e.message);
    }
    console.error('[uploads]', String((e as Error)?.message ?? e).slice(0, 200));
    return err(500, 'upload_failed', 'Не удалось обработать файл. Попробуйте другой.');
  }
};
