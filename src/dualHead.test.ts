import { describe, expect, it } from 'vitest';
import {
  effectiveNestingWidth,
  expandSynchronizedPlacements,
  physicalCopyCount,
  solverDocument,
  validateMachineSettings
} from './dualHead';
import type { Document } from './model';

const document: Document = {
  name: 'test',
  settings: {
    materialWidthMm: 1400,
    clearanceMm: 0,
    timeLimitSeconds: 30,
    materialType: 'roll',
    cutHeadMode: 'dual-sync',
    headSpacingMm: 700
  },
  parts: [{
    id: 'p1',
    name: 'Parça',
    source: { format: 'drawn' },
    outer: [[0,0],[100,0],[100,100],[0,100]],
    holes: [],
    approximationToleranceMm: 0,
    quantity: 2,
    rotations: { kind: 'discrete', degrees: [0, 180] },
    preparationPosition: [0,0]
  }]
};

describe('synchronized dual-head machine model', () => {
  it('uses a safe head lane for a centered two-head machine', () => {
    expect(effectiveNestingWidth(document.settings)).toBe(700);
    expect(solverDocument(document).settings.materialWidthMm).toBe(700);
  });

  it('uses the smaller safe lane when spacing is not centered', () => {
    expect(effectiveNestingWidth({ ...document.settings, headSpacingMm: 500 })).toBe(500);
    expect(effectiveNestingWidth({ ...document.settings, headSpacingMm: 900 })).toBe(500);
  });

  it('creates head 2 at X + head spacing without changing Y, angle, or sheet', () => {
    const placements = expandSynchronizedPlacements([{
      partId: 'p1',
      copyIndex: 0,
      xMm: 120,
      yMm: 45,
      angleDeg: 180,
      sheetIndex: 2
    }], document.settings);

    expect(placements).toHaveLength(2);
    expect(placements[0]).toMatchObject({ headIndex: 0, xMm: 120, yMm: 45, angleDeg: 180, sheetIndex: 2 });
    expect(placements[1]).toMatchObject({ headIndex: 1, xMm: 820, yMm: 45, angleDeg: 180, sheetIndex: 2 });
  });

  it('keeps single-head placement unchanged', () => {
    const placements = expandSynchronizedPlacements([{
      partId: 'p1',
      copyIndex: 0,
      xMm: 120,
      yMm: 45,
      angleDeg: 0
    }], { ...document.settings, cutHeadMode: 'single' });

    expect(placements).toHaveLength(1);
    expect(placements[0].xMm).toBe(120);
  });

  it('rejects impossible head spacing', () => {
    expect(validateMachineSettings({ ...document.settings, headSpacingMm: 1400 }).length).toBeGreaterThan(0);
    expect(validateMachineSettings({ ...document.settings, headSpacingMm: 0 }).length).toBeGreaterThan(0);
  });

  it('counts two physical outputs per synchronized cutting motion', () => {
    expect(physicalCopyCount(document)).toBe(4);
    expect(physicalCopyCount({
      ...document,
      settings: { ...document.settings, cutHeadMode: 'single' }
    })).toBe(2);
  });
});
