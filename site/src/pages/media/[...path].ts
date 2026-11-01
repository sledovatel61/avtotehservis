import type { APIRoute } from 'astro';
import { readFileSync } from 'node:fs';
import { mediaFilePath, contentTypeFor } from '../../server/media.ts';

export const GET: APIRoute = async ({ params, request }) => {
  const headersRange = request.headers.get('range');
  const parts = String(params.path ?? '').split('/').filter(Boolean);
  if (parts.length !== 2) return new Response('Not found', { status: 404 });
  const fp = mediaFilePath(parts[0], parts[1]);
  if (!fp) return new Response('Not found', { status: 404 });
  const type = contentTypeFor(parts[1]);
  const baseHeaders = {
    'Content-Type': type,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
  if (type.startsWith('video/')) {
    const { statSync, openSync, readSync, closeSync } = await import('node:fs');
    const size = statSync(fp).size;
    const range = headersRange;
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (m) {
        const rawStart = parseInt(m[1], 10);
        if (rawStart >= size) {
          // RFC 9110: диапазон за концом файла — 416, а не 206 с одним байтом (minor-3 ревью round4).
          return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` } });
        }
        const start = rawStart;
        const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : Math.min(start + 1024 * 1024 - 1, size - 1);
        if (end < start) {
          // Перевёрнутый диапазон (bytes=100-50): 416, а не 500 от Buffer.alloc
          // отрицательного размера (minor-1 ревью round5).
          return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` } });
        }
        const chunk = Buffer.alloc(end - start + 1);
        const fd = openSync(fp, 'r');
        readSync(fd, chunk, 0, chunk.length, start);
        closeSync(fd);
        return new Response(new Uint8Array(chunk), {
          status: 206,
          headers: { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(chunk.length) },
        });
      }
    }
    const buf = readFileSync(fp);
    return new Response(new Uint8Array(buf), { status: 200, headers: { ...baseHeaders, 'Content-Length': String(size) } });
  }
  const buf = readFileSync(fp);
  return new Response(new Uint8Array(buf), {
    status: 200,
    // Content-Length нужен nginx и клиентам (фото-ветка отдавалась chunked — nit ревью round4).
    headers: { ...baseHeaders, 'Content-Length': String(buf.length) },
  });
};
