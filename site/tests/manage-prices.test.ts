import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
// Браузерный модуль остаётся обычным JS без сборки.
// @ts-ignore -- нет деклараций у статического JS
import {validate as validateManage, parse, serialize} from '../public/manage/prices-schema.js';

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
 ['двести позиций',(()=>{const x=base();x.groups[0].items=Array.from({length:200},(_,i)=>({id:`work-${i}`,name:`Работа ${i}`,price:`${1000+i} ₽`}));return x;})(),true],
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
 const {validatePrices: validateSite} = await import(siteSchema.href);
 test('сверка браузерной и серверной схем', async t=>{
  assert.equal(typeof validateSite,'function','Схема A10 должна экспортировать validatePrices');
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
