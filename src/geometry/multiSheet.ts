import type {Document,Part,Placement,Result,Ring} from '../model';
import {collisionRing} from './validate';

type IntervalItem={placement:Placement;index:number;part:Part;minY:number;maxY:number};
type Band={items:IntervalItem[];minY:number;maxY:number};
type SheetChunk={items:IntervalItem[];minY:number;maxY:number};

const rotatedBounds=(ring:Ring,angleDeg:number)=>{
  const a=angleDeg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const [x,y] of ring){
    const rx=x*c-y*s,ry=x*s+y*c;
    x0=Math.min(x0,rx);y0=Math.min(y0,ry);x1=Math.max(x1,rx);y1=Math.max(y1,ry);
  }
  return [x0,y0,x1,y1] as const;
};

function orientToStartCorner(doc:Document,result:Result):Result {
  if(!result.placements.length)return result;
  const width=doc.settings.materialWidthMm,inset=0;
  const parts=new Map(doc.parts.map(part=>[part.id,part] as const));
  const groups=new Map<number,number[]>();
  result.placements.forEach((placement,index)=>{
    const sheet=doc.settings.materialType==='sheet'?(placement.sheetIndex??0):0;
    groups.set(sheet,[...(groups.get(sheet)??[]),index]);
  });
  const placements=result.placements.map(placement=>({...placement}));
  for(const indices of groups.values()){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const index of indices){
      const placement=placements[index],part=parts.get(placement.partId);
      if(!part)throw Error('Yerleşimde bilinmeyen parça bulundu.');
      const b=rotatedBounds(collisionRing(part),placement.angleDeg);
      minX=Math.min(minX,placement.xMm+b[0]);maxX=Math.max(maxX,placement.xMm+b[2]);
      minY=Math.min(minY,placement.yMm+b[1]);maxY=Math.max(maxY,placement.yMm+b[3]);
    }
    const boundaryLength=doc.settings.materialType==='sheet'?doc.settings.materialLengthMm:result.usedLengthMm;
    if(!boundaryLength)throw Error('Yerleşim uzunluğu bulunamadı.');
    const dx=width-inset-maxX;
    // Workspace renders manufacturing +Y upward with an SVG Y flip:
    // y=0 is the visual bottom edge, y=boundaryLength is the visual top edge.
    const dy=(doc.settings.startCorner??'right-bottom')==='right-bottom'?inset-minY:boundaryLength-inset-maxY;
    for(const index of indices){placements[index].xMm+=dx;placements[index].yMm+=dy;}
  }
  return {...result,placements};
}


export function packResultIntoSheets(doc:Document,result:Result):Result {
  if(doc.settings.materialType!=='sheet')return orientToStartCorner(doc,result);
  const width=doc.settings.materialWidthMm,length=doc.settings.materialLengthMm,gap=Math.max(0,doc.settings.clearanceMm);
  if(!length||!Number.isFinite(length)||length<=0)throw Error('Plaka uzunluğu pozitif bir değer olmalıdır.');
  if(result.placements.length&&result.placements.every(placement=>placement.sheetIndex!==undefined)){
    const sheetCount=Math.max(...result.placements.map(placement=>placement.sheetIndex??0))+1;
    return orientToStartCorner(doc,{...result,sheetCount,usedLengthMm:length*sheetCount});
  }

  const parts=new Map(doc.parts.map(p=>[p.id,p] as const));
  // Sparrow/Jagua may reserve an internal edge buffer for collision safety.
  // Remove that buffer with ONE rigid X translation before fixed-sheet checks;
  // relative geometry, rotations and item-to-item clearance stay unchanged.
  let minLayoutX=Infinity,maxLayoutX=-Infinity;
  for(const placement of result.placements){
    const part=parts.get(placement.partId);if(!part)throw Error('Yerleşimde bilinmeyen parça bulundu.');
    const b=rotatedBounds(collisionRing(part),placement.angleDeg);
    minLayoutX=Math.min(minLayoutX,placement.xMm+b[0]);
    maxLayoutX=Math.max(maxLayoutX,placement.xMm+b[2]);
  }
  const spanX=result.placements.length?maxLayoutX-minLayoutX:0;
  if(spanX>width+1e-6)throw Error('Yerleşim gerçek malzeme genişliğini aşıyor.');
  const normalizeX=result.placements.length?width-maxLayoutX:0;
  const normalizedPlacements=result.placements.map(placement=>({...placement,xMm:placement.xMm+normalizeX}));
  const items:IntervalItem[]=normalizedPlacements.map((placement,index)=>{
    const part=parts.get(placement.partId);if(!part)throw Error('Yerleşimde bilinmeyen parça bulundu.');
    const b=rotatedBounds(collisionRing(part),placement.angleDeg);
    const minX=placement.xMm+b[0],maxX=placement.xMm+b[2],minY=placement.yMm+b[1],maxY=placement.yMm+b[3];
    if(minX<-1e-6||maxX>width+1e-6)throw Error(`${part.name} malzeme genişliğinin dışına taşıyor.`);
    if(maxY-minY>length+1e-7)throw Error(`${part.name} seçilen plaka uzunluğuna sığmıyor.`);
    return {placement,index,part,minY,maxY};
  }).sort((a,b)=>a.minY-b.minY||a.maxY-b.maxY);

  // First keep the old safe-gap behavior: Y-disconnected Sparrow bands may
  // be compacted closer together without changing any geometry inside a band.
  const bands:Band[]=[];
  for(const item of items){
    const last=bands.at(-1);
    if(last&&item.minY<=last.maxY+gap+1e-7){
      last.items.push(item);last.maxY=Math.max(last.maxY,item.maxY);last.minY=Math.min(last.minY,item.minY);
    }else bands.push({items:[item],minY:item.minY,maxY:item.maxY});
  }

  // A single connected Y band can legitimately be taller than one physical
  // plate even though every individual part fits. Split only such oversized
  // bands into rigid chunks; different chunks may live on different plates.
  const chunks:SheetChunk[]=[];
  for(const band of bands){
    if(band.maxY-band.minY<=length+1e-7){
      chunks.push({items:band.items,minY:band.minY,maxY:band.maxY});
      continue;
    }
    let current:SheetChunk|undefined;
    for(const item of band.items){
      if(!current){
        current={items:[item],minY:item.minY,maxY:item.maxY};
        chunks.push(current);
        continue;
      }
      const nextMax=Math.max(current.maxY,item.maxY);
      if(nextMax-current.minY<=length+1e-7){
        current.items.push(item);current.maxY=nextMax;
      }else{
        current={items:[item],minY:item.minY,maxY:item.maxY};
        chunks.push(current);
      }
    }
  }

  // Pack the safe rigid chunks onto consecutive plates. Across chunks we only
  // translate in Y; internal Sparrow placement, X, rotation and geometry stay intact.
  const packed=new Array<Placement>(result.placements.length);
  let sheetIndex=0,used=0;
  for(const chunk of chunks){
    const height=chunk.maxY-chunk.minY;
    let start=used+(used>0?gap:0);
    if(start+height>length+1e-7){sheetIndex++;used=0;start=0;}
    const offset=start-chunk.minY;
    for(const item of chunk.items)packed[item.index]={...item.placement,sheetIndex,yMm:item.placement.yMm+offset};
    used=start+height;
  }

  const sheetCount=Math.max(1,sheetIndex+1);
  return orientToStartCorner(doc,{...result,sheetCount,usedLengthMm:length*sheetCount,placements:packed});
}
