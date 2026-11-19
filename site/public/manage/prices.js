import {LIMITS, validate, slugifyRu, isValidPrice, findPriceItem, removePriceItem, renamePriceItem} from './prices-schema.js';
import {escapeHTML as esc} from './store.js';

const clone=x=>JSON.parse(JSON.stringify(x));
const PRICE_ERROR='Похоже, это не цена. Напишите, например: 1200 ₽';
const LIMIT_ERROR='В одной категории не больше 40 работ. Заведите новую категорию через разработчика.';
const REFS_WARNING='Проверить ссылки в текстах не удалось. Если после сохранения сборка остановится, напишите разработчику.';
const VERSION_ERROR='Файл цен от другой версии сайта, сообщите разработчику';
const readError=r=>r.errors.includes(VERSION_ERROR)?VERSION_ERROR:'Не удалось прочитать цены. Обратитесь к разработчику.';
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const categories=doc=>[...doc.groups.map(g=>({key:`group:${g.id}`,title:g.title,kind:'group',items:g.items})),
 {key:'tyres:set',title:'Шиномонтаж — комплект',kind:'set',items:doc.tyres.set},
 {key:'tyres:repair',title:'Ремонт колёс',kind:'repair',items:doc.tyres.repair},
 {key:'tyres:extra',title:'Дополнительные работы с колёсами',kind:'extra',items:doc.tyres.extra},
 {key:'voyah',title:'Voyah Free',kind:'voyah',items:doc.voyah}];
const keyOf=(cat,id)=>`${cat}|${id}`;
const rowsOf=(doc,cat)=>cat.kind==='group'?doc.groups.find(g=>`group:${g.id}`===cat.key)?.items:cat.kind==='voyah'?doc.voyah:doc.tyres[cat.kind];
const nameOf=(p,kind)=>kind==='set'?p.radius:kind==='repair'?(p.radius??p.range):p.name;
const nameField=kind=>kind==='set'?'radius':kind==='repair'?'range':'name';
const priceFields=kind=>kind==='set'?[['passenger','Легковой'],['crossover','Кроссовер']]:[['price','Цена']];
const allIds=doc=>new Set([...doc.groups.flatMap(g=>[g.id,...g.items.map(p=>p.id)]),...['set','repair','extra'].flatMap(k=>doc.tyres[k].map(p=>p.id)),...doc.voyah.map(p=>p.id),...doc.featured.map(p=>p.id)]);
const nextId=(name,used)=>{let base=slugifyRu(name);if(base.length<LIMITS.id[0])base='poziciya';let id=base,n=2;while(used.has(id)){const suffix=`-${n++}`;id=base.slice(0,LIMITS.id[1]-suffix.length).replace(/-+$/,'')+suffix;}used.add(id);return id;};
function words(n){const last=n%10,hundred=n%100;return `${n} ${hundred>=11&&hundred<=14?'работ':last===1?'работа':last>=2&&last<=4?'работы':'работ'}`;}
function errorText(e){if(e?.status===401)return 'Ключ доступа не принят. Проверьте его срок.';if(e?.status===403)return 'Нет доступа к ценам. Проверьте права ключа.';if(e?.status===404)return 'Список цен пока недоступен. Обратитесь к разработчику.';if(e?.status===409||e?.status===422)return e.message?.startsWith('Кто-то')?e.message:'Кто-то сохранил изменения одновременно. Нажмите «Сохранить» ещё раз — мы повторим.';return e?.message||'Не удалось сохранить: нет связи. Попробуйте ещё раз.';}
function pageName(file){return file.replace(/^src\/pages\/index\.astro$/,'/').replace(/^src\/pages\//,'/').replace(/\.astro$/,'/');}
async function loadRefs(){try{const response=await fetch('./price-refs.json',{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();if(!data||!data.refs||typeof data.refs!=='object'||!data.featured||typeof data.featured!=='object')throw Error();return data;}catch{return null;}}
function refProblem(refs,doc,id,action){
 const chips=(doc.featured||[]).filter(f=>f.ref===id);
 if(action==='delete'&&chips.length)return `На эту работу ссылается плашка на главной: ${chips.map(c=>c.title).join(', ')}. Удалить сможет разработчик. Пока нажмите «Скрыть».`;
 const hits=refs&&Array.isArray(refs.refs[id])?refs.refs[id]:[];
 if(hits.length){const pages=[...new Set(hits.map(r=>pageName(String(r.file||''))) .filter(Boolean))].join(', ');return `${action==='rename'?'Это название упоминается в текстах':'На эту работу ссылаются страницы'}: ${pages}. ${action==='rename'?'Переименовать':'Удалить'} сможет разработчик после правки текстов. Пока нажмите «Скрыть» — цена исчезнет с сайта, а тексты останутся целыми.`;}
 return '';
}
export function createPrices(root){
 let api=null,snapshot=null,saving=false,lastCommit=null,notice='',noticeError=false,success=false;
 const changes=new Map(),edits=new Map(),confirmations=new Map(),addDrafts=new Map();
 let open=new Set();
 try{const stored=JSON.parse(localStorage.getItem('atsPricesOpen')||'[]');if(Array.isArray(stored))open=new Set(stored.filter(x=>typeof x==='string'));}catch{}
 const persistOpen=()=>{try{localStorage.setItem('atsPricesOpen',JSON.stringify([...open]));}catch{}};
 const dirty=()=>changes.size>0||[...edits.values()].some(e=>JSON.stringify(e.fields)!==JSON.stringify(e.initial))||[...addDrafts.values()].some(d=>Object.values(d).some(v=>v.trim()));
 window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
 const changed=(cat,id)=>changes.get(keyOf(cat,id));
 function tell(text,error=false){notice=text;noticeError=error;const el=root.querySelector('[data-price-message]');if(el){el.textContent=text;el.className='notice'+(error?' error':'');el.hidden=!text;}}
 function current(cat,item){const ch=changed(cat.key,item.id);return ch?.isNew?ch.fields:{...item,...ch?.fields};}
 function updateExisting(cat,item,fields){
  const key=keyOf(cat.key,item.id);let ch=changes.get(key)||{cat:cat.key,id:item.id,original:clone(item),fields:{},isNew:false,deleted:false};
  if(ch.isNew)Object.assign(ch.fields,fields);else for(const [field,value] of Object.entries(fields)){const old=ch.original[field];if(value===old||(field==='hidden'&&!value&&!old)||(field==='note'&&!value&&!old)||(field==='range'&&value===(ch.original.radius??old)))delete ch.fields[field];else ch.fields[field]=value;}
  if(!ch.isNew&&!ch.deleted&&!Object.keys(ch.fields).length)changes.delete(key);else changes.set(key,ch);
 }
 function focusElement(focus){if(!focus)return;const target=[...root.querySelectorAll('[data-focus]')].find(el=>el.dataset.focus===focus.key);if(target){target.focus({preventScroll:true});if(focus.start!=null&&target.setSelectionRange)try{target.setSelectionRange(focus.start,focus.end);}catch{}}}
 function captureFocus(){const el=document.activeElement;if(!root.contains(el)||!el.dataset.focus)return null;let start=null,end=null;try{start=el.selectionStart;end=el.selectionEnd;}catch{}return {key:el.dataset.focus,start,end};}
 function button(label,attribute,key,classes=''){return `<button type="button" class="button small ${classes}" ${attribute} data-focus="${esc(key)}">${label}</button>`;}
 function rowHTML(cat,item){
  const key=keyOf(cat.key,item.id),ch=changes.get(key),value=current(cat,item),edit=edits.get(key),confirm=confirmations.get(key),name=nameOf(value,cat.kind)||'',hidden=!!value.hidden;
  const badge=ch?'<span class="badge price-unsaved">не сохранено</span>':'';
  if(ch?.deleted)return `<article class="price-row price-row-deleted" data-row="${esc(key)}"><div><strong>${esc(name)}</strong> ${badge}<p>Будет удалено после сохранения</p></div>${button('Вернуть','data-restore',`restore:${key}`)}</article>`;
  if(confirm){return `<article class="price-row price-confirm" data-row="${esc(key)}"><strong>${esc(name)}</strong><p>${esc(confirm.problem||`Удалить «${name}» навсегда?`)}</p>${confirm.warning?`<p role="status">${esc(confirm.warning)}</p>`:''}<div class="price-actions">${confirm.problem?'':button('Да, удалить','data-confirm-delete',`confirm:${key}`,'danger')}${button('Отмена','data-cancel-delete',`cancel-delete:${key}`)}</div></article>`;}
  if(edit){
   const field=nameField(cat.kind),limit=field==='name'?LIMITS.name:LIMITS.radius,label=field==='name'?'Название':'Радиус';
   const input=(field,label,limits)=>`<label>${label}<input data-edit-field="${field}" data-focus="${esc(`edit:${key}:${field}`)}" maxlength="${limits[1]}" value="${esc(edit.fields[field]??'')}"><span class="field-error" role="alert" data-edit-error="${field}">${esc(edit.errors[field]||'')}</span></label>`;
   return `<article class="price-row price-edit ${ch?'price-changed':''}" data-row="${esc(key)}"><div class="price-row-title"><strong>${esc(name)}</strong> ${badge}</div><div class="price-edit-fields">${input(field,label,limit)}${cat.kind==='voyah'?input('note','Примечание',LIMITS.note):''}${priceFields(cat.kind).map(([f,l])=>input(f,l,LIMITS.price)).join('')}</div>${edit.warning?`<p role="status">${esc(edit.warning)}</p>`:''}<div class="price-actions">${button('Готово','data-done',`done:${key}`,'primary')}${button('Отмена','data-cancel-edit',`cancel-edit:${key}`)}</div></article>`;
  }
  return `<article class="price-row price-view ${ch?'price-changed':''} ${hidden?'price-hidden':''}" data-row="${esc(key)}"><div class="price-row-title"><strong>${esc(name)}</strong>${hidden?'<span class="badge draft">Скрыто</span>':''}${badge}</div><div class="price-value">${priceFields(cat.kind).map(([f,l])=>`<span>${cat.kind==='set'?`${esc(l)}: `:''}${esc(value[f])}</span>`).join('')}</div><div class="price-actions">${button('Изменить','data-edit',`edit-button:${key}`)}${button(hidden?'Показать обратно':'Скрыть','data-hide-row',`hide:${key}`)}${button('Удалить','data-delete',`delete:${key}`,'danger')}</div></article>`;
 }
 function addForm(cat){const radius=cat.kind==='set'||cat.kind==='repair',first=radius?'Радиус или диапазон':'Название работы',draft=addDrafts.get(cat.key)||{};return `<form class="price-add" data-add="${esc(cat.key)}" novalidate><h3>Добавить работу</h3><label>${first}<input name="name" data-focus="${esc(`add:${cat.key}:name`)}" value="${esc(draft.name||'')}" maxlength="${radius?LIMITS.radius[1]:LIMITS.name[1]}" placeholder="${radius?'Например, R17':'Название работы'}"></label><label>${cat.kind==='set'?'Легковой':'Цена'}<input name="price" data-focus="${esc(`add:${cat.key}:price`)}" value="${esc(draft.price||'')}" maxlength="${LIMITS.price[1]}" placeholder="Например, 1500 ₽"></label>${cat.kind==='set'?`<label>Кроссовер<input name="crossover" data-focus="${esc(`add:${cat.key}:crossover`)}" value="${esc(draft.crossover||'')}" maxlength="${LIMITS.price[1]}" placeholder="Например, 2000 ₽"></label>`:''}<button class="button" type="submit">Добавить в список</button><span class="field-error" data-add-error role="alert"></span></form>`;}
 function render(focusOverride){
  const focus=focusOverride?{key:focusOverride}:captureFocus();
  if(!api){root.innerHTML='<div class="empty">Нет подключения — введите ключ доступа в разделе выше.</div>';return;}
  if(!snapshot){root.innerHTML='<div class="notice" data-price-message role="status" aria-live="polite"></div>';tell(notice,noticeError);return;}
  const doc=snapshot.json,cats=categories(doc);
  root.innerHTML=`<div class="list-head"><div><p class="eyebrow">ЦЕНЫ И УСЛУГИ</p><h2>Цены и услуги</h2><p>Последнее обновление: ${esc(doc.updated_at)}</p><p>Несохранённые изменения: ${changes.size}</p></div></div><div class="notice${noticeError?' error':''}" data-price-message role="status" aria-live="polite" ${notice?'':'hidden'}>${esc(notice)}</div><div data-price-success>${success?'<div class="success"><a href="../prices/">Открыть прайс на сайте ↗</a><a href="https://github.com/sledovatel61/avtotehservis/actions" target="_blank" rel="noopener noreferrer">Ход сборки ↗</a><button type="button" class="button small" data-price-status>Обновить статус</button><span data-price-status-text role="status"></span></div>':''}</div>${cats.map(cat=>{
   const pending=[...changes.values()].filter(c=>c.cat===cat.key&&c.isNew).map(c=>c.fields),rows=[...cat.items,...pending],count=[...changes.values()].filter(c=>c.cat===cat.key).length,hidden=rows.filter(p=>current(cat,p).hidden).length;
   return `<details class="panel price-category" data-category="${esc(cat.key)}" ${open.has(cat.key)?'open':''}><summary data-focus="${esc(`summary:${cat.key}`)}"><span>${esc(cat.title)}</span><span class="price-summary-meta"><span>${words(rows.length)}</span>${count?`<span class="badge price-unsaved">не сохранено: ${count}</span>`:''}${hidden?`<span class="badge draft">скрыто: ${hidden}</span>`:''}</span></summary>${rows.length?rows.map(p=>rowHTML(cat,p)).join(''):'<p class="hint">Прайс пока пустой</p>'}${addForm(cat)}<div class="price-category-save"><span>Изменений: ${count}</span><button type="button" class="button primary" data-save-category="${esc(cat.key)}" data-focus="${esc(`save:${cat.key}`)}" ${saving||!count?'disabled':''}>Сохранить</button></div></details>`;
  }).join('')}<details class="panel price-category" data-category="featured" ${open.has('featured')?'open':''}><summary data-focus="summary:featured"><span>Плашки на главной</span></summary>${doc.featured.length?doc.featured.map(f=>{const source=doc.voyah.find(p=>p.id===f.ref),value=source?current({key:'voyah'},source):null;return `<div class="price-featured"><strong>${esc(f.title)}</strong><span>${esc(f.note)}</span><p class="hint">Цена берётся из работы Voyah Free: ${esc(value?.price??'не найдена')}${value?.hidden?' (работа скрыта)':''}.</p></div>`;}).join(''):'<p class="hint">Прайс пока пустой</p>'}</details>`;
  root.querySelectorAll('details[data-category]').forEach(el=>el.addEventListener('toggle',()=>{if(el.open)open.add(el.dataset.category);else open.delete(el.dataset.category);persistOpen();}));
  root.querySelectorAll('[data-row]').forEach(row=>{
   const [catKey,id]=row.dataset.row.split('|'),cat=cats.find(c=>c.key===catKey),ch=changes.get(row.dataset.row),item=cat.items.find(p=>p.id===id)||(ch?.isNew?ch.fields:null);if(!item)return;
   const key=row.dataset.row;
   row.querySelector('[data-edit]')?.addEventListener('click',()=>{const val=current(cat,item),field=nameField(cat.kind),fields={[field]:nameOf(val,cat.kind)||''};for(const [f] of priceFields(cat.kind))fields[f]=val[f]||'';if(cat.kind==='voyah')fields.note=val.note||'';edits.set(key,{fields,initial:clone(fields),errors:{},warning:''});render(`edit:${key}:${field}`);});
   row.querySelectorAll('[data-edit-field]').forEach(input=>input.addEventListener('input',()=>{const e=edits.get(key);e.fields[input.dataset.editField]=input.value;e.errors[input.dataset.editField]='';row.querySelector(`[data-edit-error="${input.dataset.editField}"]`).textContent='';}));
   row.querySelector('[data-cancel-edit]')?.addEventListener('click',()=>{edits.delete(key);render(`edit-button:${key}`);});
   row.querySelector('[data-done]')?.addEventListener('click',async()=>{
    const e=edits.get(key),field=nameField(cat.kind),limit=field==='name'?LIMITS.name:LIMITS.radius,fields=Object.fromEntries(Object.entries(e.fields).map(([k,v])=>[k,v.trim()]));e.errors={};
    if(fields[field].length<limit[0]||fields[field].length>limit[1])e.errors[field]=`Укажите ${field==='name'?'название':'радиус'}: от ${limit[0]} до ${limit[1]} символов.`;
    for(const [f] of priceFields(cat.kind))if(!isValidPrice(fields[f]))e.errors[f]=PRICE_ERROR;
    if(cat.kind==='voyah'&&fields.note.length>LIMITS.note[1])e.errors.note=`Не больше ${LIMITS.note[1]} символов.`;
    if(Object.keys(e.errors).length){render(`edit:${key}:${Object.keys(e.errors)[0]}`);return;}
    if(fields[field]!==nameOf(current(cat,item),cat.kind)&&!ch?.isNew){const refs=await loadRefs(),problem=refProblem(refs,snapshot.json,id,'rename');if(problem){e.errors[field]=problem;render(`edit:${key}:${field}`);return;}if(!refs){e.warning=REFS_WARNING;tell(REFS_WARNING);}}
    updateExisting(cat,item,fields);edits.delete(key);render(`edit-button:${key}`);
   });
   row.querySelector('[data-hide-row]')?.addEventListener('click',()=>{const hidden=!!current(cat,item).hidden;if(!hidden&&!window.confirm('Скрыть эту работу на сайте после обновления?'))return;updateExisting(cat,item,{hidden:!hidden});render(`hide:${key}`);});
   row.querySelector('[data-delete]')?.addEventListener('click',async()=>{const refs=ch?.isNew?{refs:{},featured:{}}:await loadRefs();confirmations.set(key,{problem:refProblem(refs,snapshot.json,id,'delete'),warning:refs?'':REFS_WARNING});render(`cancel-delete:${key}`);});
   row.querySelector('[data-cancel-delete]')?.addEventListener('click',()=>{confirmations.delete(key);render(`delete:${key}`);});
   row.querySelector('[data-confirm-delete]')?.addEventListener('click',()=>{const c=changes.get(key)||{cat:cat.key,id,original:clone(item),fields:{},isNew:false};c.deleted=true;changes.set(key,c);confirmations.delete(key);render(`restore:${key}`);});
   row.querySelector('[data-restore]')?.addEventListener('click',()=>{const c=changes.get(key);c.deleted=false;if(!c.isNew&&!Object.keys(c.fields).length)changes.delete(key);render(`delete:${key}`);});
  });
  root.querySelectorAll('[data-add] input').forEach(input=>input.addEventListener('input',()=>{const key=input.closest('[data-add]').dataset.add,draft=addDrafts.get(key)||{};draft[input.name]=input.value;addDrafts.set(key,draft);}));
  root.querySelectorAll('[data-add]').forEach(form=>form.addEventListener('submit',e=>{e.preventDefault();const cat=cats.find(c=>c.key===form.dataset.add),name=form.elements.name.value.trim(),price=form.elements.price.value.trim(),other=form.elements.crossover?.value.trim(),out=form.querySelector('[data-add-error]'),limits=cat.kind==='set'||cat.kind==='repair'?LIMITS.radius:LIMITS.name,max=cat.kind==='voyah'?LIMITS.maxVoyahItems:LIMITS.maxGroupItems,pending=[...changes.values()].filter(c=>c.cat===cat.key&&c.isNew&&!c.deleted).length;if(cat.items.length+pending>=max){out.textContent=LIMIT_ERROR;return;}if(name.length<limits[0]||name.length>limits[1]){out.textContent=`Укажите название: от ${limits[0]} до ${limits[1]} символов.`;return;}if(!isValidPrice(price)||(cat.kind==='set'&&!isValidPrice(other))){out.textContent=PRICE_ERROR;return;}const used=allIds(doc);for(const c of changes.values())if(c.isNew)used.add(c.id);const id=nextId(name,used),fields={id,...(cat.kind==='set'?{radius:name,passenger:price,crossover:other}:cat.kind==='repair'?{range:name,price}:cat.kind==='voyah'?{name,note:'',price}:{name,price})};changes.set(keyOf(cat.key,id),{cat:cat.key,id,fields,original:null,isNew:true,deleted:false});addDrafts.delete(cat.key);tell('Работа добавлена в список. Сохраните изменения.');render(`edit-button:${keyOf(cat.key,id)}`);}));
  root.querySelectorAll('[data-save-category]').forEach(b=>b.addEventListener('click',()=>save(b.dataset.saveCategory)));
  root.querySelector('[data-price-status]')?.addEventListener('click',async e=>{const button=e.currentTarget,out=root.querySelector('[data-price-status-text]');button.disabled=true;try{const runs=await api.publicRuns(),run=runs?.find(r=>r.head_sha===lastCommit);out.textContent=!runs?' Статус сборки сейчас недоступен — откройте «Ход сборки».':run?` Сборка: ${run.status==='completed'?(run.conclusion==='success'?'завершена успешно':'завершена с ошибкой'):'в процессе'}.`:' Сборка ещё не появилась в списке.';}finally{button.disabled=false;}});
  if(saving)root.querySelectorAll('button,input').forEach(el=>{el.disabled=true;});
  focusElement(focus);
 }
 async function save(catKey){
  if(saving||!api)return;const selected=[...changes.values()].filter(c=>c.cat===catKey);if(!selected.length)return;
  if([...edits.keys()].some(k=>k.startsWith(`${catKey}|`))){tell('Сначала нажмите «Готово» или «Отмена» в редактируемой строке.',true);return;}
  if(Object.values(addDrafts.get(catKey)||{}).some(v=>v.trim())){tell('Сначала добавьте работу в список или очистите поля добавления.',true);return;}
  saving=true;render();tell('Проверяем ссылки и сохраняем изменения…');
  try{
   const refs=await loadRefs();
   for(const c of selected){if(c.isNew)continue;const cat=categories(snapshot.json).find(x=>x.key===c.cat),field=nameField(cat.kind),renamed=Object.hasOwn(c.fields,field);if(c.deleted||renamed){const problem=refProblem(refs,snapshot.json,c.id,c.deleted?'delete':'rename');if(problem)throw Error(problem);}}
   const result=await api.savePrices(latest=>{
    const checked=validate(latest);if(!checked.ok)throw Error(readError(checked));let next=clone(latest);const used=allIds(next),missing=[],conflicts=[];
    for(const c of selected.filter(c=>c.isNew&&!c.deleted)){const cat=categories(next).find(x=>x.key===c.cat),rows=cat&&rowsOf(next,cat);if(!rows)throw Error('Раздел больше не найден. Обновите страницу.');if(rows.length>=(cat.kind==='voyah'?LIMITS.maxVoyahItems:LIMITS.maxGroupItems))throw Error(LIMIT_ERROR);const item=clone(c.fields);if(used.has(item.id))item.id=nextId(nameOf(item,cat.kind),used);else used.add(item.id);rows.push(item);}
    for(const c of selected.filter(c=>!c.isNew&&!c.deleted)){const cat=categories(next).find(x=>x.key===c.cat),item=cat&&findPriceItem(next,cat.kind,cat.key,c.id);if(!item){missing.push(c.original.name||c.original.radius||c.original.range||c.id);continue;}for(const [field,value] of Object.entries(c.fields)){const prior=field==='range'?(c.original.radius??c.original.range):c.original[field],current=field==='range'?(item.radius??item.range):item[field];if(current!==prior&&current!==value&&!(field==='hidden'&&!current&&!prior)&&!(field==='note'&&!current&&!prior))conflicts.push(c.original.name||c.original.radius||c.original.range||c.id);}}
    if(missing.length)throw Error(`Эту строку кто-то удалил, пока вы правили: ${[...new Set(missing)].join(', ')}. Обновите страницу и проверьте изменения.`);
    if(conflicts.length)throw Error(`Кто-то изменил эти цены одновременно: ${[...new Set(conflicts)].join(', ')}. Обновите страницу и проверьте изменения.`);
    for(const c of selected.filter(c=>!c.isNew&&!c.deleted)){const cat=categories(next).find(x=>x.key===c.cat),result=renamePriceItem(next,cat.kind,cat.key,c.id,c.fields);if(!result.ok)throw Error(result.errors.join('. '));next=result.value;}
    for(const c of selected.filter(c=>!c.isNew&&c.deleted)){const cat=categories(next).find(x=>x.key===c.cat);if(!cat||!findPriceItem(next,cat.kind,cat.key,c.id))continue;const result=removePriceItem(next,cat.kind,cat.key,c.id);if(!result.ok)throw Error(result.errors.join('. '));next=result.value;}
    const valid=validate(next);if(!valid.ok)throw Error('Проверьте цены и названия. Если ошибка повторяется, обратитесь к разработчику.');next.updated_at=today();return next;
   },selected.length,text=>tell(text));
   snapshot={json:result.json,sha:result.sha};for(const c of selected)changes.delete(keyOf(c.cat,c.id));lastCommit=result.commit;success=true;saving=false;notice=refs?'Сохранено. Сайт обновится через 1–2 минуты':`Сохранено. Сайт обновится через 1–2 минуты. ${REFS_WARNING}`;noticeError=false;render(`summary:${catKey}`);
  }catch(e){saving=false;render();tell(errorText(e),true);}
 }
 render();return {
  async connect(client){api=client;snapshot=null;changes.clear();edits.clear();confirmations.clear();addDrafts.clear();success=false;tell('Загружаем цены…');render();try{const read=await api.readPrices(),result=validate(read.json);if(!result.ok)throw Error(readError(result));snapshot=read;notice='';render();}catch(e){tell(errorText(e),true);}},
  mayDisconnect(){return !dirty()||window.confirm('Есть несохранённые изменения цен. Отменить их?');},
  disconnect(){api=null;snapshot=null;changes.clear();edits.clear();confirmations.clear();addDrafts.clear();success=false;notice='';render();}
 };
}
