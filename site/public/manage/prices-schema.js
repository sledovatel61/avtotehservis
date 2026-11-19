// Контракт prompts/100-task-r85-prices-store.md §3. Должен совпадать с src/shared/prices-schema.ts.
export const LIMITS = Object.freeze({name:[1,160],price:[1,40],title:[1,160]});
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function slugifyRu(text){const m={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'};return String(text).toLowerCase().split('').map(c=>m[c]??c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function validate(value){
 const errors=[],ids=new Set(),voyahIds=new Set();
 const err=(where,message)=>errors.push(`${where}: ${message}`);
 const id=(x,where)=>{if(typeof x!=='string'||!ID.test(x)){err(where,'неверное имя');return;}if(ids.has(x))err(where,'повторяется');ids.add(x);};
 const text=(x,where,max=160,required=true)=>{if(typeof x!=='string'||(required&&!x.trim())||x.trim().length>max)err(where,'неверная длина');};
 const price=(x,where)=>{if(typeof x!=='string'||!x.trim()||x.trim().length>40||!/\d/.test(x))err(where,'Похоже, это не цена. Напишите, например: 1200 ₽');};
 const items=(xs,where,fn)=>{if(!Array.isArray(xs)){err(where,'ожидается список');return;}xs.forEach((x,i)=>{const at=`${where}[${i}]`;if(!object(x)){err(at,'ожидается запись');return;}id(x.id,`${at}.id`);if(x.hidden!==undefined&&typeof x.hidden!=='boolean')err(`${at}.hidden`,'нужно да или нет');fn(x,at);});};
 if(!object(value))return {ok:false,errors:['Ожидается список цен.']};
 if(value.version!==1)err('version','неподдерживаемая версия');
 if(typeof value.updated_at!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.updated_at))err('updated_at','нужна дата ГГГГ-ММ-ДД');
 items(value.groups,'groups',(g,at)=>{text(g.title,`${at}.title`);text(g.service,`${at}.service`);items(g.items,`${at}.items`,(p,pAt)=>{text(p.name,`${pAt}.name`);price(p.price,`${pAt}.price`);});});
 if(!object(value.tyres))err('tyres','ожидаются таблицы');else{
  items(value.tyres.set,'tyres.set',(p,at)=>{text(p.radius,`${at}.radius`);price(p.passenger,`${at}.passenger`);price(p.crossover,`${at}.crossover`);});
  items(value.tyres.repair,'tyres.repair',(p,at)=>{text(p.range,`${at}.range`);price(p.price,`${at}.price`);});
  items(value.tyres.extra,'tyres.extra',(p,at)=>{text(p.name,`${at}.name`);price(p.price,`${at}.price`);});
 }
 items(value.voyah,'voyah',(p,at)=>{voyahIds.add(p.id);text(p.name,`${at}.name`);text(p.note,`${at}.note`,160,false);price(p.price,`${at}.price`);});
 items(value.featured,'featured',(p,at)=>{text(p.title,`${at}.title`);text(p.note,`${at}.note`,160,false);if(typeof p.ref!=='string'||!voyahIds.has(p.ref))err(`${at}.ref`,'не найдена работа Voyah');});
 return errors.length?{ok:false,errors}:{ok:true,data:value};
}
export function parse(input){try{return validate(typeof input==='string'?JSON.parse(input):input);}catch{return {ok:false,errors:['Не удалось прочитать список цен.']};}}
export function serialize(value){return JSON.stringify(value,null,2)+'\n';}
