import type { Document, Placement, Settings } from './model';

export type PhysicalPlacement = Placement & {
  headIndex: 0 | 1;
  sourcePlacementIndex: number;
};

export function cutHeadMode(settings: Settings) {
  return settings.cutHeadMode ?? 'single';
}

export function headSpacingMm(settings: Settings) {
  return settings.headSpacingMm ?? 500;
}

export function validateMachineSettings(settings: Settings): string[] {
  if (cutHeadMode(settings) === 'single') return [];

  const width = settings.materialWidthMm;
  const spacing = headSpacingMm(settings);
  const errors: string[] = [];

  if (!Number.isFinite(spacing) || spacing <= 0) {
    errors.push('Çift kafa modunda kafa aralığı 0 mm’den büyük olmalıdır.');
  }
  if (Number.isFinite(width) && spacing >= width) {
    errors.push('Kafa aralığı malzeme genişliğinden küçük olmalıdır.');
  }
  if (Number.isFinite(width) && width > 0 && spacing > 0 && spacing < width) {
    const lane = Math.min(spacing, width - spacing);
    if (lane <= 0) errors.push('Çift kafa için kullanılabilir nesting şeridi oluşmadı.');
  }

  return errors;
}

export function effectiveNestingWidth(settings: Settings): number {
  if (cutHeadMode(settings) === 'single') return settings.materialWidthMm;

  const errors = validateMachineSettings(settings);
  if (errors.length) throw new Error(errors[0]);

  const spacing = headSpacingMm(settings);
  return Math.min(spacing, settings.materialWidthMm - spacing);
}

export function solverDocument(document: Document): Document {
  if (cutHeadMode(document.settings) === 'single') return document;

  return {
    ...document,
    settings: {
      ...document.settings,
      materialWidthMm: effectiveNestingWidth(document.settings)
    }
  };
}

export function expandSynchronizedPlacements(
  placements: Placement[],
  settings: Settings
): PhysicalPlacement[] {
  if (cutHeadMode(settings) === 'single') {
    return placements.map((placement, sourcePlacementIndex) => ({
      ...placement,
      headIndex: 0,
      sourcePlacementIndex
    }));
  }

  const errors = validateMachineSettings(settings);
  if (errors.length) throw new Error(errors[0]);
  const spacing = headSpacingMm(settings);

  return placements.flatMap((placement, sourcePlacementIndex) => [
    {
      ...placement,
      headIndex: 0 as const,
      sourcePlacementIndex
    },
    {
      ...placement,
      xMm: placement.xMm + spacing,
      headIndex: 1 as const,
      sourcePlacementIndex
    }
  ]);
}

export function physicalCopyCount(document: Document): number {
  const cycles = document.parts.reduce((total, part) => total + Math.max(0, part.quantity), 0);
  return cutHeadMode(document.settings) === 'dual-sync' ? cycles * 2 : cycles;
}
