/// <reference lib="webworker" />
import { loadSerialWasm, supportsSIMD } from '../wasm';
import { normalizeDocument } from '../geometry/normalize';
import { solverInput } from '../import/sparrow';
import type { Document } from '../model';

type StartMessage = {
  type: 'start';
  document: Document;
  documentRevision: number;
  seed: string;
};

self.onmessage = async ({ data }: MessageEvent<StartMessage>) => {
  if (data.type !== 'start') return;

  const send = (message: Record<string, unknown>) => {
    self.postMessage({
      ...message,
      documentRevision: data.documentRevision
    });
  };

  try {
    const wasm = await loadSerialWasm();
    await wasm.default();
    const document = normalizeDocument(data.document);
    const input = solverInput(document);

    send({
      type: 'ready',
      solverBinary: supportsSIMD ? 'serial-simd' : 'serial-nosimd'
    });

    wasm.run(
      input,
      document.settings.timeLimitSeconds ?? undefined,
      data.seed,
      document.settings.clearanceMm,
      document.settings.solverPreset ?? 'standard',
      (json: string) => {
        const message = JSON.parse(json) as Record<string, unknown>;
        send(message);
      }
    );
  } catch (error) {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
};
