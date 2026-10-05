import { useMemo, useState } from 'react';
import { expandSynchronizedHeads, transformRing, validateDualHeadLayout } from './dualHead';
import type { CutHeadMode, DualHeadDocument, Part, Placement } from './model';
import './styles.css';

const samplePart: Part = {
  id: 'sample',
  name: 'Örnek parça',
  outer: [[0, 0], [180, 0], [180, 120], [0, 120]]
};

const initialPlacement: Placement = {
  partId: 'sample',
  copyIndex: 0,
  xMm: 100,
  yMm: 100,
  angleDeg: 0
};

export default function App() {
  const [mode, setMode] = useState<CutHeadMode>('single');
  const [spacing, setSpacing] = useState(500);
  const [materialWidth, setMaterialWidth] = useState(1400);
  const [materialLength, setMaterialLength] = useState(700);
  const [x, setX] = useState(100);
  const [y, setY] = useState(100);
  const [angle, setAngle] = useState(0);

  const document: DualHeadDocument = useMemo(() => ({
    machine: { cutHeadMode: mode, headSpacingMm: spacing },
    material: { widthMm: materialWidth, lengthMm: materialLength },
    parts: [samplePart],
    placements: [{ ...initialPlacement, xMm: x, yMm: y, angleDeg: angle }]
  }), [mode, spacing, materialWidth, materialLength, x, y, angle]);

  const physical = useMemo(
    () => expandSynchronizedHeads(document.placements, document.machine),
    [document]
  );

  const issues = useMemo(() => validateDualHeadLayout(document), [document]);

  const validSize = materialWidth > 0 && materialLength > 0;
  const scale = validSize ? Math.min(900 / materialWidth, 480 / materialLength) : 1;
  const canvasWidth = validSize ? materialWidth * scale : 900;
  const canvasHeight = validSize ? materialLength * scale : 480;

  return <main className="app">
    <header className="topbar">
      <div className="brand">
        <strong>Serula Dual Head</strong>
        <span>Senkron çift kafa nesting prototipi · Sürüm 1</span>
      </div>
    </header>

    <section className="layout">
      <aside className="sidebar">
        <h2>Makine</h2>

        <label>
          <span>Kesim kafası</span>
          <select value={mode} onChange={e => setMode(e.target.value as CutHeadMode)}>
            <option value="single">Tek kafa</option>
            <option value="dual-sync">Çift kafa – senkron</option>
          </select>
        </label>

        {mode === 'dual-sync' && <label>
          <span>Kafa aralığı (mm)</span>
          <input
            type="number"
            min="0.01"
            step="1"
            value={spacing}
            onChange={e => setSpacing(Number(e.target.value))}
          />
        </label>}

        <h2>Malzeme</h2>

        <label>
          <span>Genişlik (mm)</span>
          <input
            type="number"
            min="1"
            value={materialWidth}
            onChange={e => setMaterialWidth(Number(e.target.value))}
          />
        </label>

        <label>
          <span>Uzunluk (mm)</span>
          <input
            type="number"
            min="1"
            value={materialLength}
            onChange={e => setMaterialLength(Number(e.target.value))}
          />
        </label>

        <h2>Test yerleşimi</h2>

        <label>
          <span>X (mm)</span>
          <input type="number" value={x} onChange={e => setX(Number(e.target.value))} />
        </label>

        <label>
          <span>Y (mm)</span>
          <input type="number" value={y} onChange={e => setY(Number(e.target.value))} />
        </label>

        <label>
          <span>Açı (°)</span>
          <input type="number" value={angle} onChange={e => setAngle(Number(e.target.value))} />
        </label>

        <div className={issues.length ? 'status bad' : 'status good'}>
          {issues.length ? issues.length + ' sorun bulundu' : 'Yerleşim geçerli'}
        </div>

        {issues.length > 0 && <ul className="issues">
          {issues.map((issue, index) => <li key={index}>{issue.message}</li>)}
        </ul>}
      </aside>

      <section className="workspace">
        <div className="workspace-head">
          <div>
            <strong>{mode === 'dual-sync' ? 'Çift kafa – senkron' : 'Tek kafa'}</strong>
            <small>
              {mode === 'dual-sync'
                ? 'Kafa 2 = Kafa 1 + ' + spacing + ' mm X ofset'
                : 'Standart tek kafa kesimi'}
            </small>
          </div>
          <span>{materialWidth} × {materialLength} mm</span>
        </div>

        <div className="canvas-shell">
          <svg
            width={canvasWidth}
            height={canvasHeight}
            viewBox={'0 0 ' + Math.max(1, materialWidth) + ' ' + Math.max(1, materialLength)}
            aria-label="Kesim önizlemesi"
          >
            <rect
              x="0"
              y="0"
              width={Math.max(1, materialWidth)}
              height={Math.max(1, materialLength)}
              className="material"
            />

            {validSize && physical.map((placement, index) => {
              const ring = transformRing(samplePart.outer, placement);
              const points = ring
                .map(([px, py]) => px + ',' + (materialLength - py))
                .join(' ');

              return <g key={index}>
                <polygon
                  points={points}
                  className={placement.headIndex === 0 ? 'head head1' : 'head head2'}
                />
                <text
                  x={placement.xMm + 10}
                  y={materialLength - placement.yMm - 15}
                >
                  Kafa {placement.headIndex + 1}
                </text>
              </g>;
            })}
          </svg>
        </div>

        <div className="legend">
          <span><i className="dot one" />Kafa 1</span>
          {mode === 'dual-sync' && <span><i className="dot two" />Kafa 2</span>}
        </div>

        {mode === 'dual-sync' && <div className="rule-card">
          <strong>Senkron çalışma kuralı</strong>
          <p>
            İki kafa aynı parçayı aynı açı ve aynı Y hareketiyle keser.
            İkinci kafa yalnızca X ekseninde kafa aralığı kadar ötelenir.
          </p>
        </div>}
      </section>
    </section>
  </main>;
}
