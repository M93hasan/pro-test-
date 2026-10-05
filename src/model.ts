export type Point = [number, number];
export type Ring = Point[];
export type RotationRule = { kind: 'discrete'; degrees: number[] } | { kind: 'continuous' };
export type CutHeadMode = 'single' | 'dual-sync';
export type DxfSpline = { degree:number; knots:number[]; controlPoints:Point[]; weights?:number[]; flags:number; layer?:string };
export type DxfSourceEntity =
  | { kind:'line'; start:Point; end:Point; layer:string; colorNumber?:number }
  | { kind:'arc'; center:Point; radius:number; startAngleDeg:number; endAngleDeg:number; layer:string; colorNumber?:number }
  | { kind:'circle'; center:Point; radius:number; layer:string; colorNumber?:number }
  | { kind:'spline'; degree:number; knots:number[]; controlPoints:Point[]; weights?:number[]; flags:number; layer:string; colorNumber?:number }
  | { kind:'polyline'; points:Point[]; bulges?:number[]; closed:boolean; sourceType:'LWPOLYLINE'|'POLYLINE'; layer:string; colorNumber?:number };
export type DxfAuxEntity =
  | { kind:'point'; point:Point; layer:string; colorNumber?:number }
  | { kind:'text'|'mtext'; point:Point; text:string; heightMm:number; rotationDeg:number; layer:string; colorNumber?:number }
  | { kind:'path'; points:Point[]; layer:string; colorNumber?:number };
export type DxfDetailContour = { ring:Ring; layer:string; colorNumber?:number };
export type Part = {
  id: string; name: string;
  source: { format: 'svg' | 'dxf' | 'plt' | 'sparrow' | 'drawn'; fileName?: string; entityId?: string; dxfSpline?:DxfSpline; dxfEntities?:DxfSourceEntity[]; dxfColorNumber?:number; dxfHoleColorNumbers?:number[]; dxfAux?:DxfAuxEntity[]; dxfDetails?:DxfDetailContour[]; dxfSourceEntityCount?:number };
  outer: Ring; holes: Ring[]; approximationToleranceMm: number; quantity: number;
  rotations: RotationRule; preparationPosition: Point;
};
export type Settings = { solverPreset?: 'standard' | 'fast'; startCorner?: 'right-top' | 'right-bottom'; materialType?: 'roll' | 'sheet'; materialWidthMm: number; materialLengthMm?: number; clearanceMm: number; timeLimitSeconds: 10 | 30 | 60 | 120 | 300 | 600 | null; cutHeadMode?: CutHeadMode; headSpacingMm?: number };
export type Placement = { partId: string; copyIndex: number; xMm: number; yMm: number; angleDeg: number; sheetIndex?: number };
/** A document keeps the editable position of every demanded copy. */
export type Document = { name: string; parts: Part[]; settings: Settings; placements?: Placement[]; seriesMultiplier?: number };
export type Validation = { status: 'pending' | 'passed' | 'failed'; source?: 'solver' | 'local'; overlapAreaMm2: number | null;
  maxBoundaryViolationMm: number | null; minClearanceMm: number | null; errors: string[] };
export type Result = { documentRevision: number; solverRevision: string; seed: string;
  elapsedSeconds: number; usedLengthMm: number; sheetCount?: number; placements: Placement[]; validation: Validation };
export type Project = Document & { schemaVersion: 1; revision: number; result?: Result };
export const DEFAULT_SETTINGS: Settings = { startCorner: 'right-bottom', materialType: 'roll', materialWidthMm: 1400, clearanceMm: 0, timeLimitSeconds: 30, cutHeadMode: 'single', headSpacingMm: 0 };
export const SOLVER_REVISION = '5901a79b6c5a74d8b9c356ee2916736567308108';
export const LIMITS = { copies: 500, verticesPerPart: 5000, verticesTotal: 100000, extent: 100000 };
export const POLICY = { linearMm: 1e-6, overlapMm2: 1e-8, angleDeg: 1e-4 };
// getRandomValues also works on HTTP LAN addresses, unlike randomUUID.
export function newPartId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function newPart(outer: Ring, name = 'Part'): Part {
  return { id: newPartId(), name, source: { format: 'drawn' }, outer, holes: [],
    approximationToleranceMm: 0, quantity: 1, rotations: { kind: 'discrete', degrees: [0, 180] }, preparationPosition: [0, 0] };
}
export function example(): Document {
  const shapes: Ring[] = [ [[0,0],[36,0],[36,12],[12,12],[12,38],[0,38]],
    [[0,0],[28,0],[36,20],[14,32],[0,20]], [[0,0],[38,0],[38,10],[26,10],[26,26],[12,26],[12,10],[0,10]],
    [[0,0],[30,0],[30,30],[0,30]] ];
  return { name: 'Atölye parçaları', settings: { materialWidthMm: 1400, clearanceMm: 0, timeLimitSeconds: null },
    parts: shapes.map((ring, i) => ({ ...newPart(ring, ['Braket', 'Kalkan', 'Sekme', 'Plaka'][i]), quantity: 3,
      preparationPosition: [[0,0],[40,0],[0,42],[42,42]][i] as Point })) };
}

export function rotationSummary(rule: RotationRule): string {
  if (rule.kind === 'continuous') return 'Serbest dönüş';
  const degrees = [...new Set(rule.degrees.map(d => ((d % 360) + 360) % 360))].sort((a,b) => a-b);
  if (degrees.length === 1) return 'Sabit';
  if (degrees.length === 2 && degrees[1]-degrees[0] === 180) return 'Yarım dönüşler';
  if (degrees.length === 4 && degrees.every((d,i) => d-degrees[0] === i*90)) return 'Dört yön';
  return `${degrees.length} açı`;
}
