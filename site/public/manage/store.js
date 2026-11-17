// Копия slug-ов из актуального seed-data.ts (services.ts получает их из базы).
export const SERVICES = [
 ['shinomontazh','Шиномонтаж легковых автомобилей'],['balansirovka','Балансировка и ремонт колёс'],
 ['to-maslo','ТО и замена масла'],['tormoza','Тормоза'],['podveska','Подвеска и рулевое управление'],
 ['grm-sceplenie','ГРМ и сцепление'],['svarka','Сварочные работы и выхлоп'],['diagnostika','Диагностика и кондиционер'],
 ['remont-kolesa','Ремонт колеса'],['sceplenie','Сцепление'],['diagnostika-hodovaya','Диагностика ходовой']
];
export const widths = [480, 960, 1600];
export const clone = value => JSON.parse(JSON.stringify(value));
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function slugify(s) {
 const map = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'};
 return s.toLowerCase().split('').map(c=>map[c] ?? c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80).replace(/-+$/,'');
}
export function id() { const bytes = new Uint8Array(6); crypto.getRandomValues(bytes); return Array.from(bytes, n => 'abcdefghijklmnopqrstuvwxyz0123456789'[n % 36]).join(''); }
export function blank(cases) { return {slug:'',title:'',description:'',service_slug:SERVICES[0][0],mode:'before_after',status:'draft',published_at:new Date().toISOString().slice(0,10),sort:Math.max(0,...cases.map(c=>Number(c.sort)||0))+10,cover:null,before:[],after:[],photos:[]}; }
export function validate(c, cases, originalSlug) {
 if (!c.title.trim()) throw Error('Укажите название работы.');
 if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.slug)) throw Error('Слаг: только латинские буквы, цифры и дефисы.');
 if (cases.some(x=>x.slug===c.slug && x.slug!==originalSlug)) throw Error('Этот слаг уже занят. Выберите другой.');
 if (!SERVICES.some(([slug])=>slug===c.service_slug)) throw Error('Выберите услугу из списка.');
 if (!/^\d{4}-\d{2}-\d{2}$/.test(c.published_at)) throw Error('Укажите дату работы.');
 const frames=[...c.before,...c.after,...c.photos];
 if (!frames.length) throw Error('Добавьте хотя бы одно фото.');
 if (frames.length>10) throw Error('Не больше 10 фото на кейс.');
 if (frames.some(p=>!p.alt?.trim())) throw Error('Добавьте подпись к каждому снимку.');
 if (new Set(frames.map(p=>p.base)).size!==frames.length) throw Error('Совпали имена фотографий. Удалите одну из них и добавьте снова.');
 if (!['draft','published'].includes(c.status)) throw Error('Выберите статус работы.');
 if ((c.mode==='single' && (c.before.length || c.after.length)) || (c.mode==='before_after' && c.photos.length)) throw Error('Фотографии не соответствуют выбранному режиму.');
 if (!['single','before_after'].includes(c.mode)) throw Error('Выберите режим.');
 if (!c.cover || !frames.some(p=>p.base===c.cover.base)) throw Error('Выберите обложку из фотографий.');
}
