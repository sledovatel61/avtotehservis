import sharp from 'sharp';
const r=await sharp('../docs/brand/voyah/refs/r31/side-white-1456.jpg').removeAlpha().raw().toBuffer({resolveWithObject:true});
const W=r.info.width,H=r.info.height,C=r.info.channels;
const L=(x,y)=>{const i=(y*W+x)*C;return 0.2126*r.data[i]+0.7152*r.data[i+1]+0.0722*r.data[i+2];};
// красный суппорт — отличная метка диска
const isRed=(x,y)=>{const i=(y*W+x)*C;const R=r.data[i],G=r.data[i+1],B=r.data[i+2];
 return R>90 && R-G>45 && R-B>45;};
const reds=[];
for(let y=400;y<700;y++)for(let x=0;x<W;x++)if(isRed(x,y))reds.push([x,y]);
console.log('красных пикселей:',reds.length);
// кластеры по x
const xs=reds.map(p=>p[0]).sort((a,b)=>a-b);
let groups=[],st=null;
for(let i=0;i<xs.length;i++){if(st===null)st=xs[i];if(i===xs.length-1||xs[i+1]-xs[i]>40){groups.push([st,xs[i]]);st=null;}}
console.log('кластеры суппортов по x:',JSON.stringify(groups));
for(const [a,b] of groups){
  const sel=reds.filter(p=>p[0]>=a&&p[0]<=b);
  const ys=sel.map(p=>p[1]).sort((p,q)=>p-q);
  console.log(`  x ${a}…${b}: центр ${((a+b)/2).toFixed(0)}, y ${ys[0]}…${ys[ys.length-1]}, центр y ${ys[Math.floor(ys.length/2)]}`);
}
