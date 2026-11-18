const ROOT = 'https://api.github.com';
const REPO = '/repos/sledovatel61/avtotehservis';
const REF = 'preview%2Fgithub-pages';
const CONTENT = 'site/content/cases.json';
export class GitHubError extends Error { constructor(message, status) { super(message); this.status=status; } }
export function friendly(e) {
 if (e.status===401) return 'Токен не принят. Проверьте срок действия и права.';
 if (e.status===403) return 'Нет доступа: проверьте право Contents: Read and write и ограничения GitHub.';
 if (e.status===404) return 'Репозиторий, ветка или файл не найдены. Проверьте доступ токена и наличие cases.json.';
 if (e.status===409 || e.status===422) return 'Кто-то сохранил изменения. Проверьте их и повторите сохранение.';
 return e instanceof GitHubError ? e.message : 'Нет связи с GitHub. Проверьте интернет и повторите.';
}
export class GitHub {
 constructor(token) { this.token=token; }
 async request(path, options={}) {
  let res;
  try { res=await fetch(ROOT+path,{...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${this.token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}}); }
  catch { throw new GitHubError('Нет связи с GitHub. Проверьте интернет и повторите.',0); }
  if (!res.ok) throw new GitHubError(`Ошибка GitHub (${res.status}).`,res.status);
  return {data:await res.json(),headers:res.headers};
 }
 async user(){ return this.request('/user'); }
 // Публичный Actions API: токен Contents не даёт Actions: read и сюда не передаётся.
 async publicRuns(){
  try {
   const res=await fetch(`${ROOT}${REPO}/actions/runs?branch=${REF}&per_page=10`,{headers:{Accept:'application/vnd.github+json'},credentials:'omit'});
   if(!res.ok) return null;
   const data=await res.json();
   return Array.isArray(data.workflow_runs)?data.workflow_runs:null;
  } catch {return null;}
 }
 async read(){
  let data;
  try { ({data}=await this.request(`${REPO}/contents/${CONTENT}?ref=${REF}`)); }
  catch(e) {
   if(e.status!==404) throw e;
   // 404 у Contents также означает недоступный репозиторий или ветку.
   // Считаем файл отсутствующим только после проверки ветки тем же токеном.
   await this.request(`${REPO}/git/ref/heads/${REF}`);
   return {json:{version:1,updated_at:new Date().toISOString(),cases:[]},sha:null};
  }
  const bytes=Uint8Array.from(atob(data.content.replace(/\s/g,'')),c=>c.charCodeAt(0)); let json; try {json=JSON.parse(new TextDecoder().decode(bytes));} catch {throw new GitHubError('Не удалось прочитать cases.json: неверный формат.',0);} if(json.version!==1 || !Array.isArray(json.cases)) throw new GitHubError('Неизвестный формат cases.json. Обратитесь к разработчику.',0); return {json,sha:data.sha};
 }
 async image(path) { const {data}=await this.request(`${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${REF}`); const content=data.content || (await this.request(`${REPO}/git/blobs/${data.sha}`)).data.content; if(!content) throw new GitHubError('Не удалось загрузить исходную фотографию из GitHub.',0); return new Blob([Uint8Array.from(atob(content.replace(/\s/g,'')),c=>c.charCodeAt(0))]); }
 async budget(){ const {data:ref}=await this.request(`${REPO}/git/ref/heads/${REF}`); const {data:commit}=await this.request(`${REPO}/git/commits/${ref.object.sha}`); const {data}=await this.request(`${REPO}/git/trees/${commit.tree.sha}?recursive=1`); const files=data.tree.filter(x=>x.type==='blob' && x.path.startsWith('site/public/media/cases/')); return {bytes:files.reduce((s,x)=>s+(x.size||0),0), count:files.length/3, truncated:data.truncated}; }
 async save(initial, apply, buildFiles, progress=()=>{}) {
  let snapshot=initial;
  for(let attempt=0;attempt<2;attempt++) {
   progress(attempt ? 'Кто-то сохранил изменения. Проверяем и повторяем…' : 'Проверяем изменения в репозитории…');
   const latest=await this.read();
   if (latest.sha!==snapshot.sha && !apply.canRebase(latest.json)) throw new GitHubError('Кто-то изменил эту работу. Обновите список и повторите сохранение.',409);
   snapshot=latest;
   const {data:ref}=await this.request(`${REPO}/git/ref/heads/${REF}`);
   const parent=ref.object.sha;
   const {data:commit}=await this.request(`${REPO}/git/commits/${parent}`);
   // Проверка файла после чтения ref: иначе новый родитель может уже содержать чужое изменение.
   const check=await this.read();
   if(check.sha!==snapshot.sha) { if(attempt===0) continue; throw new GitHubError('Кто-то сохранил изменения. Проверьте их и повторите сохранение.',409); }
   const next=apply(latest.json); next.updated_at=new Date().toISOString();
   const files=[...await buildFiles()];
   files.push({path:CONTENT, blob:new Blob([JSON.stringify(next,null,2)+'\n'],{type:'application/json'})});
   const tree=[];
   for(let i=0;i<files.length;i++) { const f=files[i]; progress(`Отправляем файлы: ${i+1} из ${files.length}…`); if(f.blob===null) {tree.push({path:f.path,mode:'100644',type:'blob',sha:null}); continue;} const bytes=new Uint8Array(await f.blob.arrayBuffer()); let binary=''; for(let p=0;p<bytes.length;p+=0x8000) binary+=String.fromCharCode(...bytes.subarray(p,p+0x8000)); const {data}=await this.request(`${REPO}/git/blobs`,{method:'POST',body:JSON.stringify({content:btoa(binary),encoding:'base64'})}); tree.push({path:f.path,mode:'100644',type:'blob',sha:data.sha}); }
   const {data:treeData}=await this.request(`${REPO}/git/trees`,{method:'POST',body:JSON.stringify({base_tree:commit.tree.sha,tree})});
   const {data:newCommit}=await this.request(`${REPO}/git/commits`,{method:'POST',body:JSON.stringify({message:'Обновить фотографии работ',tree:treeData.sha,parents:[parent]})});
   try { await this.request(`${REPO}/git/refs/heads/${REF}`,{method:'PATCH',body:JSON.stringify({sha:newCommit.sha,force:false})}); return {json:next,commit:newCommit.sha,contentSha:tree.find(item=>item.path===CONTENT).sha}; }
   catch(e) { if((e.status===409||e.status===422)&&attempt===0) continue; throw e; }
  }
  throw new GitHubError('Кто-то сохранил изменения. Проверьте их и повторите сохранение.',409);
 }
}
