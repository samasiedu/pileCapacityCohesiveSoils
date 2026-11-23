import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Area, AreaChart, ComposedChart } from "recharts";

// ─── THEME ───────────────────────────────────────────────────────────────────
const T = {
  bg: "#0a0c10",
  panel: "#0f1218",
  border: "#1e2535",
  borderGlow: "#2a3a5a",
  accent: "#4a9eff",
  accentDim: "#1a3a6a",
  gold: "#e8b84a",
  goldDim: "#5a4510",
  green: "#3ecf8e",
  greenDim: "#0a3020",
  red: "#ff6b6b",
  soil1: "#8B6914",
  soil2: "#5a4020",
  soil3: "#3a2a10",
  water: "#1a6aaa",
  text: "#c8d8f0",
  textDim: "#5a6a8a",
  textMid: "#8a9ab8",
};

// ─── SOIL LAYER DEFAULTS ─────────────────────────────────────────────────────
const defaultLayers = [
  { id: 1, thickness: 10, qu: 40, gamma: 18, gammaSat: 20, alpha: 0.75, label: "Stiff Clay" },
  { id: 2, thickness: 12, qu: 28, gamma: 17, gammaSat: 19, alpha: 0.70, label: "Medium Clay" },
  { id: 3, thickness: 8,  qu: 50, gamma: 19, gammaSat: 21, alpha: 0.65, label: "Dense Clay" },
];

// ─── UTILITY ─────────────────────────────────────────────────────────────────
const fmt = (v, d = 2) => (typeof v === "number" && isFinite(v)) ? v.toFixed(d) : "—";

// ─── COMPUTE ENGINE ──────────────────────────────────────────────────────────
function computePile({ layers, diameter: B, gammaConcrete, fs, waterTable, pileMode, groupN, groupM, groupS }) {
  const Ab = Math.PI * B * B / 4;
  const C = Math.PI * B;
  const totalLength = layers.reduce((s, l) => s + l.thickness, 0);

  // Build depth profile for charts
  const profile = [];
  let depth = 0;
  let sigmaV = 0;
  let V = 0;

  // Per-layer shaft calculations
  const layerResults = [];
  let shaftTotal = 0;

  for (const layer of layers) {
    const isSubmerged = depth + layer.thickness > waterTable;
    const partialSubmerged = depth < waterTable && depth + layer.thickness > waterTable;

    // Effective unit weight
    const gamma_eff_top = depth >= waterTable ? (layer.gammaSat - 9.81) : layer.gamma;
    const gamma_eff_bot = (depth + layer.thickness) >= waterTable ? (layer.gammaSat - 9.81) : layer.gamma;
    const gamma_eff_avg = (gamma_eff_top + gamma_eff_bot) / 2;

    const cu = layer.qu / 2;
    const ca = layer.alpha * cu;
    const Psi = C * ca * layer.thickness;
    shaftTotal += Psi;

    layerResults.push({
      label: layer.label,
      depth_top: depth,
      depth_bot: depth + layer.thickness,
      cu,
      ca,
      Psi,
      gamma_eff: gamma_eff_avg,
    });

    // Profile points every 1m
    for (let dz = 0; dz <= layer.thickness; dz += 1) {
      const d = depth + dz;
      const aboveWT = Math.min(d, waterTable);
      const belowWT = Math.max(0, d - waterTable);
      const sv = aboveWT * layer.gamma + belowWT * (layer.gammaSat - 9.81);
      profile.push({
        depth: d,
        cu: layer.qu / 2,
        ca: layer.alpha * layer.qu / 2,
        sigmaV: sv,
        layer: layer.label,
      });
    }

    depth += layer.thickness;
    V += Ab * layer.thickness;
  }

  // Base conditions (last layer)
  const lastLayer = layers[layers.length - 1];
  const cu_base = lastLayer.qu / 2;
  const aboveWT_base = Math.min(totalLength, waterTable);
  const belowWT_base = Math.max(0, totalLength - waterTable);
  let sigmaV_base = 0;
  let d2 = 0;
  for (const l of layers) {
    const ab = Math.min(d2 + l.thickness, waterTable) - Math.min(d2, waterTable);
    const bl = Math.max(0, (d2 + l.thickness) - waterTable) - Math.max(0, d2 - waterTable);
    sigmaV_base += ab * l.gamma + bl * (l.gammaSat - 9.81);
    d2 += l.thickness;
  }

  const Pbu = Ab * (cu_base * 9.0 + sigmaV_base * 1.0);
  const Psu = shaftTotal;
  const W = gammaConcrete * V;
  const Pu = Pbu + Psu - W;
  const Pa = Pu / fs;

  // Cumulative shaft chart
  const shaftCumulative = [];
  let cumShaft = 0;
  let depthCum = 0;
  for (const lr of layerResults) {
    shaftCumulative.push({ depth: depthCum, shaft: cumShaft });
    cumShaft += lr.Psi;
    shaftCumulative.push({ depth: lr.depth_bot, shaft: cumShaft });
    depthCum = lr.depth_bot;
  }

  // Sensitivity: vary length from 5m to max
  const sensitivity = [];
  for (let L = 5; L <= totalLength; L += 1) {
    let shaftS = 0, layerDepth = 0, vol = 0;
    for (const lay of layers) {
      const rem = Math.max(0, Math.min(lay.thickness, L - layerDepth));
      if (rem <= 0) break;
      shaftS += C * (lay.alpha * lay.qu / 2) * rem;
      vol += Ab * rem;
      layerDepth += lay.thickness;
    }
    const lastLay = layers[Math.min(layers.length - 1, layers.findIndex((_, i) => {
      let d = 0; for (let j = 0; j <= i; j++) d += layers[j].thickness; return d >= L;
    }))];
    const cu_b = lastLay.qu / 2;
    let sv_b = 0, dd = 0;
    for (const la of layers) {
      const seg = Math.min(la.thickness, Math.max(0, L - dd));
      if (seg <= 0) break;
      const ab2 = Math.min(dd + seg, waterTable) - Math.min(dd, waterTable);
      const bl2 = Math.max(0, (dd + seg) - waterTable) - Math.max(0, dd - waterTable);
      sv_b += ab2 * la.gamma + bl2 * (la.gammaSat - 9.81);
      dd += la.thickness;
    }
    const Pbu_s = Ab * (cu_b * 9.0 + sv_b);
    const W_s = gammaConcrete * vol;
    const Pu_s = Pbu_s + shaftS - W_s;
    sensitivity.push({ length: L, Pu: +Pu_s.toFixed(2), Pa: +(Pu_s / fs).toFixed(2), Psu: +shaftS.toFixed(2), Pbu: +Pbu_s.toFixed(2) });
  }

  // Group
  let groupResult = null;
  if (pileMode === "group") {
    const theta = Math.atan(B / groupS) * (180 / Math.PI);
    const eta = 1 - (theta / 90) * ((groupN * (groupM - 1) + groupM * (groupN - 1)) / (groupN * groupM));
    const Pg = eta * groupN * groupM * Pu;
    const Pga = Pg / fs;
    groupResult = { theta, eta, Pg, Pga, count: groupN * groupM };
  }

  return { Pbu, Psu, W, Pu, Pa, Ab, C, cu_base, layerResults, profile, shaftCumulative, sensitivity, totalLength, groupResult, sigmaV_base };
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────
function Toggle({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", background: "#080a0e", borderRadius: "4px", border: `1px solid ${T.border}`, overflow: "hidden" }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          flex: 1, padding: "7px 14px", border: "none", cursor: "pointer", fontSize: "11px",
          letterSpacing: "1.5px", textTransform: "uppercase", fontFamily: "'Courier New', monospace",
          background: value === o.value ? T.accentDim : "transparent",
          color: value === o.value ? T.accent : T.textDim,
          borderRight: `1px solid ${T.border}`, transition: "all 0.2s",
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function NumField({ label, symbol, unit, value, onChange, min = 0, step = 0.1, small }) {
  return (
    <div style={{ marginBottom: small ? "8px" : "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "11px", color: T.textMid }}>{label}</span>
        <span style={{ fontSize: "10px", color: T.textDim, fontFamily: "monospace" }}>{symbol}</span>
      </div>
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <input type="number" value={value} min={min} step={step}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          style={{
            flex: 1, background: "#080a0e", border: `1px solid ${T.border}`, borderRadius: "3px",
            padding: "7px 10px", color: T.text, fontFamily: "'Courier New', monospace",
            fontSize: "12px", outline: "none",
          }} />
        {unit && <span style={{ fontSize: "10px", color: T.textDim, minWidth: "38px" }}>{unit}</span>}
      </div>
    </div>
  );
}

function SoilColumn({ layers, waterTable, pileLength, diameter }) {
  const totalH = layers.reduce((s, l) => s + l.thickness, 0);
  const scale = 260 / totalH;
  const pileW = Math.max(8, diameter * 60);
  const colors = ["#6b4c1a", "#4a3318", "#2e2010", "#1e1808", "#3a2a0e"];

  return (
    <svg width="100%" viewBox="0 0 200 300" style={{ display: "block" }}>
      {/* Soil layers */}
      {layers.map((l, i) => {
        const y = l.thickness > 0 ? layers.slice(0, i).reduce((s, x) => s + x.thickness, 0) * scale + 10 : 0;
        const h = l.thickness * scale;
        return (
          <g key={l.id}>
            <rect x={20} y={y} width={160} height={h} fill={colors[i % colors.length]} opacity={0.85} />
            <rect x={20} y={y} width={160} height={1} fill="rgba(255,255,255,0.08)" />
            {/* Hatch lines */}
            {Array.from({ length: Math.floor(h / 8) }).map((_, j) => (
              <line key={j} x1={20} y1={y + j * 8 + 4} x2={180} y2={y + j * 8 + 4}
                stroke="rgba(0,0,0,0.25)" strokeWidth={0.5} />
            ))}
            <text x={100} y={y + h / 2 + 4} textAnchor="middle" fill="rgba(255,255,255,0.5)"
              fontSize="8" fontFamily="monospace">{l.label}</text>
          </g>
        );
      })}

      {/* Water table */}
      {waterTable < totalH && (
        <g>
          <line x1={15} x2={185} y1={waterTable * scale + 10} y2={waterTable * scale + 10}
            stroke={T.water} strokeWidth={1.5} strokeDasharray="6,3" />
          <text x={16} y={waterTable * scale + 8} fill={T.water} fontSize="7" fontFamily="monospace">WT</text>
          {/* Water fill */}
          <rect x={20} y={waterTable * scale + 10} width={160} height={(totalH - waterTable) * scale}
            fill={T.water} opacity={0.08} />
        </g>
      )}

      {/* Pile */}
      <rect x={100 - pileW / 2} y={5} width={pileW} height={pileLength * scale}
        fill="#2a3a5a" stroke={T.accent} strokeWidth={1} opacity={0.9} />
      {/* Pile tip */}
      <polygon
        points={`${100 - pileW / 2},${pileLength * scale + 5} ${100 + pileW / 2},${pileLength * scale + 5} ${100},${pileLength * scale + 5 + pileW / 2}`}
        fill={T.accent} opacity={0.8} />

      {/* Load arrow */}
      <line x1={100} y1={0} x2={100} y2={8} stroke={T.gold} strokeWidth={2} />
      <polygon points={`95,8 105,8 100,14`} fill={T.gold} />
      <text x={112} y={8} fill={T.gold} fontSize="7" fontFamily="monospace">Pu</text>

      {/* Depth label */}
      <text x={185} y={pileLength * scale + 10} textAnchor="end" fill={T.textDim} fontSize="7" fontFamily="monospace">
        {pileLength}m
      </text>
    </svg>
  );
}

function ResultBadge({ label, value, unit, color = T.accent }) {
  return (
    <div style={{
      background: "#080a0e", border: `1px solid ${color}33`,
      borderRadius: "4px", padding: "12px 16px", textAlign: "center",
    }}>
      <div style={{ fontSize: "10px", color: T.textDim, letterSpacing: "2px", textTransform: "uppercase", fontFamily: "monospace", marginBottom: "6px" }}>{label}</div>
      <div style={{ fontSize: "22px", color, fontFamily: "'Courier New', monospace", fontWeight: "bold" }}>{fmt(value)}</div>
      <div style={{ fontSize: "11px", color: T.textDim, marginTop: "2px" }}>{unit}</div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f1218", border: `1px solid ${T.border}`, borderRadius: "4px", padding: "10px 14px" }}>
      <div style={{ fontSize: "11px", color: T.textDim, marginBottom: "6px", fontFamily: "monospace" }}>Depth: {label}m</div>
      {payload.map(p => (
        <div key={p.name} style={{ fontSize: "12px", color: p.color, fontFamily: "monospace" }}>
          {p.name}: {fmt(p.value)} {p.unit || ""}
        </div>
      ))}
    </div>
  );
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function PileApp() {
  const [layers, setLayers] = useState(defaultLayers);
  const [diameter, setDiameter] = useState(0.3);
  const [gammaConcrete, setGammaConcrete] = useState(23.5);
  const [fs, setFs] = useState(2);
  const [waterTable, setWaterTable] = useState(8);
  const [pileMode, setPileMode] = useState("single");
  const [groupN, setGroupN] = useState(3);
  const [groupM, setGroupM] = useState(3);
  const [groupS, setGroupS] = useState(0.9);
  const [chartTab, setChartTab] = useState("profile");
  const [results, setResults] = useState(null);
  const [showWT, setShowWT] = useState(true);

  const totalLength = layers.reduce((s, l) => s + l.thickness, 0);

  useEffect(() => {
    const r = computePile({ layers, diameter, gammaConcrete, fs, waterTable: showWT ? waterTable : 99999, pileMode, groupN, groupM, groupS });
    setResults(r);
  }, [layers, diameter, gammaConcrete, fs, waterTable, showWT, pileMode, groupN, groupM, groupS]);

  const addLayer = () => setLayers(prev => [...prev, { id: Date.now(), thickness: 5, qu: 30, gamma: 18, gammaSat: 20, alpha: 0.70, label: `Layer ${prev.length + 1}` }]);
  const removeLayer = (id) => setLayers(prev => prev.length > 1 ? prev.filter(l => l.id !== id) : prev);
  const updateLayer = (id, key, val) => setLayers(prev => prev.map(l => l.id === id ? { ...l, [key]: val } : l));

  const chartOptions = [
    { value: "profile", label: "Soil Profile" },
    { value: "shaft", label: "Shaft Friction" },
    { value: "sensitivity", label: "Capacity vs Length" },
    { value: "breakdown", label: "Breakdown" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "'Georgia', serif" }}>
      {/* Header */}
      <div style={{ background: T.panel, borderBottom: `1px solid ${T.border}`, padding: "18px 28px" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "4px", color: T.accent, textTransform: "uppercase", marginBottom: "3px" }}>
              Static Limit States · Cohesive Soil
            </div>
            <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "normal", letterSpacing: "0.5px", color: "#d8e8ff" }}>
              Pile Foundation Capacity Analyzer
            </h1>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <Toggle options={[{ value: "single", label: "Single" }, { value: "group", label: "Group" }]} value={pileMode} onChange={setPileMode} />
            <button onClick={() => setShowWT(v => !v)} style={{
              padding: "7px 14px", border: `1px solid ${showWT ? T.water : T.border}`,
              background: showWT ? "rgba(26,106,170,0.2)" : "transparent",
              color: showWT ? "#6ab4ff" : T.textDim, borderRadius: "4px", cursor: "pointer",
              fontSize: "11px", letterSpacing: "1.5px", fontFamily: "monospace", textTransform: "uppercase",
            }}>💧 Water Table {showWT ? "ON" : "OFF"}</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "20px 28px", display: "grid", gridTemplateColumns: "320px 1fr", gap: "18px" }}>

        {/* ── LEFT PANEL ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* Pile geometry */}
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "3px", color: T.accent, textTransform: "uppercase", marginBottom: "12px" }}>Pile Parameters</div>
            <NumField label="Diameter" symbol="B" unit="m" value={diameter} onChange={setDiameter} step={0.05} min={0.1} />
            <NumField label="Concrete Unit Weight" symbol="γ_c" unit="kN/m³" value={gammaConcrete} onChange={setGammaConcrete} step={0.5} />
            <NumField label="Factor of Safety" symbol="FS" unit="" value={fs} onChange={setFs} step={0.5} min={1} />
          </div>

          {/* Water table */}
          {showWT && (
            <div style={{ background: T.panel, border: `1px solid rgba(26,106,170,0.4)`, borderRadius: "6px", padding: "16px" }}>
              <div style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "3px", color: "#6ab4ff", textTransform: "uppercase", marginBottom: "12px" }}>Water Table</div>
              <NumField label="Depth to Water Table" symbol="d_wt" unit="m" value={waterTable} onChange={setWaterTable} step={0.5} min={0} />
              <div style={{ fontSize: "10px", color: T.textDim, marginTop: "-4px" }}>
                Soil below WT uses γ' = γ_sat − γ_w (9.81 kN/m³)
              </div>
            </div>
          )}

          {/* Group config */}
          {pileMode === "group" && (
            <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "16px" }}>
              <div style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "3px", color: T.gold, textTransform: "uppercase", marginBottom: "12px" }}>Group Configuration</div>
              <NumField label="Piles per row (n)" symbol="n" unit="" value={groupN} onChange={setGroupN} step={1} min={1} small />
              <NumField label="Piles per column (m)" symbol="m" unit="" value={groupM} onChange={setGroupM} step={1} min={1} small />
              <NumField label="Pile Spacing" symbol="s" unit="m" value={groupS} onChange={setGroupS} step={0.1} min={0.3} small />
            </div>
          )}

          {/* Soil Layers */}
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "3px", color: T.green, textTransform: "uppercase" }}>Soil Layers</div>
              <button onClick={addLayer} style={{
                padding: "4px 10px", background: T.greenDim, border: `1px solid ${T.green}44`,
                color: T.green, borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "monospace"
              }}>+ Add Layer</button>
            </div>

            {layers.map((l, i) => (
              <div key={l.id} style={{
                background: "#080a0e", border: `1px solid ${T.border}`, borderRadius: "4px",
                padding: "12px", marginBottom: "10px", position: "relative"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <input value={l.label} onChange={e => updateLayer(l.id, "label", e.target.value)}
                    style={{ background: "transparent", border: "none", color: T.gold, fontSize: "12px", fontFamily: "monospace", width: "130px", outline: "none" }} />
                  {layers.length > 1 && (
                    <button onClick={() => removeLayer(l.id)} style={{
                      background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: "14px", padding: "0 4px"
                    }}>×</button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  {[
                    { label: "Thick.", symbol: "h (m)", key: "thickness", step: 1, min: 0.5 },
                    { label: "qu", symbol: "kN/m²", key: "qu", step: 5, min: 1 },
                    { label: "γ", symbol: "kN/m³", key: "gamma", step: 0.5 },
                    { label: "γsat", symbol: "kN/m³", key: "gammaSat", step: 0.5 },
                    { label: "α", symbol: "–", key: "alpha", step: 0.05, min: 0.1 },
                  ].map(f => (
                    <div key={f.key}>
                      <div style={{ fontSize: "9px", color: T.textDim, fontFamily: "monospace", marginBottom: "2px" }}>{f.label} ({f.symbol})</div>
                      <input type="number" value={l[f.key]} min={f.min || 0} step={f.step}
                        onChange={e => updateLayer(l.id, f.key, parseFloat(e.target.value) || 0)}
                        style={{
                          width: "100%", background: T.panel, border: `1px solid ${T.border}`, borderRadius: "3px",
                          padding: "5px 7px", color: T.text, fontFamily: "monospace", fontSize: "11px", outline: "none", boxSizing: "border-box"
                        }} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Soil column diagram */}
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "3px", color: T.textDim, textTransform: "uppercase", marginBottom: "10px" }}>Pile Profile Diagram</div>
            <SoilColumn layers={layers} waterTable={showWT ? waterTable : 99999} pileLength={totalLength} diameter={diameter} />
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* Key results row */}
          {results && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
              <ResultBadge label="Shaft Resistance" value={results.Psu} unit="kN" color={T.green} />
              <ResultBadge label="Base Resistance" value={results.Pbu} unit="kN" color={T.accent} />
              <ResultBadge label="Ultimate Capacity" value={results.Pu} unit="kN" color={T.gold} />
              <ResultBadge label={pileMode === "group" ? "Group Allow. Load" : "Allowable Load"} value={pileMode === "group" ? results.groupResult?.Pga : results.Pa} unit="kN" color={T.red} />
            </div>
          )}

          {/* Group result extra */}
          {pileMode === "group" && results?.groupResult && (
            <div style={{ background: T.panel, border: `1px solid ${T.goldDim}`, borderRadius: "6px", padding: "14px 18px", display: "flex", gap: "24px", flexWrap: "wrap" }}>
              <div><span style={{ fontSize: "10px", color: T.textDim, fontFamily: "monospace" }}>Piles: </span><span style={{ color: T.gold, fontFamily: "monospace" }}>{results.groupResult.count}</span></div>
              <div><span style={{ fontSize: "10px", color: T.textDim, fontFamily: "monospace" }}>θ: </span><span style={{ color: T.gold, fontFamily: "monospace" }}>{fmt(results.groupResult.theta)}°</span></div>
              <div><span style={{ fontSize: "10px", color: T.textDim, fontFamily: "monospace" }}>η (efficiency): </span><span style={{ color: T.gold, fontFamily: "monospace" }}>{fmt(results.groupResult.eta, 3)}</span></div>
              <div><span style={{ fontSize: "10px", color: T.textDim, fontFamily: "monospace" }}>P_g (ultimate): </span><span style={{ color: T.gold, fontFamily: "monospace" }}>{fmt(results.groupResult.Pg)} kN</span></div>
              <div><span style={{ fontSize: "10px", color: T.gold, fontFamily: "monospace" }}>P_ga (allowable): </span><span style={{ color: T.gold, fontFamily: "monospace", fontWeight: "bold" }}>{fmt(results.groupResult.Pga)} kN</span></div>
            </div>
          )}

          {/* Layer table */}
          {results && (
            <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "16px" }}>
              <div style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "3px", color: T.textDim, textTransform: "uppercase", marginBottom: "12px" }}>Layer-by-Layer Results</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ color: T.textDim, fontSize: "10px" }}>
                      {["Layer", "Depth (m)", "cᵤ (kN/m²)", "cₐ (kN/m²)", "α", "Psi (kN)"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${T.border}`, fontWeight: "normal", letterSpacing: "1px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.layerResults.map((lr, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${T.border}22` }}>
                        <td style={{ padding: "8px 10px", color: T.gold }}>{lr.label}</td>
                        <td style={{ padding: "8px 10px", color: T.text }}>{fmt(lr.depth_top)} – {fmt(lr.depth_bot)}</td>
                        <td style={{ padding: "8px 10px", color: T.green }}>{fmt(lr.cu)}</td>
                        <td style={{ padding: "8px 10px", color: T.accent }}>{fmt(lr.ca)}</td>
                        <td style={{ padding: "8px 10px", color: T.textMid }}>{layers[i]?.alpha}</td>
                        <td style={{ padding: "8px 10px", color: T.text, fontWeight: "bold" }}>{fmt(lr.Psi)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: `1px solid ${T.border}` }}>
                      <td colSpan={5} style={{ padding: "8px 10px", color: T.textDim, fontSize: "10px" }}>Total Shaft Resistance</td>
                      <td style={{ padding: "8px 10px", color: T.green, fontWeight: "bold" }}>{fmt(results.Psu)} kN</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Charts */}
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "3px", color: T.textDim, textTransform: "uppercase" }}>Charts</div>
              <Toggle options={chartOptions} value={chartTab} onChange={setChartTab} />
            </div>

            {results && chartTab === "profile" && (
              <div>
                <div style={{ fontSize: "11px", color: T.textDim, marginBottom: "10px", fontFamily: "monospace" }}>Undrained shear strength & effective vertical stress vs. depth</div>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={results.profile} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2030" />
                    <XAxis type="number" stroke={T.textDim} tick={{ fontSize: 10, fontFamily: "monospace", fill: T.textDim }} />
                    <YAxis type="number" dataKey="depth" reversed stroke={T.textDim} tick={{ fontSize: 10, fontFamily: "monospace", fill: T.textDim }} label={{ value: "Depth (m)", angle: -90, position: "insideLeft", fill: T.textDim, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "11px", fontFamily: "monospace", color: T.textMid }} />
                    {showWT && <ReferenceLine x={0} label={{ value: `WT @ ${waterTable}m`, fill: T.water, fontSize: 9 }} stroke="transparent" />}
                    <Area type="stepAfter" dataKey="cu" name="cᵤ (kN/m²)" stroke={T.green} fill={T.green} fillOpacity={0.12} dot={false} />
                    <Line type="stepAfter" dataKey="sigmaV" name="σᵥ (kN/m²)" stroke={T.accent} dot={false} strokeDasharray="4 2" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {results && chartTab === "shaft" && (
              <div>
                <div style={{ fontSize: "11px", color: T.textDim, marginBottom: "10px", fontFamily: "monospace" }}>Cumulative shaft friction with depth</div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={results.shaftCumulative} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2030" />
                    <XAxis type="number" stroke={T.textDim} tick={{ fontSize: 10, fontFamily: "monospace", fill: T.textDim }} label={{ value: "Cumulative Psu (kN)", position: "insideBottom", fill: T.textDim, fontSize: 10, offset: -5 }} />
                    <YAxis type="number" dataKey="depth" reversed stroke={T.textDim} tick={{ fontSize: 10, fontFamily: "monospace", fill: T.textDim }} label={{ value: "Depth (m)", angle: -90, position: "insideLeft", fill: T.textDim, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="shaft" name="Cumul. Psu (kN)" stroke={T.green} fill={T.green} fillOpacity={0.15} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {results && chartTab === "sensitivity" && (
              <div>
                <div style={{ fontSize: "11px", color: T.textDim, marginBottom: "10px", fontFamily: "monospace" }}>How pile capacity changes with embedment depth</div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={results.sensitivity} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2030" />
                    <XAxis dataKey="length" stroke={T.textDim} tick={{ fontSize: 10, fontFamily: "monospace", fill: T.textDim }} label={{ value: "Pile Length (m)", position: "insideBottom", fill: T.textDim, fontSize: 10, offset: -5 }} />
                    <YAxis stroke={T.textDim} tick={{ fontSize: 10, fontFamily: "monospace", fill: T.textDim }} label={{ value: "Capacity (kN)", angle: -90, position: "insideLeft", fill: T.textDim, fontSize: 10 }} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div style={{ background: "#0f1218", border: `1px solid ${T.border}`, borderRadius: "4px", padding: "10px 14px" }}>
                          <div style={{ fontSize: "11px", color: T.textDim, marginBottom: "6px", fontFamily: "monospace" }}>Length: {label}m</div>
                          {payload.map(p => <div key={p.name} style={{ fontSize: "12px", color: p.color, fontFamily: "monospace" }}>{p.name}: {fmt(p.value)} kN</div>)}
                        </div>
                      );
                    }} />
                    <Legend wrapperStyle={{ fontSize: "11px", fontFamily: "monospace", color: T.textMid }} />
                    <Line type="monotone" dataKey="Pu" name="Pu (Ultimate)" stroke={T.gold} dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="Pa" name="Pa (Allowable)" stroke={T.accent} dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="Psu" name="Psu (Shaft)" stroke={T.green} dot={false} strokeDasharray="4 2" />
                    <Line type="monotone" dataKey="Pbu" name="Pbu (Base)" stroke={T.red} dot={false} strokeDasharray="4 2" />
                    <ReferenceLine x={totalLength} stroke={T.gold} strokeDasharray="6 3" label={{ value: "Current L", fill: T.gold, fontSize: 9 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {results && chartTab === "breakdown" && (
              <div>
                <div style={{ fontSize: "11px", color: T.textDim, marginBottom: "10px", fontFamily: "monospace" }}>Resistance contribution by layer and component</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div>
                    <div style={{ fontSize: "10px", color: T.textDim, fontFamily: "monospace", marginBottom: "8px" }}>Shaft Friction per Layer (kN)</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={results.layerResults} layout="vertical" margin={{ left: 50, right: 20, top: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a2030" />
                        <XAxis type="number" stroke={T.textDim} tick={{ fontSize: 10, fontFamily: "monospace", fill: T.textDim }} />
                        <YAxis type="category" dataKey="label" stroke={T.textDim} tick={{ fontSize: 9, fontFamily: "monospace", fill: T.textDim }} width={60} />
                        <Tooltip formatter={v => [`${fmt(v)} kN`, "Psi"]} contentStyle={{ background: "#0f1218", border: `1px solid ${T.border}`, fontSize: "11px", fontFamily: "monospace" }} />
                        <Bar dataKey="Psi" fill={T.green} fillOpacity={0.8} radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", color: T.textDim, fontFamily: "monospace", marginBottom: "8px" }}>Overall Capacity Breakdown (kN)</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={[{ name: "Capacity", Shaft: +results.Psu.toFixed(1), Base: +results.Pbu.toFixed(1), Weight: +(-results.W).toFixed(1) }]} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1a2030" />
                        <XAxis dataKey="name" stroke={T.textDim} tick={{ fontSize: 10, fontFamily: "monospace", fill: T.textDim }} />
                        <YAxis stroke={T.textDim} tick={{ fontSize: 10, fontFamily: "monospace", fill: T.textDim }} />
                        <Tooltip formatter={(v, n) => [`${fmt(v)} kN`, n]} contentStyle={{ background: "#0f1218", border: `1px solid ${T.border}`, fontSize: "11px", fontFamily: "monospace" }} />
                        <Legend wrapperStyle={{ fontSize: "11px", fontFamily: "monospace" }} />
                        <Bar dataKey="Shaft" fill={T.green} fillOpacity={0.85} />
                        <Bar dataKey="Base" fill={T.accent} fillOpacity={0.85} />
                        <Bar dataKey="Weight" fill={T.red} fillOpacity={0.7} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Equation summary */}
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "16px" }}>
            <div style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "3px", color: T.textDim, textTransform: "uppercase", marginBottom: "10px" }}>Governing Equations</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", fontSize: "11px", fontFamily: "monospace", color: T.textMid }}>
              {[
                ["Pᵤ", "Pbu + Psu − W"],
                ["Pbu", "Aᵦ (cᵤNc + σᵥNq)"],
                ["Psu", "∑ C · cₐᵢ · hᵢ"],
                ["cₐ", "α · cᵤ"],
                ["cᵤ", "qᵤ / 2"],
                ["Pa", "Pᵤ / FS"],
              ].map(([sym, eq]) => (
                <div key={sym} style={{ background: "#080a0e", padding: "8px 10px", borderRadius: "3px", border: `1px solid ${T.border}22` }}>
                  <span style={{ color: T.accent }}>{sym}</span><span style={{ color: T.textDim }}> = </span><span>{eq}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "8px", fontSize: "10px", color: T.textDim, fontFamily: "monospace" }}>
              φ = 0 → Nc = 9.0, Nq = 1, Nγ = 0 &nbsp;|&nbsp; Group efficiency: Converse-Labarre &nbsp;|&nbsp; Submerged: γ' = γ_sat − 9.81 kN/m³
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
