import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
// Браузерный модуль остаётся обычным JS без сборки.
// @ts-ignore -- нет деклараций у статического JS
import {LIMITS, validate as validateManage, parse, serialize} from '../public/manage/prices-schema.js';

const base = () => ({updated_at:'2026-11-21',
 groups:[{id:'to',title:'ТО и жидкости',service:'to-maslo',items:[{id:'oil-sedan',name:'Замена масла',price:'1200 ₽'}]}],
 tyres:{set:[{id:'set-r13',radius:'R13',passenger:'1800 ₽',crossover:'2000 ₽'}],repair:[{id:'rep-r13',range:'R13–R15',price:'600 ₽'}],extra:[{id:'extra-set',name:'Смена колёс',price:'1000 ₽'}]},
 voyah:[{id:'voyah-oil',name:'Масло ДВС',note:'фильтры',price:'2000 ₽'}],featured:[{id:'chip-oil',ref:'voyah-oil',title:'Масло ДВС',note:'фильтры'}]});
const fixtures: Array<[string,unknown,boolean]> = [
 ['отсутствующая версия',base(),true],
 ['версия 1', {...base(),version:1},true],
 ['версия 2', {...base(),version:2},false],
 ['скрытая строка',(()=>{const x=base();return {...x,groups:[{...x.groups[0],items:[{...x.groups[0].items[0],hidden:true}]}]};})(),true],
 ['лишние поля сохраняются',{...base(),future:{foo:'bar'}},true],
 ['пустая цена',(()=>{const x=base();x.groups[0].items[0].price='';return x;})(),false],
 ['цена без цифры',(()=>{const x=base();x.groups[0].items[0].price='по запросу';return x;})(),false],
 ['цена длиннее 40',(()=>{const x=base();x.groups[0].items[0].price='1'.repeat(41);return x;})(),false],
 ['повтор id',(()=>{const x=base();x.voyah[0].id='oil-sedan';return x;})(),false],
 ['неверная дата',({...base(),updated_at:'сегодня'}) ,false],
 ['нет ссылки на Voyah',(()=>{const x=base();x.featured[0].ref='missing';return x;})(),false],
 ['ровно 40 позиций',(()=>{const x=base();x.groups[0].items=Array.from({length:40},(_,i)=>({id:`work-${i}`,name:`Работа ${i}`,price:`${1000+i} ₽`}));return x;})(),true],
 ['41 позиция в группе',(()=>{const x=base();x.groups[0].items=Array.from({length:41},(_,i)=>({id:`work-${i}`,name:`Работа ${i}`,price:'1000 ₽'}));return x;})(),false],
 ['двести позиций',(()=>{const x=base();x.groups[0].items=Array.from({length:200},(_,i)=>({id:`work-${i}`,name:`Работа ${i}`,price:`${1000+i} ₽`}));return x;})(),false],
 ['41 позиция Voyah',(()=>{const x=base();x.voyah=Array.from({length:41},(_,i)=>({id:i?'voyah-'+i:'voyah-oil',name:'Работа',note:'',price:'1000 ₽'}));return x;})(),false],
 ['41 строка шин',(()=>{const x=base();x.tyres.set=Array.from({length:41},(_,i)=>({id:`set-${i}`,radius:'R13',passenger:'1800 ₽',crossover:'2000 ₽'}));return x;})(),false],
 ['имя: меньше 2 символов',(()=>{const x=base();x.groups[0].items[0].name='А';return x;})(),false],
 ['имя: 120 символов',(()=>{const x=base();x.groups[0].items[0].name='А'.repeat(120);return x;})(),true],
 ['имя: больше 120 символов',(()=>{const x=base();x.groups[0].items[0].name='А'.repeat(121);return x;})(),false],
 ['примечание: больше 160 символов',(()=>{const x=base();x.voyah[0].note='А'.repeat(161);return x;})(),false],
 ['заголовок: меньше 2 символов',(()=>{const x=base();x.groups[0].title='А';return x;})(),false],
 ['заголовок: 80 символов',(()=>{const x=base();x.groups[0].title='А'.repeat(80);return x;})(),true],
 ['заголовок: больше 80 символов',(()=>{const x=base();x.groups[0].title='А'.repeat(81);return x;})(),false],
 ['радиус: больше 20 символов',(()=>{const x=base();x.tyres.set[0].radius='R'.repeat(21);return x;})(),false],
 ['id: меньше 2 символов',(()=>{const x=base();x.groups[0].items[0].id='a';return x;})(),false],
 ['id: 48 символов',(()=>{const x=base();x.groups[0].items[0].id='a'.repeat(48);return x;})(),true],
 ['id: больше 48 символов',(()=>{const x=base();x.groups[0].items[0].id='a'.repeat(49);return x;})(),false],
 ['несуществующая календарная дата',{...base(),updated_at:'2026-02-30'},false],
 ['нулевая цена без от',(()=>{const x=base();x.groups[0].items[0].price='0 ₽';return x;})(),false],
 ['цена с руб',(()=>{const x=base();x.groups[0].items[0].price='1200 руб.';return x;})(),false],
];
for(const [name,value,expected] of fixtures)test(`браузерная схема: ${name}`,()=>{
 assert.equal(validateManage(value).ok,expected,`Неожиданный результат для «${name}»`);
});
test('другая версия: понятная ошибка',()=>{
 assert.deepEqual(validateManage({...base(),version:2}).errors,['Файл цен от другой версии сайта, сообщите разработчику']);
});
const real = JSON.parse(readFileSync(new URL('../content/prices.json',import.meta.url),'utf8'));
test('реальный файл цен принимается браузерной схемой без изменения формата',()=>{
 assert.equal(validateManage(real).ok,true);
 assert.deepEqual(JSON.parse(serialize(real)),real);
});
const siteSchema = new URL('../src/shared/prices-schema.ts',import.meta.url);
const missingMessage = 'схема A10 ещё не влита — сверка валидаторов включится автоматически после мержа PR Агента 10';
if (!existsSync(siteSchema)) {
 test('сверка браузерной и серверной схем', {skip: missingMessage}, () => {});
} else {
 // Ошибки импорта или отсутствующий экспорт — ошибки теста, а не skip.
 const {validatePrices: validateSite, PRICE_LIMITS} = await import(siteSchema.href);
 test('сверка браузерной и серверной схем', async t=>{
  assert.equal(typeof validateSite,'function','Схема A10 должна экспортировать validatePrices');
  assert.deepEqual(LIMITS,PRICE_LIMITS,'Ограничения браузера и сайта должны совпадать');
  for(const [name,value,expected] of fixtures)await t.test(name,()=>{
   const browser=validateManage(value),site=validateSite(value);
   assert.equal(browser.ok,site.ok,`Разные решения для «${name}»: браузер ${JSON.stringify(browser)}, сайт ${JSON.stringify(site)}`);
   assert.equal(browser.ok,expected,`Неожиданный результат для «${name}»`);
  });
  await t.test('реальный файл цен',()=>{
   assert.equal(validateManage(real).ok,true);
   assert.equal(validateSite(real).ok,true);
  });
 });
}
test('разбор не бросает при повреждённом тексте, сериализация сохраняет неизвестные поля',()=>{
 assert.equal(parse('{').ok,false);const input={...base(),future:{enabled:true}};const data=serialize(input);
 assert.ok(data.endsWith('\n'));assert.equal(data.charCodeAt(0),'{'.charCodeAt(0));assert.deepEqual(JSON.parse(data).future,input.future);
});

// DOM-тесты используют только поддельный GitHub-клиент, настоящей записи нет.
import { JSDOM } from 'jsdom';
// @ts-ignore -- статический браузерный JS
import {createPrices} from '../public/manage/prices.js';
test('интерфейс цен: аккордеоны, редактирование, удаление и защита ссылок', async t=>{
 const dom=new JSDOM('<main id="prices"></main>',{url:'https://example.test/avtotehservis/manage/'});
 const oldWindow=globalThis.window,oldDocument=globalThis.document,oldStorage=globalThis.localStorage,oldFetch=globalThis.fetch;
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage});
 const root=dom.window.document.querySelector('#prices') as HTMLElement;
 let refs: any={refs:{},featured:{}};
 globalThis.fetch=async()=>({ok:refs!==null,json:async()=>refs}) as Response;
 dom.window.confirm=()=>true;
 let doc: any=base();doc.groups[0].items.push({id:'test',name:'ТЕСТ',price:'100'},{id:'other',name:'Другая работа',price:'500 ₽'});
 let commits=0;
 const client={readPrices:async()=>({json:structuredClone(doc),sha:'one'}),savePrices:async(apply: (v:unknown)=>any)=>{const value=apply(structuredClone(doc));commits++;doc=value;return {json:structuredClone(value),sha:'two',commit:'commit'};},publicRuns:async()=>[]};
 const ui=createPrices(root);await ui.connect(client);
 const query=(s:string)=>{const el=root.querySelector(s) as HTMLElement|null;assert.ok(el,`нет ${s}`);return el;};
 const click=async(s:string)=>{query(s).click();await new Promise(resolve=>setTimeout(resolve,10));};
 const input=(selector:string,value:string)=>{const el=query(selector) as HTMLInputElement;el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 const section='[data-category="group:to"]', row=(id:string)=>`[data-row="group:to|${id}"]`;
 try{
  await t.test('свёрнуты, число работ, одна кнопка сохранения',()=>{
   assert.ok([...root.querySelectorAll('details')].every(d=>!d.open));
   assert.match(query(`${section} summary`).textContent||'',/3 работы/);
   assert.equal(root.querySelector('[data-save-all], [data-save-row]'),null);
   assert.equal(query(section).querySelectorAll('[data-save-category]').length,1);
   assert.equal((query(`${section} [data-save-category]`) as HTMLButtonElement).disabled,true);
  });
  await t.test('раскрытие запоминается при перерисовке',async()=>{
   (query(section) as HTMLDetailsElement).open=true;query(section).dispatchEvent(new dom.window.Event('toggle'));await new Promise(r=>setTimeout(r,10));
   assert.ok(JSON.parse(dom.window.localStorage.getItem('atsPricesOpen')||'[]').includes('group:to'));
   await click(`${row('other')} [data-edit]`);assert.equal((query(section) as HTMLDetailsElement).open,true);
  });
  await t.test('правка с проверками и отменой; id не меняется',async()=>{
   input(`${row('other')} [data-edit-field="name"]`,'');await click(`${row('other')} [data-done]`);assert.match(query(`${row('other')} [data-edit-error="name"]`).textContent||'',/Укажите/);
   input(`${row('other')} [data-edit-field="name"]`,'Новое название');input(`${row('other')} [data-edit-field="price"]`,'1300 ₽');await click(`${row('other')} [data-done]`);
   assert.match(query(row('other')).textContent||'',/не сохранено/);assert.equal((query(`${section} [data-save-category]`) as HTMLButtonElement).disabled,false);
   await click(`${row('other')} [data-edit]`);input(`${row('other')} [data-edit-field="name"]`,'Отменённое');await click(`${row('other')} [data-cancel-edit]`);assert.match(query(row('other')).textContent||'',/Новое название/);
  });
  await t.test('ссылки по id и alias запрещают удаление и переименование, featured защищён',async()=>{
   for(const matched of ['id','alias']){
    refs={refs:{'oil-sedan':[{file:'src/pages/prices.astro',line:1,token:'x',matched}]},featured:{}};
    await click(`${row('oil-sedan')} [data-delete]`);assert.match(query(row('oil-sedan')).textContent||'',/\/prices\/.*Скрыть/);assert.equal(root.querySelector(`${row('oil-sedan')} [data-confirm-delete]`),null);await click(`${row('oil-sedan')} [data-cancel-delete]`);
    await click(`${row('oil-sedan')} [data-edit]`);input(`${row('oil-sedan')} [data-edit-field="name"]`,'Новое имя');await click(`${row('oil-sedan')} [data-done]`);assert.match(query(`${row('oil-sedan')} [data-edit-error="name"]`).textContent||'',/\/prices\/.*Скрыть/);await click(`${row('oil-sedan')} [data-cancel-edit]`);
   }
   refs={refs:{},featured:{}};await click('[data-row="voyah|voyah-oil"] [data-delete]');assert.match(query('[data-row="voyah|voyah-oil"]').textContent||'',/плашка на главной/);assert.equal(root.querySelector('[data-row="voyah|voyah-oil"] [data-confirm-delete]'),null);await click('[data-row="voyah|voyah-oil"] [data-cancel-delete]');
  });
  await t.test('404 карты: предупреждение, вернуть, добавление и удаление одним сохранением',async()=>{
   refs=null;await click(`${row('test')} [data-delete]`);assert.match(query(row('test')).textContent||'',/Проверить ссылки в текстах не удалось/);await click(`${row('test')} [data-confirm-delete]`);assert.match(query(row('test')).textContent||'',/Будет удалено/);await click(`${row('test')} [data-restore]`);assert.match(query(row('test')).textContent||'',/ТЕСТ/);
   await click(`${row('test')} [data-delete]`);await click(`${row('test')} [data-confirm-delete]`);
   const form=query('[data-add="group:to"]') as HTMLFormElement;(form.querySelector('[name=name]') as HTMLInputElement).value='Новая услуга';(form.querySelector('[name=price]') as HTMLInputElement).value='1500 ₽';form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
   await click(`${section} [data-save-category]`);assert.equal(commits,1);assert.equal(doc.groups[0].items.some((p:any)=>p.id==='test'),false);assert.equal(doc.groups[0].items.find((p:any)=>p.id==='other').name,'Новое название');assert.equal(doc.groups[0].items.find((p:any)=>p.id==='other').price,'1300 ₽');assert.ok(doc.groups[0].items.some((p:any)=>p.name==='Новая услуга'));assert.equal((query(section) as HTMLDetailsElement).open,true);assert.match(query(section).textContent||'',/Изменений: 0/);
  });
  await t.test('конфликт цены не перезаписывается; параллельное удаление идемпотентно',async()=>{
   refs={refs:{},featured:{}};await click(`${row('other')} [data-edit]`);input(`${row('other')} [data-edit-field="price"]`,'1400 ₽');await click(`${row('other')} [data-done]`);
   doc.groups[0].items.find((p:any)=>p.id==='other').price='1600 ₽';await click(`${section} [data-save-category]`);
   assert.match(query('[data-price-message]').textContent||'',/Кто-то изменил эти цены одновременно/);assert.equal(doc.groups[0].items.find((p:any)=>p.id==='other').price,'1600 ₽');assert.equal(commits,1);
   await ui.connect(client);await click(`${row('other')} [data-delete]`);await click(`${row('other')} [data-confirm-delete]`);doc.groups[0].items=doc.groups[0].items.filter((p:any)=>p.id!=='other');await click(`${section} [data-save-category]`);
   assert.match(query('[data-price-message]').textContent||'',/Сохранено/);assert.equal(commits,2);
  });
  await t.test('без localStorage интерфейс не падает',async()=>{
   Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}});const el=dom.window.document.createElement('div');dom.window.document.body.append(el);const second=createPrices(el);await second.connect(client);const details=el.querySelector('details') as HTMLDetailsElement;details.open=true;details.dispatchEvent(new dom.window.Event('toggle'));assert.equal(details.open,true);
  });
 }finally{Object.assign(globalThis,{window:oldWindow,document:oldDocument,localStorage:oldStorage,fetch:oldFetch});dom.window.close();}
});

test('общий вход работает при полностью заблокированном localStorage',async()=>{
 const html=readFileSync(new URL('../public/manage/index.html',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:'https://example.test/avtotehservis/manage/#prices'});
 const saved=new Map(['window','document','localStorage','location','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{
  window:{configurable:true,value:dom.window},document:{configurable:true,value:dom.window.document},location:{configurable:true,value:dom.window.location},
  localStorage:{configurable:true,get(){throw new Error('storage blocked');}},
  fetch:{configurable:true,value:async (url: string)=>{
   let data: unknown;
   if(url.endsWith('/user'))data={login:'owner'};
   else if(url.includes('/contents/site/content/cases.json'))data={sha:'cases',content:Buffer.from(JSON.stringify({version:1,updated_at:'',cases:[]})).toString('base64')};
   else if(url.includes('/contents/site/content/prices.json'))data={sha:'prices',content:Buffer.from(JSON.stringify(base())).toString('base64')};
   else if(url.includes('/git/ref/heads/'))data={object:{sha:'parent'}};
   else if(url.includes('/git/commits/parent'))data={tree:{sha:'root'}};
   else if(url.includes('/git/trees/root'))data={tree:[],truncated:false};
   else if(url.endsWith('price-refs.json'))data={refs:{},featured:{}};
   else throw new Error(`неожиданный запрос ${url}`);
   return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  }},
 });
 try{
  // @ts-ignore -- обычный статический модуль без деклараций
  await import('../public/manage/app.js');
  (dom.window.document.querySelector('#token') as HTMLInputElement).value='mock-key';
  (dom.window.document.querySelector('#check') as HTMLButtonElement).click();
  for(let i=0;i<100&&!dom.window.document.querySelector('[data-category="group:to"]');i++)await new Promise(r=>setTimeout(r,10));
  assert.match(dom.window.document.querySelector('#connection')?.textContent||'',/Подключено/);
  assert.match(dom.window.document.querySelector('#token-info')?.textContent||'',/не сохраняется/);
  assert.ok(dom.window.document.querySelector('[data-category="group:to"]'));
  assert.equal((dom.window.document.querySelector('#list') as HTMLElement).hidden,false);
  (dom.window.document.querySelector('#logout') as HTMLButtonElement).click();
  assert.match(dom.window.document.querySelector('#connection')?.textContent||'',/Не подключено/);
 }finally{
  for(const [key,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
  dom.window.close();
 }
});
