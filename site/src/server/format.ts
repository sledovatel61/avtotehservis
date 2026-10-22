const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

export function fmtDateRu(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.includes('T') || iso.includes(' ') ? iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z') : iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('T') && !iso.endsWith('Z') ? 'Z' : iso.endsWith('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
