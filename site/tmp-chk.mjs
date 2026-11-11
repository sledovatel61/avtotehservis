import { SPEC } from './scripts/bg3d-side-ruler.mjs';
// проверка: где на фото X=0 (передний бампер) и X=L (задний)
const ppM=(1119-295)/SPEC.wheelbase;
const axleF=295;
for(const [name,xPct] of [['0 %L',0],['100 %L',100]]){
  const px=axleF+(xPct-19.8)/100*SPEC.length*ppM;
  console.log(`${name} → px ${px.toFixed(0)}`);
}
console.log(`то есть нос на фото x≈${(axleF-0.198*SPEC.length*ppM).toFixed(0)}, корма x≈${(axleF+0.802*SPEC.length*ppM).toFixed(0)}`);
console.log('(фактические края фото-кузова: 94 и 1410)');
