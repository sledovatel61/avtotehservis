// Отзывы из файла и с сайта объединяются в черновик; изменения сохраняются в обоих источниках.
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const SOURCE_NAMES={site:'Сайт',yandex:'Яндекс Карты','2gis':'2ГИС',demo:'Пример'};
// Склонение для честных счётчиков: «1 отзыв / 2 отзыва / 6 отзывов».
function plural(n,one,few,many){const n10=n%10,n100=n%100;if(n10===1&&n100!==11)return one;if(n10>=2&&n10<=4&&(n100<10||n100>=20))return few;return many;}
function realDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;}
export function reviewErrors(item){
 const errors={},author=typeof item.author==='string'?item.author.trim():'',text=typeof item.text==='string'?item.text.trim():'';
 if(author.length<2||author.length>40)errors.author='Имя должно содержать от 2 до 40 символов.';
 if(text.length<20||text.length>1500)errors.text='Текст должен содержать от 20 до 1500 символов.';
 if(!Number.isInteger(item.rating)||item.rating<1||item.rating>5)errors.rating='Выберите оценку от 1 до 5.';
 if(!realDate(item.published_at))errors.published_at='Укажите настоящую дату.';
 if(!['site','yandex','2gis','demo'].includes(item.source))errors.source='Выберите источник.';
 if(item.source_url!=null&&item.source_url!==''&&(typeof item.source_url!=='string'||(item.source_url.trim()&&!/^https?:\/\/\S+$/i.test(item.source_url.trim()))))errors.source_url='Укажите ссылку, начинающуюся с http:// или https://.';
 if(!['published','hidden'].includes(item.status))errors.status='Выберите статус отзыва.';
 if(typeof item.id!=='string'||!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(item.id.trim()))errors.id='Не удалось определить отзыв. Обратитесь к разработчику.';
 if(item.demo!==undefined&&typeof item.demo!=='boolean')errors.demo='Не удалось определить пример. Обратитесь к разработчику.';
 return errors;
}
function validateDocument(doc){if(!doc||typeof doc!=='object'||!Array.isArray(doc.items))return false;const ids=new Set();return doc.items.every(item=>{if(!item||typeof item!=='object'||Object.keys(reviewErrors(item)).length||ids.has(item.id.trim()))return false;ids.add(item.id.trim());return true;});}
function nextId(items,date){const used=new Set(items.map(r=>r.id));for(let n=1;n<=999;n++){const id=`r-${date}-${String(n).padStart(3,'0')}`;if(!used.has(id))return id;}throw Error('На эту дату уже добавлено слишком много отзывов. Выберите другую дату.');}
export function parseTelegram(value){
 let author='',rating=null;const lines=String(value).replace(/\r\n?/g,'\n').split('\n');
 // Разметку снимаем при распознавании полей, не меняя остальной текст клиента.
 const plain=line=>line.replace(/<[^>]*>/g,'').replace(/[*_]/g,'');
 const service=line=>/^\s*(?:Источник\s*:|Согласие\s+на\s+обработку|Опубликовать\s*:)/i.test(line);
 const header=line=>/Новый отзыв с сайта/i.test(line);
 const marker=line=>/^\s*Отзыв\s*:/i.test(line);
 const reviewIndex=lines.findIndex(line=>marker(plain(line)));
 const text=[];let ended=false;
 for(let i=0;i<lines.length;i++){
  const line=lines[i],clean=plain(line);
  if(header(clean))continue;
  if(service(clean)){if(reviewIndex>=0&&i>reviewIndex)ended=true;continue;}
  if(reviewIndex>=0&&i>reviewIndex){if(!ended)text.push(line);continue;}
  if(reviewIndex===i){const colon=line.indexOf(':');const remainder=colon<0?'':line.slice(colon+1).replace(/^\s*(?:<\/[^>]+>|[*_])+\s*/, '');if(remainder.trim())text.push(remainder);continue;}
  const score=clean.match(/Оценка\s*:\s*([1-5])\s*\/\s*5(?!\d)/i);
  const name=clean.match(/^\s*Имя\s*:\s*(.+)$/i);
  if(score)rating=Number(score[1]);
  if(name)author=name[1].trim();
  if(score||name||/^\s*(?:Оценка|Имя)\s*:/i.test(clean))continue;
  if(reviewIndex<0)text.push(line);
 }
 return {author,rating,text:text.join('\n').trim().replace(/^(?:⭐\s*)+/, '').trim()};
}
function displayError(error){if(error?.status===401)return 'Ключ доступа не принят. Проверьте его срок.';if(error?.status===403)return 'Нет доступа к отзывам. Проверьте права ключа.';if(error?.status===404)return 'Отзывы пока недоступны. Обратитесь к разработчику.';if(error?.status===409||error?.status===422)return 'Кто-то сохранил изменения одновременно. Нажмите «Сохранить» ещё раз.';return error?.message||'Не удалось сохранить: нет связи. Попробуйте ещё раз.';}
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function button(text,attribute,value,className='button'){const node=element('button',className,text);node.type='button';node.setAttribute(attribute,value);return node;}
function labelInput(label,name,value,options={}){const wrap=element('label','review-field',label);let input;if(options.textarea){input=element('textarea');input.rows=options.rows||5;}else if(options.choices){input=element('select');for(const [v,title] of options.choices){const opt=element('option','',title);opt.value=v;input.append(opt);}}else{input=element('input');input.type=options.type||'text';}input.name=name;input.value=value??'';if(options.max)input.maxLength=options.max;input.setAttribute('data-review-field',name);wrap.append(input);const err=element('span','field-error');err.setAttribute('role','alert');err.dataset.fieldError=name;wrap.append(err);return wrap;}

/* Вход в мастерскую один: ключ GitHub. Прослойка проверяет его сама, поэтому
   второго кода для отзывов не нужно. */
let authToken='';
let liveBase='https://ats-leads.ats439.workers.dev';

/** Передать ключ GitHub из общего блока входа (вызывает app.js при подключении). */
export function configureReviews(options={}){
 if(typeof options.token==='string')authToken=options.token.trim();
 if(typeof options.base==='string'&&options.base)liveBase=options.base.replace(/\/+$/,'');
}

export function createReviews(root){
 let api=null,snapshot=null,draft=null,filter='all',editor=null,saving=false,message='',error=false,success=false,telegram='',demoHintShown=false;
 let liveLinks=new Map(),liveBaseline=new Map(),liveLoading=false,liveMessage='',liveErrorState=false,session=0;
 const liveHeaders=()=>({'content-type':'application/json',authorization:`Bearer ${authToken}`});
 async function liveFetch(url,options){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{return await fetch(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}}
 const reviewKey=item=>[item.author,item.text].map(x=>String(x||'').trim().replace(/\s+/g,' ').toLowerCase()).join('|')+'|'+item.rating;
 function liveChanges(){if(!draft)return [];const result=[];for(const [fileId,live] of liveLinks){const item=draft.items.find(r=>r.id===fileId);if(!item){result.push({fileId,live,action:'delete'});continue;}if(item.status!==live.status)result.push({fileId,live,action:item.status==='hidden'?'hide':'publish'});if(['author','text','rating'].some(key=>item[key]!==liveBaseline.get(fileId)?.[key]))result.push({fileId,live,action:'edit',item:copy(item)});}return result;}
 const hasChanges=()=>changes().length>0||liveChanges().length>0;
 function changes(){if(!snapshot||!draft)return [];const old=new Map(snapshot.json.items.map(item=>[item.id,item])),now=new Map(draft.items.map(item=>[item.id,item])),result=[];for(const [id,item] of now){const original=old.get(id);if(!original)result.push({id,type:'add',item:copy(item)});else if(!same(original,item))result.push({id,type:'edit',item:copy(item),original:copy(original)});}for(const [id,item] of old)if(!now.has(id))result.push({id,type:'delete',original:copy(item)});return result;}
 const hasEditorChanges=()=>!!editor&&!same(editor.item,editor.original);
 const dirty=()=>hasChanges()||hasEditorChanges();
 window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
 function say(text,isError=false){message=text;error=isError;const node=root.querySelector('[data-reviews-message]');if(node){node.textContent=text;node.className='notice'+(isError?' error':'');node.hidden=!text;}}
 function add(parent,...children){for(const child of children)parent.append(child);}
 function confirmDelete(items,allExamples=false){const last=items.some(item=>item.status==='published'&&item.demo!==true)&&!draft.items.some(item=>item.status==='published'&&item.demo!==true&&!items.some(x=>x.id===item.id));const label=allExamples?`Удалить все примеры (${items.length})?`:`Удалить отзыв «${items[0].author}»?`;return window.confirm(label+(last?'\nНа сайте вернётся заглушка про Яндекс.Карты.':''));}
 function startEditor(item){success=false;message='';editor={item:copy(item),original:copy(item),isNew:!draft.items.some(r=>r.id===item.id)};render();root.querySelector('[data-review-field="author"]')?.focus();}
 function refreshEditorErrors(){if(!editor)return;const errors=reviewErrors(editor.item);for(const node of root.querySelectorAll('[data-field-error]')){node.textContent=errors[node.dataset.fieldError]||'';const field=node.parentElement.querySelector('[data-review-field]');if(field){if(errors[node.dataset.fieldError])field.setAttribute('aria-invalid','true');else field.removeAttribute('aria-invalid');}}const done=root.querySelector('[data-review-done]');if(done)done.disabled=Object.keys(errors).length>0||saving;const save=root.querySelector('[data-save-reviews]');if(save)save.disabled=saving||!!editor||!hasChanges()||liveLoading||!validateDocument(draft);}
 function renderEditor(parent){
  if(!editor)return;const item=editor.item,box=element('section','panel review-editor');box.dataset.reviewEditor='';add(box,element('h3','',editor.isNew?'Добавить отзыв':'Изменить отзыв'));
  const fields=element('div','review-form-grid');
  add(fields,labelInput('Имя','author',item.author,{max:40}),labelInput('Оценка','rating',item.rating==null?'':String(item.rating),{choices:[['','— выберите оценку —'],['1','1 из 5'],['2','2 из 5'],['3','3 из 5'],['4','4 из 5'],['5','5 из 5']]}),labelInput('Текст отзыва','text',item.text,{textarea:true,max:1500}),labelInput('Источник','source',item.source,{choices:[['site','Сайт'],['yandex','Яндекс Карты'],['2gis','2ГИС'],...(item.source==='demo'?[['demo','Пример']]:[])]}),labelInput('Ссылка на источник (необязательно)','source_url',item.source_url||'',{type:'url'}),labelInput('Дата','published_at',item.published_at,{type:'date'}),labelInput('Показывать на сайте','status',item.status,{choices:[['published','Опубликован'],['hidden','Скрыт']]}));box.append(fields);
  const actions=element('div','review-actions');const done=button(editor.isNew?'Добавить в список':'Готово','data-review-done','', 'button primary');const cancel=button('Отмена','data-review-cancel','');add(actions,done,cancel);box.append(actions);parent.append(box);
  for(const field of fields.querySelectorAll('[data-review-field]'))field.addEventListener('input',()=>{const name=field.dataset.reviewField;editor.item[name]=name==='rating'?(field.value===''?null:Number(field.value)):name==='source_url'?(field.value||null):field.value;refreshEditorErrors();});
  done.addEventListener('click',()=>{if(Object.keys(reviewErrors(editor.item)).length)return;const clean={...editor.item,author:editor.item.author.trim(),text:editor.item.text.trim(),source_url:editor.item.source_url?.trim()||null};if(editor.isNew){try{clean.id=nextId(draft.items,clean.published_at);}catch(e){say(e.message,true);return;}draft.items.push(clean);}else{const index=draft.items.findIndex(r=>r.id===clean.id);if(index<0){say('Отзыв больше не найден. Обновите страницу.',true);return;}draft.items[index]=clean;}editor=null;say('Изменения в списке. Нажмите «Сохранить» внизу.');render();});
  cancel.addEventListener('click',()=>{editor=null;render();});refreshEditorErrors();
 }
 function liveError(status){
  if(status===401||status===403)return 'Ключ не подошёл: у него нет права записи в репозиторий сайта. Войдите заново ключом с правом Contents: Read and write.';
  if(status===503)return 'Не удалось проверить ключ. Попробуйте через минуту.';
  return `Сервер ответил ошибкой ${status}. Попробуйте позже.`;
 }
 async function loadLive(){
  if(liveLoading||saving)return;
  if(!authToken){liveMessage='Сначала войдите: отзывы открываются тем же ключом, что и вся мастерская.';liveErrorState=true;render();return;}
  const current=session;liveLoading=true;liveMessage='Загружаем отзывы с сайта…';liveErrorState=false;render();
  try{
   const res=await liveFetch(`${liveBase}/reviews/inbox`,{headers:liveHeaders()});
   if(!res.ok)throw Error(liveError(res.status));
   const data=await res.json();if(!Array.isArray(data.items))throw Error('Не удалось прочитать отзывы с сайта. Попробуйте позже.');
   if(current!==session||!draft)return;
   let invalid=0,mismatched=0;
   for(const incoming of data.items){
    const converted={id:incoming?.id,author:incoming?.author,text:incoming?.text,rating:incoming?.rating,source:'site',source_url:null,published_at:typeof incoming?.createdAt==='string'?incoming.createdAt.slice(0,10):'',status:incoming?.status==='hidden'?'hidden':'published',demo:false};
    if(Object.keys(reviewErrors(converted)).length){invalid++;continue;}
    const previous=[...liveLinks].find(([,value])=>value.id===converted.id);
    const original=snapshot.json.items.find(r=>r.id===converted.id)||snapshot.json.items.find(r=>r.demo!==true&&reviewKey(r)===reviewKey(converted));
    if(original&&original.id===converted.id&&reviewKey(original)!==reviewKey(converted))mismatched++;
    const knownId=previous?.[0]||original?.id;
    let item=knownId?draft.items.find(r=>r.id===knownId):draft.items.find(r=>r.id===converted.id)||draft.items.find(r=>r.demo!==true&&reviewKey(r)===reviewKey(converted));
    // Если владелец удалил карточку в черновике, обновление не возвращает её.
    if(knownId&&!item){liveLinks.set(knownId,{...copy(incoming),status:converted.status});continue;}
    if(!item){item=converted;draft.items.push(item);}
    else if(incoming.status==='hidden'){
     const original=snapshot.json.items.find(r=>r.id===item.id);
     const oldLive=previous?.[1];
     if((oldLive&&item.status===oldLive.status)||(!oldLive&&(!original||item.status===original.status)))item.status='hidden';
    }
    liveLinks.set(item.id,{...copy(incoming),status:converted.status});
    if(!liveBaseline.has(item.id))liveBaseline.set(item.id,copy(original||item));
   }
   liveMessage=invalid?`Не удалось добавить отзывов с неверными данными: ${invalid}.`:mismatched?`Для ${mismatched} отзывов текст в списке и на сайте отличается. Проверьте перед правкой.`:'Отзывы с сайта обновлены.';liveErrorState=!!(invalid||mismatched);
  }catch(e){if(current===session){liveMessage=e.name==='AbortError'?'Сервер отзывов не ответил вовремя. Попробуйте ещё раз.':e.message||'Не удалось связаться с сервером. Попробуйте ещё раз.';liveErrorState=true;}}
  finally{if(current===session){liveLoading=false;render();}}
 }
 async function syncLive(plan){
  const failed=[];
  for(const change of plan){
   const body={id:change.live.id,action:change.action};
   if(change.action==='edit')Object.assign(body,{author:change.item.author,text:change.item.text,rating:change.item.rating,status:change.item.status});
   try{
    const res=await liveFetch(`${liveBase}/reviews/moderate`,{method:'POST',headers:liveHeaders(),body:JSON.stringify(body)});
    if(!res.ok)throw Error(liveError(res.status));
    const entry=liveLinks.get(change.fileId);
    if(change.action==='delete'){liveLinks.delete(change.fileId);liveBaseline.delete(change.fileId);}
    else if(entry){if(change.action==='hide'||change.action==='publish')entry.status=change.action==='hide'?'hidden':'published';else {Object.assign(entry,{author:change.item.author,text:change.item.text,rating:change.item.rating,status:change.item.status});liveBaseline.set(change.fileId,copy(change.item));}}
   }catch(e){failed.push(change.action==='edit'?'Правка текста на сайте не поддерживается сервером или временно недоступна.':`Не удалось обновить отзыв на сайте: ${e.message||'нет связи'}.`);}
  }
  return [...new Set(failed)];
 }
 function render(){
  root.replaceChildren();
  if(!api){root.append(element('div','empty','Нет подключения — введите ключ доступа в разделе выше.'));return;}
  if(!draft){const notice=element('div','notice',message);notice.dataset.reviewsMessage='';notice.setAttribute('role','status');root.append(notice);return;}
  // Примеры (demo:true) не показываются посетителям: их не смешиваем с настоящими отзывами.
  const realItems=draft.items.filter(item=>item.demo!==true),demoItems=draft.items.filter(item=>item.demo===true);
  const realPublished=realItems.filter(item=>item.status==='published').length,realHidden=realItems.filter(item=>item.status==='hidden').length;
  const heading=element('div','list-head');const title=element('div');add(title,element('p','eyebrow','ОТЗЫВЫ'),element('h2','','Отзывы'),element('p','hint','Отзывы из файла и с сайта собраны вместе. Изменения сохраняйте кнопкой внизу.'),element('p','hint review-site-count',hasChanges()?`В списке опубликовано: ${realPublished} ${plural(realPublished,'отзыв','отзыва','отзывов')}. Есть несохранённые изменения.`:realPublished?`На сайте посетители видят: ${realPublished} ${plural(realPublished,'отзыв','отзыва','отзывов')}.`:'На сайте посетители сейчас не видят ни одного отзыва.'));heading.append(title);root.append(heading);
  const notice=element('div','notice'+(error?' error':''),message);notice.dataset.reviewsMessage='';notice.hidden=!message;notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');root.append(notice);
  if(success){const done=element('div','success');done.setAttribute('role','status');done.setAttribute('aria-live','polite');done.append(element('b','','Отправлено. GitHub собирает сайт — 1–2 минуты'));const links=element('div','review-actions');const site=element('a','','Открыть /otzyvy на сайте ↗');site.href='../otzyvy/';const actions=element('a','','Ход сборки ↗');actions.href='https://github.com/sledovatel61/avtotehservis/actions';actions.target='_blank';actions.rel='noopener noreferrer';add(links,site,actions);done.append(links);root.append(done);}
  const moderation=element('details','panel review-moderation');add(moderation,element('summary','','Добавить отзыв вручную из текста Telegram'),element('p','hint','Вставьте сообщение из группы в Telegram, нажмите «Разобрать» — поля заполнятся. Проверьте текст, нажмите «Добавить в список», затем «Сохранить» внизу: только после этого отзыв появится на сайте (1–2 минуты на сборку).'));const telegramLabel=element('label','','Вставить текст из Telegram');const text=element('textarea');text.rows=5;text.value=telegram;text.dataset.telegram='';telegramLabel.append(text);moderation.append(telegramLabel);const parse=button('Разобрать','data-parse-telegram','');moderation.append(parse);root.append(moderation);
  text.addEventListener('input',()=>{telegram=text.value;});parse.addEventListener('click',()=>{const parsed=parseTelegram(telegram);const item={id:nextId(draft.items,today()),author:parsed.author,text:parsed.text,rating:parsed.rating,source:'site',source_url:null,published_at:today(),status:'published',demo:false};startEditor(item);});
  const archive=element('section','panel review-inbox');archive.dataset.reviewsInbox='';
  add(archive,element('h3','','Отзывы с сайта'));
  const load=button('Обновить с сайта','data-inbox-load','');load.disabled=liveLoading||saving;load.addEventListener('click',loadLive);archive.append(load);
  const archiveList=element('div','review-inbox-list');archiveList.setAttribute('role','status');if(liveMessage)archiveList.append(element('p',liveErrorState?'notice error':'hint',liveMessage));archive.append(archiveList);root.append(archive);
  const toolbar=element('div','review-toolbar');const filterGroup=element('div','review-filters');filterGroup.setAttribute('role','group');filterGroup.setAttribute('aria-label','Фильтр отзывов');const counts={all:realItems.length,published:realPublished,hidden:realHidden,demo:demoItems.length};for(const [key,title] of [['all','Все'],['published','Опубликованные'],['hidden','Скрытые'],['demo','Примеры']]){const b=button(`${title} ${counts[key]}`,'data-review-filter',key,'button small');b.setAttribute('aria-pressed',String(filter===key));b.addEventListener('click',()=>{filter=key;render();});filterGroup.append(b);}toolbar.append(filterGroup);
  const actions=element('div','review-actions');const create=button('+ Добавить отзыв','data-review-add','', 'button primary');const clear=button('Удалить все примеры','data-review-clear-demo','', 'button danger');clear.disabled=!demoItems.length||saving;add(actions,create,clear);toolbar.append(actions);root.append(toolbar);
  // Владелец должен видеть, почему /otzyvy/ пустая, а в мастерской «есть отзывы».
  if(!realItems.length&&demoItems.length){
   const count=demoItems.length===1?'1 пример не показывается посетителям':`${demoItems.length} ${plural(demoItems.length,'пример','примера','примеров')} не показываются посетителям`;
   const warning=element('div','notice warn',`На сайте сейчас нет ни одного отзыва: ${count}. Удалите примеры и добавьте настоящие отзывы.`);
   warning.dataset.reviewsDemoWarning='';warning.setAttribute('role','status');root.append(warning);
  }
  create.addEventListener('click',()=>{try{startEditor({id:nextId(draft.items,today()),author:'',text:'',rating:null,source:'site',source_url:null,published_at:today(),status:'hidden',demo:false});}catch(e){say(e.message,true);}});
  clear.addEventListener('click',()=>{const demos=draft.items.filter(r=>r.demo===true);if(!demos.length||!confirmDelete(demos,true))return;success=false;draft.items=draft.items.filter(r=>r.demo!==true);if(editor&&demos.some(r=>r.id===editor.item.id))editor=null;say('Примеры удалены из списка. Нажмите «Сохранить».');render();});
  renderEditor(root);
  const list=element('div','review-list');list.dataset.reviewList='';const sorted=[...draft.items].sort((a,b)=>b.published_at.localeCompare(a.published_at)||b.id.localeCompare(a.id));const visible=filter==='all'?sorted.filter(item=>item.demo!==true):filter==='demo'?demoItems:sorted.filter(item=>item.demo!==true&&item.status===filter);
  if(!visible.length)list.append(element('div','empty',filter==='demo'?'Примеров нет.':filter==='all'&&demoItems.length?'Настоящих отзывов пока нет — примеры лежат во вкладке «Примеры».':'В этом разделе пока нет отзывов.'));
  for(const item of visible){const card=element('article','panel review-card');card.dataset.reviewId=item.id;const linked=liveLinks.has(item.id);if(linked)card.dataset.liveReview=liveLinks.get(item.id).id;const top=element('div','review-card-head');const who=element('div');const stars=element('span','review-stars','★'.repeat(item.rating)+'☆'.repeat(5-item.rating));stars.setAttribute('aria-label',`${item.rating} из 5`);add(who,stars,element('strong','review-author',item.author));const meta=element('div','review-meta');const demo=item.demo===true;meta.append(element('span','',item.published_at),demo?element('span','badge demo',item.status==='published'?'Пример':'Пример, черновик'):element('span',`badge ${item.status==='published'?'live':'draft'}`,item.status==='published'?'Опубликован':'Скрыт'));add(top,who,meta);card.append(top);card.append(element('p','review-excerpt',item.text.length>120?`${item.text.slice(0,120)}…`:item.text));card.append(element('p','hint',SOURCE_NAMES[item.source]||item.source));
   if(linked){card.append(element('p','hint',`Отзыв с сайта: ${item.status==='published'?'на сайте':'скрыт'}.`));if(!snapshot.json.items.some(r=>r.id===item.id))card.append(element('p','badge draft','Новый с сайта — нажмите Сохранить для закрепления'));}
   if(demo)card.append(element('p','hint review-demo-note','Пример — на сайте не показывается: посетители его не видят.'));const controls=element('div','review-actions');const status=button(item.status==='published'?'Скрыть':'Опубликовать','data-review-status',item.id);const edit=button('Изменить','data-review-edit',item.id);const del=button('Удалить','data-review-delete',item.id,'button danger');add(controls,status,edit,del);
   if(linked){const quick=button(item.status==='published'?'Скрыть сейчас':'Вернуть сейчас','data-live-action',item.status==='published'?'hide':'publish');const remove=button('Удалить сейчас','data-live-action','delete','button danger');for(const b of [quick,remove]){b.dataset.liveId=liveLinks.get(item.id).id;b.addEventListener('click',()=>{if((changes().some(c=>c.type!=='add'||!liveLinks.has(c.id))||liveChanges().length)&&!window.confirm('Будут сохранены и другие изменения отзывов. Продолжить?'))return;if(b.dataset.liveAction==='delete'){if(!confirmDelete([item]))return;draft.items=draft.items.filter(r=>r.id!==item.id);}else item.status=b.dataset.liveAction==='hide'?'hidden':'published';void saveAll();});}add(controls,quick,remove);}
   card.append(controls);list.append(card);
   status.addEventListener('click',()=>{success=false;item.status=item.status==='published'?'hidden':'published';if(item.demo===true){if(item.status==='published'&&!demoHintShown){demoHintShown=true;say('Это пример. На сайте он появится только если включить показ примеров в сборке; для настоящих отзывов добавьте свой.');}else say('Статус примера изменён. На сайте примеры не показываются. Нажмите «Сохранить».');}else say('Статус изменён. Нажмите «Сохранить».');render();});
   edit.addEventListener('click',()=>startEditor(item));
   del.addEventListener('click',()=>{if(!confirmDelete([item]))return;success=false;draft.items=draft.items.filter(r=>r.id!==item.id);if(editor?.item.id===item.id)editor=null;say('Отзыв удалён из списка. Нажмите «Сохранить».');render();});
  }
  root.append(list);const bar=element('div','review-save-bar');bar.append(element('span','',`Изменений: ${changes().length+liveChanges().length}`));const save=button('Сохранить','data-save-reviews','','button primary');save.disabled=saving||!!editor||!hasChanges()||liveLoading||!validateDocument(draft);bar.append(save);root.append(bar);save.addEventListener('click',saveAll);
  if(editor){refreshEditorErrors();root.querySelectorAll('[data-review-add],[data-review-clear-demo],[data-parse-telegram],[data-review-status],[data-review-edit],[data-review-delete],[data-live-action]').forEach(el=>{el.disabled=true;});}if(saving||liveLoading)root.querySelectorAll('button,input,textarea,select').forEach(el=>{el.disabled=true;});
 }
 async function saveAll(){
  if(saving||liveLoading||editor||!draft||!validateDocument(draft))return;const edits=changes(),plan=liveChanges();if(!edits.length&&!plan.length)return;saving=true;render();say('Сохраняем отзывы…');
  try{let result;if(edits.length)result=await api.saveReviews(latest=>{
   if(!validateDocument(latest))throw Error('Не удалось прочитать отзывы. Обратитесь к разработчику.');const next=copy(latest);
   for(const change of edits){const index=next.items.findIndex(r=>r.id===change.id),current=next.items[index];
    if(change.type==='add'){const item=copy(change.item);if(index>=0){if(!same(current,item))throw Error(`Отзыв «${item.author}» уже изменён другим человеком. Обновите список.`);continue;}if(next.items.some(r=>r.demo!==true&&item.demo!==true&&reviewKey(r)===reviewKey(item)))throw Error(`Отзыв «${item.author}» уже добавлен другим человеком. Обновите список.`);next.items.push(item);continue;}
    if(change.type==='delete'){if(index<0)continue;if(!same(current,change.original))throw Error(`Отзыв «${change.original.author}» изменён другим человеком. Обновите список и проверьте его.`);next.items.splice(index,1);continue;}
    if(index<0)throw Error(`Отзыв «${change.original.author}» уже удалён. Обновите список.`);
    for(const key of Object.keys(change.item)){if(key==='id'||same(change.item[key],change.original[key]))continue;if(!same(current[key],change.original[key])&&!same(current[key],change.item[key]))throw Error(`Отзыв «${change.original.author}» изменён другим человеком. Обновите список и проверьте его.`);current[key]=copy(change.item[key]);}
   }
   next.updated_at=today();if(!validateDocument(next))throw Error('Проверьте отзывы перед сохранением.');return next;
  },edits.length,edits.every(change=>change.type==='delete'),text=>say(text));if(result){snapshot={json:copy(result.json),sha:result.sha};draft=copy(result.json);}const failures=authToken?await syncLive(liveChanges()):[];success=!!result;saving=false;message=failures.length?'Отзывы сохранены, но не всё обновилось на сайте: '+failures.join(' ')+' Повторите сохранение.':'';error=!!failures;render();}
  catch(e){saving=false;render();say(displayError(e),true);}
 }
 render();return {
  async connect(client){const current=++session;api=client;snapshot=null;draft=null;editor=null;liveLinks=new Map();liveBaseline=new Map();liveLoading=false;liveMessage='';success=false;message='Загружаем отзывы…';render();try{const read=await api.readReviews();if(current!==session)return;if(!validateDocument(read.json))throw Error('Не удалось прочитать отзывы. Обратитесь к разработчику.');snapshot={json:copy(read.json),sha:read.sha};draft=copy(read.json);message='';render();/* Отзывы с сайта подтягиваем сразу: владельцу не нужно искать кнопку. */if(authToken)await loadLive();}catch(e){say(displayError(e),true);}},
  mayDisconnect(){if(saving){say('Дождитесь окончания сохранения отзывов.',true);return false;}return !dirty()||window.confirm('Есть несохранённые изменения отзывов. Отменить их?');},
  disconnect(){session++;api=null;snapshot=null;draft=null;editor=null;liveLinks=new Map();liveBaseline=new Map();liveLoading=false;liveMessage='';message='';success=false;render();}
 };
}
