import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Settings2, Layers, Plus, Trash2, Activity, Info, Link as LinkIcon, CheckCircle2 } from 'lucide-react';

const SPEED_OF_LIGHT = 299792458; // m/s

// --- Transfer Matrix Method Physics Engine ---
function calculateTMM(f_GHz, layers, theta0_deg, polarization) {
  const theta0 = ((parseFloat(theta0_deg) || 0) * Math.PI) / 180;
  const sinTheta0 = Math.sin(theta0);

  let A_TE = 1, B_TE = 0, C_TE = 0, D_TE = 1;
  let A_TM = 1, B_TM = 0, C_TM = 0, D_TM = 1;

  const isLastInfinite = layers.length > 0 && layers[layers.length - 1].isInfinite;
  const activeLayers = isLastInfinite ? layers.slice(0, -1) : layers;
  const exitLayer = isLastInfinite ? layers[layers.length - 1] : null;

  for (let layer of activeLayers) {
    const n = parseFloat(layer.n) || 1;
    const d = (parseFloat(layer.d) || 0) * 1e-3; 
    const cosTheta = Math.sqrt(Math.max(0, 1 - (sinTheta0 * sinTheta0) / (n * n)));

    const delta = ((2 * Math.PI * f_GHz * 1e9) / SPEED_OF_LIGHT) * n * d * cosTheta;
    const cosD = Math.cos(delta);
    const sinD = Math.sin(delta);

    // TE Polarization
    const eta_TE = n * cosTheta;
    const a_te = cosD;
    const b_te = eta_TE !== 0 ? sinD / eta_TE : 0;
    const c_te = eta_TE * sinD;
    const d_te = cosD;

    const newA_TE = A_TE * a_te - B_TE * c_te;
    const newB_TE = A_TE * b_te + B_TE * d_te;
    const newC_TE = C_TE * a_te + D_TE * c_te;
    const newD_TE = -C_TE * b_te + D_TE * d_te;
    A_TE = newA_TE; B_TE = newB_TE; C_TE = newC_TE; D_TE = newD_TE;

    // TM Polarization
    const eta_TM = cosTheta !== 0 ? n / cosTheta : 0;
    const a_tm = cosD;
    const b_tm = eta_TM !== 0 ? sinD / eta_TM : 0;
    const c_tm = eta_TM * sinD;
    const d_tm = cosD;

    const newA_TM = A_TM * a_tm - B_TM * c_tm;
    const newB_TM = A_TM * b_tm + B_TM * d_tm;
    const newC_TM = C_TM * a_tm + D_TM * c_tm;
    const newD_TM = -C_TM * b_tm + D_TM * d_tm;
    A_TM = newA_TM; B_TM = newB_TM; C_TM = newC_TM; D_TM = newD_TM;
  }

  const eta_in_TE = Math.cos(theta0);
  const eta_in_TM = Math.cos(theta0) !== 0 ? 1 / Math.cos(theta0) : 0;

  let eta_out_TE = eta_in_TE;
  let eta_out_TM = eta_in_TM;

  if (exitLayer) {
    const n_out = parseFloat(exitLayer.n) || 1;
    const sin2 = (sinTheta0 * sinTheta0) / (n_out * n_out);
    
    if (sin2 >= 1) return { R: 1, T: 0 }; // TIR
    
    const cosThetaOut = Math.sqrt(1 - sin2);
    eta_out_TE = n_out * cosThetaOut;
    eta_out_TM = cosThetaOut !== 0 ? n_out / cosThetaOut : 0;
  }

  const denTE = Math.pow(eta_in_TE * A_TE + eta_out_TE * D_TE, 2) + Math.pow(eta_in_TE * eta_out_TE * B_TE + C_TE, 2);
  const R_TE = denTE === 0 ? 1 : (Math.pow(eta_in_TE * A_TE - eta_out_TE * D_TE, 2) + Math.pow(eta_in_TE * eta_out_TE * B_TE - C_TE, 2)) / denTE;

  const denTM = Math.pow(eta_in_TM * A_TM + eta_out_TM * D_TM, 2) + Math.pow(eta_in_TM * eta_out_TM * B_TM + C_TM, 2);
  const R_TM = denTM === 0 ? 1 : (Math.pow(eta_in_TM * A_TM - eta_out_TM * D_TM, 2) + Math.pow(eta_in_TM * eta_out_TM * B_TM - C_TM, 2)) / denTM;

  if (polarization === 'TE') return { R: R_TE, T: 1 - R_TE };
  if (polarization === 'TM') return { R: R_TM, T: 1 - R_TM };
  
  const R_avg = (R_TE + R_TM) / 2;
  return { R: R_avg, T: 1 - R_avg };
}

// Stack-profile layer heights: proportional to thickness, but never shorter
// than one line of label text so thin neighboring layers don't overlap
const layerSizeStyle = (d) => ({ flex: `${d} 1 0px`, minHeight: '14px' });

// --- Custom Interactive Chart Component ---
const SimulationChart = ({ data, fMin, fMax, yAxisMode, yMin, yMax, passbands, avgReflection }) => {
  const [hoverInfo, setHoverInfo] = useState(null);
  const svgRef = useRef(null);

  const width = 800;
  const height = 350; 
  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const getSafeVal = (v) => Math.max(v, 1e-6);

  const xScale = (f) => margin.left + ((f - fMin) / (fMax - fMin || 1)) * plotW;
  
  const yScale = (val) => {
    if (yAxisMode === 'log') {
      const lMin = Math.log10(getSafeVal(yMin));
      const lMax = Math.log10(getSafeVal(yMax));
      const lVal = Math.log10(getSafeVal(val));
      return margin.top + (1 - (lVal - lMin) / (lMax - lMin || 1)) * plotH;
    }
    return margin.top + (1 - (val - yMin) / (yMax - yMin || 1)) * plotH;
  };

  const generateTicks = () => {
    if (yAxisMode === 'log') {
      const ticks = [];
      for (let p = Math.floor(Math.log10(getSafeVal(yMin))); p <= Math.ceil(Math.log10(getSafeVal(yMax))); p++) {
        ticks.push(Math.pow(10, p));
      }
      return ticks.filter(t => t >= yMin && t <= yMax);
    }
    const step = (yMax - yMin) / 4;
    return [yMin, yMin + step, yMin + 2*step, yMin + 3*step, yMax];
  };
  const yTicks = generateTicks();

  const formatYTick = (tick) => {
    if (yAxisMode === 'log') {
      const p = Math.round(Math.log10(tick));
      const superscripts = { '0': '⁰', '1': '¹', '-1': '⁻¹', '-2': '⁻²', '-3': '⁻³', '-4': '⁻⁴', '-5': '⁻⁵', '-6': '⁻⁶' };
      return `10${superscripts[p.toString()] || '^'+p}`;
    }
    return tick.toFixed(2);
  };

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const viewX = (x / rect.width) * width;
    const plotX = viewX - margin.left;
    
    if (plotX < 0 || plotX > plotW) {
      setHoverInfo(null);
      return;
    }

    const f = fMin + (plotX / plotW) * (fMax - fMin);
    
    let closest = data[0];
    let minDiff = Infinity;
    for (let pt of data) {
      const diff = Math.abs(pt.f - f);
      if (diff < minDiff) {
        minDiff = diff;
        closest = pt;
      }
    }
    setHoverInfo({ x: xScale(closest.f), pt: closest });
  };

  const pathR = useMemo(() => {
    if (data.length === 0) return '';
    return data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.f)},${yScale(d.R)}`).join(' ');
  }, [data, fMin, fMax, yAxisMode, yMin, yMax]);

  const pathT = useMemo(() => {
    if (data.length === 0) return '';
    return data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.f)},${yScale(d.T)}`).join(' ');
  }, [data, fMin, fMax, yAxisMode, yMin, yMax]);

  // Visible portion of each passband, in SVG x coordinates
  const pbRects = avgReflection === null ? [] : passbands
    .map(pb => ({
      x0: Math.max(margin.left, xScale(pb.min)),
      x1: Math.min(width - margin.right, xScale(pb.max)),
    }))
    .filter(r => r.x1 > r.x0);
  // Label the combined average in the widest visible band
  const labelRect = pbRects.reduce((best, r) => (!best || r.x1 - r.x0 > best.x1 - best.x0 ? r : best), null);

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        className="w-full h-full cursor-crosshair"
        ref={svgRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverInfo(null)}
        style={{ touchAction: 'none' }}
      >
        <defs>
          <clipPath id="plotArea">
            <rect x={margin.left} y={margin.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {pbRects.length > 0 && (
          <g clipPath="url(#plotArea)">
            {pbRects.map((r, i) => (
              <rect key={i} x={r.x0} y={margin.top} width={r.x1 - r.x0} height={plotH} fill="#ef4444" opacity="0.08" />
            ))}
            {(labelRect.x1 - labelRect.x0) > 40 && (
              <text x={(labelRect.x0 + labelRect.x1) / 2} y={margin.top + 16} textAnchor="middle" className="text-[11px] font-bold fill-red-600">
                Avg R: {(avgReflection * 100).toFixed(1)}%
              </text>
            )}
          </g>
        )}

        {/* Grid lines */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} y1={yScale(tick)} x2={width - margin.right} y2={yScale(tick)} stroke="#e2e8f0" strokeDasharray="4 4" />
            <text x={margin.left - 10} y={yScale(tick)} textAnchor="end" alignmentBaseline="middle" className="text-xs fill-slate-500 font-medium">
              {formatYTick(tick)}
            </text>
          </g>
        ))}

        {/* X Axis Labels */}
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((tick) => {
          const f = fMin + tick * (fMax - fMin);
          return (
            <text key={tick} x={xScale(f)} y={height - 10} textAnchor="middle" className="text-xs fill-slate-500 font-medium">
              {f.toFixed(0)} GHz
            </text>
          );
        })}

        <text x={margin.left - 45} y={height / 2} transform={`rotate(-90, ${margin.left - 45}, ${height / 2})`} textAnchor="middle" className="text-xs fill-slate-700 font-semibold tracking-wide">
          Power
        </text>

        {/* Data Paths */}
        <g clipPath="url(#plotArea)">
          <path d={pathT} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" />
          <path d={pathR} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinejoin="round" />
        </g>

        {/* Hover Interaction */}
        {hoverInfo && (
          <g clipPath="url(#plotArea)">
            <line x1={hoverInfo.x} y1={margin.top} x2={hoverInfo.x} y2={height - margin.bottom} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" />
            <circle cx={hoverInfo.x} cy={yScale(hoverInfo.pt.R)} r="4" fill="#ef4444" stroke="white" strokeWidth="1.5" />
            <circle cx={hoverInfo.x} cy={yScale(hoverInfo.pt.T)} r="4" fill="#3b82f6" stroke="white" strokeWidth="1.5" />
            
            <g transform={`translate(${hoverInfo.x < width / 2 ? hoverInfo.x + 15 : hoverInfo.x - 115}, ${margin.top + 10})`}>
              <rect x="0" y="0" width="100" height="65" rx="4" fill="white" stroke="#cbd5e1" opacity="0.95" />
              <text x="8" y="18" className="text-[10px] font-bold fill-slate-700">{hoverInfo.pt.f.toFixed(2)} GHz</text>
              <text x="8" y="36" className="text-[10px] fill-red-500 font-semibold">R: {hoverInfo.pt.R < 1e-6 ? '<10⁻⁶' : hoverInfo.pt.R.toFixed(4)}</text>
              <text x="8" y="54" className="text-[10px] fill-blue-500 font-semibold">T: {hoverInfo.pt.T < 1e-6 ? '<10⁻⁶' : hoverInfo.pt.T.toFixed(4)}</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
};

export default function App() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Global settings
  const [fMin, setFMin] = useState(0);
  const [fMax, setFMax] = useState(300);
  const [angle, setAngle] = useState(0);
  const [polarization, setPolarization] = useState('Unpolarized');
  
  // Y-Axis Controls
  const [yAxisMode, setYAxisMode] = useState('linear');
  const [yMinLinear, setYMinLinear] = useState(0);
  const [yMaxLinear, setYMaxLinear] = useState(1);
  const [yMinLog, setYMinLog] = useState(0.0001);
  const [yMaxLog, setYMaxLog] = useState(1);

  // Passband states
  const [passbandEnabled, setPassbandEnabled] = useState(false);
  const [passbandMin, setPassbandMin] = useState(10);
  const [passbandMax, setPassbandMax] = useState(20);
  const [passband2Enabled, setPassband2Enabled] = useState(false);
  const [passband2Min, setPassband2Min] = useState(30);
  const [passband2Max, setPassband2Max] = useState(40);

  // Layers state
  const [layers, setLayers] = useState([
    { id: 1, label: '', d: 2.5, n: 2.1, isInfinite: false }
  ]);

  // URL State Initialization
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stateParam = params.get('state');
    if (stateParam) {
      try {
        const decoded = JSON.parse(atob(stateParam));
        if (decoded.fMin !== undefined) setFMin(decoded.fMin);
        if (decoded.fMax !== undefined) setFMax(decoded.fMax);
        if (decoded.angle !== undefined) setAngle(decoded.angle);
        if (decoded.polarization) setPolarization(decoded.polarization);
        if (decoded.yAxisMode) setYAxisMode(decoded.yAxisMode);
        if (decoded.yMinLinear !== undefined) setYMinLinear(decoded.yMinLinear);
        if (decoded.yMaxLinear !== undefined) setYMaxLinear(decoded.yMaxLinear);
        if (decoded.yMinLog !== undefined) setYMinLog(decoded.yMinLog);
        if (decoded.yMaxLog !== undefined) setYMaxLog(decoded.yMaxLog);
        if (decoded.layers) setLayers(decoded.layers);
        if (decoded.passbandEnabled !== undefined) setPassbandEnabled(decoded.passbandEnabled);
        if (decoded.passbandMin !== undefined) setPassbandMin(decoded.passbandMin);
        if (decoded.passbandMax !== undefined) setPassbandMax(decoded.passbandMax);
        if (decoded.passband2Enabled !== undefined) setPassband2Enabled(decoded.passband2Enabled);
        if (decoded.passband2Min !== undefined) setPassband2Min(decoded.passband2Min);
        if (decoded.passband2Max !== undefined) setPassband2Max(decoded.passband2Max);
      } catch (e) {
        console.error("Failed to parse URL state");
      }
    }
    setIsLoaded(true);
  }, []);

  const handleShareLink = () => {
    const state = {
      fMin, fMax, angle, polarization, yAxisMode,
      yMinLinear, yMaxLinear, yMinLog, yMaxLog,
      layers, passbandEnabled, passbandMin, passbandMax,
      passband2Enabled, passband2Min, passband2Max
    };
    const encoded = btoa(JSON.stringify(state));
    const url = `${window.location.origin}${window.location.pathname}?state=${encoded}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const activeYMin = yAxisMode === 'log' ? parseFloat(yMinLog) || 0.0001 : parseFloat(yMinLinear) || 0;
  const activeYMax = yAxisMode === 'log' ? parseFloat(yMaxLog) || 1 : parseFloat(yMaxLinear) || 1;

  const chartData = useMemo(() => {
    if (!isLoaded) return [];
    const data = [];
    const points = 500;
    const start = Math.max(0, parseFloat(fMin) || 0);
    const end = Math.max(start + 1, parseFloat(fMax) || 300);

    for (let i = 0; i <= points; i++) {
      const f = start + (i / points) * (end - start);
      const res = calculateTMM(f, layers, angle, polarization);
      data.push({ f, R: res.R, T: res.T });
    }
    return data;
  }, [fMin, fMax, angle, polarization, layers, isLoaded]);

  // Active passbands as numeric [min, max] ranges
  const passbands = useMemo(() => {
    if (!passbandEnabled) return [];
    const toBand = (lo, hi) => {
      const min = Math.max(0, parseFloat(lo) || 0);
      return { min, max: Math.max(min + 0.001, parseFloat(hi) || 1) };
    };
    const bands = [toBand(passbandMin, passbandMax)];
    if (passband2Enabled) bands.push(toBand(passband2Min, passband2Max));
    return bands;
  }, [passbandEnabled, passbandMin, passbandMax, passband2Enabled, passband2Min, passband2Max]);

  // Average R over the union of the passbands, weighted by bandwidth
  // (overlapping bands are merged so no frequency is counted twice)
  const avgReflection = useMemo(() => {
    if (passbands.length === 0) return null;
    const merged = [];
    for (const b of [...passbands].sort((a, b) => a.min - b.min)) {
      const last = merged[merged.length - 1];
      if (last && b.min <= last.max) last.max = Math.max(last.max, b.max);
      else merged.push({ ...b });
    }
    const points = 200;
    let weightedSum = 0;
    let totalWidth = 0;
    for (const { min, max } of merged) {
      let sumR = 0;
      for (let i = 0; i <= points; i++) {
        const f = min + (i / points) * (max - min);
        sumR += calculateTMM(f, layers, angle, polarization).R;
      }
      weightedSum += (sumR / (points + 1)) * (max - min);
      totalWidth += max - min;
    }
    return weightedSum / totalWidth;
  }, [passbands, layers, angle, polarization]);

  const addLayer = () => {
    const newId = layers.length > 0 ? Math.max(...layers.map(l => l.id)) + 1 : 1;
    const cleanLayers = layers.map(l => ({...l, isInfinite: false}));
    setLayers([...cleanLayers, { id: newId, label: '', d: 1.0, n: 1.5, isInfinite: false }]);
  };

  const removeLayer = (id) => setLayers(layers.filter(l => l.id !== id));
  const updateLayer = (id, key, value) => setLayers(layers.map(l => l.id === id ? { ...l, [key]: value } : l));

  if (!isLoaded) return null;

  return (
    <div className="min-h-screen bg-slate-100 p-2 md:p-4 font-sans text-slate-800 flex flex-col items-center">
      <div className="w-full max-w-7xl space-y-4">
        
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-2 gap-4">
          <div className="flex items-center space-x-3">
            <Activity className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900 leading-tight">Microwave Multilayer TMM Simulator - Kovac CMB Group</h1>
          </div>
          <button 
            onClick={handleShareLink}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition-colors shadow-sm"
          >
            {copiedLink ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <LinkIcon className="w-4 h-4" />}
            <span>{copiedLink ? 'Link Copied!' : 'Link this stack'}</span>
          </button>
        </header>

        {/* Top Section: Visualization & Stack Profile */}
        <div className="flex flex-col lg:flex-row gap-4 h-auto lg:h-[400px]">
          
          {/* Left: Main Chart */}
          <div className="flex-1 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col">
            <div className="flex justify-between items-center mb-2 shrink-0">
              <h2 className="text-md font-bold text-slate-800">Transmission & Reflection Spectrum</h2>
              <div className="flex space-x-4 text-xs">
                <div className="flex items-center space-x-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
                  <span className="font-medium text-slate-700">T</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                  <span className="font-medium text-slate-700">R</span>
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-[250px]">
              <SimulationChart 
                data={chartData} 
                fMin={Math.max(0, parseFloat(fMin) || 0)} 
                fMax={Math.max(1, parseFloat(fMax) || 300)} 
                yAxisMode={yAxisMode}
                yMin={activeYMin}
                yMax={activeYMax}
                passbands={passbands}
                avgReflection={avgReflection}
              />
            </div>
          </div>

          {/* Right: Stack Profile */}
          <div className="w-full lg:w-72 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col h-[400px] lg:h-auto shrink-0">
            <div className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wider flex justify-between items-end shrink-0">
              <span>Stack Profile</span>
            </div>
            
            <div className="flex justify-center mb-1 shrink-0 text-yellow-500">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"></line><polyline points="19 15 12 22 5 15"></polyline></svg>
            </div>

            <div className="flex-1 flex flex-row border border-slate-300 shadow-inner rounded overflow-hidden bg-slate-50 min-h-0 relative">
              {/* Colored Layer Blocks */}
              <div className="flex-1 flex flex-col">
                {(() => {
                  const finiteLayers = layers.filter(l => !l.isInfinite);
                  const maxFiniteD = Math.max(...finiteLayers.map(l => parseFloat(l.d) || 0), 0.1);

                  return layers.map((layer, idx) => {
                    const d = layer.isInfinite ? maxFiniteD : (parseFloat(layer.d) || 0);
                    
                    const n = parseFloat(layer.n) || 1;
                    const intensity = Math.min(1, Math.max(0, (n - 1) / 9)); 
                    const lightness = 95 - (intensity * 75);
                    const textColor = lightness < 55 ? 'text-white' : 'text-slate-800';
                    const customLabel = layer.label ? layer.label : `Layer ${idx + 1}`;

                    return (
                      <div 
                        key={layer.id} 
                        style={{ 
                          ...layerSizeStyle(d),
                          backgroundColor: `hsl(215, 60%, ${lightness}%)`,
                          backgroundImage: layer.isInfinite ? 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.1) 5px, rgba(0,0,0,0.1) 10px)' : 'none'
                        }}
                        className="w-full border-b border-slate-900/10 flex items-center justify-center relative group"
                        title={`${customLabel}: ${layer.isInfinite ? '∞' : d + 'mm'}, n=${layer.n}`}
                      >
                        <div className={`text-[10px] font-bold ${textColor} whitespace-nowrap overflow-visible absolute inset-x-0 z-10 text-center px-1`}>
                          {customLabel} (n={layer.n})
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              
              {/* Fixed 8-char Width Thickness Labels */}
              <div className="w-20 flex flex-col border-l border-slate-200 bg-white">
                {(() => {
                  const finiteLayers = layers.filter(l => !l.isInfinite);
                  const maxFiniteD = Math.max(...finiteLayers.map(l => parseFloat(l.d) || 0), 0.1);

                  return layers.map(layer => {
                    const d = layer.isInfinite ? maxFiniteD : (parseFloat(layer.d) || 0);
                    return (
                      <div key={layer.id} style={layerSizeStyle(d)} className="w-full border-b border-slate-200 flex items-center pl-1.5">
                         <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">
                           {layer.isInfinite ? '∞ mm' : `${d} mm`}
                         </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Dielectric Stack Controls */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm w-full">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-slate-600" />
              <h2 className="text-sm font-semibold text-slate-800">Dielectric Stack</h2>
            </div>
            <button onClick={addLayer} className="flex items-center space-x-1 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded transition-colors border border-blue-200">
              <Plus className="w-3 h-3" /><span>Add Layer</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {layers.map((layer, index) => {
              const isLastLayer = index === layers.length - 1;
              return (
                <div key={layer.id} className={`p-3 bg-slate-50 rounded-lg border space-y-3 relative transition-colors ${layer.isInfinite ? 'border-indigo-200' : 'border-slate-200'}`}>
                  <div className="flex justify-between items-center">
                    <input 
                      type="text" 
                      placeholder={`Layer ${index + 1}`}
                      value={layer.label}
                      onChange={e => updateLayer(layer.id, 'label', e.target.value)}
                      className="text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded px-1.5 py-0.5 w-24 focus:outline-none focus:border-blue-500"
                    />
                    <button onClick={() => removeLayer(layer.id)} className="text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  
                  {layer.isInfinite ? (
                    <div className="py-3 text-center text-[11px] font-semibold text-indigo-500 bg-indigo-50/50 rounded border border-indigo-100">∞ Thickness (Exit Medium)</div>
                  ) : (
                    <div>
                      <label className="text-[11px] font-medium text-slate-700 mb-1 block">Thickness $d$ (mm)</label>
                      <div className="flex items-center space-x-2">
                        <input type="range" min="0.1" max="50" step="0.1" value={layer.d} onChange={e => updateLayer(layer.id, 'd', e.target.value)} className="flex-1 accent-slate-600" />
                        <input type="number" min="0.1" step="0.1" value={layer.d} onChange={e => updateLayer(layer.id, 'd', e.target.value)} className="w-16 p-1 text-xs border border-slate-300 rounded text-center" />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] font-medium text-slate-700 mb-1 block">Refractive Index $n$</label>
                    <div className="flex items-center space-x-2">
                      <input type="range" min="1" max="10" step="0.01" value={layer.n} onChange={e => updateLayer(layer.id, 'n', e.target.value)} className="flex-1 accent-slate-600" />
                      <input type="number" min="1" step="0.01" value={layer.n} onChange={e => updateLayer(layer.id, 'n', e.target.value)} className="w-16 p-1 text-xs border border-slate-300 rounded text-center" />
                    </div>
                  </div>

                  {isLastLayer && (
                    <div className="flex items-center space-x-2 pt-2 mt-2 border-t border-slate-200">
                      <input type="checkbox" id="infToggle" checked={layer.isInfinite} onChange={e => updateLayer(layer.id, 'isInfinite', e.target.checked)} className="rounded text-indigo-600 cursor-pointer" />
                      <label htmlFor="infToggle" className="text-[10px] font-bold text-slate-600 uppercase cursor-pointer">Semi-Infinite Substrate</label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Global Settings */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm w-full space-y-4">
          <div className="flex items-center space-x-2 pb-2 border-b border-slate-100">
            <Settings2 className="w-4 h-4 text-slate-600" />
            <h2 className="text-sm font-semibold text-slate-800">Global Parameters</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Frequency Range (GHz)</label>
                <div className="flex space-x-2">
                  <input type="number" value={fMin} onChange={e => setFMin(e.target.value)} className="w-full p-1.5 text-xs border border-slate-300 rounded" />
                  <span className="text-slate-400 text-xs self-center">to</span>
                  <input type="number" value={fMax} onChange={e => setFMax(e.target.value)} className="w-full p-1.5 text-xs border border-slate-300 rounded" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Angle of Incidence (θ)</label>
                <div className="flex space-x-2">
                  <input type="range" min="0" max="89" value={angle} onChange={e => setAngle(e.target.value)} className="flex-1 accent-blue-600" />
                  <input type="number" min="0" max="89" value={angle} onChange={e => setAngle(e.target.value)} className="w-14 p-1 text-xs border border-slate-300 rounded text-center" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Y-Axis Scale Mode</label>
                <select value={yAxisMode} onChange={e => setYAxisMode(e.target.value)} className="w-full p-1.5 text-xs border border-slate-300 rounded bg-white">
                  <option value="linear">Linear</option>
                  <option value="log">Logarithmic</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Y-Axis Bounds</label>
                <div className="flex space-x-2">
                  <input type="number" step={yAxisMode === 'log' ? '0.0001' : '0.1'} value={yAxisMode === 'log' ? yMinLog : yMinLinear} onChange={e => yAxisMode === 'log' ? setYMinLog(e.target.value) : setYMinLinear(e.target.value)} className="w-full p-1.5 text-xs border border-slate-300 rounded" placeholder="Min" />
                  <span className="text-slate-400 text-xs self-center">to</span>
                  <input type="number" step={yAxisMode === 'log' ? '0.1' : '0.1'} value={yAxisMode === 'log' ? yMaxLog : yMaxLinear} onChange={e => yAxisMode === 'log' ? setYMaxLog(e.target.value) : setYMaxLinear(e.target.value)} className="w-full p-1.5 text-xs border border-slate-300 rounded" placeholder="Max" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Polarization</label>
                <select value={polarization} onChange={e => setPolarization(e.target.value)} className="w-full p-1.5 text-xs border border-slate-300 rounded bg-white">
                  <option value="Unpolarized">Unpolarized (Avg)</option>
                  <option value="TE">TE (s-polarized)</option>
                  <option value="TM">TM (p-polarized)</option>
                </select>
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
              <label className="flex items-center space-x-2 cursor-pointer text-xs font-medium text-slate-700 mb-2">
                <input type="checkbox" checked={passbandEnabled} onChange={e => setPassbandEnabled(e.target.checked)} className="rounded text-blue-600" />
                <span>Passband Average Reflection</span>
              </label>
              {passbandEnabled && (
                <div className="flex flex-col gap-2 mt-2">
                  <div className="flex space-x-2">
                    <input type="number" value={passbandMin} onChange={e => setPassbandMin(e.target.value)} className="w-full min-w-0 p-1.5 text-xs border border-slate-300 rounded" />
                    <span className="text-slate-400 text-xs self-center">to</span>
                    <input type="number" value={passbandMax} onChange={e => setPassbandMax(e.target.value)} className="w-full min-w-0 p-1.5 text-xs border border-slate-300 rounded" />
                    <span className="text-slate-500 text-xs self-center">GHz</span>
                  </div>
                  <label className="flex items-center space-x-2 cursor-pointer text-xs text-slate-600">
                    <input type="checkbox" checked={passband2Enabled} onChange={e => setPassband2Enabled(e.target.checked)} className="rounded text-blue-600" />
                    <span>Add second passband</span>
                  </label>
                  {passband2Enabled && (
                    <div className="flex space-x-2">
                      <input type="number" value={passband2Min} onChange={e => setPassband2Min(e.target.value)} className="w-full min-w-0 p-1.5 text-xs border border-slate-300 rounded" />
                      <span className="text-slate-400 text-xs self-center">to</span>
                      <input type="number" value={passband2Max} onChange={e => setPassband2Max(e.target.value)} className="w-full min-w-0 p-1.5 text-xs border border-slate-300 rounded" />
                      <span className="text-slate-500 text-xs self-center">GHz</span>
                    </div>
                  )}
                  <div className="bg-white border border-red-200 p-1.5 rounded text-center">
                    <span className="text-xs font-bold text-red-500">{passbands.length > 1 ? 'Combined ' : ''}Avg R: {avgReflection !== null ? (avgReflection * 100).toFixed(2) + '%' : '-'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="text-center text-[10px] text-slate-400 pb-2">
          Last updated November 9, 2026 by John Kovac; code generated and maintained using Gemini and Claude
        </footer>
      </div>
    </div>
  );
}
