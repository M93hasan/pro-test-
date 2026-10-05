import polygonClipping from 'polygon-clipping';
import { LIMITS, POLICY, type Document, type Part, type Placement, type Point, type Result, type Ring, type Validation } from '../model';
import { area, bounds, intersects, normalizeDocument, normalizePart, normalizeRing } from './normalize';

export type WorldPart = { partId: string; copyIndex: number; outer: Ring; holes: Ring[] };
const RESULT_LINEAR_TOLERANCE_MM=0.01;
const RESULT_OVERLAP_TOLERANCE_MM2=0.05;
export const transform = (ring: Ring, p: Placement): Ring => {
  const angle = p.angleDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return ring.map(([x,y]) => [x*c-y*s+p.xMm, x*s+y*c+p.yMm]);
};
export function worldParts(doc: Document, result: Pick<Result,'placements'>): WorldPart[] {
  const parts = new Map(doc.parts.map(p => [p.id,p]));
  return result.placements.map(p => {
    const part = parts.get(p.partId);
    if (!part) throw Error(`Unknown part ${p.partId}.`);
    return { partId: p.partId, copyIndex: p.copyIndex, outer: transform(part.outer,p), holes: part.holes.map(h=>transform(h,p)) };
  });
}
function convexHull(points:Point[]):Ring {
  const unique=[...new Map(points.map(point=>[`${point[0]},${point[1]}`,point] as const)).values()]
    .sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if(unique.length<3)return normalizeRing(points);
  const cross=(o:Point,a:Point,b:Point)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower:Point[]=[];
  for(const point of unique){while(lower.length>=2&&cross(lower.at(-2)!,lower.at(-1)!,point)<=0)lower.pop();lower.push(point);}
  const upper:Point[]=[];
  for(let i=unique.length-1;i>=0;i--){const point=unique[i];while(upper.length>=2&&cross(upper.at(-2)!,upper.at(-1)!,point)<=0)upper.pop();upper.push(point);}
  return normalizeRing([...lower.slice(0,-1),...upper.slice(0,-1)]);
}
// Attached DXF contours can extend beyond the selected main outer contour.
// Nest against the true union envelope so exported production geometry cannot
// overlap even when a colored allowance/detail protrudes outside the main ring.
// A connected union keeps the original concavity. Only genuinely disjoint
// attached islands fall back to a conservative convex hull.
export function collisionRing(part:Part):Ring {
  const details=part.source.dxfDetails?.map(detail=>detail.ring).filter(ring=>ring.length>=3)??[];
  if(!details.length)return part.outer;
  const source=[part.outer,...details];
  try{
    const union=polygonClipping.union as unknown as (...polygons:Ring[][])=>Ring[][];
    const merged=union(...source.map(ring=>[ring]));
    if(merged.length===1&&merged[0]?.[0]?.length>=3)return normalizeRing(merged[0][0]);
    const exterior=merged.flatMap(polygon=>polygon[0]??[]) as Point[];
    if(exterior.length>=3)return convexHull(exterior);
  }catch{/* fall through to a conservative envelope */}
  return convexHull(source.flat());
}
export function collisionWorldRings(doc:Document,result:Pick<Result,'placements'>):Ring[] {
  const parts=new Map(doc.parts.map(part=>[part.id,part]));
  return result.placements.map(placement=>{
    const part=parts.get(placement.partId);
    if(!part)throw Error(`Unknown part ${placement.partId}.`);
    return transform(collisionRing(part),placement);
  });
}
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx=b[0]-a[0], dy=b[1]-a[1], d=dx*dx+dy*dy;
  const t=d === 0 ? 0 : Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}
function distance(a: Ring,b: Ring): number {
  let min=Infinity;
  for(let i=0;i<a.length;i++) for(let j=0;j<b.length;j++) {
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    if(intersects(p,q,r,s)) return 0;
    min=Math.min(min,pointSegmentDistance(p,r,s),pointSegmentDistance(q,r,s),pointSegmentDistance(r,p,q),pointSegmentDistance(s,p,q));
  }
  return min;
}
export function validate(doc: Document, result: Result, serialized?: WorldPart[]): Validation {
  const v: Validation & {overlapAreaMm2:number;maxBoundaryViolationMm:number} = { status:'failed', overlapAreaMm2:0, maxBoundaryViolationMm:0, minClearanceMm:null, errors:[] };
  try {
    doc=normalizeDocument(doc);
    if(!Number.isFinite(result.usedLengthMm) || result.usedLengthMm<=0) throw Error('Used length must be finite and positive.');
    if(doc.settings.materialType==='sheet'){
      const sheetCount=result.sheetCount??1,total=doc.parts.reduce((n,p)=>n+p.quantity,0);
      if(!Number.isInteger(sheetCount)||sheetCount<1||sheetCount>Math.max(1,total))throw Error('Invalid sheet count.');
      const expected=(doc.settings.materialLengthMm??0)*sheetCount;
      if(!Number.isFinite(expected)||Math.abs(result.usedLengthMm-expected)>RESULT_LINEAR_TOLERANCE_MM)throw Error('Sheet result length does not match its sheet count.');
    }else if(result.usedLengthMm>LIMITS.extent) throw Error('Used length must be at most 100,000 mm.');
    if(!Array.isArray(result.placements) || result.placements.length!==doc.parts.reduce((n,p)=>n+p.quantity,0)) throw Error('Layout does not contain exactly the demanded copies.');
    const parts=new Map(doc.parts.map(p=>[p.id,p]));
    const seen=new Set<string>();
    for(const p of result.placements) {
      const part=parts.get(p.partId);
      if(!part || !Number.isInteger(p.copyIndex) || p.copyIndex<0 || p.copyIndex>=part.quantity) throw Error('Unknown part or copy index.');
      if(Object.keys(p).some(k=>!['partId','copyIndex','xMm','yMm','angleDeg','sheetIndex'].includes(k))) throw Error('Placements support rigid rotations and translations only.');
      if(![p.xMm,p.yMm,p.angleDeg].every(Number.isFinite)) throw Error('Placement contains a non-finite transform.');
      if(doc.settings.materialType==='sheet') {
        const sheetCount=result.sheetCount??1;
        const sheetIndex=p.sheetIndex??0;
        if(!Number.isInteger(sheetIndex)||sheetIndex<0||sheetIndex>=sheetCount) throw Error('Invalid sheet index.');
      }
      const key=JSON.stringify([p.partId,p.copyIndex]);
      if(seen.has(key)) throw Error('Duplicate part copy.');
      seen.add(key);
      if(part.rotations.kind==='discrete' && !part.rotations.degrees.some(a=>Math.abs(((p.angleDeg-a)%360+540)%360-180)<=POLICY.angleDeg)) throw Error(`Disallowed rotation for ${part.name}.`);
    }
    const expected=worldParts(doc,result),world=serialized ?? expected,collision=collisionWorldRings(doc,result);
    if(world.length!==result.placements.length) throw Error('Serialized contour count differs from the layout.');
    const boxes=world.map((p,i)=>{
      const original=parts.get(p.partId);
      if(!original || p.partId!==result.placements[i].partId || p.copyIndex!==result.placements[i].copyIndex || p.holes.length!==original.holes.length) throw Error('Serialized part or hole identity differs from the layout.');
      if(serialized) {
        const expectedRings=[expected[i].outer,...expected[i].holes];
        if([p.outer,...p.holes].some((ring,j)=>ring.length!==expectedRings[j].length||ring.some((point,k)=>point.length!==2||point.some((coordinate,axis)=>coordinate!==expectedRings[j][k][axis]))))throw Error('Serialized contours differ from the rigidly transformed input geometry.');
      }
      normalizePart({...original,outer:p.outer,holes:p.holes});
      const b=bounds(collision[i]);
      const boundaryLength=doc.settings.materialType==='sheet'?doc.settings.materialLengthMm:result.usedLengthMm;
      if(!boundaryLength)throw Error('Sheet length is required.');
      v.maxBoundaryViolationMm=Math.max(v.maxBoundaryViolationMm,-b[0],-b[1],b[2]-doc.settings.materialWidthMm,b[3]-boundaryLength);
      return b;
    });
    if(v.maxBoundaryViolationMm>RESULT_LINEAR_TOLERANCE_MM) v.errors.push(`Material boundary exceeded by ${v.maxBoundaryViolationMm} mm.`);
    let operations=0;
    for(let i=0;i<world.length;i++) for(let j=0;j<i;j++) {
      if(doc.settings.materialType==='sheet' && result.placements[i].sheetIndex!==result.placements[j].sheetIndex)continue;
      const a=boxes[i],b=boxes[j];
      const boxDistance=Math.hypot(Math.max(0,a[0]-b[2],b[0]-a[2]),Math.max(0,a[1]-b[3],b[1]-a[3]));
      if(boxDistance===0) {
        const clipped=polygonClipping.intersection([collision[i]],[collision[j]]);
        const overlap=clipped.reduce((total,poly)=>total+Math.abs(area(poly[0]))-poly.slice(1).reduce((n,h)=>n+Math.abs(area(h)),0),0);
        if(!Number.isFinite(overlap)) throw Error('Intersection returned a non-finite area.');
        v.overlapAreaMm2=Math.max(v.overlapAreaMm2,overlap);
        if(overlap>RESULT_OVERLAP_TOLERANCE_MM2 && v.errors.length<20) v.errors.push(`Copies ${j+1} and ${i+1} overlap by ${overlap} mm².`);
      }
      if(doc.settings.clearanceMm>0 && (v.minClearanceMm===null || boxDistance<v.minClearanceMm)) {
        operations+=collision[i].length*collision[j].length;
        if(operations>50_000_000) throw Error('Clearance check exceeded its segment budget. Use fewer vertices or parts.');
        const gap=distance(collision[i],collision[j]);
        if(!Number.isFinite(gap)) throw Error('Clearance check returned a non-finite distance.');
        v.minClearanceMm=Math.min(v.minClearanceMm ?? Infinity,gap);
      }
    }
    if(v.minClearanceMm!==null && v.minClearanceMm+RESULT_LINEAR_TOLERANCE_MM<doc.settings.clearanceMm) v.errors.push(`Minimum clearance is ${v.minClearanceMm} mm; requested ${doc.settings.clearanceMm} mm.`);
    v.status=v.errors.length?'failed':'passed';
  } catch(error) { v.errors.push(error instanceof Error?error.message:String(error)); }
  return v;
}
export const netArea = (part: Part) => Math.abs(area(part.outer))-part.holes.reduce((n,h)=>n+Math.abs(area(h)),0);
