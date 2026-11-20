import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
// @ts-ignore статический модуль
import {createReviews,reviewErrors,parseTelegram} from '../public/manage/reviews.js';
// @ts-ignore статический модуль
import {GitHub,GitHubError} from '../public/manage/github.js';
import {parseReviewsFile} from '../src/shared/reviews-schema.ts';
const sample=()=>({updated_at:'2026-11-19',future:{ok:true},items:[
 {id:'r-2026-11-18-001',author:'Павел И.',text:'Замечательная работа и прекрасный сервис.',rating:5,source:'site',source_url:null,published_at:'2026-11-18',status:'hidden',demo:false,extra:'keep'},
 {id:'r-2026-11-19-001',author:'Марина С.',text:'Благодарю за качественную работу мастеров.',rating:4,source:'demo',source_url:null,published_at:'2026-11-19',status:'published',demo:true}]});
async function setup(initial:any=sample()){
 const dom=new JSDOM('<section id="root"></section>',{url:'https://example.test/avtotehservis/manage/',runScripts:'dangerously'});
 const previous={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document});
 const root=dom.window.document.querySelector('#root') as HTMLElement;let doc:any=structuredClone(initial),commits=0,count=0,deletedOnly=false,confirmText='';dom.window.confirm=(text?:string)=>{confirmText=text||'';return true;};
 const client={readReviews:async()=>({json:structuredClone(doc),sha:'old'}),saveReviews:async(apply:(doc:any)=>any,n:number,del:boolean)=>{doc=apply(structuredClone(doc));commits++;count=n;deletedOnly=del;return {json:structuredClone(doc),sha:'new'};}};
 const ui=createReviews(root);await ui.connect(client);
 function q(selector:string){const el=root.querySelector(selector) as HTMLElement|null;assert.ok(el,`Нет ${selector}`);return el;}
 function click(selector:string){q(selector).click();}
 function input(name:string,value:string){const field=q(`[data-review-field="${name}"]`) as HTMLInputElement;field.value=value;field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
 async function save(){click('[data-save-reviews]');await new Promise(resolve=>setTimeout(resolve,0));}
 return {dom,root,q,click,input,save,ui,get doc(){return doc;},get commits(){return commits;},get count(){return count;},get deletedOnly(){return deletedOnly;},get confirmText(){return confirmText;},setDoc(value:any){doc=value;},close(){dom.window.close();Object.assign(globalThis,previous);}};
}
test('1 загрузка, фильтры, счётчики, сортировка и примеры',async()=>{const c=await setup();try{assert.match(c.q('[data-review-filter="all"]').textContent!,/1/);assert.match(c.q('[data-review-filter="published"]').textContent!,/0/);assert.match(c.q('[data-review-filter="hidden"]').textContent!,/1/);assert.match(c.q('[data-review-filter="demo"]').textContent!,/1/);assert.equal(c.root.querySelectorAll('[data-review-id]').length,1);assert.equal((c.root.querySelector('[data-review-id]') as HTMLElement).dataset.reviewId,'r-2026-11-18-001');c.click('[data-review-filter="demo"]');assert.equal(c.root.querySelectorAll('[data-review-id]').length,1);assert.match(c.q('[data-review-id="r-2026-11-19-001"]').textContent!,/Пример/);c.click('[data-review-filter="hidden"]');assert.equal(c.root.querySelectorAll('[data-review-id]').length,1);}finally{c.close();}});
test('2 статус меняется без записи',async()=>{const c=await setup();try{c.click('[data-review-filter="demo"]');c.click('[data-review-status="r-2026-11-19-001"]');const card=c.q('[data-review-id="r-2026-11-19-001"]');assert.match(card.textContent!,/Пример, черновик/);assert.doesNotMatch(card.textContent!,/Скрыт/);assert.match(c.q('[data-reviews-message]').textContent!,/Статус примера изменён/);assert.equal(c.doc.items[1].status,'published');assert.equal(c.commits,0);}finally{c.close();}});
test('3 сохранение без изменений неактивно',async()=>{const c=await setup();try{assert.equal((c.q('[data-save-reviews]') as HTMLButtonElement).disabled,true);await c.save();assert.equal(c.commits,0);}finally{c.close();}});
test('4 два изменения один коммит и неизвестные поля',async()=>{const c=await setup();try{c.click('[data-review-status="r-2026-11-18-001"]');c.click('[data-review-filter="demo"]');c.click('[data-review-status="r-2026-11-19-001"]');await c.save();assert.equal(c.commits,1);assert.equal(c.count,2);assert.equal(c.doc.items[0].extra,'keep');assert.deepEqual(c.doc.future,{ok:true});assert.match(c.root.textContent!,/Отправлено/);}finally{c.close();}});
test('5 текст 19 и 20 знаков',async()=>{const c=await setup();try{c.click('[data-review-edit="r-2026-11-18-001"]');c.input('text','а'.repeat(19));assert.match(c.q('[data-field-error="text"]').textContent!,/20/);assert.equal((c.q('[data-save-reviews]') as HTMLButtonElement).disabled,true);assert.equal((c.q('[data-review-done]') as HTMLButtonElement).disabled,true);c.input('text','а'.repeat(20));c.click('[data-review-done]');await c.save();assert.equal(c.doc.items[0].text,'а'.repeat(20));assert.equal(c.commits,1);}finally{c.close();}});
test('6 удаление с подтверждением и один коммит',async()=>{const c=await setup();try{c.click('[data-review-filter="demo"]');c.click('[data-review-delete="r-2026-11-19-001"]');assert.match(c.confirmText,/Удалить отзыв/);assert.equal(c.root.querySelectorAll('[data-review-id]').length,0);await c.save();assert.equal(c.commits,1);assert.equal(c.deletedOnly,true);assert.equal(c.doc.items.length,1);}finally{c.close();}});
test('7 удалить все примеры только demo true',async()=>{const c=await setup();try{c.click('[data-review-clear-demo]');assert.match(c.confirmText,/все примеры/);await c.save();assert.equal(c.doc.items.length,1);assert.equal(c.doc.items[0].demo,false);}finally{c.close();}});
test('8 разбор Telegram',async()=>{const c=await setup();try{const field=c.q('[data-telegram]') as HTMLTextAreaElement;field.value='Оценка: 5/5\nИмя: Павел И.\nСпасибо за прекрасный сервис и помощь!';field.dispatchEvent(new c.dom.window.Event('input',{bubbles:true}));c.click('[data-parse-telegram]');assert.equal((c.q('[data-review-field="author"]') as HTMLInputElement).value,'Павел И.');assert.equal((c.q('[data-review-field="rating"]') as HTMLInputElement).value,'5');assert.equal((c.q('[data-review-field="text"]') as HTMLInputElement).value,'Спасибо за прекрасный сервис и помощь!');}finally{c.close();}});
test('9 пользовательский текст не выполняется',async()=>{const c=await setup();try{c.click('[data-review-add]');c.input('author','<script>window.pwned=1</script>');c.input('text','<script>window.pwned=1</script> отличный сервис');c.input('rating','5');c.click('[data-review-done]');assert.equal(c.root.querySelectorAll('script').length,0);assert.equal((c.dom.window as any).pwned,undefined);assert.match(c.root.textContent!,/<script>/);await c.save();assert.equal(c.commits,1);}finally{c.close();}});
test('схема A10 и проверка браузера на крайних значениях',()=>{const original=sample().items[0];for(const patch of [{},{author:'А'},{author:'А'.repeat(41)},{text:'а'.repeat(19)},{text:'а'.repeat(20)},{rating:0},{rating:5},{published_at:'2026-02-30'},{source_url:'javascript:alert(1)'},{demo:'true'}]){const item={...original,...patch};assert.equal(!Object.keys(reviewErrors(item)).length,parseReviewsFile({items:[item]}).errors.length===0,JSON.stringify(patch));}});
test('совместные независимые изменения сохраняются',async()=>{const c=await setup();try{c.click('[data-review-status="r-2026-11-18-001"]');const latest=sample();latest.items[0].text='Новый текст другого человека, прекрасный сервис.';c.setDoc(latest);await c.save();assert.equal(c.doc.items[0].text,latest.items[0].text);assert.equal(c.doc.items[0].status,'published');}finally{c.close();}});
test('GitHub запись одного файла и повтор при конфликте ref',async()=>{const api:any=new GitHub('fake');const calls:Array<{path:string,body:any,method:string}>=[];let patches=0;api.request=async(path:string,options:any={})=>{const body=options.body?JSON.parse(options.body):null;calls.push({path,body,method:options.method||'GET'});if(path.includes('/contents/'))return {data:{content:Buffer.from(JSON.stringify(sample())).toString('base64'),sha:'sha'}};if(path.includes('/git/ref/'))return {data:{object:{sha:'parent'}}};if(path.includes('/git/commits/'))return {data:{tree:{sha:'tree'}}};if(path.endsWith('/git/blobs'))return {data:{sha:'blob'}};if(path.endsWith('/git/trees'))return {data:{sha:'tree2'}};if(path.endsWith('/git/commits'))return {data:{sha:'new'}};if(path.includes('/git/refs/')){if(++patches===1)throw new GitHubError('conflict',409);return {data:{}};}throw Error(path);};await api.saveReviews((doc:any)=>doc,2);assert.equal(patches,2);const trees=calls.filter(c=>c.path.endsWith('/git/trees'));assert.deepEqual(trees[0].body.tree.map((e:any)=>e.path),['site/content/reviews.json']);assert.equal(calls.find(c=>c.path.endsWith('/git/commits'))!.body.message,'Отзывы: правка из админки (2 изменений)');});
test('конфликт текста не затирает чужую правку',async()=>{const c=await setup();try{c.click('[data-review-edit="r-2026-11-18-001"]');c.input('text','Моя новая версия текста для отзыва.');c.click('[data-review-done]');const other=sample();other.items[0].text='Версия от другого сотрудника, достаточно длинная.';c.setDoc(other);await c.save();assert.equal(c.commits,0);assert.equal(c.doc.items[0].text,other.items[0].text);assert.match(c.q('[data-reviews-message]').textContent!,/изменён другим человеком/);}finally{c.close();}});
test('отмена удаления оставляет список и не создаёт запись',async()=>{const c=await setup();try{c.dom.window.confirm=()=>false;c.click('[data-review-filter="demo"]');c.click('[data-review-delete="r-2026-11-19-001"]');assert.equal(c.root.querySelectorAll('[data-review-id]').length,1);assert.equal((c.q('[data-save-reviews]') as HTMLButtonElement).disabled,true);assert.equal(c.commits,0);}finally{c.close();}});

const realTelegram=`⭐ Новый отзыв с сайта (на модерации)

Оценка: 5/5 ⭐⭐⭐⭐⭐

Имя: Павел И.

Отзыв:
Заезжал на шиномонтаж, приняли вовремя, всё аккуратно.

Источник: /otzyvy

Согласие на обработку ПД: версия 2026-11-20, отметка 19.11.2026 14:22 МСК

Опубликовать: админка → Отзывы`;

test('88-1: полное реальное сообщение Telegram разбирается без служебных строк',()=>{
 assert.deepEqual(parseTelegram(realTelegram),{author:'Павел И.',rating:5,text:'Заезжал на шиномонтаж, приняли вовремя, всё аккуратно.'});
 assert.deepEqual(parseTelegram('<b>Оценка:</b> 4/5 ⭐⭐⭐⭐\n**Имя:** _Павел И._\n<b>Отзыв:</b> ⭐ Очень качественно и аккуратно.\nИсточник: /otzyvy'),{author:'Павел И.',rating:4,text:'Очень качественно и аккуратно.'});
 assert.equal(parseTelegram('Оценка: 5/50\nИмя: Павел И.\nОтличная работа и аккуратный подход.').rating,null);
});
test('88-2: старый формат без маркера сохраняет текст и отбрасывает служебные строки',()=>{
 const result=parseTelegram('⭐ Новый отзыв с сайта (на модерации)\nОценка: 3/5 ⭐⭐⭐\nИмя: Павел И.\n\n⭐ Хороший сервис.\nВсё аккуратно.\nИсточник: /otzyvy\nСогласие на обработку ПД: да\nОпубликовать: админка → Отзывы');
 assert.deepEqual(result,{author:'Павел И.',rating:3,text:'Хороший сервис.\nВсё аккуратно.'});
});
test('88-3: оценка из Telegram отсутствует — пустой выбор, добавление заблокировано',async()=>{
 const message='Оценка: —\nИмя: Павел И.\nОтзыв:\nЗаезжал на шиномонтаж, приняли вовремя, всё аккуратно.\nИсточник: /otzyvy';
 assert.equal(parseTelegram(message).rating,null);
 const c=await setup();try{const field=c.q('[data-telegram]') as HTMLTextAreaElement;field.value=message;field.dispatchEvent(new c.dom.window.Event('input',{bubbles:true}));c.click('[data-parse-telegram]');
 const select=c.q('[data-review-field="rating"]') as HTMLSelectElement;assert.equal(select.value,'');assert.equal(select.options[0].textContent,'— выберите оценку —');assert.match(c.q('[data-field-error="rating"]').textContent!,/Выберите оценку/);assert.equal((c.q('[data-review-done]') as HTMLButtonElement).disabled,true);assert.equal((c.q('[data-save-reviews]') as HTMLButtonElement).disabled,true);assert.equal(c.commits,0);
 c.input('rating','3');c.click('[data-review-done]');await c.save();assert.equal(c.doc.items.at(-1).rating,3);assert.equal(c.doc.items.at(-1).demo,false);assert.equal(c.doc.items.at(-1).status,'hidden');assert.equal(c.doc.items.at(-1).source,'site');
 }finally{c.close();}
});
test('88-4: ручное добавление требует выбора оценки и сохраняет выбранную четвёрку',async()=>{
 const c=await setup();try{c.click('[data-review-add]');const select=c.q('[data-review-field="rating"]') as HTMLSelectElement;assert.equal(select.value,'');assert.equal(select.options[0].value,'');c.input('author','Павел И.');c.input('text','Заезжал на шиномонтаж, приняли вовремя, всё аккуратно.');assert.equal((c.q('[data-review-done]') as HTMLButtonElement).disabled,true);assert.equal((c.q('[data-save-reviews]') as HTMLButtonElement).disabled,true);c.click('[data-review-done]');assert.equal(c.root.querySelectorAll('[data-review-id]').length,1);c.input('rating','4');assert.equal((c.q('[data-review-done]') as HTMLButtonElement).disabled,false);c.input('rating','');assert.equal((c.q('[data-review-done]') as HTMLButtonElement).disabled,true);c.input('rating','4');c.click('[data-review-done]');await c.save();assert.equal(c.commits,1);assert.equal(c.doc.items.at(-1).rating,4);}finally{c.close();}
});
test('88-5: служебные строки и заголовок исключаются в обоих режимах',()=>{
 for(const message of [realTelegram,'⭐ Новый отзыв с сайта (на модерации)\nОценка: —\nИмя: Павел И.\nТекст отзыва, достаточно длинный для проверки.\nИсточник: /otzyvy\nСогласие на обработку ПД: да\nОпубликовать: админка → Отзывы','Отзыв:\nПервая строка\n\nВторая строка\nИсточник: /otzyvy\nНельзя включать текст после источника\nСогласие на обработку ПД: да\nОпубликовать: админка → Отзывы']){
  const result=parseTelegram(message);assert.doesNotMatch(result.text,/Источник:|Согласие на обработку ПД:|Опубликовать:|Новый отзыв с сайта/);if(message.startsWith('Отзыв:'))assert.equal(result.text,'Первая строка\n\nВторая строка');
 }
});

function review(id:string,status:string,demo:boolean,date:string){return {id,author:'Павел И.',text:'Заезжал на шиномонтаж, приняли вовремя, всё аккуратно.',rating:5,source:demo?'demo':'site',source_url:null,published_at:date,status,demo};}
test('139-1: пример не выглядит опубликованным и не попадает в «Опубликованные»',async()=>{
 const c=await setup();try{
  assert.equal(c.root.querySelectorAll('[data-review-id]').length,1);
  assert.doesNotMatch(c.q('[data-review-id="r-2026-11-18-001"]').textContent!,/Опубликован|Пример/);
  c.click('[data-review-filter="demo"]');const demoCard=c.q('[data-review-id="r-2026-11-19-001"]');
  assert.match(demoCard.textContent!,/Пример/);assert.doesNotMatch(demoCard.textContent!,/Опубликован/);
  assert.match(demoCard.textContent!,/на сайте не показывается/);
  c.click('[data-review-filter="published"]');assert.equal(c.root.querySelectorAll('[data-review-id]').length,0);
 }finally{c.close();}
});
test('139-2: настоящий опубликованный отзыв — «Опубликован» и есть в фильтре',async()=>{
 const initial:any=sample();initial.items=[review('r-2026-11-18-001','published',false,'2026-11-18')];
 const c=await setup(initial);try{
  assert.match(c.q('[data-review-id="r-2026-11-18-001"]').textContent!,/Опубликован/);
  assert.doesNotMatch(c.q('[data-review-id="r-2026-11-18-001"]').textContent!,/Пример/);
  c.click('[data-review-filter="published"]');assert.equal(c.root.querySelectorAll('[data-review-id]').length,1);
  assert.match(c.q('[data-review-filter="published"]').textContent!,/1/);
  assert.match(c.q('[data-review-filter="demo"]').textContent!,/0/);
  assert.equal(c.root.querySelectorAll('[data-reviews-demo-warning]').length,0);
 }finally{c.close();}
});
test('139-3: смешанный набор — счётчики только по настоящим, примеры отдельной вкладкой',async()=>{
 const initial:any={updated_at:'2026-11-19',items:[review('r-2026-11-18-001','published',false,'2026-11-18'),review('r-2026-11-19-001','published',true,'2026-11-19'),review('r-2026-11-19-002','hidden',true,'2026-11-19'),review('r-2026-11-19-003','published',true,'2026-11-19')]};
 const c=await setup(initial);try{
  assert.match(c.q('[data-review-filter="all"]').textContent!,/1/);
  assert.match(c.q('[data-review-filter="published"]').textContent!,/1/);
  assert.match(c.q('[data-review-filter="hidden"]').textContent!,/0/);
  assert.match(c.q('[data-review-filter="demo"]').textContent!,/3/);
  assert.equal(c.root.querySelectorAll('[data-review-id]').length,1);
  c.click('[data-review-filter="demo"]');assert.equal(c.root.querySelectorAll('[data-review-id]').length,3);
  for(const card of c.root.querySelectorAll('[data-review-id]')){assert.doesNotMatch(card.textContent!,/Опубликован/);assert.match(card.textContent!,/Пример/);}
 }finally{c.close();}
});
test('139-4: «Удалить все примеры» доступна и удаляет только примеры',async()=>{
 const initial:any={updated_at:'2026-11-19',items:[review('r-2026-11-18-001','published',false,'2026-11-18'),review('r-2026-11-19-001','published',true,'2026-11-19'),review('r-2026-11-19-002','hidden',true,'2026-11-19')]};
 const c=await setup(initial);try{
  const clear=c.q('[data-review-clear-demo]') as HTMLButtonElement;assert.equal(clear.disabled,false);assert.equal(clear.hidden,false);
  c.click('[data-review-clear-demo]');assert.equal(c.root.querySelectorAll('[data-review-id]').length,1);assert.equal(c.root.querySelectorAll('[data-reviews-demo-warning]').length,0);
  await c.save();assert.equal(c.commits,1);assert.equal(c.doc.items.length,1);assert.equal(c.doc.items[0].demo,false);
 }finally{c.close();}
});
test('139-5: без настоящих отзывов показывается предупреждение про примеры',async()=>{
 const initial:any={updated_at:'2026-11-19',items:[review('r-2026-11-19-001','published',true,'2026-11-19'),review('r-2026-11-19-002','published',true,'2026-11-19'),review('r-2026-11-19-003','published',true,'2026-11-19'),review('r-2026-11-19-004','published',true,'2026-11-19')]};
 const c=await setup(initial);try{
  const warning=c.q('[data-reviews-demo-warning]');
  assert.match(warning.textContent!,/нет ни одного отзыва/);assert.match(warning.textContent!,/4 примера не показываются/);
  assert.match(c.q('.review-site-count').textContent!,/не видят ни одного отзыва/);
  assert.equal((c.q('[data-review-clear-demo]') as HTMLButtonElement).disabled,false);
  assert.equal(c.root.querySelectorAll('[data-review-id]').length,0);
 }finally{c.close();}
});
