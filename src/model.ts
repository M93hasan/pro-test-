export type Point = [number, number];
export type Ring = Point[];

export type CutHeadMode = 'single' | 'dual-sync';

export type MachineSettings = {
  cutHeadMode: CutHeadMode;
  headSpacingMm: number;
};

export type MaterialSettings = {
  widthMm: number;
  lengthMm: number;
};

export type Part = {
  id: string;
  name: string;
  outer: Ring;
};

export type Placement = {
  partId: string;
  copyIndex: number;
  xMm: number;
  yMm: number;
  angleDeg: number;
};

export type PhysicalCutPlacement = Placement & {
  headIndex: 0 | 1;
  sourcePlacementIndex: number;
};

export type DualHeadDocument = {
  machine: MachineSettings;
  material: MaterialSettings;
  parts: Part[];
  placements: Placement[];
};

export type LayoutIssue = {
  type: 'invalid-machine' | 'invalid-material' | 'boundary' | 'overlap' | 'missing-part';
  message: string;
  placementIndexes?: number[];
};

export const DEFAULT_MACHINE: MachineSettings = {
  cutHeadMode: 'single',
  headSpacingMm: 500
};
