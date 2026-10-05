import type { Document, Placement, Result } from './model';
import { SOLVER_REVISION } from './model';
import { solverCopies } from './import/sparrow';
import { packResultIntoSheets } from './geometry/multiSheet';
import { validate } from './geometry/validate';
import { solverDocument } from './dualHead';

type SolverPlacement = {
  item_id: number;
  transformation: {
    reflected?: boolean;
    rotation: number;
    translation: [number, number];
  };
};

type SolverMessage =
  | { type: 'ready'; solverBinary: string; documentRevision: number }
  | { type: 'phase'; phase: string; documentRevision: number }
  | {
      type: 'candidate';
      documentRevision: number;
      elapsedMs: number;
      solution: {
        strip_width: number;
        layout: { placed_items: SolverPlacement[] };
      };
    }
  | { type: 'finished'; documentRevision: number }
  | { type: 'error'; documentRevision: number; message: string }
  | { type: string; documentRevision: number; [key: string]: unknown };

export type NestingController = {
  cancel: () => void;
};

export type NestingCallbacks = {
  onStatus?: (status: string) => void;
  onCandidate?: (result: Result) => void;
  onComplete: (result: Result) => void;
  onError: (message: string) => void;
};

function randomSeed() {
  return crypto.getRandomValues(new BigUint64Array(1))[0].toString();
}

function candidateResult(document: Document, message: Extract<SolverMessage, { type: 'candidate' }>, seed: string): Result {
  const copies = solverCopies(document);

  const placements: Placement[] = message.solution.layout.placed_items.map(item => {
    if (item.transformation.reflected) {
      throw new Error('Solver yansıtılmış parça döndürdü; Serula yansıtmayı kullanmıyor.');
    }

    const copy = copies[item.item_id];
    if (!copy) throw new Error('Solver bilinmeyen parça kimliği döndürdü.');

    const rawY = item.transformation.translation[0];
    const sheetLength = document.settings.materialLengthMm;
    const sheetIndex =
      document.settings.materialType === 'sheet' && sheetLength
        ? Math.max(0, Math.floor((rawY + 1e-7) / sheetLength))
        : undefined;
    const yMm = sheetIndex === undefined ? rawY : rawY - sheetIndex * sheetLength!;

    return {
      partId: copy.partId,
      copyIndex: copy.copyIndex,
      xMm: item.transformation.translation[1],
      yMm,
      angleDeg: -item.transformation.rotation,
      ...(sheetIndex === undefined ? {} : { sheetIndex })
    };
  });

  return {
    documentRevision: message.documentRevision,
    solverRevision: SOLVER_REVISION,
    seed,
    elapsedSeconds: message.elapsedMs / 1000,
    usedLengthMm: message.solution.strip_width,
    placements,
    validation: {
      status: 'pending',
      overlapAreaMm2: 0,
      maxBoundaryViolationMm: 0,
      minClearanceMm: null,
      errors: []
    }
  };
}

export function startNesting(document: Document, documentRevision: number, callbacks: NestingCallbacks): NestingController {
  const solveDocument = solverDocument(document);
  const seed = randomSeed();
  const worker = new Worker(new URL('./workers/solver.worker.ts', import.meta.url), { type: 'module' });
  let best: Result | undefined;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    worker.terminate();
  };

  worker.onmessage = ({ data }: MessageEvent<SolverMessage>) => {
    if (closed || data.documentRevision !== documentRevision) return;

    if (data.type === 'ready') {
      callbacks.onStatus?.('Sparrow hazır');
      return;
    }

    if (data.type === 'phase') {
      callbacks.onStatus?.(data.phase);
      return;
    }

    if (data.type === 'candidate') {
      try {
        const candidate = candidateResult(solveDocument, data, seed);
        const packed = packResultIntoSheets(solveDocument, candidate);
        const checked = validate(solveDocument, packed);

        if (checked.status !== 'passed') return;

        const valid = { ...packed, validation: checked };
        const better =
          !best ||
          (valid.sheetCount ?? 1) < (best.sheetCount ?? 1) ||
          ((valid.sheetCount ?? 1) === (best.sheetCount ?? 1) && valid.usedLengthMm < best.usedLengthMm);

        if (better) {
          best = valid;
          callbacks.onCandidate?.(valid);
        }
      } catch (error) {
        callbacks.onStatus?.(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (data.type === 'finished') {
      close();
      if (best) callbacks.onComplete(best);
      else callbacks.onError('Geçerli bir yerleşim bulunamadı.');
      return;
    }

    if (data.type === 'error') {
      close();
      callbacks.onError(data.message);
    }
  };

  worker.onerror = event => {
    close();
    callbacks.onError(event.message || 'Nesting worker başlatılamadı.');
  };

  worker.postMessage({
    type: 'start',
    document: solveDocument,
    documentRevision,
    seed
  });

  return { cancel: close };
}
