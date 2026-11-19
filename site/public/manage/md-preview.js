import {escapeHTML} from './store.js';
// Разметка создаётся только из экранированного текста и безопасных ссылок.
function inline(value){
 const placeholders=[];
 let safe=escapeHTML(value).replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g,(full,label,url)=>{
  if(!/^(?:https?:\/\/[^\s]+|\/(?!\/)[^\s]*|mailto:[^\s]+|tel:[^\s]+)$/i.test(url)||/&#(?:0*9|0*10|0*13|x0*[9ad]);/i.test(url))return full;
  const key=`\u0000${placeholders.length}\u0000`;placeholders.push(`<a href="${url}" rel="noopener noreferrer">${label}</a>`);return key;
 });
 safe=safe.replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
 return safe.replace(/\u0000(\d+)\u0000/g,(_,i)=>placeholders[Number(i)]);
}
export function renderMarkdown(text){
 const lines=String(text??'').replace(/\r\n?/g,'\n').split('\n'),out=[];let list=false,paragraph=[];
 const flush=()=>{if(paragraph.length){out.push(`<p>${inline(paragraph.join('\n')).replace(/\n/g,'<br>')}</p>`);paragraph=[];}};
 const endList=()=>{if(list){out.push('</ul>');list=false;}};
 for(const line of lines){const head=line.match(/^(#{1,3})\s+(.+)$/),item=line.match(/^\s*[-*]\s+(.+)$/),quote=line.match(/^\s*>\s?(.*)$/);
  if(!line.trim()){flush();endList();continue;}
  if(head){flush();endList();out.push(`<h${head[1].length}>${inline(head[2])}</h${head[1].length}>`);continue;}
  if(item){flush();if(!list){out.push('<ul>');list=true;}out.push(`<li>${inline(item[1])}</li>`);continue;}
  if(quote){flush();endList();out.push(`<blockquote>${inline(quote[1])}</blockquote>`);continue;}
  endList();paragraph.push(line);
 }
 flush();endList();return out.join('\n');
}
