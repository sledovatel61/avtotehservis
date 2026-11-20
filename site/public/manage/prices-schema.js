// Контракт должен совпадать с src/shared/prices-schema.ts (Агент 10).
export const LIMITS = Object.freeze({name:[2,120],note:[0,160],price:[1,40],title:[2,80],radius:[2,20],id:[2,48],maxGroupItems:40,maxVoyahItems:40});
export const PRICE_LIMITS = LIMITS;
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function slugifyRu(text){const m={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'};return String(text??'').toLowerCase().trim().split('').map(c=>m[c]??c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,LIMITS.id[1]).replace(/-+$/g,'')||'poziciya';}
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=x=>typeof x==='string'?x.trim():'';
const inRange=(value,[min,max])=>value.length>=min&&value.length<=max;
function extractPriceNumbers(price){const compact=String(price??'').replace(/(\d)[\s\u00a0]+(?=\d{3}(?:\D|$))/g,'$1');const matches=compact.match(/\d+/g);return matches?matches.map(Number).filter(Number.isFinite):[];}
export function isValidPrice(x){const s=str(x),numbers=extractPriceNumbers(s);return inRange(s,LIMITS.price)&&numbers.length>0&&!/(?:^|[^а-яёa-z])(?:руб\.?|rub)(?:$|[^а-яёa-z])/i.test(s)&&(numbers.some(n=>n>0)||/(?:^|\s)от(?:\s|$)/i.test(s));}
function checkSinglePriceValue(raw,errors){
 const price=str(raw);
 if(!inRange(price,LIMITS.price)){errors.push(`Цена должна быть от ${LIMITS.price[0]} до ${LIMITS.price[1]} символов`);return price;}
 const nums=extractPriceNumbers(price);
 if(nums.length===0){errors.push('Цена должна содержать хотя бы одну цифру');return price;}
 if(/(?:^|[^а-яёa-z])(?:руб\.?|rub)(?:$|[^а-яёa-z])/i.test(price)){errors.push('Используйте символ \u20bd вместо «руб.» или «RUB»');return price;}
 const hasPositive=nums.some(n=>n>0);
 if(!hasPositive&&!/(?:^|\s)от(?:\s|$)/i.test(price)){errors.push('Нулевая цена без пометки «от» не допускается');return price;}
 return price;
}
export function findPriceItem(prices,kind,catId,id){
 if(!object(prices))return undefined;
 const targetId=str(id);
 if(!targetId)return undefined;
 const normCat=str(catId).replace(/^group:/,'');
 if(kind==='group'){
  const groups=Array.isArray(prices.groups)?prices.groups:[];
  const grp=groups.find(g=>object(g)&&str(g.id)===normCat);
  if(!grp||!Array.isArray(grp.items))return undefined;
  return grp.items.find(it=>object(it)&&str(it.id)===targetId);
 }
 if(kind==='set'){
  const list=object(prices.tyres)&&Array.isArray(prices.tyres.set)?prices.tyres.set:[];
  return list.find(r=>object(r)&&str(r.id)===targetId);
 }
 if(kind==='repair'){
  const list=object(prices.tyres)&&Array.isArray(prices.tyres.repair)?prices.tyres.repair:[];
  return list.find(r=>object(r)&&str(r.id)===targetId);
 }
 if(kind==='extra'){
  const list=object(prices.tyres)&&Array.isArray(prices.tyres.extra)?prices.tyres.extra:[];
  return list.find(r=>object(r)&&str(r.id)===targetId);
 }
 if(kind==='voyah'){
  const list=Array.isArray(prices.voyah)?prices.voyah:[];
  return list.find(it=>object(it)&&str(it.id)===targetId);
 }
 return undefined;
}
export function removePriceItem(prices,kind,catId,id){
 if(!object(prices))return {ok:false,errors:['Файл прайса должен быть объектом']};
 const targetId=str(id);
 if(!targetId)return {ok:false,errors:['Не указан идентификатор позиции']};
 const normCat=str(catId).replace(/^group:/,'');
 if(kind!=='group'&&kind!=='set'&&kind!=='repair'&&kind!=='extra'&&kind!=='voyah'){
  return {ok:false,errors:[`Неизвестный раздел прайса «${String(kind)}»`]};
 }
 if(kind==='group'){
  const groups=Array.isArray(prices.groups)?prices.groups:[];
  const grp=groups.find(g=>object(g)&&str(g.id)===normCat);
  if(!grp)return {ok:false,errors:[`Категория «${normCat}» не найдена`]};
 }
 const existing=findPriceItem(prices,kind,catId,targetId);
 if(!existing)return {ok:false,errors:[`Позиция «${targetId}» не найдена`]};
 const featured=Array.isArray(prices.featured)?prices.featured:[];
 const blocking=featured.filter(ch=>object(ch)&&str(ch.ref)===targetId);
 if(blocking.length>0){
  return {ok:false,errors:blocking.map(ch=>`Сначала уберите плашку «${str(ch.title)||str(ch.id)}» на главной`)};
 }
 const next=structuredClone(prices);
 if(kind==='group'){
  const grp=next.groups.find(g=>str(g.id)===normCat);
  grp.items=grp.items.filter(it=>str(it.id)!==targetId);
 }else if(kind==='set'){
  next.tyres.set=next.tyres.set.filter(r=>str(r.id)!==targetId);
 }else if(kind==='repair'){
  next.tyres.repair=next.tyres.repair.filter(r=>str(r.id)!==targetId);
 }else if(kind==='extra'){
  next.tyres.extra=next.tyres.extra.filter(r=>str(r.id)!==targetId);
 }else if(kind==='voyah'){
  next.voyah=next.voyah.filter(it=>str(it.id)!==targetId);
 }
 return {ok:true,value:next};
}
export function renamePriceItem(prices,kind,catId,id,patch){
 if(!object(prices))return {ok:false,errors:['Файл прайса должен быть объектом']};
 if(!object(patch))return {ok:false,errors:['Изменения позиции должны быть объектом']};
 const targetId=str(id);
 if(!targetId)return {ok:false,errors:['Не указан идентификатор позиции']};
 const normCat=str(catId).replace(/^group:/,'');
 if(kind!=='group'&&kind!=='set'&&kind!=='repair'&&kind!=='extra'&&kind!=='voyah'){
  return {ok:false,errors:[`Неизвестный раздел прайса «${String(kind)}»`]};
 }
 if(kind==='group'){
  const groups=Array.isArray(prices.groups)?prices.groups:[];
  const grp=groups.find(g=>object(g)&&str(g.id)===normCat);
  if(!grp)return {ok:false,errors:[`Категория «${normCat}» не найдена`]};
 }
 const next=structuredClone(prices);
 const target=findPriceItem(next,kind,catId,targetId);
 if(!target)return {ok:false,errors:[`Позиция «${targetId}» не найдена`]};
 const errors=[];
 if(kind==='group'||kind==='extra'||kind==='voyah'){
  if(patch.name!==undefined)target.name=str(patch.name);
  if(patch.note!==undefined)target.note=patch.note===null?'':str(patch.note);
  if(patch.price!==undefined)target.price=str(patch.price);
  if(typeof patch.hidden==='boolean')target.hidden=patch.hidden;
  const nameVal=str(target.name);
  if(!inRange(nameVal,LIMITS.name))errors.push(`Название работы: ${LIMITS.name[0]}–${LIMITS.name[1]} символов`);
  const noteVal=target.note===undefined||target.note===null?'':str(target.note);
  if(!inRange(noteVal,LIMITS.note))errors.push(`Примечание: до ${LIMITS.note[1]} символов`);
  target.price=checkSinglePriceValue(target.price,errors);
 }else if(kind==='set'){
  if(patch.radius!==undefined)target.radius=str(patch.radius);
  if(patch.passenger!==undefined)target.passenger=str(patch.passenger);
  if(patch.crossover!==undefined)target.crossover=str(patch.crossover);
  if(patch.price!==undefined&&patch.passenger===undefined&&patch.crossover===undefined)target.passenger=str(patch.price);
  if(typeof patch.hidden==='boolean')target.hidden=patch.hidden;
  const radVal=str(target.radius);
  if(!inRange(radVal,LIMITS.radius))errors.push(`Радиус: ${LIMITS.radius[0]}–${LIMITS.radius[1]} символов`);
  target.passenger=checkSinglePriceValue(target.passenger,errors);
  target.crossover=checkSinglePriceValue(target.crossover,errors);
 }else if(kind==='repair'){
  if(patch.range!==undefined||patch.radius!==undefined){
   const nextRad=str(patch.range!==undefined?patch.range:patch.radius);
   target.radius=nextRad;
   target.range=nextRad;
  }
  if(patch.price!==undefined)target.price=str(patch.price);
  if(typeof patch.hidden==='boolean')target.hidden=patch.hidden;
  const radVal=str(target.radius!==undefined?target.radius:target.range);
  if(!inRange(radVal,LIMITS.radius))errors.push(`Радиус: ${LIMITS.radius[0]}–${LIMITS.radius[1]} символов`);
  target.price=checkSinglePriceValue(target.price,errors);
 }
 target.id=targetId;
 if(errors.length>0)return {ok:false,errors};
 return {ok:true,value:next};
}
export function validate(value){
 const errors=[],ids=new Set(),voyahIds=new Set();
 const err=(where,message)=>errors.push(`${where}: ${message}`);
 const id=(x,where,unique=true)=>{x=str(x);if(!inRange(x,LIMITS.id)||!ID.test(x)){err(where,'неверное имя');return;}if(unique){if(ids.has(x))err(where,'повторяется');ids.add(x);}};
 const text=(x,where,limits)=>{if(!inRange(str(x),limits))err(where,'неверная длина');};
 const price=(x,where)=>{if(!isValidPrice(x))err(where,'Похоже, это не цена. Напишите, например: 1200 ₽');};
 const items=(xs,where,fn,max)=>{if(!Array.isArray(xs)){err(where,'ожидается список');return;}if(max!==undefined&&xs.length>max)err(where,`не более ${max} позиций`);xs.forEach((x,i)=>{const at=`${where}[${i}]`;if(!object(x)){err(at,'ожидается запись');return;}id(x.id,`${at}.id`);if(x.hidden!==undefined&&typeof x.hidden!=='boolean')err(`${at}.hidden`,'нужно да или нет');fn(x,at);});};
 const priceItem=(p,at)=>{text(p.name,`${at}.name`,LIMITS.name);text(p.note,`${at}.note`,LIMITS.note);price(p.price,`${at}.price`);};
 if(!object(value))return {ok:false,errors:['Ожидается список цен.']};
 if(Object.hasOwn(value,'version') && value.version!==1)errors.push('Файл цен от другой версии сайта, сообщите разработчику');
 const date=str(value.updated_at),match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);let validDate=false;
 if(match){const [,y,m,d]=match,dt=new Date(Date.UTC(+y,+m-1,+d));validDate=dt.getUTCFullYear()===+y&&dt.getUTCMonth()===+m-1&&dt.getUTCDate()===+d;}
 if(!validDate)err('updated_at','нужна реальная дата ГГГГ-ММ-ДД');
 if(Array.isArray(value.groups)&&!value.groups.length)err('groups','нужна хотя бы одна категория');
 items(value.groups,'groups',(g,at)=>{text(g.title,`${at}.title`,LIMITS.title);id(g.service,`${at}.service`,false);items(g.items,`${at}.items`,priceItem,LIMITS.maxGroupItems);});
 if(!object(value.tyres))err('tyres','ожидаются таблицы');else{
  items(value.tyres.set,'tyres.set',(p,at)=>{text(p.radius,`${at}.radius`,LIMITS.radius);price(p.passenger,`${at}.passenger`);price(p.crossover,`${at}.crossover`);},LIMITS.maxGroupItems);
  items(value.tyres.repair,'tyres.repair',(p,at)=>{text(p.radius!==undefined?p.radius:p.range,`${at}.radius`,LIMITS.radius);price(p.price,`${at}.price`);},LIMITS.maxGroupItems);
  items(value.tyres.extra,'tyres.extra',priceItem,LIMITS.maxGroupItems);
 }
 items(value.voyah,'voyah',(p,at)=>{voyahIds.add(str(p.id));priceItem(p,at);},LIMITS.maxVoyahItems);
 items(value.featured,'featured',(p,at)=>{text(p.title,`${at}.title`,LIMITS.title);text(p.note,`${at}.note`,LIMITS.note);if(!voyahIds.has(str(p.ref)))err(`${at}.ref`,'не найдена работа Voyah');});
 return errors.length?{ok:false,errors}:{ok:true,data:value};
}
export function parse(input){try{return validate(typeof input==='string'?JSON.parse(input):input);}catch{return {ok:false,errors:['Не удалось прочитать список цен.']};}}
export function serialize(value){return JSON.stringify(value,null,2)+'\n';}
