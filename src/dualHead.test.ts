import { describe, expect, it } from 'vitest';
import { expandSynchronizedHeads, validateDualHeadLayout } from './dualHead';
import type { DualHeadDocument } from './model';

const base: DualHeadDocument = {
  machine: { cutHeadMode: 'dual-sync', headSpacingMm: 500 },
  material: { widthMm: 1400, lengthMm: 700 },
  parts: [{
    id: 'p1',
    name: 'Parça',
    outer: [[0,0],[100,0],[100,100],[0,100]]
  }],
  placements: [{
    partId: 'p1',
    copyIndex: 0,
    xMm: 100,
    yMm: 100,
    angleDeg: 0
  }]
};

describe('dual synchronous head mode', () => {
  it('creates head 2 at X + configured spacing', () => {
    const cuts = expandSynchronizedHeads(base.placements, base.machine);
    expect(cuts).toHaveLength(2);
    expect(cuts[0].xMm).toBe(100);
    expect(cuts[1].xMm).toBe(600);
    expect(cuts[1].yMm).toBe(cuts[0].yMm);
    expect(cuts[1].angleDeg).toBe(cuts[0].angleDeg);
  });

  it('keeps single-head behavior unchanged', () => {
    const cuts = expandSynchronizedHeads(
      base.placements,
      { cutHeadMode: 'single', headSpacingMm: 500 }
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0].xMm).toBe(100);
  });

  it('rejects head 2 when it leaves material bounds', () => {
    const doc: DualHeadDocument = {
      ...base,
      machine: { cutHeadMode: 'dual-sync', headSpacingMm: 1250 }
    };
    expect(validateDualHeadLayout(doc).some(issue => issue.type === 'boundary')).toBe(true);
  });

  it('rejects overlap between synchronized heads', () => {
    const doc: DualHeadDocument = {
      ...base,
      machine: { cutHeadMode: 'dual-sync', headSpacingMm: 50 }
    };
    expect(validateDualHeadLayout(doc).some(issue => issue.type === 'overlap')).toBe(true);
  });

  it('accepts a valid synchronized layout', () => {
    expect(validateDualHeadLayout(base)).toEqual([]);
  });
});
