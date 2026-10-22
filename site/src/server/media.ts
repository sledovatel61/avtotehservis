import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mediaDir } from './db.ts';
import { db } from './db.ts';

export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const PHOTO_VARIANTS = [480, 960, 1600] as const;

export class MediaError extends Error {
  code: 'too_large' | 'bad_type' | 'bad_file';
  constructor(message: string, code: 'too_large' | 'bad_type' | 'bad_file' = 'bad_file') {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

/** Проверка сигнатуры: JPEG/PNG/WebP/AVIF. SVG и всё прочее — отклоняется (§10). */
export function detectImage(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'avif' | null {
  if (buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['avif', 'avis', 'mif1'].includes(brand)) return 'avif';
  }
  return null;
}

export const MIME_BY_KIND: Record<string, string> = {
  jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif',
};

export interface ProcessedPhoto { id: string; mime: string; width: number; height: number; bytes: number }

/** Приём фото заявки: автоповорот, снятие EXIF (включая GPS), ресайз ≤2000 px, варианты 480/960/1600 (WebP+AVIF+JPEG). */
export async function processPhotoUpload(buf: Buffer): Promise<ProcessedPhoto> {
  if (buf.length > PHOTO_MAX_BYTES) throw new MediaError('Файл больше 15 МБ', 'too_large');
  const kind = detectImage(buf);
  if (!kind) throw new MediaError('Допустимы JPEG, PNG, WebP или AVIF. SVG и прочие форматы не принимаются', 'bad_type');

  const id = 'upl_' + randomBytes(9).toString('base64url');
  const dir = join(mediaDir(), id);
  mkdirSync(dir, { recursive: true });

  // rotate() — автоповорот по EXIF; при перекодировании метаданные (включая GPS) удаляются.
  const base = sharp(buf, { failOn: 'none' }).rotate()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true });
  const { data: master, info } = await base.jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  writeFileSync(join(dir, 'master.jpg'), master);

  for (const w of PHOTO_VARIANTS) {
    const v = sharp(master).resize({ width: w, withoutEnlargement: true });
    await v.webp({ quality: 82 }).toFile(join(dir, `v${w}.webp`));
    await v.avif({ quality: 68, effort: 4 }).toFile(join(dir, `v${w}.avif`));
    await v.jpeg({ quality: 84, mozjpeg: true }).toFile(join(dir, `v${w}.jpg`));
  }

  const bytes = statSync(join(dir, 'master.jpg')).size;
  db().prepare(`INSERT INTO media(id, kind, path, width, height, bytes, mime, attached_to)
                VALUES(?, 'photo', ?, ?, ?, ?, ?, NULL)`).run(id, `${id}/master.jpg`, info.width, info.height, bytes, 'image/jpeg');
  return { id, mime: 'image/jpeg', width: info.width ?? 0, height: info.height ?? 0, bytes };
}

/** Привязка загрузки к сущности (lead/case/news). */
export function attachMedia(mediaId: string, attachedTo: string): void {
  db().prepare('UPDATE media SET attached_to=? WHERE id=? AND attached_to IS NULL').run(attachedTo, mediaId);
}

/** Белая маска имени файла для маршрута выдачи (защита от path traversal). */
export const MEDIA_FILE_RE = /^(?:master\.jpg|v(?:480|960|1600)\.(?:webp|avif|jpg)|poster\.jpg|original\.(?:mp4|webm))$/;
export const MEDIA_ID_RE = /^(?:upl|med|vid)_[A-Za-z0-9_-]+$/;

export function mediaFilePath(id: string, file: string): string | null {
  if (!MEDIA_ID_RE.test(id) || !MEDIA_FILE_RE.test(file)) return null;
  const p = join(mediaDir(), id, file);
  try { statSync(p); return p; } catch { return null; }
}

export function contentTypeFor(file: string): string {
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.avif')) return 'image/avif';
  if (file.endsWith('.jpg')) return 'image/jpeg';
  if (file.endsWith('.mp4')) return 'video/mp4';
  if (file.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}
