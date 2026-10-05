import { DEFAULT_SETTINGS, newPart, type Document, type Part, type Ring } from '../model';
import { bounds, normalizeDocument, normalizeRing } from '../geometry/normalize';
import { collisionRing } from '../geometry/validate';

export type ImportReview = { document: Document; warnings: string[]; replace: boolean; issues?:string[]; layers?:string[]; result?:import('../model').Result };
export function record(value: unknown): Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw Error('Expected an object.');
  return value as Record<string,unknown>;
}
export function number(value: unknown): number {
  if(typeof value!=='number' || !Number.isFinite(value)) throw Error('Expected a finite number.');
  return value;
}
export function localize(part: Part): Part {
  const [x,y]=bounds(part.outer);
  const shift=(ring: Ring): Ring=>ring.map(p=>[p[0]-x,p[1]-y]);
  const dxfAux=part.source.dxfAux?.map(entity=>entity.kind==='path'
    ? {...entity,points:entity.points.map(([px,py])=>[px-x,py-y] as [number,number])}
    : {...entity,point:[entity.point[0]-x,entity.point[1]-y] as [number,number]});
  const dxfDetails=part.source.dxfDetails?.map(detail=>({...detail,ring:shift(detail.ring)}));
  const dxfEntities=part.source.dxfEntities?.map(entity=>{
    if(entity.kind==='line')return {...entity,start:[entity.start[0]-x,entity.start[1]-y] as [number,number],end:[entity.end[0]-x,entity.end[1]-y] as [number,number]};
    if(entity.kind==='arc'||entity.kind==='circle')return {...entity,center:[entity.center[0]-x,entity.center[1]-y] as [number,number]};
    if(entity.kind==='spline')return {...entity,controlPoints:entity.controlPoints.map(([px,py])=>[px-x,py-y] as [number,number])};
    return {...entity,points:entity.points.map(([px,py])=>[px-x,py-y] as [number,number])};
  });
  return {...part,source:{...part.source,...(dxfAux?{dxfAux}: {}),...(dxfDetails?{dxfDetails}: {}),...(dxfEntities?{dxfEntities}: {})},outer:shift(part.outer),holes:part.holes.map(shift)};
}
export function importSparrow(text: string,fileName: string,scale: number): ImportReview {
  if(!Number.isFinite(scale) || scale<=0) throw Error('Choose a positive millimeter scale.');
  const input=record(JSON.parse(text));
  if(typeof input.name!=='string' || !Array.isArray(input.items) || input.items.length>500) throw Error('Expected a sparrow ExtSPInstance with name and items.');
  const ids=new Set<number>();
  const parts=input.items.map((raw,index)=>{
    const item=record(raw),shape=record(item.shape),id=number(item.id);
    if(!Number.isSafeInteger(id) || id<0 || ids.has(id)) throw Error('sparrow item IDs must be unique nonnegative safe integers.');
    ids.add(id);
    let outer: Ring,holes: Ring[]=[];
    const scaled=(ring: unknown): Ring=>normalizeRing(ring).map(p=>[p[0]*scale,p[1]*scale]);
    if(shape.type==='simple_polygon') outer=scaled(shape.data);
    else if(shape.type==='polygon') {
      const data=record(shape.data);
      outer=scaled(data.outer);
      if(data.inner!==undefined && !Array.isArray(data.inner)) throw Error('Polygon inner contours must be an array.');
      holes=((data.inner ?? []) as unknown[]).map(scaled);
    } else if(shape.type==='rectangle') {
      const d=record(shape.data),x=number(d.x_min),y=number(d.y_min),w=number(d.width),h=number(d.height);
      if(w<=0 || h<=0) throw Error('Rectangle dimensions must be positive.');
      outer=scaled([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);
    } else throw Error(`Item ${id}: ${String(shape.type)} is unsupported. Disjoint JSON items cannot be split without changing demand.`);
    let rotations:Part['rotations'];
    if(item.orientation!==undefined){
      const orientation=record(item.orientation),rotation=record(orientation.rotation);
      const axes=orientation.reflection_axes;
      if(axes!==undefined&&(!Array.isArray(axes)||axes.some(axis=>typeof axis!=='number'||!Number.isFinite(axis))))throw Error(`Item ${id}: reflection_axes must be a finite degree list.`);
      if(Array.isArray(axes)&&axes.length)throw Error(`Item ${id}: reflected Sparrow parts are not supported by Serula.`);
      if(rotation.mode==='continuous')rotations={kind:'continuous'};
      else if(rotation.mode==='discrete'){
        const angles=rotation.angles;
        if(!Array.isArray(angles)||!angles.length||!angles.every(a=>typeof a==='number'&&Number.isFinite(a)))throw Error(`Item ${id}: discrete rotation requires a nonempty finite angle list.`);
        rotations={kind:'discrete',degrees:angles as number[]};
      }else if(rotation.mode==='stepped'){
        const step=number(rotation.step);
        const count=Math.round(360/step);
        if(step<=0||step>360||count<1||count>65536||Math.abs(count*step-360)>360*Number.EPSILON)throw Error(`Item ${id}: stepped rotation must divide 360 degrees.`);
        rotations={kind:'discrete',degrees:Array.from({length:count},(_,i)=>i*360/count)};
      }else throw Error(`Item ${id}: unsupported Sparrow rotation mode.`);
    }else{
      const orientations=item.allowed_orientations;
      if(orientations!==undefined && orientations!==null && (!Array.isArray(orientations) || !orientations.length || !orientations.every(a=>typeof a==='number' && Number.isFinite(a)))) throw Error(`Item ${id}: allowed_orientations must be omitted for free rotation or a nonempty degree list.`);
      rotations=orientations==null?{kind:'continuous'}:{kind:'discrete',degrees:orientations as number[]};
    }
    return localize({...newPart(outer,`Part ${id}`),holes,quantity:number(item.demand),
      source:{format:'sparrow',fileName,entityId:String(id)},rotations,
      preparationPosition:[index*50,0]});
  });
  const separation=input.min_item_separation===undefined?0:number(input.min_item_separation)*scale;
  if(separation<0)throw Error('Sparrow minimum item separation must be nonnegative.');
  return {document:normalizeDocument({name:input.name,parts,settings:{...DEFAULT_SETTINGS,materialWidthMm:number(input.strip_height)*scale,clearanceMm:separation}}),
    replace:false,warnings:[...(input.solution!==undefined?['Stored native solution is ignored; warm starts are not supported.']:[]),
      `One coordinate unit = ${scale} mm. Benchmark coordinates have no intrinsic manufacturing units.`,
      ...(parts.some(p=>p.holes.length)?['Holes are preserved; nesting inside holes is not supported.']:[])]};
}
export const SOLVER_EDGE_EPS_MM=0.01;
export const solverEdgePadding=(clearanceMm:number)=>Math.max(0,clearanceMm)+SOLVER_EDGE_EPS_MM;

export type SolverCopy={itemId:number;partId:string;copyIndex:number};
export function solverCopies(doc:Document):SolverCopy[] {
  let itemId=0;
  return doc.parts.flatMap(part=>Array.from({length:part.quantity},(_,copyIndex)=>({itemId:itemId++,partId:part.id,copyIndex})));
}
export function solverCopyForItem(doc:Document,itemId:number):SolverCopy|undefined {
  return solverCopies(doc).find(copy=>copy.itemId===itemId);
}
function rotatedWidth(ring:Ring,angleDeg:number):number {
  const a=angleDeg*Math.PI/180,c=Math.cos(a),sin=Math.sin(a);
  let min=Infinity,max=-Infinity;
  for(const [x,y] of ring){
    const rx=x*c-y*sin;
    min=Math.min(min,rx);max=Math.max(max,rx);
  }
  return max-min;
}
export function preflightSolverFit(doc:Document):void {
  const width=doc.settings.materialWidthMm,tolerance=1e-7;
  for(const part of doc.parts){
    if(part.quantity<=0||part.rotations.kind==='continuous')continue;
    const ring=collisionRing(part);
    const fits=part.rotations.degrees.some(angle=>rotatedWidth(ring,angle)<=width+tolerance);
    if(!fits){
      const angles=part.rotations.degrees.map(angle=>`${angle}°`).join(', ');
      throw Error(`${part.name} seçilen dönüş kuralıyla ${width} mm malzeme genişliğine sığmıyor. İzin verilen açılar: ${angles}.`);
    }
  }
}
export function friendlyInitialPlacementError(doc:Document,message:string):string {
  const match=message.match(/No valid initial placement could be constructed for item\s+(\d+)/i);
  if(!match)return message;
  const copy=solverCopyForItem(doc,Number(match[1]));
  if(!copy)return message;
  const part=doc.parts.find(part=>part.id===copy.partId);
  if(!part)return message;
  return `${part.name} — Kopya ${copy.copyIndex+1} için başlangıç yerleşimi bulunamadı. Dönüş kuralı değiştirilmedi; parça mevcut izin verilen açılarla yeniden denendi.`;
}
export function solverInput(doc: Document): string {
  const copies=solverCopies(doc);
  if(!copies.length)throw Error('Add at least one copy before nesting.');
  preflightSolverFit(doc);
  const parts=new Map(doc.parts.map(part=>[part.id,part]));
  const edgePadding=solverEdgePadding(doc.settings.clearanceMm);
  return JSON.stringify({name:doc.name,strip_height:doc.settings.materialWidthMm+2*edgePadding,min_item_separation:doc.settings.clearanceMm,items:copies.map(copy=>{
    const p=parts.get(copy.partId)!;
    return {
      // Keep each physical copy as its own Sparrow item. Demand=1 preserves
      // stable physical copy identity for footwear DXF parts.
      id:copy.itemId,demand:1,
      orientation:{rotation:p.rotations.kind==='continuous'
        ?{mode:'continuous'}
        :{mode:'discrete',angles:p.rotations.degrees.map(angle=>-angle)}},
      shape:{type:'simple_polygon',data:collisionRing(p).map(([x,y])=>[y,x])},
    };
  })});
}
