import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
// @ts-ignore -- статические браузерные модули
import {blank,orderCases as browserOrder} from '../public/manage/store.js';
// @ts-ignore -- статические браузерные модули
import {GitHub,GitHubError} from '../public/manage/github.js';
import {orderCases as siteOrder, type SiteCase} from '../src/shared/cases-schema.ts';

function work(slug:string,sort:number,status='published',published_at='2026-11-19'):SiteCase {
 const photo={base:`${slug}1-single`,alt:'Фото работы',w:960,h:720,ext:'webp' as const};
 return {slug,title:`Работа ${slug}`,description:'Описание',service_slug:'podveska',mode:'single',status:status as 'draft'|'published',published_at,sort,cover:photo,before:[],after:[],photos:[photo]};
}
const fixture=()=>({version:1,updated_at:'2026-11-19T12:00:00Z',future:'сохранять',cases:[work('three',30,'published','2026-11-17'),work('one',10,'published','2026-11-18'),work('two',20,'draft','2026-11-19')]});
let sequence=0;
async function setup(initial=fixture()){
 const html=readFileSync(new URL('../public/manage/index.html',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:'https://example.test/avtotehservis/manage/#photos'});
 const saved=new Map(['window','document','localStorage','location','fetch','confirm','prompt','createImageBitmap'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{window:{configurable:true,value:dom.window},document:{configurable:true,value:dom.window.document},location:{configurable:true,value:dom.window.location},localStorage:{configurable:true,value:dom.window.localStorage},confirm:{configurable:true,value:()=>true},prompt:{configurable:true,value:()=>null},fetch:{configurable:true,value:async()=>new Response(JSON.stringify({refs:{},featured:{}}),{status:200})}});
 dom.window.scrollTo=()=>{};dom.window.confirm=()=>true;
 const createUrl=URL.createObjectURL,revokeUrl=URL.revokeObjectURL;
 URL.createObjectURL=()=> 'blob:mock';URL.revokeObjectURL=()=>{};
 Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async()=>({width:960,height:720,close(){}})});
 (dom.window as any).createImageBitmap=(globalThis as any).createImageBitmap;
 dom.window.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/webp;base64,mock';
 dom.window.HTMLCanvasElement.prototype.getContext=(()=>({fillRect(){},drawImage(){}})) as any;
 dom.window.HTMLCanvasElement.prototype.toBlob=function(callback:any){callback(new Blob(['image'],{type:'image/webp'}));};
 let remote:any=structuredClone(initial),sha=0,commits=0,failed=false,files:any[]=[];
 const methods=['user','read','budget','readPrices','readReviews','readNews','save','image','publicRuns'];const original=new Map(methods.map(k=>[k,(GitHub.prototype as any)[k]]));
 const prices=JSON.parse(readFileSync(new URL('../content/prices.json',import.meta.url),'utf8'));
 GitHub.prototype.user=async()=>({data:{login:'test'},headers:new Headers()});
 GitHub.prototype.read=async()=>({json:structuredClone(remote),sha:String(sha)});
 GitHub.prototype.budget=async()=>({count:0,bytes:0,truncated:false});
 GitHub.prototype.readPrices=async()=>({json:structuredClone(prices),sha:'prices'});
 GitHub.prototype.readReviews=async()=>({json:JSON.parse(readFileSync(new URL('../content/reviews.json',import.meta.url),'utf8')),sha:'reviews'});
 GitHub.prototype.readNews=async()=>({json:JSON.parse(readFileSync(new URL('../content/news.json',import.meta.url),'utf8')),sha:'news'});
 GitHub.prototype.image=async()=>new Blob(['mock']);
 GitHub.prototype.publicRuns=async()=>[];
 GitHub.prototype.save=async(initial:any,apply:any,buildFiles:any,progress:any)=>{
  progress('Проверяем…');if(failed){failed=false;throw new GitHubError('Нет связи',0);}
  if(initial.sha!==String(sha)&&!apply.canRebase(structuredClone(remote)))throw new GitHubError('Конфликт',409);
  const next=apply(structuredClone(remote));files=await buildFiles();remote=structuredClone(next);commits++;sha++;return {json:structuredClone(remote),contentSha:String(sha),commit:'test-commit'};
 };
 // Разные URL обеспечивают отдельное состояние приложения в каждом jsdom.
 await import(new URL(`../public/manage/app.js?case-order=${sequence++}`,import.meta.url).href);
 const doc=dom.window.document;
 const q=(selector:string)=>{const node=doc.querySelector(selector) as HTMLElement|null;assert.ok(node,`нет ${selector}`);return node;};
 const click=(selector:string)=>q(selector).click();
 const wait=async(predicate:()=>boolean)=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Не дождались обновления интерфейса');};
 (q('#token') as HTMLInputElement).value='mock';click('#check');await wait(()=>doc.querySelectorAll('[data-open]').length===initial.cases.length&&!(q('#check') as HTMLButtonElement).disabled);
 const list=()=>[...doc.querySelectorAll<HTMLElement>('[data-open]')].map(n=>n.dataset.open);
 const open=async(slug:string)=>{click(`[data-open="${slug}"]`);await wait(()=>!q('#form').hidden);};
 const save=async(action='save')=>{const old=commits;click(`[data-save="${action}"]`);await wait(()=>commits>old&&!!doc.querySelector('#success .success'));};
 const back=()=>click('[data-back]');
 return {dom,doc,q,click,wait,list,open,save,back,get remote(){return remote;},get commits(){return commits;},get files(){return files;},fail(){failed=true;},mutate(fn:(value:any)=>void){fn(remote);sha++;},close(){URL.createObjectURL=createUrl;URL.revokeObjectURL=revokeUrl;for(const [k,v] of original)(GitHub.prototype as any)[k]=v;for(const [k,d] of saved)if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);dom.window.close();}};
}

test('1 новая работа получает сортировку меньше минимума',()=>{const f=fixture(),created=blank(f.cases);assert.equal(created.sort,-10);assert.equal(browserOrder([...f.cases,{...f.cases[0],slug:'new',sort:created.sort}])[0].slug,'new');assert.equal(blank([{sort:-40},{sort:8}]).sort,-50);assert.equal(blank([]).sort,-10);});
test('2 публикация черновика перемещает его на первое место',async()=>{const c=await setup();try{assert.deepEqual(c.list(),['one','two','three']);await c.open('two');await c.save('publish');assert.equal(c.remote.cases.find((x:SiteCase)=>x.slug==='two').status,'published');assert.equal(c.remote.cases.find((x:SiteCase)=>x.slug==='two').sort,-10);c.back();assert.deepEqual(c.list(),['two','one','three']);assert.equal(c.commits,1);}finally{c.close();}});
test('3 повторное сохранение опубликованной работы сохраняет место',async()=>{const c=await setup();try{await c.open('three');const input=c.q('[data-field="title"]') as HTMLInputElement;input.value='Работа после редактирования';input.dispatchEvent(new c.dom.window.Event('input',{bubbles:true}));await c.save();assert.equal(c.remote.cases.find((x:SiteCase)=>x.slug==='three').sort,30);c.back();assert.deepEqual(c.list(),['one','two','three']);}finally{c.close();}});
test('4 перемещение локально, затем один коммит и шаг 10',async()=>{const c=await setup();try{c.click('[data-move-case][data-slug="two"][data-move="up"]');assert.equal(c.commits,0);assert.equal((c.q('#check') as HTMLButtonElement).disabled,false);assert.deepEqual(c.list(),['two','one','three']);assert.deepEqual(browserOrder(c.remote.cases).map((x:SiteCase)=>x.sort),[10,20,30]);c.click('[data-save-order]');await c.wait(()=>c.commits===1&&(c.q('[data-save-order]') as HTMLButtonElement).disabled);assert.deepEqual(browserOrder(c.remote.cases).map((x:SiteCase)=>x.sort),[10,20,30]);assert.deepEqual(siteOrder(c.remote.cases).map(x=>x.slug),['two','one','three']);assert.deepEqual(c.files,[]);assert.equal(c.remote.future,'сохранять');}finally{c.close();}});
test('5 крайние кнопки заблокированы',async()=>{const c=await setup();try{assert.equal((c.q('[data-move-case][data-slug="one"][data-move="up"]') as HTMLButtonElement).disabled,true);assert.equal((c.q('[data-move-case][data-slug="three"][data-move="down"]') as HTMLButtonElement).disabled,true);c.click('[data-move-case][data-slug="one"][data-move="up"]');assert.equal(c.commits,0);}finally{c.close();}});
test('6 порядок совпадает с серверным при равных sort',()=>{const cases=[work('a',10,'published','2026-11-02'),work('b',10,'draft','2026-11-07'),work('c',-10,'published','2026-11-01'),work('d',10,'published','2026-11-07'),work('e',30,'published','2026-12-01')];const input=structuredClone(cases);assert.deepEqual(browserOrder(cases).map((c:SiteCase)=>c.slug),siteOrder(cases).map(c=>c.slug));assert.deepEqual(cases,input,'порядок входного массива не меняется');});
test('7 ошибка сохранения оставляет порядок и возможность повтора',async()=>{const c=await setup();try{c.fail();c.click('[data-move-case][data-slug="two"][data-move="up"]');c.click('[data-save-order]');await c.wait(()=>!c.q('#notice').hidden&&c.q('#notice').classList.contains('error'));assert.deepEqual(c.list(),['two','one','three']);assert.equal(c.commits,0);assert.equal((c.q('[data-save-order]') as HTMLButtonElement).disabled,false);c.click('[data-save-order]');await c.wait(()=>c.commits===1&&c.list()[0]==='two');}finally{c.close();}});
test('публикация выбором статуса тоже ставит черновик первым',async()=>{const c=await setup();try{await c.open('two');const field=c.q('[data-field="status"]') as HTMLSelectElement;field.value='published';field.dispatchEvent(new c.dom.window.Event('change',{bubbles:true}));await c.save();c.back();assert.deepEqual(c.list(),['two','one','three']);}finally{c.close();}});
test('дублирование создаёт работу первой с учётом новых параллельных работ',async()=>{const c=await setup();try{c.click('[data-copy="three"]');await c.wait(()=>!c.q('#form').hidden);const slug=c.q('[data-field="slug"]') as HTMLInputElement;slug.value='copy-three';slug.dispatchEvent(new c.dom.window.Event('input',{bubbles:true}));c.mutate(doc=>doc.cases.push(work('other',-30)));await c.save();assert.equal(c.remote.cases.find((x:SiteCase)=>x.slug==='copy-three').sort,-40);c.back();assert.deepEqual(c.list(),['copy-three','other','one','two','three']);assert.equal(c.commits,1);}finally{c.close();}});
test('параллельная перестановка вызывает конфликт, не перезаписывает порядок',async()=>{const c=await setup();try{c.click('[data-move-case][data-slug="two"][data-move="up"]');c.mutate(doc=>{doc.cases.find((x:SiteCase)=>x.slug==='one').sort=100;});c.click('[data-save-order]');await c.wait(()=>!c.q('#notice').hidden&&c.q('#notice').classList.contains('error'));assert.equal(c.commits,0);assert.deepEqual(c.list(),['two','one','three']);assert.match(c.q('#notice').textContent||'',/Порядок работ изменился/);assert.equal(c.remote.cases.find((x:SiteCase)=>x.slug==='one').sort,100);}finally{c.close();}});
test('параллельное изменение текста сохраняется при перестановке',async()=>{const c=await setup();try{c.click('[data-move-case][data-slug="two"][data-move="up"]');c.mutate(doc=>{doc.cases.find((x:SiteCase)=>x.slug==='three').title='Чужая правка работы';});c.click('[data-save-order]');await c.wait(()=>c.commits===1&&c.list()[0]==='two');assert.equal(c.remote.cases.find((x:SiteCase)=>x.slug==='three').title,'Чужая правка работы');}finally{c.close();}});
test('пять перемещений подряд не отправляют данные; возврат порядка выключает сохранение',async()=>{const c=await setup();try{
 assert.equal((c.q('[data-save-order]') as HTMLButtonElement).disabled,true);
 const move=(slug:string,direction:string)=>c.click(`[data-move-case][data-slug="${slug}"][data-move="${direction}"]`);
 move('three','up');move('three','up');move('three','down');move('three','down');move('two','up');
 assert.deepEqual(c.list(),['two','one','three']);assert.equal(c.commits,0);assert.equal((c.q('[data-save-order]') as HTMLButtonElement).disabled,false);assert.match(c.q('#list [role=status]').textContent||'',/Порядок изменён/);
 assert.equal((c.q('[data-slug="two"][data-move="up"]') as HTMLButtonElement).disabled,true);assert.equal((c.q('[data-slug="three"][data-move="down"]') as HTMLButtonElement).disabled,true);
 move('two','down');assert.deepEqual(c.list(),['one','two','three']);assert.equal((c.q('[data-save-order]') as HTMLButtonElement).disabled,true);assert.equal(c.commits,0);
}finally{c.close();}});
test('отмена ухода, открытие работы и beforeunload защищают черновик порядка',async()=>{const c=await setup();try{
 c.click('[data-slug="two"][data-move="up"]');let confirmations=0;
 Object.defineProperty(globalThis,'confirm',{configurable:true,value:()=>{confirmations++;return false;}});
 const event=new c.dom.window.Event('beforeunload',{cancelable:true});c.dom.window.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
 c.click('[data-open="one"]');assert.equal(confirmations,1);assert.equal(c.q('#form').hidden,true);assert.deepEqual(c.list(),['two','one','three']);
 c.click('#logout');assert.equal(confirmations,2);assert.deepEqual(c.list(),['two','one','three']);
 Object.defineProperty(globalThis,'confirm',{configurable:true,value:()=>{confirmations++;return true;}});c.click('[data-open="one"]');await c.wait(()=>!c.q('#form').hidden);assert.equal(confirmations,3);c.back();assert.deepEqual(c.list(),['one','two','three']);
}finally{c.close();}});
test('новая опубликованная работа первая среди трёх опубликованных и на витрине',async()=>{const initial=fixture();initial.cases=[work('one',20),work('two',30),work('three',40)];const c=await setup(initial);try{
 c.click('[data-new]');assert.equal(c.q('#form').hidden,false);c.click('[data-mode="single"]');
 const title=c.q('[data-field="title"]') as HTMLInputElement;title.value='Новая работа';title.dispatchEvent(new c.dom.window.Event('input',{bubbles:true}));
 const slug=c.q('[data-field="slug"]') as HTMLInputElement;slug.value='new-work';slug.dispatchEvent(new c.dom.window.Event('input',{bubbles:true}));
 const file=c.q('[data-files="photos"]') as HTMLInputElement;Object.defineProperty(file,'files',{configurable:true,value:[new c.dom.window.File(['photo'],'photo.jpg',{type:'image/jpeg'})]});file.dispatchEvent(new c.dom.window.Event('change',{bubbles:true}));
 await c.wait(()=>!!c.doc.querySelector('[data-alt="photos:0"]'));const alt=c.q('[data-alt="photos:0"]') as HTMLInputElement;alt.value='Фото работы';alt.dispatchEvent(new c.dom.window.Event('input',{bubbles:true}));
 await c.save('publish');assert.equal(c.remote.cases.find((x:SiteCase)=>x.slug==='new-work').sort,-10);assert.equal(siteOrder(c.remote.cases.filter((x:SiteCase)=>x.status==='published'))[0].slug,'new-work');c.back();assert.deepEqual(c.list(),['new-work','one','two','three']);
}finally{c.close();}});
