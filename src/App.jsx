import { useState, useEffect, useCallback } from 'react'
import {
  CATS_GASTO_GRUPOS, CATS_GASTO, CATS_INGRESO,
  fmt, fmtInput, parseFmt, getMonthKey, formatMonthLabel,
  categorizeAuto, shouldExclude
} from './constants'
import {
  getPresupuesto, setPresupuesto,
  getTransacciones, addTransaccion, updateTransaccionCat, deleteTransaccion,
  getSaldo, setSaldo,
  getMovimientos, addMovimiento
} from './db'
import './App.css'

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n')
  const txs = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const firstComma = line.indexOf(',')
    const rest = line.substring(firstComma + 1)
    const lastComma2 = rest.lastIndexOf(',')
    const lastComma1 = rest.lastIndexOf(',', lastComma2 - 1)
    const lastComma0 = rest.lastIndexOf(',', lastComma1 - 1)
    const fecha = line.substring(0, firstComma).trim()
    const concepto = rest.substring(0, lastComma0).trim().replace(/^"|"$/g, '')
    const cargosStr = rest.substring(lastComma0 + 1, lastComma1).trim()
    const abonosStr = rest.substring(lastComma1 + 1, lastComma2).trim()
    if (!fecha || !concepto) continue
    if (shouldExclude(concepto)) continue
    const parts = fecha.split('/')
    if (parts.length !== 3) continue
    const isoDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    const mes = isoDate.substring(0, 7)
    const cargo = parseFloat(cargosStr) || 0
    const abono = parseFloat(abonosStr) || 0
    if (cargo === 0 && abono === 0) continue
    const tipo = abono > 0 ? 'ingreso' : 'gasto'
    const monto = abono > 0 ? abono : Math.abs(cargo)
    const categoria = categorizeAuto(concepto, tipo)
    let display = concepto
    if (display.includes('SPEI RECIBIDO')) {
      const m = display.match(/CONCEPTO:\s*(.+?)\s+REFERENCIA/i)
      if (m) display = m[1].trim()
    }
    txs.push({ mes, fecha: isoDate, concepto: display, monto, tipo, categoria })
  }
  return txs
}

// ─── NOTIFICATION ─────────────────────────────────────────────────────────────
function Notif({ msg, onClose }) {
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [msg, onClose])
  if (!msg) return null
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      background: '#fff', border: '1px solid #4f46e5',
      padding: '12px 18px', borderRadius: 8, fontSize: 13,
      boxShadow: '0 4px 20px #4f46e520', zIndex: 999,
      color: '#0f172a', fontFamily: 'DM Sans, sans-serif'
    }}>{msg}</div>
  )
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, subtitle, children }) {
  if (!open) return null
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: '#000000cc',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: 28,
        width: 460, maxWidth: '95vw', border: '1px solid #e0e7ff'
      }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{title}</h3>
        {subtitle && <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 5, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%', background: '#f5f7ff', border: '1px solid #c7d2fe',
  color: '#0f172a', fontFamily: 'DM Mono, monospace', fontSize: 14,
  padding: '9px 12px', borderRadius: 7, outline: 'none'
}

const selectStyle = {
  ...inputStyle, fontFamily: 'DM Sans, sans-serif', cursor: 'pointer'
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [currentMonth, setCurrentMonth] = useState(getMonthKey())
  const [presupuesto, setPresupuestoState] = useState({})
  const [transacciones, setTransacciones] = useState([])
  const [saldo, setSaldoState] = useState({ saldo_real: 0, saldo_fecha: null })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('presupuesto')
  const [notif, setNotif] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())

  // Modals
  const [modalSaldo, setModalSaldo] = useState(false)
  const [modalIngreso, setModalIngreso] = useState(false)
  const [modalGasto, setModalGasto] = useState(false)
  const [modalMover, setModalMover] = useState(false)

  // Form state
  const [formSaldo, setFormSaldo] = useState({ monto: '', fecha: new Date().toISOString().split('T')[0] })
  const [formIngreso, setFormIngreso] = useState({ fecha: '', concepto: '', monto: '', categoria: 'VentasDirectas' })
  const [formGasto, setFormGasto] = useState({ fecha: '', concepto: '', monto: '', categoria: 'Viniles' })
  const [formMover, setFormMover] = useState({ desde: '', hacia: '', monto: '' })

  const notify = (msg) => setNotif(msg)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [pres, txs, sal] = await Promise.all([
        getPresupuesto(currentMonth),
        getTransacciones(currentMonth),
        getSaldo(currentMonth),
      ])
      setPresupuestoState(pres)
      setTransacciones(txs)
      setSaldoState(sal)
    } catch (e) {
      notify('Error cargando datos: ' + e.message)
    }
    setLoading(false)
  }, [currentMonth])

  useEffect(() => { loadData() }, [loadData])

  // ── Computed ──
  const ingresoActual = {}
  const gastoActual = {}
  for (const tx of transacciones) {
    if (tx.tipo === 'ingreso') ingresoActual[tx.categoria] = (ingresoActual[tx.categoria] || 0) + Number(tx.monto)
    else gastoActual[tx.categoria] = (gastoActual[tx.categoria] || 0) + Math.abs(Number(tx.monto))
  }
  const totalIngresos = Object.values(ingresoActual).reduce((a, b) => a + b, 0)
  const totalGastos = Object.values(gastoActual).reduce((a, b) => a + b, 0)
  const totalPresupuestado = Object.values(presupuesto).reduce((a, b) => a + b, 0)
  const resultado = totalIngresos - totalGastos
  const margen = totalIngresos > 0 ? (resultado / totalIngresos * 100).toFixed(1) : 0
  const saldoReal = saldo.saldo_real || 0
  const paraAsignar = saldoReal - totalPresupuestado
  const overspendCats = CATS_GASTO.filter(c => {
    const real = gastoActual[c.id] || 0
    const pres = presupuesto[c.id] || 0
    return real > pres && real > 0
  })

  // ── Handlers ──
  const changeMonth = (delta) => {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setCurrentMonth(getMonthKey(d))
  }

  const toggleGroup = (id) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handlePresupuestoChange = async (cat, val) => {
    const monto = parseFmt(val)
    setPresupuestoState(prev => ({ ...prev, [cat]: monto }))
    try { await setPresupuesto(currentMonth, cat, monto) }
    catch (e) { notify('Error guardando: ' + e.message) }
  }

  const handleCSV = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const text = await file.text()
    const txs = parseCSV(text)
    let added = 0, skipped = 0
    for (const tx of txs) {
      try {
        const ok = await addTransaccion(tx)
        ok ? added++ : skipped++
      } catch { skipped++ }
    }
    notify(`✓ ${added} importadas · ${skipped} duplicadas`)
    await loadData()
    e.target.value = ''
  }

  const handleSaveSaldo = async () => {
    const monto = parseFmt(formSaldo.monto)
    if (isNaN(monto) || monto < 0) { notify('⚠️ Ingresa un saldo válido'); return }
    try {
      await setSaldo(currentMonth, monto, formSaldo.fecha)
      setSaldoState({ saldo_real: monto, saldo_fecha: formSaldo.fecha })
      setModalSaldo(false)
      notify(`✓ Saldo actualizado: ${fmt(monto)}`)
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handleSaveIngreso = async () => {
    const monto = parseFloat(formIngreso.monto)
    if (!formIngreso.fecha || !formIngreso.concepto || !monto) { notify('⚠️ Completa todos los campos'); return }
    try {
      await addTransaccion({ mes: formIngreso.fecha.substring(0, 7), fecha: formIngreso.fecha, concepto: formIngreso.concepto, monto, tipo: 'ingreso', categoria: formIngreso.categoria })
      setModalIngreso(false)
      notify('✓ Ingreso registrado')
      await loadData()
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handleSaveGasto = async () => {
    const monto = parseFloat(formGasto.monto)
    if (!formGasto.fecha || !formGasto.concepto || !monto) { notify('⚠️ Completa todos los campos'); return }
    try {
      await addTransaccion({ mes: formGasto.fecha.substring(0, 7), fecha: formGasto.fecha, concepto: formGasto.concepto, monto, tipo: 'gasto', categoria: formGasto.categoria })
      setModalGasto(false)
      notify('✓ Gasto registrado')
      await loadData()
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handleDeleteTx = async (id) => {
    try {
      await deleteTransaccion(id)
      notify('Transacción eliminada')
      await loadData()
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handleUpdateCat = async (id, categoria) => {
    try {
      await updateTransaccionCat(id, categoria)
      await loadData()
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handleMover = async () => {
    const monto = parseFloat(formMover.monto)
    if (!formMover.desde || !formMover.hacia) { notify('⚠️ Selecciona categorías'); return }
    if (formMover.desde === formMover.hacia) { notify('⚠️ Las categorías deben ser distintas'); return }
    if (!monto || monto <= 0) { notify('⚠️ Ingresa un monto válido'); return }
    try {
      const presDesde = presupuesto[formMover.desde] || 0
      const presHacia = presupuesto[formMover.hacia] || 0
      setPresupuestoState(prev => ({ ...prev, [formMover.desde]: presDesde - monto, [formMover.hacia]: presHacia + monto }))
      await Promise.all([
        setPresupuesto(currentMonth, formMover.desde, presDesde - monto),
        setPresupuesto(currentMonth, formMover.hacia, presHacia + monto),
      ])
      setModalMover(false)
      const dLabel = CATS_GASTO.find(c => c.id === formMover.desde)?.label || formMover.desde
      const hLabel = CATS_GASTO.find(c => c.id === formMover.hacia)?.label || formMover.hacia
      notify(`✓ ${fmt(monto)} movido de ${dLabel} → ${hLabel}`)
    } catch (e) { notify('Error: ' + e.message) }
  }

  const catOptions = (
    <>
      {CATS_GASTO_GRUPOS.map(g => (
        <optgroup key={g.grupo} label={g.grupo}>
          {g.cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </optgroup>
      ))}
    </>
  )

  const allCatOptions = (selectedId) => (
    <>
      <optgroup label="↑ Ingresos">
        {CATS_INGRESO.map(c => <option key={c.id} value={c.id} selected={c.id === selectedId}>{c.label}</option>)}
      </optgroup>
      {CATS_GASTO_GRUPOS.map(g => (
        <optgroup key={g.grupo} label={g.grupo}>
          {g.cats.map(c => <option key={c.id} value={c.id} selected={c.id === selectedId}>{c.label}</option>)}
        </optgroup>
      ))}
    </>
  )

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#eef2ff', fontFamily: 'DM Sans, sans-serif', color: '#4f46e5', fontSize: 16 }}>
      Cargando Cromática...
    </div>
  )

  return (
    <div style={{ background: '#eef2ff', minHeight: '100vh', fontFamily: 'DM Sans, sans-serif', color: '#0f172a', fontSize: 15 }}>

      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', background: '#fff', borderBottom: '2px solid #c7d2fe', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, fontWeight: 500, color: '#4f46e5', letterSpacing: '0.08em' }}>
          CROMÁTICA <span style={{ color: '#94a3b8' }}>/ presupuesto</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => changeMonth(-1)} style={{ background: 'none', border: '1px solid #c7d2fe', color: '#94a3b8', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>‹</button>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#0f172a', minWidth: 120, textAlign: 'center', textTransform: 'capitalize' }}>{formatMonthLabel(currentMonth)}</div>
          <button onClick={() => changeMonth(1)} style={{ background: 'none', border: '1px solid #c7d2fe', color: '#94a3b8', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>›</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setFormIngreso({ fecha: new Date().toISOString().split('T')[0], concepto: '', monto: '', categoria: 'VentasDirectas' }); setModalIngreso(true) }} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#475569' }}>+ Ingreso</button>
          <button onClick={() => { setFormGasto({ fecha: new Date().toISOString().split('T')[0], concepto: '', monto: '', categoria: 'Viniles' }); setModalGasto(true) }} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#475569' }}>+ Gasto</button>
          <label style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: '#4f46e5', color: '#fff', border: 'none' }}>
            ↑ Importar CSV
            <input type="file" accept=".csv" onChange={handleCSV} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', padding: '0 28px', background: '#fff', borderBottom: '2px solid #c7d2fe' }}>
        {['presupuesto', 'transacciones'].map(tab => (
          <div key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '12px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            color: activeTab === tab ? '#4f46e5' : '#94a3b8',
            borderBottom: activeTab === tab ? '2px solid #4f46e5' : '2px solid transparent',
            textTransform: 'capitalize', userSelect: 'none'
          }}>{tab}</div>
        ))}
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>

        {/* ── TAB: PRESUPUESTO ── */}
        {activeTab === 'presupuesto' && (
          <>
            {/* SUMMARY CARDS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Ingresos del mes', value: fmt(totalIngresos), sub: `${transacciones.filter(t => t.tipo === 'ingreso').length} transacciones`, color: '#059669', border: '#059669' },
                { label: 'Gastos del mes', value: fmt(totalGastos), sub: `${Object.keys(gastoActual).length} categorías activas`, color: '#dc2626', border: '#dc2626' },
                { label: 'Resultado', value: fmt(resultado), sub: `margen ${margen}%`, color: resultado >= 0 ? '#059669' : '#dc2626', border: '#7c3aed' },
              ].map((c, i) => (
                <div key={i} style={{ background: '#fff', border: '1px solid #e0e7ff', borderTop: `3px solid ${c.border}`, borderRadius: 10, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{c.label}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 500, color: c.color }}>{c.value}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, fontFamily: 'DM Mono, monospace' }}>{c.sub}</div>
                </div>
              ))}
              <div onClick={() => { setFormSaldo({ monto: saldoReal || '', fecha: new Date().toISOString().split('T')[0] }); setModalSaldo(true) }}
                style={{ background: '#fff', border: '1px solid #e0e7ff', borderTop: '3px solid #2563eb', borderRadius: 10, padding: '16px 18px', cursor: 'pointer' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Saldo real Banorte <span style={{ color: '#4f46e5' }}>✎</span>
                </div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 500, color: '#2563eb' }}>{fmt(saldoReal)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, fontFamily: 'DM Mono, monospace' }}>
                  {saldo.saldo_fecha ? `actualizado ${saldo.saldo_fecha.split('-').reverse().join('/')}` : 'toca para actualizar'}
                </div>
              </div>
            </div>

            {/* BANNER LISTO PARA ASIGNAR */}
            <div style={{
              background: saldoReal === 0 ? '#fff' : 'linear-gradient(135deg,#4f46e5,#7c3aed)',
              border: saldoReal === 0 ? '1px solid #c7d2fe' : 'none',
              borderRadius: 10, padding: '14px 20px', marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: saldoReal === 0 ? 'pointer' : 'default'
            }} onClick={saldoReal === 0 ? () => setModalSaldo(true) : undefined}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: saldoReal === 0 ? '#475569' : 'rgba(255,255,255,0.85)' }}>
                  {saldoReal === 0 ? '💰 Ingresa tu saldo real de Banorte para comenzar' : paraAsignar >= 0 ? '💰 Listo para asignar' : '🔴 Presupuesto excede saldo real'}
                </div>
                <div style={{ fontSize: 11, color: saldoReal === 0 ? '#94a3b8' : 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                  {saldoReal === 0 ? 'Toca aquí para ingresar el saldo' : 'Saldo real menos lo ya asignado a categorías'}
                </div>
              </div>
              {saldoReal > 0 && (
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 600, color: paraAsignar >= 0 ? '#ffffff' : '#fca5a5' }}>
                  {paraAsignar < 0 ? '-' : ''}{fmt(Math.abs(paraAsignar))}
                </div>
              )}
            </div>

            {/* OVERSPENDING BANNER */}
            {overspendCats.length > 0 && (
              <div style={{ background: '#fef2f2', border: '2px solid #ef4444', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#dc2626' }}>⚠️ Overspending detectado</div>
                    <div style={{ fontSize: 13, color: '#991b1b', marginTop: 2 }}>
                      {overspendCats.length} categoría{overspendCats.length > 1 ? 's' : ''} excedida{overspendCats.length > 1 ? 's' : ''} · Total sin cubrir: {fmt(overspendCats.reduce((s, c) => s + ((gastoActual[c.id] || 0) - (presupuesto[c.id] || 0)), 0))}
                    </div>
                  </div>
                  <button onClick={() => { setFormMover({ desde: CATS_GASTO.find(c => (presupuesto[c.id] || 0) - (gastoActual[c.id] || 0) > 0)?.id || '', hacia: overspendCats[0]?.id || '', monto: '' }); setModalMover(true) }}
                    style={{ padding: '7px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Cubrir ahora →
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {overspendCats.map(c => {
                    const exceso = (gastoActual[c.id] || 0) - (presupuesto[c.id] || 0)
                    return <span key={c.id} style={{ background: '#fee2e2', color: '#dc2626', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{c.label} -{fmt(exceso)}</span>
                  })}
                </div>
              </div>
            )}

            {/* INGRESOS */}
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '20px 0 8px' }}>Ingresos</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 10, overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: '#f5f7ff' }}>
                  {['Categoría', 'Real del mes', '', ''].map((h, i) => (
                    <th key={i} style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '10px 14px', borderBottom: '2px solid #a5b4fc', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CATS_INGRESO.map(cat => {
                  const real = ingresoActual[cat.id] || 0
                  return (
                    <tr key={cat.id} style={{ borderBottom: '1px solid #f1f5ff' }}>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 500 }}>
                          <div style={{ width: 9, height: 9, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                          {cat.label}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 15, fontWeight: 600, color: '#059669' }}>{fmt(real)}</td>
                      <td /><td />
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* GASTOS */}
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '24px 0 8px' }}>Gastos</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 10, overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: '#f5f7ff' }}>
                  {['Categoría', 'Presupuestado', 'Gastado', 'Progreso', 'Disponible'].map((h, i) => (
                    <th key={i} style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '10px 14px', borderBottom: '2px solid #a5b4fc', textAlign: i === 0 ? 'left' : 'right', minWidth: i === 3 ? 160 : 'auto' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CATS_GASTO_GRUPOS.map(grupo => {
                  const gId = grupo.grupo.replace(/\s+/g, '_')
                  const isCollapsed = collapsedGroups.has(gId)
                  const grupoGastado = grupo.cats.reduce((s, c) => s + (gastoActual[c.id] || 0), 0)
                  const grupoPresup = grupo.cats.reduce((s, c) => s + (presupuesto[c.id] || 0), 0)
                  return [
                    <tr key={`g-${gId}`} onClick={() => toggleGroup(gId)}
                      style={{ background: '#f8faff', cursor: 'pointer', borderBottom: '1px solid #e0e7ff' }}>
                      <td colSpan={5} style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            <span style={{ marginRight: 6, display: 'inline-block', transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                            {grupo.grupo}
                          </span>
                          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#94a3b8' }}>
                            {fmt(grupoGastado)} / {fmt(grupoPresup)}
                          </span>
                        </div>
                      </td>
                    </tr>,
                    ...(!isCollapsed ? grupo.cats.map(cat => {
                      const pres = presupuesto[cat.id] || 0
                      const real = gastoActual[cat.id] || 0
                      const disp = pres - real
                      const pct = pres > 0 ? Math.min((real / pres) * 100, 100) : (real > 0 ? 100 : 0)
                      const barColor = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f97316' : '#3b82f6'
                      const dispColor = disp < 0 ? '#dc2626' : pct >= 80 ? '#d97706' : '#2563eb'
                      return (
                        <tr key={cat.id} style={{ borderBottom: '1px solid #f1f5ff' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f8faff'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 500 }}>
                              <div style={{ width: 9, height: 9, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                              {cat.label}
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            <input
                              defaultValue={fmtInput(pres)}
                              onBlur={e => handlePresupuestoChange(cat.id, e.target.value)}
                              onFocus={e => { e.target.value = pres || '' }}
                              style={{ background: '#f5f7ff', border: '1px solid #c7d2fe', color: '#0f172a', fontFamily: 'DM Mono, monospace', fontSize: 14, textAlign: 'right', padding: '5px 10px', borderRadius: 5, width: 130 }}
                            />
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 15 }}>{fmt(real)}</td>
                          <td style={{ padding: '12px 14px', minWidth: 160 }}>
                            <div style={{ height: 7, background: '#e0e7ff', borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 4, transition: 'width 0.4s ease' }} />
                            </div>
                            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, fontWeight: 600, color: barColor }}>{pct.toFixed(0)}%</div>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 15, fontWeight: 700, color: dispColor }}>
                            {disp < 0 ? '-' : ''}{fmt(Math.abs(disp))}
                          </td>
                        </tr>
                      )
                    }) : [])
                  ]
                })}
              </tbody>
            </table>
          </>
        )}

        {/* ── TAB: TRANSACCIONES ── */}
        {activeTab === 'transacciones' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: '#475569' }}>{transacciones.length} transacciones</div>
              <label style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: '#4f46e5', color: '#fff', border: 'none' }}>
                ↑ Importar CSV Banorte
                <input type="file" accept=".csv" onChange={handleCSV} style={{ display: 'none' }} />
              </label>
            </div>

            {transacciones.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <p>No hay transacciones este mes.<br />Importa tu CSV de Banorte para comenzar.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {transacciones.map(tx => (
                  <div key={tx.id} style={{
                    display: 'grid', gridTemplateColumns: '95px 1fr 180px 110px 70px',
                    alignItems: 'center', gap: 12, padding: '11px 14px',
                    borderRadius: 8, background: '#fff', border: '1px solid #e0e7ff'
                  }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#475569', fontWeight: 500 }}>
                      {tx.fecha.split('-').reverse().join('/')}
                    </div>
                    <div style={{ fontSize: 14, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.concepto}>{tx.concepto}</div>
                    <select value={tx.categoria} onChange={e => handleUpdateCat(tx.id, e.target.value)}
                      style={{ background: '#f5f7ff', border: '1px solid #c7d2fe', color: '#0f172a', fontSize: 12, padding: '4px 7px', borderRadius: 5, width: '100%', cursor: 'pointer' }}>
                      <optgroup label="↑ Ingresos">
                        {CATS_INGRESO.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </optgroup>
                      {CATS_GASTO_GRUPOS.map(g => (
                        <optgroup key={g.grupo} label={g.grupo}>
                          {g.cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 600, textAlign: 'right', color: tx.tipo === 'ingreso' ? '#059669' : '#dc2626' }}>
                      {tx.tipo === 'ingreso' ? '+' : '-'}{fmt(tx.monto)}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => handleDeleteTx(tx.id)}
                        style={{ background: 'none', border: '1px solid #fee2e2', color: '#dc2626', padding: '4px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── MODALS ── */}

      {/* Saldo */}
      <Modal open={modalSaldo} onClose={() => setModalSaldo(false)} title="Actualizar saldo real" subtitle="¿Cuánto tienes en Banorte negocio ahorita? Este número es la base para 'Listo para asignar'.">
        <Field label="Saldo actual Banorte ($MXN)">
          <input type="number" value={formSaldo.monto} onChange={e => setFormSaldo(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" step="0.01" style={inputStyle} />
        </Field>
        <Field label="Fecha de consulta">
          <input type="date" value={formSaldo.fecha} onChange={e => setFormSaldo(p => ({ ...p, fecha: e.target.value }))} style={inputStyle} />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={() => setModalSaldo(false)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleSaveSaldo} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Guardar</button>
        </div>
      </Modal>

      {/* Ingreso */}
      <Modal open={modalIngreso} onClose={() => setModalIngreso(false)} title="Registrar ingreso" subtitle="Agrega un ingreso manualmente">
        <Field label="Fecha"><input type="date" value={formIngreso.fecha} onChange={e => setFormIngreso(p => ({ ...p, fecha: e.target.value }))} style={inputStyle} /></Field>
        <Field label="Concepto"><input type="text" value={formIngreso.concepto} onChange={e => setFormIngreso(p => ({ ...p, concepto: e.target.value }))} placeholder="Ej: Pago cliente X" style={inputStyle} /></Field>
        <Field label="Monto ($MXN)"><input type="number" value={formIngreso.monto} onChange={e => setFormIngreso(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" step="0.01" style={inputStyle} /></Field>
        <Field label="Categoría">
          <select value={formIngreso.categoria} onChange={e => setFormIngreso(p => ({ ...p, categoria: e.target.value }))} style={selectStyle}>
            {CATS_INGRESO.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={() => setModalIngreso(false)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleSaveIngreso} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Guardar</button>
        </div>
      </Modal>

      {/* Gasto */}
      <Modal open={modalGasto} onClose={() => setModalGasto(false)} title="Registrar gasto" subtitle="Agrega un gasto manualmente">
        <Field label="Fecha"><input type="date" value={formGasto.fecha} onChange={e => setFormGasto(p => ({ ...p, fecha: e.target.value }))} style={inputStyle} /></Field>
        <Field label="Concepto"><input type="text" value={formGasto.concepto} onChange={e => setFormGasto(p => ({ ...p, concepto: e.target.value }))} placeholder="Ej: SIO Supply materiales" style={inputStyle} /></Field>
        <Field label="Monto ($MXN)"><input type="number" value={formGasto.monto} onChange={e => setFormGasto(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" step="0.01" style={inputStyle} /></Field>
        <Field label="Categoría">
          <select value={formGasto.categoria} onChange={e => setFormGasto(p => ({ ...p, categoria: e.target.value }))} style={selectStyle}>
            {catOptions}
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={() => setModalGasto(false)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleSaveGasto} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Guardar</button>
        </div>
      </Modal>

      {/* Mover dinero */}
      <Modal open={modalMover} onClose={() => setModalMover(false)} title="Mover dinero entre categorías" subtitle="Cubre el overspending tomando presupuesto de otra categoría.">
        <Field label="Tomar de">
          <select value={formMover.desde} onChange={e => setFormMover(p => ({ ...p, desde: e.target.value }))} style={selectStyle}>
            {CATS_GASTO.filter(c => (presupuesto[c.id] || 0) - (gastoActual[c.id] || 0) > 0).map(c => {
              const disp = (presupuesto[c.id] || 0) - (gastoActual[c.id] || 0)
              return <option key={c.id} value={c.id}>{c.label} — disponible: {fmt(disp)}</option>
            })}
          </select>
        </Field>
        <Field label="Dar a">
          <select value={formMover.hacia} onChange={e => setFormMover(p => ({ ...p, hacia: e.target.value }))} style={selectStyle}>
            {[...overspendCats, ...CATS_GASTO.filter(c => !overspendCats.includes(c))].map(c => {
              const exceso = (gastoActual[c.id] || 0) - (presupuesto[c.id] || 0)
              return <option key={c.id} value={c.id}>{exceso > 0 ? `⚠️ ${c.label} (falta: ${fmt(exceso)})` : c.label}</option>
            })}
          </select>
        </Field>
        <Field label="Monto ($MXN)"><input type="number" value={formMover.monto} onChange={e => setFormMover(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" step="0.01" style={inputStyle} /></Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={() => setModalMover(false)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleMover} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Mover dinero</button>
        </div>
      </Modal>

      <Notif msg={notif} onClose={() => setNotif('')} />
    </div>
  )
}
