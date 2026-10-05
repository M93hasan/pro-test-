import type {
  DualHeadDocument,
  LayoutIssue,
  MachineSettings,
  Part,
  PhysicalCutPlacement,
  Placement,
  Point,
  Ring
} from './model';

const EPS = 1e-7;

export function validateMachineSettings(machine: MachineSettings): string[] {
  const errors: string[] = [];
  if (machine.cutHeadMode !== 'single' && machine.cutHeadMode !== 'dual-sync') {
    errors.push('Geçersiz kesim kafası modu.');
  }
  if (machine.cutHeadMode === 'dual-sync') {
    if (!Number.isFinite(machine.headSpacingMm) || machine.headSpacingMm <= 0) {
      errors.push('Çift kafa modunda kafa aralığı 0 mm’den büyük olmalıdır.');
    }
  }
  return errors;
}

export function expandSynchronizedHeads(
  placements: Placement[],
  machine: MachineSettings
): PhysicalCutPlacement[] {
  const errors = validateMachineSettings(machine);
  if (errors.length) throw new Error(errors[0]);

  return placements.flatMap((placement, sourcePlacementIndex) => {
    const first: PhysicalCutPlacement = {
      ...placement,
      headIndex: 0,
      sourcePlacementIndex
    };

    if (machine.cutHeadMode === 'single') return [first];

    const second: PhysicalCutPlacement = {
      ...placement,
      xMm: placement.xMm + machine.headSpacingMm,
      headIndex: 1,
      sourcePlacementIndex
    };

    return [first, second];
  });
}

export function transformRing(ring: Ring, placement: Placement): Ring {
  const angle = placement.angleDeg * Math.PI / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return ring.map(([x, y]) => [
    x * c - y * s + placement.xMm,
    x * s + y * c + placement.yMm
  ]);
}

function bounds(ring: Ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function orientation(a: Point, b: Point, c: Point) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Point, b: Point, p: Point) {
  return (
    Math.abs(orientation(a, b, p)) <= EPS &&
    p[0] >= Math.min(a[0], b[0]) - EPS &&
    p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS &&
    p[1] <= Math.max(a[1], b[1]) + EPS
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (
    ((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) &&
    ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))
  ) return true;

  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function pointInRing(point: Point, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    if (onSegment(ring[j], ring[i], point)) return true;

    const crosses =
      (yi > point[1]) !== (yj > point[1]) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;

    if (crosses) inside = !inside;
  }
  return inside;
}

export function ringsOverlap(a: Ring, b: Ring) {
  const ba = bounds(a);
  const bb = bounds(b);

  if (
    ba.maxX < bb.minX - EPS ||
    bb.maxX < ba.minX - EPS ||
    ba.maxY < bb.minY - EPS ||
    bb.maxY < ba.minY - EPS
  ) return false;

  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  return pointInRing(a[0], b) || pointInRing(b[0], a);
}

export function validateDualHeadLayout(document: DualHeadDocument): LayoutIssue[] {
  const issues: LayoutIssue[] = [];

  for (const message of validateMachineSettings(document.machine)) {
    issues.push({ type: 'invalid-machine', message });
  }

  if (
    !Number.isFinite(document.material.widthMm) ||
    !Number.isFinite(document.material.lengthMm) ||
    document.material.widthMm <= 0 ||
    document.material.lengthMm <= 0
  ) {
    issues.push({ type: 'invalid-material', message: 'Malzeme ölçüleri 0 mm’den büyük olmalıdır.' });
  }

  if (issues.length) return issues;

  const parts = new Map<string, Part>(document.parts.map(part => [part.id, part]));
  const physical = expandSynchronizedHeads(document.placements, document.machine);
  const rings: Ring[] = [];

  physical.forEach((placement, physicalIndex) => {
    const part = parts.get(placement.partId);
    if (!part) {
      issues.push({
        type: 'missing-part',
        message: 'Yerleşimde bilinmeyen parça var: ' + placement.partId,
        placementIndexes: [physicalIndex]
      });
      rings.push([]);
      return;
    }

    const ring = transformRing(part.outer, placement);
    rings.push(ring);
    const box = bounds(ring);

    if (
      box.minX < -EPS ||
      box.minY < -EPS ||
      box.maxX > document.material.widthMm + EPS ||
      box.maxY > document.material.lengthMm + EPS
    ) {
      issues.push({
        type: 'boundary',
        message: part.name + ' · Kafa ' + (placement.headIndex + 1) + ' malzeme sınırının dışına çıkıyor.',
        placementIndexes: [physicalIndex]
      });
    }
  });

  for (let i = 0; i < rings.length; i++) {
    if (rings[i].length < 3) continue;
    for (let j = 0; j < i; j++) {
      if (rings[j].length < 3) continue;

      const a = physical[j];
      const b = physical[i];

      // Aynı ana hareketin iki senkron kafa çıktısı fiziksel olarak üst üste gelemez.
      // Diğer tüm fiziksel kesim çiftleri de gerçek geometriyle kontrol edilir.
      if (!ringsOverlap(rings[i], rings[j])) continue;

      issues.push({
        type: 'overlap',
        message:
          'Çakışma: Kafa ' + (a.headIndex + 1) + ' / yerleşim ' + (a.sourcePlacementIndex + 1) +
          ' ile Kafa ' + (b.headIndex + 1) + ' / yerleşim ' + (b.sourcePlacementIndex + 1) + '.',
        placementIndexes: [j, i]
      });
    }
  }

  return issues;
}

export function minimumRequiredMaterialWidth(baseLayoutMaxX: number, machine: MachineSettings) {
  if (machine.cutHeadMode === 'single') return baseLayoutMaxX;
  return baseLayoutMaxX + machine.headSpacingMm;
}
