import parseString from 'dxf/lib/parseString';
import type {Document,DxfAuxEntity,DxfSourceEntity,DxfSpline,Placement,Point,Ring} from '../model';
import type {WorldPart} from '../geometry/validate';

export const STUDIO_CREDIT='nested with sparrow/studio · https://sparrowstudio.app';
export const SHEET_EXPORT_GAP_MM=50;

export function exportDXF(doc:Document,world:WorldPart[],placements:Placement[]=[],preserveSourceCurves=true):string {
  let nextHandle=0x100;
  const handle=()=> (nextHandle++).toString(16).toUpperCase();
  const colorGroup=(color?:number)=>color!==undefined&&color>=1&&color<=255?`62\n${color}\n`:'';
  const polyline=(ring:Ring,layer:string,color?:number)=>`0\nLWPOLYLINE\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${colorGroup(color)}100\nAcDbPolyline\n90\n${ring.length}\n70\n1\n${ring.map(([x,y])=>`10\n${x}\n20\n${y}\n`).join('')}`;
  const transformPoint=([x,y]:Point,p:Placement):Point=>{
    const angle=p.angleDeg*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
    return [x*cos-y*sin+p.xMm,x*sin+y*cos+p.yMm];
  };
  const sheetMode=doc.settings.materialType==='sheet'&&placements.some(placement=>placement.sheetIndex!==undefined);
  const sheetPitch=doc.settings.materialWidthMm+SHEET_EXPORT_GAP_MM;
  const sheetOffset=(placement:Placement|undefined)=>sheetMode?(placement?.sheetIndex??0)*sheetPitch:0;
  const shiftRing=(ring:Ring,dx:number):Ring=>dx===0?ring:ring.map(([x,y])=>[x+dx,y]);
  const exportPlacements=placements.map(placement=>({...placement,xMm:placement.xMm+sheetOffset(placement)}));
  const exportWorld=world.map((part,index)=>{
    const dx=sheetOffset(placements[index]);
    return dx===0?part:{...part,outer:shiftRing(part.outer,dx),holes:part.holes.map(ring=>shiftRing(ring,dx))};
  });

  const aux=(entity:DxfAuxEntity,p:Placement)=>{
    const layer=entity.layer||'MARKS',color=colorGroup(entity.colorNumber);
    if(entity.kind==='path') {
      const points=entity.points.map(point=>transformPoint(point,p));
      return `0\nLWPOLYLINE\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${color}100\nAcDbPolyline\n90\n${points.length}\n70\n0\n${points.map(([x,y])=>`10\n${x}\n20\n${y}\n`).join('')}`;
    }
    const [x,y]=transformPoint(entity.point,p);
    if(entity.kind==='point') return `0\nPOINT\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${color}100\nAcDbPoint\n10\n${x}\n20\n${y}\n30\n0\n`;
    const rotation=entity.rotationDeg+p.angleDeg;
    if(entity.kind==='mtext') return `0\nMTEXT\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${color}100\nAcDbMText\n10\n${x}\n20\n${y}\n30\n0\n40\n${entity.heightMm}\n1\n${entity.text}\n50\n${rotation}\n`;
    return `0\nTEXT\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${color}100\nAcDbText\n10\n${x}\n20\n${y}\n30\n0\n40\n${entity.heightMm}\n1\n${entity.text}\n50\n${rotation}\n100\nAcDbText\n`;
  };
  const spline=(curve:DxfSpline,p:Placement,layer:string,color?:number)=>{
    const points=curve.controlPoints.map(point=>transformPoint(point,p));
    return `0\nSPLINE\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${colorGroup(color)}100\nAcDbSpline\n210\n0\n220\n0\n230\n1\n70\n${curve.flags}\n71\n${curve.degree}\n72\n${curve.knots.length}\n73\n${points.length}\n74\n0\n42\n0.0000000001\n43\n0.0000000001\n${curve.knots.map(k=>`40\n${k}\n`).join('')}${curve.weights?.map(w=>`41\n${w}\n`).join('')??''}${points.map(([x,y])=>`10\n${x}\n20\n${y}\n30\n0\n`).join('')}`;
  };
  const angle=(degrees:number)=>((degrees%360)+360)%360;
  const nativeEntity=(entity:DxfSourceEntity,p:Placement):string=>{
    const layer=entity.layer||'PARTS',color=colorGroup(entity.colorNumber);
    if(entity.kind==='line'){
      const [x1,y1]=transformPoint(entity.start,p),[x2,y2]=transformPoint(entity.end,p);
      return `0\nLINE\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${color}100\nAcDbLine\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;
    }
    if(entity.kind==='circle'){
      const [x,y]=transformPoint(entity.center,p);
      return `0\nCIRCLE\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${color}100\nAcDbCircle\n10\n${x}\n20\n${y}\n30\n0\n40\n${entity.radius}\n`;
    }
    if(entity.kind==='arc'){
      const [x,y]=transformPoint(entity.center,p);
      return `0\nARC\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${color}100\nAcDbCircle\n10\n${x}\n20\n${y}\n30\n0\n40\n${entity.radius}\n100\nAcDbArc\n50\n${angle(entity.startAngleDeg+p.angleDeg)}\n51\n${angle(entity.endAngleDeg+p.angleDeg)}\n`;
    }
    if(entity.kind==='spline')return spline(entity,p,layer,entity.colorNumber);
    const points=entity.points.map(point=>transformPoint(point,p)),bulges=entity.bulges??[];
    if(entity.sourceType==='LWPOLYLINE'){
      return `0\nLWPOLYLINE\n5\n${handle()}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${color}100\nAcDbPolyline\n90\n${points.length}\n70\n${entity.closed?1:0}\n${points.map(([x,y],i)=>`10\n${x}\n20\n${y}\n${bulges[i]?`42\n${bulges[i]}\n`:''}`).join('')}`;
    }
    const parent=handle();
    const vertices=points.map(([x,y],i)=>`0\nVERTEX\n5\n${handle()}\n330\n${parent}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbVertex\n100\nAcDb2dVertex\n10\n${x}\n20\n${y}\n30\n0\n${bulges[i]?`42\n${bulges[i]}\n`:''}70\n0\n`).join('');
    return `0\nPOLYLINE\n5\n${parent}\n330\n21\n100\nAcDbEntity\n8\n${layer}\n${color}100\nAcDb2dPolyline\n66\n1\n70\n${entity.closed?1:0}\n10\n0\n20\n0\n30\n0\n${vertices}0\nSEQEND\n5\n${handle()}\n330\n${parent}\n100\nAcDbEntity\n8\n${layer}\n`;
  };
  const parts=new Map(doc.parts.map(part=>[part.id,part]));
  const layerNames=[...new Set(['0','PARTS','HOLES',...doc.parts.flatMap(part=>[
    ...(part.source.dxfEntities??[]).map(entity=>entity.layer||'PARTS'),
    ...(part.source.dxfSpline?.layer?[part.source.dxfSpline.layer]:[]),
    ...(part.source.dxfAux??[]).map(entity=>entity.layer||'MARKS'),
    ...(part.source.dxfDetails??[]).map(detail=>detail.layer||'DETAILS')
  ])])];
  const layers=layerNames.map(layer=>`0\nLAYER\n5\n${handle()}\n330\n10\n100\nAcDbSymbolTableRecord\n100\nAcDbLayerTableRecord\n2\n${layer}\n70\n0\n62\n7\n6\nCONTINUOUS\n`).join('');
  const partEntities=exportWorld.map((p,i)=>{
    const part=parts.get(p.partId),placement=exportPlacements[i];
    const native=preserveSourceCurves&&part?.source.dxfEntities?.length&&placement&&placement.partId===p.partId&&placement.copyIndex===p.copyIndex
      ?part.source.dxfEntities.map(entity=>nativeEntity(entity,placement)).join(''):undefined;
    const compact=native??(preserveSourceCurves&&part?.source.dxfSpline&&placement&&placement.partId===p.partId&&placement.copyIndex===p.copyIndex
      ?spline(part.source.dxfSpline,placement,part.source.dxfSpline.layer||'PARTS',part.source.dxfColorNumber):polyline(p.outer,'PARTS',part?.source.dxfColorNumber));
    const details=native?'':part&&placement?(part.source.dxfDetails??[]).map(detail=>polyline(detail.ring.map(point=>transformPoint(point,placement)),detail.layer||'DETAILS',detail.colorNumber)).join(''):'';
    const holes=native?'':p.holes.map((h,holeIndex)=>polyline(h,'HOLES',part?.source.dxfHoleColorNumbers?.[holeIndex])).join('');
    const marks=part&&placement?(part.source.dxfAux??[])
      .filter(entity=>!native||entity.kind!=='path')
      .map(entity=>aux(entity,placement)).join(''):'';
    return compact+holes+details+marks;
  }).join('');
  const entities=partEntities;
  // R2000 readers such as QCAD require explicit model/paper-space ownership.
  const spaces=[['*Model_Space','21','23','24'],['*Paper_Space','22','25','26']];
  const records=spaces.map(([name,id])=>`0\nBLOCK_RECORD\n5\n${id}\n330\n20\n100\nAcDbSymbolTableRecord\n100\nAcDbBlockTableRecord\n2\n${name}\n70\n0\n`).join('');
  const blocks=spaces.map(([name,id,begin,end])=>`0\nBLOCK\n5\n${begin}\n330\n${id}\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockBegin\n2\n${name}\n70\n0\n10\n0\n20\n0\n30\n0\n3\n${name}\n1\n\n0\nENDBLK\n5\n${end}\n330\n${id}\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockEnd\n`).join('');
  const text=`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n4\n9\n$HANDSEED\n5\n${nextHandle.toString(16).toUpperCase()}\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n5\n10\n330\n0\n100\nAcDbSymbolTable\n70\n${layerNames.length}\n${layers}0\nENDTAB\n0\nTABLE\n2\nBLOCK_RECORD\n5\n20\n330\n0\n100\nAcDbSymbolTable\n70\n2\n${records}0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
  const parsed=parseString(text) as {header:{insUnits:number};entities:{type:string;closed?:boolean;layer:string;vertices?:{x:number;y:number}[];controlPoints?:{x:number;y:number}[];knots?:number[];degree?:number;weights?:number[]}[]};
  if(parsed.header.insUnits!==4)throw Error('Serialized DXF lost its millimeter units.');
  let at=0;
  for(let i=0;i<exportWorld.length;i++){
    const p=exportWorld[i],part=parts.get(p.partId),placement=exportPlacements[i],curve=part?.source.dxfSpline;
    const native=preserveSourceCurves&&part?.source.dxfEntities?.length&&placement&&placement.partId===p.partId&&placement.copyIndex===p.copyIndex
      ?part.source.dxfEntities:undefined;
    if(native){
      for(const source of native){
        const entity=parsed.entities[at++];
        const expectedType=source.kind==='polyline'?source.sourceType:source.kind.toUpperCase();
        if(entity?.type!==expectedType||entity.layer!==(source.layer||'PARTS'))throw Error(`Serialized DXF changed native ${expectedType} geometry.`);
        if(source.kind==='spline'&&(entity.controlPoints?.length??0)>source.controlPoints.length)throw Error('Serialized DXF increased SPLINE control-point count.');
        if(source.kind==='polyline'&&(entity.vertices?.length??0)>source.points.length)throw Error('Serialized DXF increased POLYLINE vertex count.');
      }
    }else{
      const entity=parsed.entities[at++];
      if(preserveSourceCurves&&curve&&placement&&placement.partId===p.partId&&placement.copyIndex===p.copyIndex){
        if(entity?.type!=='SPLINE'||entity.layer!==(curve.layer||'PARTS')||entity.degree!==curve.degree)throw Error('Serialized DXF lost its compact spline.');
        const expected=curve.controlPoints.map(point=>transformPoint(point,placement)),actual=(entity.controlPoints??[]).map(q=>[q.x,q.y] as Point);
        if(JSON.stringify(entity.knots??[])!==JSON.stringify(curve.knots)||JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Serialized DXF changed spline control points.');
      }else{
        if(entity?.type!=='LWPOLYLINE'||!entity.closed||entity.layer!=='PARTS')throw Error('Serialized DXF lost a closed contour or layer.');
        const outer=(entity.vertices??[]).map(q=>[q.x,q.y] as Point);
        if(JSON.stringify(outer)!==JSON.stringify(p.outer))throw Error('Serialized DXF changed canvas coordinates.');
      }
      for(const hole of p.holes){
        const h=parsed.entities[at++];
        if(h?.type!=='LWPOLYLINE'||!h.closed||h.layer!=='HOLES')throw Error('Serialized DXF lost a closed hole.');
        const ring=(h.vertices??[]).map(q=>[q.x,q.y] as Point);
        if(JSON.stringify(ring)!==JSON.stringify(hole))throw Error('Serialized DXF changed canvas coordinates.');
      }
      for(const detail of part?.source.dxfDetails??[]){
        const entity=parsed.entities[at++];
        if(entity?.type!=='LWPOLYLINE'||!entity.closed||entity.layer!==(detail.layer||'DETAILS'))throw Error('Serialized DXF lost an attached detail contour.');
        const expected=detail.ring.map(point=>transformPoint(point,placement!)),actual=(entity.vertices??[]).map(q=>[q.x,q.y] as Point);
        if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Serialized DXF changed an attached detail contour.');
      }
    }
    for(const mark of (part?.source.dxfAux??[]).filter(mark=>!native||mark.kind!=='path')){
      const entity=parsed.entities[at++];
      if(mark.kind==='path'){
        if(entity?.type!=='LWPOLYLINE'||entity.closed)throw Error('Serialized DXF lost an attached open path mark.');
        const expected=mark.points.map(point=>transformPoint(point,placement!)),actual=(entity.vertices??[]).map(q=>[q.x,q.y] as Point);
        if(JSON.stringify(actual)!==JSON.stringify(expected)||entity.layer!==(mark.layer||'MARKS'))throw Error('Serialized DXF changed an attached open path mark.');
        continue;
      }
      const expectedType=mark.kind==='point'?'POINT':mark.kind==='mtext'?'MTEXT':'TEXT';
      if(entity?.type!==expectedType)throw Error('Serialized DXF lost an attached point or text mark.');
    }
  }
  if(at!==parsed.entities.length)throw Error('Serialized DXF changed contour count.');
  return text;
}
