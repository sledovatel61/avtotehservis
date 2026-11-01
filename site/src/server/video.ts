import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mediaDir, db } from './db.ts';
import { MediaError } from './media.ts';

export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 180;

export function detectVideo(buf: Buffer): 'mp4' | 'webm' | null {
  if (buf.length < 16) return null;
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['mp41', 'mp42', 'isom', 'iso2', 'avc1', 'm4v ', 'dash'].includes(brand)) return 'mp4';
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'; // WebM/EBML
  return null;
}

export interface ProcessedVideo { id: string; mime: string; bytes: number; duration: number | null }

/** Видео ≤100 МБ (MP4/WebM). Постер обязателен: из ffmpeg (если настроен) или отдельным фото. */
export function processVideoUpload(buf: Buffer, posterBuf: Buffer | null): ProcessedVideo {
  if (buf.length > VIDEO_MAX_BYTES) throw new MediaError('Видео больше 100 МБ', 'too_large');
  const kind = detectVideo(buf);
  if (!kind) throw new MediaError('Допустимы видео MP4 или WebM', 'bad_type');
  const ffmpeg = process.env.FFMPEG_PATH || '';

  const id = 'vid_' + randomBytes(9).toString('base64url');
  const dir = join(mediaDir(), id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `original.${kind}`);
  writeFileSync(file, buf);

  let duration: number | null = null;
  if (ffmpeg) {
    try {
      const ffprobe = ffmpeg.replace(/ffmpeg(\.\w+)?$/, 'ffprobe$1');
      const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8', timeout: 30000 });
      const d = parseFloat((probe.stdout ?? '').trim());
      if (!isNaN(d)) duration = Math.round(d);
    } catch { /* длительность неизвестна — честный null */ }
    if (duration !== null && duration > VIDEO_MAX_SECONDS) {
      throw new MediaError(`Видео длиннее 3 минут (${duration} с) — сократите или нарежьте кадры фотографиями`, 'bad_file');
    }
  }

  let posterPath: string | null = null;
  if (posterBuf && posterBuf.length > 0) {
    writeFileSync(join(dir, 'poster.jpg'), posterBuf);
    posterPath = `${id}/poster.jpg`;
  } else if (ffmpeg) {
    try {
      const out = join(dir, 'poster.jpg');
      spawnSync(ffmpeg, ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-q:v', '4', out], { timeout: 60000 });
      if (existsSync(out) && statSync(out).size > 0) posterPath = `${id}/poster.jpg`;
    } catch { /* попробуем обязать ручной постер */ }
  }
  if (!posterPath) {
    throw new MediaError('К видео нужен постер: приложите фото-обложку (или настройте FFMPEG_PATH на сервере)', 'bad_file');
  }

  const bytes = statSync(file).size;
  db().prepare(`INSERT INTO media(id, kind, path, poster_path, duration, bytes, mime, attached_to)
                VALUES(?, 'video', ?, ?, ?, ?, ?, NULL)`).run(id, `${id}/original.${kind}`, posterPath, duration, bytes, kind === 'mp4' ? 'video/mp4' : 'video/webm');
  return { id, mime: kind === 'mp4' ? 'video/mp4' : 'video/webm', bytes, duration };
}
