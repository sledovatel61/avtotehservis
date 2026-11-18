// Копия видимых slug-ов из актуального seed-data.ts (services.ts получает их из базы).
export const SERVICES = [
 ['shinomontazh','Шиномонтаж легковых автомобилей'],['balansirovka','Балансировка и ремонт колёс'],
 ['to-maslo','ТО и замена масла'],['tormoza','Тормоза'],['podveska','Подвеска и рулевое управление'],
 ['grm-sceplenie','ГРМ и сцепление'],['svarka','Сварочные работы и выхлоп'],['diagnostika','Диагностика и кондиционер']
];
export const widths = [480, 960, 1600];
export const clone = value => JSON.parse(JSON.stringify(value));
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Лимиты обязаны совпадать с site/src/shared/cases-schema.ts.
export const LIMITS = Object.freeze({title: {min:5,max:90}, description: {min:0,max:200}, alt: {min:3,max:160}, slug: {min:3,max:60}});
export class ValidationError extends Error {
 constructor(message, field) { super(message); this.name='ValidationError'; this.field=field; }
}
export function slugify(s) {
 const map = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'};
 return s.toLowerCase().split('').map(c=>map[c] ?? c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,LIMITS.slug.max).replace(/-+$/,'');
}
export function id() { const bytes = new Uint8Array(6); crypto.getRandomValues(bytes); return Array.from(bytes, n => 'abcdefghijklmnopqrstuvwxyz0123456789'[n % 36]).join(''); }
export function blank(cases) { return {slug:'',title:'',description:'',service_slug:SERVICES[0][0],mode:'before_after',status:'draft',published_at:new Date().toISOString().slice(0,10),sort:Math.max(0,...cases.map(c=>Number(c.sort)||0))+10,cover:null,before:[],after:[],photos:[]}; }
function lengthCheck(value, limits, label, field) {
 const length=value.trim().length;
 if(length<limits.min||length>limits.max) throw new ValidationError(`${label}: ${limits.min}–${limits.max} символов, сейчас ${length} — ${length>limits.max?'сократите':'дополните'}.`,field);
}
export function validate(c, cases, originalSlug) {
 if (typeof c.title!=='string'||!c.title.trim()) throw new ValidationError('Укажите название работы.','title');
 lengthCheck(c.title,LIMITS.title,'Название','title');
 if(typeof c.description!=='string') throw new ValidationError('Укажите описание текстом.','description');
 lengthCheck(c.description,LIMITS.description,'Описание','description');
 if(typeof c.slug!=='string') throw new ValidationError('Укажите слаг.','slug');
 lengthCheck(c.slug,LIMITS.slug,'Слаг','slug');
 if (!/^[a-z0-9-]{3,60}$/.test(c.slug)) throw new ValidationError('Слаг: только латинские буквы, цифры и дефисы.','slug');
 if (cases.some(x=>x.slug===c.slug && x.slug!==originalSlug)) throw new ValidationError('Этот слаг уже занят. Выберите другой.','slug');
 if (!SERVICES.some(([slug])=>slug===c.service_slug)) throw new ValidationError('Выберите услугу из списка.','service_slug');
 if (typeof c.published_at!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.published_at)) throw new ValidationError('Укажите дату работы.','published_at');
 if (!Number.isFinite(Number(c.sort))) throw new ValidationError('Порядок кейса должен быть числом.');
 if (!['single','before_after'].includes(c.mode)) throw new ValidationError('Выберите режим.');
 if (!['draft','published'].includes(c.status)) throw new ValidationError('Выберите статус работы.','status');
 if (!['before','after','photos'].every(key=>Array.isArray(c[key]))) throw new ValidationError('Список фотографий повреждён.');
 if (c.mode==='before_after' && (!c.before.length || !c.after.length)) {
  const emptyZone=c.before.length ? 'after' : 'before';
  throw new ValidationError('В режиме «До и после» нужны обе фотографии: «как было» и «как стало». Добавьте вторую или переключитесь на «Одно фото работы».',`zone:${emptyZone}`);
 }
 const frames=[...c.before,...c.after,...c.photos];
 if (!frames.length) throw new ValidationError('Добавьте хотя бы одно фото.', 'zone:photos');
 if (frames.length>10) throw new ValidationError('Не больше 10 фото на кейс.');
 for(const key of ['before','after','photos']) for(const [i,p] of c[key].entries()) {
  const field=`alt:${key}:${i}`;
  if (!p || typeof p.alt!=='string' || !p.alt.trim()) throw new ValidationError('Добавьте подпись к снимку: 3–160 символов.',field);
  lengthCheck(p.alt,LIMITS.alt,'Подпись',field);
  if (typeof p.base!=='string'||!/^[a-z0-9]{4,12}-(before|after|single)$/.test(p.base)) throw new ValidationError('Некорректное имя фотографии. Добавьте её снова.');
  const phase={before:'before',after:'after',photos:'single'}[key];
  if (!p.base.endsWith(`-${phase}`)) throw new ValidationError('Фотография не соответствует выбранной зоне.');
  if (!Number.isFinite(Number(p.w)) || Number(p.w)<=0 || !Number.isFinite(Number(p.h)) || Number(p.h)<=0) throw new ValidationError('Некорректный размер фотографии. Добавьте её снова.');
  if (!['webp','jpg'].includes(p.ext)) throw new ValidationError('Некорректный формат фотографии. Добавьте её снова.');
 }
 if (new Set(frames.map(p=>p.base)).size!==frames.length) throw new ValidationError('Совпали имена фотографий. Удалите одну из них и добавьте снова.');
 if ((c.mode==='single' && (c.before.length || c.after.length)) || (c.mode==='before_after' && c.photos.length)) throw new ValidationError('Фотографии не соответствуют выбранному режиму.');
 const cover=c.cover && frames.find(p=>p.base===c.cover.base);
 if (!cover) throw new ValidationError('Выберите обложку из фотографий.');
 if (typeof c.cover.alt!=='string' || c.cover.alt.trim()!==cover.alt.trim() || Number(c.cover.w)!==Number(cover.w) || Number(c.cover.h)!==Number(cover.h) || c.cover.ext!==cover.ext) throw new ValidationError('Обложка не соответствует выбранной фотографии. Выберите её снова.');
}
