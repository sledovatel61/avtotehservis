import {validate, slugifyRu} from './prices-schema.js';
import {escapeHTML as esc} from './store.js';
const clone=x=>JSON.parse(JSON.stringify(x));
const PRICE_ERROR='Похоже, это не цена. Напишите, например: 1200 ₽';
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const findCategory=(doc,key)=>{
 if(key.startsWith('group:'))return doc.groups.find(g=>g.id===key.slice(6))?.items;
 if(key.startsWith('tyres:'))return doc.tyres[key.slice(6)];
 return key==='voyah'?doc.voyah:undefined;
};
const allIds=doc=>new Set([...doc.groups.flatMap(g=>[g.id,...g.items.map(p=>p.id)]),...['set','repair','extra'].flatMap(k=>doc.tyres[k].map(p=>p.id)),...doc.voyah.map(p=>p.id),...doc.featured.map(p=>p.id)]);
const nextId=(name,used)=>{const base=slugifyRu(name)||'rabota';let id=base,n=2;while(used.has(id))id=`${base}-${n++}`;used.add(id);return id;};
const categories=doc=>[
 ...doc.groups.map(g=>({key:`group:${g.id}`,title:g.title,kind:'group',items:g.items})),
 {key:'tyres:set',title:'Шиномонтаж — комплект',kind:'set',items:doc.tyres.set},
 {key:'tyres:repair',title:'Ремонт колёс',kind:'repair',items:doc.tyres.repair},
 {key:'tyres:extra',title:'Дополнительные работы с колёсами',kind:'extra',items:doc.tyres.extra},
 {key:'voyah',title:'Voyah Free',kind:'voyah',items:doc.voyah}
];
const nameOf=(p,kind)=>kind==='set'?p.radius:kind==='repair'?p.range:p.name;
const priceFields=kind=>kind==='set'?[['passenger','Легковой автомобиль'],['crossover','Кроссовер']]:[['price','Цена']];
function errorText(e){if(e?.status===401)return 'Ключ доступа не принят. Проверьте его срок.';if(e?.status===403)return 'Нет доступа к ценам. Проверьте права ключа.';if(e?.status===404)return 'Список цен пока недоступен. Обратитесь к разработчику.';if(e?.status===409||e?.status===422)return e.message?.startsWith('Кто-то')?e.message:'Кто-то сохранил изменения одновременно. Нажмите «Сохранить» ещё раз — мы повторим.';return e?.message||'Не удалось сохранить: нет связи. Попробуйте ещё раз.';}
export function createPrices(root){
 let api=null,snapshot=null,changes=new Map(),saving=false,lastCommit=null;
 const keyOf=(cat,id)=>`${cat}|${id}`;
 function dirty(){return changes.size>0;}
 window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
 function message(text,error=false){const el=root.querySelector('[data-price-message]');if(el){el.textContent=text;el.className='notice'+(error?' error':'');el.hidden=!text;}}
 function changed(cat,id){return changes.get(keyOf(cat,id));}
 function updateCount(){const n=changes.size;const counter=root.querySelector('[data-price-count]');if(counter)counter.textContent=`Изменений: ${n}`;root.querySelectorAll('[data-cat-count]').forEach(el=>{const cat=el.dataset.catCount;const k=[...changes.values()].filter(x=>x.cat===cat).length;el.textContent=`изменено: ${k}`;});root.querySelectorAll('[data-save-all],[data-save-category]').forEach(el=>{const n=el.hasAttribute('data-save-all')?changes.size:[...changes.values()].filter(x=>x.cat===el.dataset.saveCategory).length;el.disabled=saving||!api||!n;});}
 function updateExisting(cat,item,field,value){const k=keyOf(cat,item.id);let change=changes.get(k);if(!change)change={cat,id:item.id,original:clone(item),fields:{},isNew:false};if(change.isNew)change.fields[field]=value;else if(value===change.original[field]||(field==='hidden'&&!value&&!change.original.hidden))delete change.fields[field];else change.fields[field]=value;if(!change.isNew&&!Object.keys(change.fields).length)changes.delete(k);else changes.set(k,change);updateCount();}
 function rowHTML(cat,p,kind){const change=changed(cat,p.id),value=change?{...p,...change.fields}:p,hidden=!!value.hidden,isNew=!!change?.isNew;
  return `<article class="price-row ${hidden?'price-hidden':''}" data-row="${esc(keyOf(cat,p.id))}"><div class="price-row-title"><strong>${esc(nameOf(value,kind))}</strong>${hidden?'<span class="badge draft">Скрыто</span>':''}${isNew?'<span class="badge ok">Новая</span>':''}</div>${priceFields(kind).map(([field,label])=>`<label>${esc(label)}<span class="hint field-hint">Сейчас: ${esc(isNew?'новая работа':p[field])}</span><input type="text" maxlength="40" data-price-field="${field}" value="${esc(value[field]??'')}" aria-label="Новая цена: ${esc(nameOf(value,kind))}, ${esc(label)}" placeholder="Новая цена"><span class="field-error" data-price-error="${field}" role="alert"></span></label>`).join('')}<div class="price-actions"><button class="button small" data-save-row>Сохранить</button><button class="button small ${hidden?'':'danger'}" data-hide-row>${hidden?'Показать обратно':'Скрыть'}</button></div></article>`;
 }
 function addForm(cat){const first=cat.kind==='set'?'Радиус':cat.kind==='repair'?'Радиус или диапазон':'Название работы';return `<form class="price-add" data-add="${esc(cat.key)}"><h3>Добавить работу</h3><label>${first}<input name="name" maxlength="160" required placeholder="${cat.kind==='set'?'Например, R17':cat.kind==='repair'?'Например, R13–R15':'Название работы'}"></label><label>${cat.kind==='set'?'Легковой автомобиль':'Цена'}<input name="price" maxlength="40" required placeholder="Например, 1500 ₽"></label>${cat.kind==='set'?'<label>Кроссовер<input name="crossover" maxlength="40" required placeholder="Например, 2000 ₽"></label>':''}<button class="button" type="submit">Добавить</button><span class="field-error" data-add-error role="alert"></span></form>`;}
 function render(){
  if(!api){root.innerHTML='<div class="empty">Нет подключения — введите ключ доступа в разделе выше.</div>';return;}
  if(!snapshot){root.innerHTML='<div class="notice" data-price-message role="status" aria-live="polite"></div>';return;}
  const doc=snapshot.json,cats=categories(doc);root.innerHTML=`<div class="list-head"><div><p class="eyebrow">ЦЕНЫ И УСЛУГИ</p><h2>Цены и услуги</h2><p>Последнее обновление: ${esc(doc.updated_at)}</p></div></div><div class="price-sticky"><strong data-price-count>Изменений: 0</strong><button class="button primary" data-save-all disabled>Сохранить всё</button></div><div class="notice" data-price-message role="status" aria-live="polite" hidden></div><div data-price-success></div>${cats.length?cats.map(cat=>{const pending=[...changes.values()].filter(x=>x.cat===cat.key&&x.isNew).map(x=>x.fields);const rows=[...cat.items,...pending];return `<details class="panel price-category" open data-category="${esc(cat.key)}"><summary><span>${esc(cat.title)}</span><span class="badge" data-cat-count="${esc(cat.key)}">изменено: 0</span></summary>${rows.length?rows.map(p=>rowHTML(cat.key,p,cat.kind)).join(''):'<p class="hint">Прайс пока пустой</p>'}${addForm(cat)}<button class="button primary" data-save-category="${esc(cat.key)}" disabled>Сохранить категорию</button></details>`;}).join(''):'<div class="empty">Прайс пока пустой</div>'}<details class="panel price-category" open><summary><span>Плашки на главной</span></summary>${doc.featured.length?doc.featured.map(f=>{const source=doc.voyah.find(p=>p.id===f.ref),change=source&&changed('voyah',source.id),value=source?{...source,...change?.fields}:null;return `<div class="price-featured"><strong>${esc(f.title)}</strong><span>${esc(f.note)}</span><p class="hint">Цена берётся из работы Voyah Free: ${esc(value?.price??'не найдена')}${value?.hidden?' (работа скрыта)':''}. Чтобы изменить цену, откройте раздел Voyah Free.</p></div>`;}).join(''):'<p class="hint">Прайс пока пустой</p>'}</details>`;
  updateCount();
  root.querySelectorAll('[data-row]').forEach(row=>{const [cat,id]=row.dataset.row.split('|');const descriptor=cats.find(x=>x.key===cat);const ch=changed(cat,id);const item=descriptor.items.find(x=>x.id===id)||(ch?.isNew?ch.fields:null);if(!item)return;
   row.querySelectorAll('[data-price-field]').forEach(input=>{input.oninput=()=>{updateExisting(cat,item,input.dataset.priceField,input.value);row.querySelector(`[data-price-error="${input.dataset.priceField}"]`).textContent='';};});
   row.querySelector('[data-hide-row]').onclick=()=>{const current=changed(cat,id),hidden=!!(current?.fields.hidden??item.hidden);if(!hidden&&!confirm('Скрыть эту работу на сайте после обновления?'))return;updateExisting(cat,item,'hidden',!hidden);render();};
   row.querySelector('[data-save-row]').onclick=()=>save([keyOf(cat,id)]);
  });
  root.querySelectorAll('[data-add]').forEach(form=>form.onsubmit=e=>{e.preventDefault();const cat=cats.find(x=>x.key===form.dataset.add),name=form.elements.name.value.trim(),price=form.elements.price.value.trim(),other=form.elements.crossover?.value.trim();const out=form.querySelector('[data-add-error]');if(!name||name.length>160){out.textContent='Укажите название работы.';return;}if(!validPrice(price)||(cat.kind==='set'&&!validPrice(other))){out.textContent=PRICE_ERROR;return;}const used=allIds(doc);for(const change of changes.values())if(change.isNew)used.add(change.id);const id=nextId(name,used);const fields={id,...(cat.kind==='set'?{radius:name,passenger:price,crossover:other}:cat.kind==='repair'?{range:name,price}:cat.kind==='voyah'?{name,note:'',price}:{name,price})};changes.set(keyOf(cat.key,id),{cat:cat.key,id,fields,original:null,isNew:true});render();message('Работа добавлена. Сохраните изменения.');});
  root.querySelector('[data-save-all]').onclick=()=>save([...changes.keys()]);root.querySelectorAll('[data-save-category]').forEach(b=>b.onclick=()=>save([...changes].filter(([,c])=>c.cat===b.dataset.saveCategory).map(([key])=>key)));
 }
 function validPrice(value){return typeof value==='string'&&value.trim().length>=1&&value.trim().length<=40&&/\d/.test(value);}
 function validateSelected(selected){for(const change of selected){const cat=categories(snapshot.json).find(x=>x.key===change.cat);if(!cat)throw Error('Раздел больше не найден. Обновите страницу.');for(const [field] of priceFields(cat.kind)){const value=change.fields[field]??change.original?.[field];if(!validPrice(value)){const row=[...root.querySelectorAll('[data-row]')].find(el=>el.dataset.row===keyOf(change.cat,change.id));const out=row?.querySelector(`[data-price-error="${field}"]`);if(out)out.textContent=PRICE_ERROR;throw Error(PRICE_ERROR);}}}}
 async function save(keys){if(saving||!api)return;const selected=keys.map(k=>changes.get(k)).filter(Boolean);if(!selected.length){message('Нет изменений для сохранения.');return;}try{validateSelected(selected);}catch(e){message(e.message,true);return;}
  saving=true;root.querySelectorAll('button,input').forEach(x=>x.disabled=true);message('Сохраняем изменения…');
  try{
   const result=await api.savePrices(latest=>{
    const checked=validate(latest);if(!checked.ok)throw Error('Не удалось прочитать цены. Обратитесь к разработчику.');
    const next=clone(latest),used=allIds(next),missing=[],conflicts=[];
    const selectedKeys=new Set(keys);for(const [key,change] of changes)if(change.isNew&&!selectedKeys.has(key))used.add(change.id);
    for(const change of selected){const rows=findCategory(next,change.cat);if(!Array.isArray(rows)){missing.push(nameOf(change.fields,change.cat==='tyres:set'?'set':change.cat==='tyres:repair'?'repair':'group')||change.id);continue;}
     if(change.isNew){const added=clone(change.fields);if(used.has(added.id))added.id=nextId(added.name||added.radius||added.range,used);else used.add(added.id);rows.push(added);continue;}
     const item=rows.find(p=>p.id===change.id);if(!item){missing.push(change.original.name||change.original.radius||change.original.range||change.id);continue;}
     for(const [field,value] of Object.entries(change.fields)){const prior=change.original[field],current=item[field];if(current!==prior&&current!==value&&!(field==='hidden'&&!current&&!prior))conflicts.push(change.original.name||change.original.radius||change.original.range||change.id);}
     Object.assign(item,change.fields);
    }
    if(missing.length)throw Error(`Эту строку кто-то удалил, пока вы правили: ${[...new Set(missing)].join(', ')}. Обновите страницу и проверьте изменения.`);
    if(conflicts.length)throw Error(`Кто-то изменил эти цены одновременно: ${[...new Set(conflicts)].join(', ')}. Обновите страницу и проверьте изменения.`);
    next.updated_at=today();const valid=validate(next);if(!valid.ok)throw Error('Проверьте цены и названия. Если ошибка повторяется, обратитесь к разработчику.');return next;
   },selected.length,text=>message(text));
   snapshot={json:result.json,sha:result.sha};for(const key of keys)changes.delete(key);lastCommit=result.commit;render();message('Сохранено. Сайт обновится через 1–2 минуты');const success=root.querySelector('[data-price-success]');success.innerHTML='<div class="success"><a href="../prices/">Открыть прайс на сайте ↗</a><span> · </span><a href="https://github.com/sledovatel61/avtotehservis/actions" target="_blank" rel="noopener noreferrer">Ход сборки ↗</a> <button class="button small" data-price-status>Обновить статус</button><span data-price-status-text role="status"></span></div>';success.querySelector('[data-price-status]').onclick=async e=>{const button=e.currentTarget,out=success.querySelector('[data-price-status-text]');button.disabled=true;out.textContent='';try{const runs=await api.publicRuns();if(!runs){out.textContent=' Статус сборки сейчас недоступен — откройте «Ход сборки».';return;}const run=runs.find(r=>r.head_sha===lastCommit);out.textContent=run?` Сборка: ${run.status==='completed'?(run.conclusion==='success'?'завершена успешно':'завершена с ошибкой'):'в процессе'}.`:' Сборка ещё не появилась в списке.';}finally{button.disabled=false;}};
  }catch(e){render();message(errorText(e),true);}finally{saving=false;root.querySelectorAll('button,input').forEach(x=>x.disabled=false);updateCount();}
 }
 render();return {
  async connect(client){api=client;snapshot=null;changes.clear();render();message('Загружаем цены…');try{const read=await api.readPrices();const result=validate(read.json);if(!result.ok)throw Error('Не удалось прочитать цены. Обратитесь к разработчику.');snapshot=read;render();}catch(e){message(errorText(e),true);}},
  mayDisconnect(){return !dirty()||confirm('Есть несохранённые изменения цен. Отменить их?');},
  disconnect(){api=null;snapshot=null;changes.clear();render();}
 };
}
