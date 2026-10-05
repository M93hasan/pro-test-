import { useEffect, useMemo, useRef, useState } from 'react';
import { importDXF } from './import/dxf';
import { exportDXF } from './export/dxf';
import { worldParts } from './geometry/validate';
import {
  cutHeadMode,
  effectiveNestingWidth,
  expandSynchronizedPlacements,
  headSpacingMm,
  physicalCopyCount,
  validateMachineSettings
} from './dualHead';
import { DEFAULT_SETTINGS, example, type CutHeadMode, type Document, type Result } from './model';
import { startNesting, type NestingController } from './solver';
import './styles.css';

function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/dxf;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function baseDocument(): Document {
  const source = example();
  return {
    ...source,
    name: 'Serula Dual Head',
    settings: {
      ...DEFAULT_SETTINGS,
      ...source.settings,
      cutHeadMode: 'single',
      headSpacingMm: 0
    }
  };
}

export default function App() {
  const [document, setDocument] = useState<Document>(() => baseDocument());
  const [result, setResult] = useState<Result>();
  const [status, setStatus] = useState('DXF yükleyebilir veya örnek parçalarla test edebilirsin.');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [revision, setRevision] = useState(1);
  const controller = useRef<NestingController | undefined>(undefined);

  useEffect(() => () => controller.current?.cancel(), []);

  const machineErrors = useMemo(
    () => validateMachineSettings(document.settings),
    [document.settings]
  );

  const laneWidth = useMemo(() => {
    try {
      return effectiveNestingWidth(document.settings);
    } catch {
      return document.settings.materialWidthMm;
    }
  }, [document.settings]);

  const physicalPlacements = useMemo(
    () => result ? expandSynchronizedPlacements(result.placements, document.settings) : [],
    [result, document.settings]
  );

  const previewPlacements = useMemo(() => {
    const sourcePlacements = result ? physicalPlacements : (document.placements ?? []);
    const sheetMode = !!result && document.settings.materialType === 'sheet';
    const pitch = document.settings.materialWidthMm + 50;
    return sourcePlacements.map(placement => ({
      ...placement,
      xMm: placement.xMm + (sheetMode ? (placement.sheetIndex ?? 0) * pitch : 0)
    }));
  }, [document.placements, document.settings.materialType, document.settings.materialWidthMm, physicalPlacements, result]);

  const previewWorld = useMemo(() => {
    if (!previewPlacements.length) return [];
    try {
      return worldParts(document, { placements: previewPlacements });
    } catch {
      return [];
    }
  }, [document, previewPlacements]);

  const previewSize = useMemo(() => {
    const width = document.settings.materialWidthMm;
    if (document.settings.materialType === 'sheet') {
      const sheets = Math.max(1, result?.sheetCount ?? 1);
      return {
        width: sheets * width + Math.max(0, sheets - 1) * 50,
        height: document.settings.materialLengthMm ?? 700
      };
    }
    return {
      width,
      height: Math.max(300, result?.usedLengthMm ?? 700)
    };
  }, [document.settings, result]);

  function updateSettings(patch: Partial<Document['settings']>) {
    controller.current?.cancel();
    setRunning(false);
    setResult(undefined);
    setError('');
    setDocument(current => ({
      ...current,
      settings: { ...current.settings, ...patch }
    }));
    setRevision(value => value + 1);
  }

  async function openDXF(file: File) {
    controller.current?.cancel();
    setRunning(false);
    setError('');
    setResult(undefined);

    try {
      const text = await file.text();
      const review = importDXF(text, file.name, {
        scale: 1,
        tolerance: 0.05,
        enclosed: 'holes'
      });

      if (!review.document.parts.length) {
        throw new Error(review.issues?.[0] || 'DXF içinde kapalı kesim konturu bulunamadı.');
      }
      setWarnings(review.warnings);
      setDocument(current => ({
        ...review.document,
        name: file.name.replace(/\.dxf$/i, ''),
        settings: {
          ...review.document.settings,
          materialWidthMm: current.settings.materialWidthMm,
          materialLengthMm: current.settings.materialLengthMm,
          materialType: current.settings.materialType,
          clearanceMm: current.settings.clearanceMm,
          timeLimitSeconds: current.settings.timeLimitSeconds,
          solverPreset: current.settings.solverPreset,
          startCorner: current.settings.startCorner,
          cutHeadMode: current.settings.cutHeadMode,
          headSpacingMm: current.settings.headSpacingMm
        }
      }));
      setRevision(value => value + 1);
      setStatus(file.name + ' içe aktarıldı.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function nest() {
    controller.current?.cancel();
    setResult(undefined);
    setError('');

    const errors = validateMachineSettings(document.settings);
    if (errors.length) {
      setError(errors[0]);
      return;
    }
    if (!document.parts.length) {
      setError('Önce en az bir parça içe aktar.');
      return;
    }

    const runRevision = revision + 1;
    setRevision(runRevision);
    setRunning(true);
    setStatus('Sparrow başlatılıyor…');

    controller.current = startNesting(document, runRevision, {
      onStatus: setStatus,
      onCandidate: candidate => {
        setResult(candidate);
        setStatus('Geçerli yerleşim bulundu; iyileştiriliyor…');
      },
      onComplete: finalResult => {
        setResult(finalResult);
        setRunning(false);
        setStatus('Nesting tamamlandı.');
      },
      onError: message => {
        setRunning(false);
        setError(message);
        setStatus('Nesting durdu.');
      }
    });
  }

  function stop() {
    controller.current?.cancel();
    controller.current = undefined;
    setRunning(false);
    setStatus('Nesting kullanıcı tarafından durduruldu.');
  }

  function saveDXF() {
    if (!result) return;

    try {
      const noSoftwareOffset = cutHeadMode(document.settings) === 'dual-sync' && headSpacingMm(document.settings) === 0;
      const placements = noSoftwareOffset
        ? result.placements
        : expandSynchronizedPlacements(result.placements, document.settings);
      const world = worldParts(document, { placements });
      const text = exportDXF(document, world, placements, true);
      const suffix = cutHeadMode(document.settings) === 'dual-sync' ? '-cift-kafa' : '-tek-kafa';
      downloadText((document.name || 'serula') + suffix + '.dxf', text);
      setStatus('Üretim DXF’i hazırlandı.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const cycles = document.parts.reduce((sum, part) => sum + part.quantity, 0);
  const mode = cutHeadMode(document.settings);
  const sheetCount = result?.sheetCount ?? 1;

  return <main className="app">
    <header className="topbar">
      <div>
        <strong>Serula Dual Head</strong>
        <span>Sürüm 1 · gerçek Sparrow nesting motoru</span>
      </div>
      <label className="file-button">
        DXF Aç
        <input
          type="file"
          accept=".dxf"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void openDXF(file);
            event.currentTarget.value = '';
          }}
        />
      </label>
    </header>

    <section className="layout">
      <aside className="sidebar">
        <section className="panel">
          <h2>Makine</h2>
          <label>
            <span>Kesim kafası</span>
            <select
              value={mode}
              onChange={event => updateSettings({ cutHeadMode: event.target.value as CutHeadMode })}
            >
              <option value="single">Tek kafa</option>
              <option value="dual-sync">Çift kafa – senkron</option>
            </select>
          </label>

          {mode === 'dual-sync' && <label>
            <span>Kafa X ofseti (mm)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={headSpacingMm(document.settings)}
              onChange={event => updateSettings({ headSpacingMm: Number(event.target.value) })}
            />
          </label>}

          {mode === 'dual-sync' && <div className="info-card">
            <b>Aktif nesting şeridi</b>
            <strong>{laneWidth.toFixed(1)} mm</strong>
            <small>{headSpacingMm(document.settings) === 0 ? 'Kafa 2 aynı hareketi ek X ofset olmadan tekrarlar.' : <>Kafa 2, aynı hareketi +{headSpacingMm(document.settings)} mm X ofset ile tekrarlar.</>}</small>
          </div>}
        </section>

        <section className="panel">
          <h2>Malzeme</h2>
          <label>
            <span>Tip</span>
            <select
              value={document.settings.materialType ?? 'roll'}
              onChange={event => updateSettings({ materialType: event.target.value as 'roll' | 'sheet' })}
            >
              <option value="roll">Rulo</option>
              <option value="sheet">Plaka</option>
            </select>
          </label>

          <label>
            <span>Genişlik (mm)</span>
            <input
              type="number"
              min="1"
              value={document.settings.materialWidthMm}
              onChange={event => updateSettings({ materialWidthMm: Number(event.target.value) })}
            />
          </label>

          {document.settings.materialType === 'sheet' && <label>
            <span>Plaka uzunluğu (mm)</span>
            <input
              type="number"
              min="1"
              value={document.settings.materialLengthMm ?? 700}
              onChange={event => updateSettings({ materialLengthMm: Number(event.target.value) })}
            />
          </label>}

          <label>
            <span>Parça aralığı (mm)</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={document.settings.clearanceMm}
              onChange={event => updateSettings({ clearanceMm: Math.max(0, Number(event.target.value)) })}
            />
          </label>

          <label>
            <span>Süre</span>
            <select
              value={String(document.settings.timeLimitSeconds ?? 30)}
              onChange={event => updateSettings({ timeLimitSeconds: Number(event.target.value) as 10 | 30 | 60 | 120 | 300 | 600 })}
            >
              <option value="10">10 sn</option>
              <option value="30">30 sn</option>
              <option value="60">60 sn</option>
              <option value="120">120 sn</option>
              <option value="300">300 sn</option>
              <option value="600">600 sn</option>
            </select>
          </label>
        </section>

        <section className="panel">
          <h2>İş</h2>
          <div className="metrics">
            <div><span>Parça tipi</span><b>{document.parts.length}</b></div>
            <div><span>Kesim hareketi</span><b>{cycles}</b></div>
            <div><span>Fiziksel çıktı</span><b>{physicalCopyCount(document)}</b></div>
            {result && <div><span>Plaka</span><b>{sheetCount}</b></div>}
          </div>

          <div className="actions">
            {!running
              ? <button className="primary" onClick={nest} disabled={machineErrors.length > 0}>Nest</button>
              : <button className="danger" onClick={stop}>Durdur</button>}
            <button onClick={saveDXF} disabled={!result}>DXF İndir</button>
          </div>

          <div className={error || machineErrors.length ? 'status bad' : result ? 'status good' : 'status'}>
            {error || machineErrors[0] || status}
          </div>

          {warnings.length > 0 && <ul className="warnings">
            {warnings.slice(0, 6).map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>}
        </section>
      </aside>

      <section className="workspace">
        <div className="workspace-head">
          <div>
            <strong>{document.name || 'Adsız iş'}</strong>
            <small>
              {mode === 'dual-sync'
                ? 'Senkron çift kafa · Kafa 2 = Kafa 1 + ' + headSpacingMm(document.settings) + ' mm'
                : 'Tek kafa'}
            </small>
          </div>
          <span>
            {document.settings.materialWidthMm} mm
            {document.settings.materialType === 'sheet' ? ' × ' + (document.settings.materialLengthMm ?? 700) + ' mm' : ''}
          </span>
        </div>

        <div className="canvas-shell">
          <svg
            viewBox={'0 0 ' + previewSize.width + ' ' + previewSize.height}
            aria-label="Nesting önizlemesi"
          >
            {document.settings.materialType === 'sheet'
              ? Array.from({ length: sheetCount }, (_, index) => {
                  const x = index * (document.settings.materialWidthMm + 50);
                  return <g key={index}>
                    <rect
                      x={x}
                      y="0"
                      width={document.settings.materialWidthMm}
                      height={document.settings.materialLengthMm ?? 700}
                      className="material"
                    />
                    <text className="sheet-label" x={x + 16} y={28}>Plaka {index + 1}</text>
                  </g>;
                })
              : <rect
                  x="0"
                  y="0"
                  width={document.settings.materialWidthMm}
                  height={previewSize.height}
                  className="material"
                />}

            {previewWorld.map((part, index) => {
              const placement = previewPlacements[index];
              const points = part.outer
                .map(([x, y]) => x + ',' + (previewSize.height - y))
                .join(' ');
              const head = result ? (physicalPlacements[index]?.headIndex ?? 0) : 0;
              return <polygon
                key={index}
                points={points}
                className={head === 0 ? 'part head1' : 'part head2'}
                data-part={placement?.partId}
              />;
            })}
          </svg>
        </div>

        <div className="legend">
          <span><i className="dot one" />Kafa 1</span>
          {mode === 'dual-sync' && <span><i className="dot two" />Kafa 2</span>}
          {result && <span>Kullanılan uzunluk: {result.usedLengthMm.toFixed(1)} mm</span>}
        </div>

        {!result && !previewWorld.length && <div className="empty-state">
          <strong>Üretim akışı hazır</strong>
          <p>DXF dosyasını aç, makine modunu seç ve Nest düğmesine bas.</p>
        </div>}
        {!result && previewWorld.length > 0 && <div className="empty-state">
          <strong>DXF açıldı</strong>
          <p>{document.parts.length} parça içe aktarıldı. Şimdi makine ayarlarını kontrol edip Nest düğmesine bas.</p>
        </div>}
      </section>
    </section>
  </main>;
}
