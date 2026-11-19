import { test } from 'node:test';
import assert from 'node:assert/strict';
// Браузерный модуль остаётся обычным JS без сборки.
// @ts-ignore -- нет деклараций у статического JS
import {validate as validateManage, parse, serialize} from '../public/manage/prices-schema.js';
// @ts-ignore -- модуль добавляется параллельной задачей; тест намеренно падает, пока его нет
import {validatePrices as validateSite} from '../src/shared/prices-schema.ts';

const base = () => ({version:1, updated_at:'2026-11-21',
 groups:[{id:'to',title:'ТО и жидкости',service:'to-maslo',items:[{id:'oil-sedan',name:'Замена масла',price:'1200 ₽'}]}],
 tyres:{set:[{id:'set-r13',radius:'R13',passenger:'1800 ₽',crossover:'2000 ₽'}],repair:[{id:'rep-r13',range:'R13–R15',price:'600 ₽'}],extra:[{id:'extra-set',name:'Смена колёс',price:'1000 ₽'}]},
 voyah:[{id:'voyah-oil',name:'Масло ДВС',note:'фильтры',price:'2000 ₽'}],featured:[{id:'chip-oil',ref:'voyah-oil',title:'Масло ДВС',note:'фильтры'}]});
const fixtures: Array<[string,unknown,boolean]> = [
 ['обычный прайс',base(),true],
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
for(const [name,value,expected] of fixtures)test(`схема цен: ${name}`,()=>{
 const browser=validateManage(value),site=validateSite(value);
 assert.equal(browser.ok,site.ok,`Разные решения для «${name}»: браузер ${JSON.stringify(browser)}, сайт ${JSON.stringify(site)}`);
 assert.equal(browser.ok,expected,`Неожиданный результат для «${name}»`);
});
test('разбор не бросает при повреждённом тексте, сериализация сохраняет неизвестные поля',()=>{
 assert.equal(parse('{').ok,false);const input={...base(),future:{enabled:true}};const data=serialize(input);
 assert.ok(data.endsWith('\n'));assert.equal(data.charCodeAt(0),'{'.charCodeAt(0));assert.deepEqual(JSON.parse(data).future,input.future);
});
