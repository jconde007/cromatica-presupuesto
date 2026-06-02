import { useState, useEffect, useMemo } from 'react'
import { getReporteMultiMes } from './db'
import { fmt, formatMonthLabel } from './constants'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function lastNMonths(currentMonth, n) {
  // Devuelve array ascendente de N meses incluyendo el actual: ['2026-01', ..., '2026-06']
  const [y, m] = currentMonth.split('-').map(Number)
  const arr = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return arr
}

function shortMonthLabel(mesKey) {
  // '2026-06' → 'Jun'
  const [y, m] = mesKey.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')
}

// Paleta de colores rotativa para categorías
const PALETTE = [
  '#4f46e5', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#0284c7', '#9333ea', '#16a34a',
  '#e11d48', '#0d9488', '#ca8a04', '#7e22ce', '#2563eb', '#facc15',
]

// ─── PIE CHART: Spending Breakdown ────────────────────────────────────────────
function PieChart({ data, total }) {
  if (!data.length || total === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Sin gastos este mes.</div>
  }
  const size = 220
  const radius = 100
  const cx = size / 2
  const cy = size / 2
  let currentAngle = -Math.PI / 2 // empezar arriba

  const slices = data.map((d, i) => {
    const angle = (d.value / total) * 2 * Math.PI
    const x1 = cx + radius * Math.cos(currentAngle)
    const y1 = cy + radius * Math.sin(currentAngle)
    currentAngle += angle
    const x2 = cx + radius * Math.cos(currentAngle)
    const y2 = cy + radius * Math.sin(currentAngle)
    const largeArc = angle > Math.PI ? 1 : 0
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`
    return { path, color: PALETTE[i % PALETTE.length], ...d }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth="2" />
        ))}
      </svg>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
        {slices.map((s, i) => {
          const pct = (s.value / total * 100).toFixed(1)
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', fontSize: 13 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
              <div style={{ flex: 1, color: '#0f172a' }}>{s.label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: '#0f172a', minWidth: 90, textAlign: 'right' }}>{fmt(s.value)}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', color: '#94a3b8', fontSize: 11, minWidth: 50, textAlign: 'right' }}>{pct}%</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── LINE CHART: Net Worth ────────────────────────────────────────────────────
function LineChart({ series, height = 220 }) {
  const padding = { top: 20, right: 16, bottom: 36, left: 56 }
  const width = 600
  const w = width - padding.left - padding.right
  const h = height - padding.top - padding.bottom
  if (!series.length) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Sin datos.</div>
  const values = series.map(s => s.value)
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const yZero = padding.top + h * (max / range)

  const points = series.map((s, i) => {
    const x = padding.left + (series.length === 1 ? w / 2 : (i / (series.length - 1)) * w)
    const y = padding.top + h - ((s.value - min) / range) * h
    return { x, y, ...s }
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  // 4 grid lines en Y
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: padding.top + h * t,
    value: max - range * t,
  }))

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }} preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padding.left} y1={t.y} x2={width - padding.right} y2={t.y} stroke="#e0e7ff" strokeWidth="1" />
          <text x={padding.left - 6} y={t.y + 4} fontSize="10" textAnchor="end" fill="#94a3b8" fontFamily="DM Mono, monospace">{fmt(t.value)}</text>
        </g>
      ))}
      {/* Zero line si hay valores negativos y positivos */}
      {min < 0 && max > 0 && (
        <line x1={padding.left} y1={yZero} x2={width - padding.right} y2={yZero} stroke="#94a3b8" strokeDasharray="3,3" strokeWidth="1" />
      )}
      <path d={path} fill="none" stroke="#4f46e5" strokeWidth="2.5" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill="#4f46e5" stroke="#fff" strokeWidth="2" />
          <text x={p.x} y={height - 14} fontSize="11" textAnchor="middle" fill="#475569" fontWeight="500">{shortMonthLabel(p.mes)}</text>
          <text x={p.x} y={p.y - 10} fontSize="10" textAnchor="middle" fill="#0f172a" fontFamily="DM Mono, monospace" fontWeight="600">{fmt(p.value)}</text>
        </g>
      ))}
    </svg>
  )
}

// ─── BAR CHART AGRUPADO: Income vs Spending ──────────────────────────────────
function BarChart({ series, height = 240 }) {
  const padding = { top: 24, right: 16, bottom: 40, left: 56 }
  const width = 600
  const w = width - padding.left - padding.right
  const h = height - padding.top - padding.bottom
  if (!series.length) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Sin datos.</div>
  const max = Math.max(...series.flatMap(s => [s.ingreso, s.gasto]), 0) || 1

  const groupWidth = w / series.length
  const barWidth = Math.min(28, groupWidth * 0.35)
  const gap = 4

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: padding.top + h * (1 - t),
    value: max * t,
  }))

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }} preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padding.left} y1={t.y} x2={width - padding.right} y2={t.y} stroke="#e0e7ff" strokeWidth="1" />
          <text x={padding.left - 6} y={t.y + 4} fontSize="10" textAnchor="end" fill="#94a3b8" fontFamily="DM Mono, monospace">{fmt(t.value)}</text>
        </g>
      ))}
      {series.map((s, i) => {
        const cx = padding.left + groupWidth * (i + 0.5)
        const ingresoH = (s.ingreso / max) * h
        const gastoH = (s.gasto / max) * h
        return (
          <g key={i}>
            <rect x={cx - barWidth - gap / 2} y={padding.top + h - ingresoH} width={barWidth} height={ingresoH} fill="#059669" rx="3" />
            <rect x={cx + gap / 2} y={padding.top + h - gastoH} width={barWidth} height={gastoH} fill="#dc2626" rx="3" />
            <text x={cx} y={height - 22} fontSize="11" textAnchor="middle" fill="#475569" fontWeight="500">{shortMonthLabel(s.mes)}</text>
            <text x={cx} y={height - 8} fontSize="9" textAnchor="middle" fill="#94a3b8" fontFamily="DM Mono, monospace">
              {s.ingreso - s.gasto >= 0 ? '+' : ''}{fmt(s.ingreso - s.gasto)}
            </text>
          </g>
        )
      })}
      {/* Leyenda */}
      <g transform={`translate(${padding.left}, 10)`}>
        <rect width="10" height="10" fill="#059669" rx="2" />
        <text x="14" y="9" fontSize="10" fill="#475569">Ingresos</text>
        <rect x="80" width="10" height="10" fill="#dc2626" rx="2" />
        <text x="94" y="9" fontSize="10" fill="#475569">Gastos</text>
      </g>
    </svg>
  )
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function Reports({ currentMonth, catsGasto }) {
  const [mesesRange, setMesesRange] = useState(() => lastNMonths(currentMonth, 6))
  const [mesDetalle, setMesDetalle] = useState(currentMonth)
  const [data, setData] = useState({ transacciones: [], cuentas: [] })
  const [loading, setLoading] = useState(true)

  // Asegurar que mes detalle siempre esté en el rango
  useEffect(() => {
    setMesesRange(lastNMonths(currentMonth, 6))
    setMesDetalle(currentMonth)
  }, [currentMonth])

  useEffect(() => {
    setLoading(true)
    getReporteMultiMes(mesesRange).then(d => {
      setData(d)
      setLoading(false)
    }).catch(e => {
      console.error(e)
      setLoading(false)
    })
  }, [mesesRange])

  // ── Spending Breakdown del mes seleccionado ──
  const spendingData = useMemo(() => {
    const gastosMes = data.transacciones.filter(t =>
      t.mes === mesDetalle &&
      t.tipo === 'gasto' &&
      !t.es_transferencia
    )
    const porCat = {}
    for (const tx of gastosMes) {
      const cat = catsGasto.find(c => c.id === tx.categoria)
      const label = cat?.label || tx.categoria || 'Sin categoría'
      porCat[label] = (porCat[label] || 0) + Math.abs(Number(tx.monto))
    }
    const arr = Object.entries(porCat)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
    const total = arr.reduce((s, x) => s + x.value, 0)
    return { arr, total }
  }, [data.transacciones, mesDetalle, catsGasto])

  // ── Net Worth por mes (saldo_inicial + ingresos - gastos por cuenta, con crédito negativo) ──
  const netWorthData = useMemo(() => {
    return mesesRange.map(mes => {
      const cuentasMes = data.cuentas.filter(c => c.mes === mes)
      let netWorth = 0
      for (const c of cuentasMes) {
        const txsCta = data.transacciones.filter(t => t.mes === mes && (t.cuenta || 'Banorte') === c.nombre)
        const ingresos = txsCta.filter(t => t.tipo === 'ingreso').reduce((s, t) => s + Number(t.monto), 0)
        const gastos = txsCta.filter(t => t.tipo === 'gasto').reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
        const saldo = c.tipo === 'credito'
          ? (c.saldo_inicial || 0) - gastos + ingresos
          : (c.saldo_inicial || 0) + ingresos - gastos
        // Crédito ya es negativo, débito es positivo — sumamos directo
        netWorth += saldo
      }
      return { mes, value: netWorth }
    })
  }, [data, mesesRange])

  // ── Income vs Spending por mes (excluyendo transferencias) ──
  const incomeVsSpending = useMemo(() => {
    return mesesRange.map(mes => {
      const txs = data.transacciones.filter(t => t.mes === mes && !t.es_transferencia)
      const ingreso = txs.filter(t => t.tipo === 'ingreso').reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
      const gasto = txs.filter(t => t.tipo === 'gasto').reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
      return { mes, ingreso, gasto }
    })
  }, [data, mesesRange])

  const cardStyle = {
    background: '#fff', border: '1px solid #e0e7ff', borderRadius: 10, padding: 20, marginBottom: 20,
  }
  const cardHeaderStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap',
  }
  const titleStyle = { fontSize: 14, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.05em' }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#4f46e5' }}>Cargando reportes…</div>

  return (
    <div>
      {/* INCOME VS SPENDING (6 meses) */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={titleStyle}>Ingresos vs Gastos</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Últimos 6 meses</div>
        </div>
        <BarChart series={incomeVsSpending} />
      </div>

      {/* NET WORTH (6 meses) */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={titleStyle}>Patrimonio neto</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Débito − Crédito al cierre del mes</div>
        </div>
        <LineChart series={netWorthData} />
      </div>

      {/* SPENDING BREAKDOWN (mes seleccionado) */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={titleStyle}>Gastos por categoría</div>
          <select value={mesDetalle} onChange={e => setMesDetalle(e.target.value)}
            style={{ background: '#f5f7ff', border: '1px solid #c7d2fe', color: '#0f172a', fontSize: 13, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, textTransform: 'capitalize' }}>
            {mesesRange.map(m => <option key={m} value={m}>{formatMonthLabel(m)}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 12, color: '#475569', marginBottom: 12 }}>
          Total del mes: <strong style={{ fontFamily: 'DM Mono, monospace', color: '#dc2626' }}>{fmt(spendingData.total)}</strong> · {spendingData.arr.length} categorías
        </div>
        <PieChart data={spendingData.arr} total={spendingData.total} />
      </div>
    </div>
  )
}
