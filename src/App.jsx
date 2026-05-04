import { useState, useEffect, useCallback } from 'react'
import {
  CATS_GASTO_GRUPOS as CATS_GASTO_GRUPOS_DEFAULT,
  CATS_GASTO as CATS_GASTO_DEFAULT,
  CATS_INGRESO as CATS_INGRESO_DEFAULT,
  fmt, fmtInput, parseFmt, getMonthKey, formatMonthLabel,
  categorizeAuto, shouldExclude
} from './constants'
import {
  getPresupuesto, setPresupuesto, getArrastres, cerrarMes,
  getAsignados, setAsignado,
  getTransacciones, addTransaccion, updateTransaccionCat, deleteTransaccion,
  getSaldosCuentas, setSaldoInicial, reconciliar, CUENTAS_DEFAULT,
  getClabeMap, saveClabe,
} from './db'
import Settings from './Settings.jsx'
import { supabase } from './supabase'
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
export default function App({ session, onSignOut }) {
  const [currentMonth, setCurrentMonth] = useState(getMonthKey())
  const [presupuesto, setPresupuestoState] = useState({})
  const [transacciones, setTransacciones] = useState([])
  const [cuentas, setCuentasState] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('presupuesto')
  const [notif, setNotif] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const [showReconciliar, setShowReconciliar] = useState(false)
  const [arrastres, setArrastres] = useState({})
  const [asignados, setAsignados] = useState({})
  const [clabeMap, setClabeMap] = useState({})

  // Dynamic categories from Supabase (fallback to static while loading)
  const [catsGastoGrupos, setCatsGastoGrupos] = useState(CATS_GASTO_GRUPOS_DEFAULT)
  const [catsGasto, setCatsGasto] = useState(CATS_GASTO_DEFAULT)
  const [catsIngreso, setCatsIngreso] = useState(CATS_INGRESO_DEFAULT)

  // Modals
  const [modalCuenta, setModalCuenta] = useState(false)
  const [modalIngreso, setModalIngreso] = useState(false)
  const [modalGasto, setModalGasto] = useState(false)
  const [modalMover, setModalMover] = useState(false)
  const [modalReconciliar, setModalReconciliar] = useState(false)

  // Form state
  const [formCuenta, setFormCuenta] = useState({ nombre: 'Banorte', monto: '' })
  const [formIngreso, setFormIngreso] = useState({ fecha: '', concepto: '', monto: '', categoria: 'VentasDirectas', cuenta: 'Banorte' })
  const [formGasto, setFormGasto] = useState({ fecha: '', concepto: '', monto: '', categoria: 'Viniles', cuenta: 'Banorte' })
  const [formMover, setFormMover] = useState({ desde: '', hacia: '', monto: '' })
  const [formReconciliar, setFormReconciliar] = useState({ nombre: 'Banorte', saldoReal: '' })

  const notify = (msg) => setNotif(msg)

  const loadCategories = useCallback(async () => {
    const { data } = await supabase.from('categorias').select('*').eq('activa', true).order('grupo_orden').order('cat_orden')
    if (data && data.length > 0) {
      const gastos = data.filter(c => !c.es_ingreso)
      const ingresos = data.filter(c => c.es_ingreso)
      const gruposUnicos = [...new Set(gastos.map(c => c.grupo))]
      const grupos = gruposUnicos.map(g => ({
        grupo: g,
        cats: gastos.filter(c => c.grupo === g).map(c => ({ id: c.cat_id, label: c.label, color: c.color }))
      }))
      setCatsGastoGrupos(grupos)
      setCatsGasto(gastos.map(c => ({ id: c.cat_id, label: c.label, color: c.color })))
      setCatsIngreso(ingresos.map(c => ({ id: c.cat_id, label: c.label, color: c.color })))
    }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [pres, txs, arr, cts, asig, clMap] = await Promise.all([
        getPresupuesto(currentMonth),
        getTransacciones(currentMonth),
        getArrastres(currentMonth),
        getSaldosCuentas(currentMonth),
        getAsignados(currentMonth),
        getClabeMap(),
      ])
      setPresupuestoState(pres)
      setTransacciones(txs)
      setArrastres(arr)
      setCuentasState(cts)
      setAsignados(asig)
      setClabeMap(clMap)
    } catch (e) {
      notify('Error cargando datos: ' + e.message)
    }
    setLoading(false)
  }, [currentMonth])

  useEffect(() => {
    loadCategories()
  }, [loadCategories])

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

  // Saldo neto = débito - crédito
  const saldoNeto = cuentas.reduce((s, c) => c.tipo === 'credito' ? s - Math.abs(c.saldoActual) : s + c.saldoActual, 0)
  const totalAsignado = Object.values(asignados).reduce((a, b) => a + b, 0)
  const paraAsignar = saldoNeto - totalAsignado

  const overspendCats = catsGasto.filter(c => {
    const real = gastoActual[c.id] || 0
    const asig = (asignados[c.id] || 0) + (arrastres[c.id] || 0)
    return real > asig && real > 0
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

  const handleCerrarMes = async () => {
    if (!confirm(`¿Cerrar ${formatMonthLabel(currentMonth)}? El sobrante de cada categoría se arrastrará al siguiente mes.`)) return
    try {
      await cerrarMes(currentMonth, gastoActual)
      notify(`✓ Mes cerrado — sobrantes arrastrados a ${formatMonthLabel(nextMonthKey(currentMonth))}`)
    } catch (e) { notify('Error: ' + e.message) }
  }

  const nextMonthKey = (mes) => {
    const [y, m] = mes.split('-').map(Number)
    const d = new Date(y, m, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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
      // Try to use clabeMap for better categorization
      const clabeMatch = tx.concepto.match(/CLABE:\s*(\d{10,18})/i)
      if (clabeMatch) {
        const clabe = clabeMatch[1]
        if (clabeMap[clabe]) {
          tx.categoria = clabeMap[clabe].categoria
        }
      }
      try {
        const ok = await addTransaccion(tx)
        ok ? added++ : skipped++
      } catch { skipped++ }
    }
    notify(`✓ ${added} importadas · ${skipped} duplicadas`)
    await loadData()
    e.target.value = ''
  }

  const handleSaveCuenta = async () => {
    const monto = parseFmt(formCuenta.monto)
    if (isNaN(monto)) { notify('⚠️ Ingresa un saldo válido'); return }
    try {
      await setSaldoInicial(currentMonth, formCuenta.nombre, monto)
      setModalCuenta(false)
      notify(`✓ Saldo de ${formCuenta.nombre} actualizado: ${fmt(monto)}`)
      await loadData()
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handleSaveIngreso = async () => {
    const monto = parseFloat(formIngreso.monto)
    if (!formIngreso.fecha || !formIngreso.concepto || !monto) { notify('⚠️ Completa todos los campos'); return }
    try {
      await addTransaccion({ mes: formIngreso.fecha.substring(0, 7), fecha: formIngreso.fecha, concepto: formIngreso.concepto, monto, tipo: 'ingreso', categoria: formIngreso.categoria, cuenta: formIngreso.cuenta })
      setModalIngreso(false)
      notify('✓ Ingreso registrado')
      await loadData()
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handleSaveGasto = async () => {
    const monto = parseFloat(formGasto.monto)
    if (!formGasto.fecha || !formGasto.concepto || !monto) { notify('⚠️ Completa todos los campos'); return }
    try {
      await addTransaccion({ mes: formGasto.fecha.substring(0, 7), fecha: formGasto.fecha, concepto: formGasto.concepto, monto, tipo: 'gasto', categoria: formGasto.categoria, cuenta: formGasto.cuenta })
      setModalGasto(false)
      notify('✓ Gasto registrado')
      await loadData()
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handleReconciliar = async () => {
    const saldoReal = parseFmt(formReconciliar.saldoReal)
    if (isNaN(saldoReal)) { notify('⚠️ Ingresa el saldo real'); return }
    try {
      const diferencia = await reconciliar(currentMonth, formReconciliar.nombre, saldoReal)
      setModalReconciliar(false)
      if (Math.abs(diferencia) < 0.01) {
        notify(`✅ ${formReconciliar.nombre} cuadra perfectamente`)
      } else {
        notify(`✓ Reconciliado — diferencia de ${fmt(Math.abs(diferencia))} ajustada`)
      }
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

  const handleAsignado = async (cat, val) => {
    const monto = parseFmt(val)
    setAsignados(prev => ({ ...prev, [cat]: monto }))
    try { await setAsignado(currentMonth, cat, monto) }
    catch (e) { notify('Error guardando: ' + e.message) }
  }

  const handleUpdateCat = async (id, categoria, concepto) => {
    try {
      await updateTransaccionCat(id, categoria)
      // Save CLABE mapping if concepto has one
      const clabeMatch = concepto?.match(/CLABE:\s*(\d{10,18})/i)
      if (clabeMatch) {
        await saveClabe(clabeMatch[1], categoria, concepto.substring(0, 60))
        setClabeMap(prev => ({ ...prev, [clabeMatch[1]]: { categoria, descripcion: concepto.substring(0, 60) } }))
      }
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
      const dLabel = catsGasto.find(c => c.id === formMover.desde)?.label || formMover.desde
      const hLabel = catsGasto.find(c => c.id === formMover.hacia)?.label || formMover.hacia
      notify(`✓ ${fmt(monto)} movido de ${dLabel} → ${hLabel}`)
    } catch (e) { notify('Error: ' + e.message) }
  }

  const catOptions = (
    <>
      {catsGastoGrupos.map(g => (
        <optgroup key={g.grupo} label={g.grupo}>
          {g.cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </optgroup>
      ))}
    </>
  )

  const allCatOptions = (selectedId) => (
    <>
      <optgroup label="↑ Ingresos">
        {catsIngreso.map(c => <option key={c.id} value={c.id} selected={c.id === selectedId}>{c.label}</option>)}
      </optgroup>
      {catsGastoGrupos.map(g => (
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
          <button onClick={handleCerrarMes} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#475569' }}>Cerrar mes →</button>
          <button onClick={() => setShowSettings(true)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#475569' }}>⚙️</button>
          <button onClick={onSignOut} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#94a3b8' }}>
            Salir
          </button>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
              <div style={{ background: '#fff', border: '1px solid #e0e7ff', borderTop: '3px solid #059669', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Ingresos del mes</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 500, color: '#059669' }}>{fmt(totalIngresos)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{transacciones.filter(t => t.tipo === 'ingreso').length} transacciones</div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #e0e7ff', borderTop: '3px solid #dc2626', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Gastos del mes</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 500, color: '#dc2626' }}>{fmt(totalGastos)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{Object.keys(gastoActual).length} categorías activas</div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #e0e7ff', borderTop: '3px solid #7c3aed', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Resultado</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 500, color: resultado >= 0 ? '#059669' : '#dc2626' }}>{fmt(resultado)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>margen {margen}%</div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #e0e7ff', borderTop: '3px solid #2563eb', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Saldo neto</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 500, color: saldoNeto >= 0 ? '#2563eb' : '#dc2626' }}>{saldoNeto < 0 ? '-' : ''}{fmt(Math.abs(saldoNeto))}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>débito - crédito</div>
              </div>
            </div>

            {/* CUENTAS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
              {cuentas.map(c => {
                const hoy = new Date().toISOString().split('T')[0]
                const updatedAt = c.updated_at ? new Date(c.updated_at) : null
                const diasDesde = updatedAt ? Math.floor((new Date() - updatedAt) / 86400000) : 99
                const semaforo = diasDesde === 0 ? { color: '#059669', label: '🟢 hoy' } : diasDesde <= 2 ? { color: '#d97706', label: `🟡 hace ${diasDesde}d` } : { color: '#dc2626', label: `🔴 hace ${diasDesde}d` }
                return (
                  <div key={c.nombre} style={{ background: '#fff', border: '1px solid #e0e7ff', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {c.tipo === 'credito' ? '💳' : '🏦'} {c.nombre}
                        <span style={{ fontSize: 10, color: semaforo.color }}>{semaforo.label}</span>
                      </div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, fontWeight: 700, color: c.tipo === 'credito' ? '#dc2626' : '#059669' }}>
                        {c.tipo === 'credito' && c.saldoActual < 0 ? '-' : ''}{fmt(Math.abs(c.saldoActual))}
                      </div>
                      {c.saldo_inicial === 0 && c.tipo === 'debito' && (
                        <div style={{ fontSize: 10, color: '#f97316', marginTop: 2 }}>⚠️ Ingresa saldo inicial</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button onClick={() => { setFormCuenta({ nombre: c.nombre, monto: c.saldo_inicial || '' }); setModalCuenta(true) }}
                        style={{ padding: '4px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#475569' }}>✎ Inicial</button>
                      <button onClick={() => { setFormReconciliar({ nombre: c.nombre, saldoReal: '' }); setModalReconciliar(true) }}
                        style={{ padding: '4px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer', background: 'none', border: `1px solid ${semaforo.color}20`, color: semaforo.color }}>⚖️ Rec.</button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* BANNER LISTO PARA ASIGNAR — estilo YNAB */}
            <div style={{
              borderRadius: 12,
              marginBottom: 20,
              background: paraAsignar > 0 ? 'linear-gradient(135deg, #059669, #10b981)' :
                          paraAsignar === 0 ? 'linear-gradient(135deg, #4f46e5, #7c3aed)' :
                          'linear-gradient(135deg, #dc2626, #ef4444)',
              padding: '20px 28px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              boxShadow: paraAsignar > 0 ? '0 4px 20px #05966930' : paraAsignar < 0 ? '0 4px 20px #dc262630' : '0 4px 20px #4f46e530'
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  Listo para asignar
                </div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 38, fontWeight: 700, color: '#ffffff', lineHeight: 1 }}>
                  {paraAsignar < 0 ? '-' : ''}{fmt(Math.abs(paraAsignar))}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 6 }}>
                  {paraAsignar > 0 ? '✅ Tienes dinero sin asignar — distribúyelo en categorías' :
                   paraAsignar === 0 ? '✅ Perfecto — todo el dinero está asignado' :
                   '🔴 Te pasaste — asignaste más de lo que tienes disponible'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>Saldo neto</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{saldoNeto < 0 ? '-' : ''}{fmt(Math.abs(saldoNeto))}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 8, marginBottom: 4 }}>Total asignado</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{fmt(totalAsignado)}</div>
              </div>
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
                  <button onClick={() => { setFormMover({ desde: catsGasto.find(c => (presupuesto[c.id] || 0) - (gastoActual[c.id] || 0) > 0)?.id || '', hacia: overspendCats[0]?.id || '', monto: '' }); setModalMover(true) }}
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
                {catsIngreso.map(cat => {
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
                  {['Categoría', 'Objetivo', 'Asignado', 'Gastado', 'Disponible'].map((h, i) => (
                    <th key={i} style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '10px 14px', borderBottom: '2px solid #a5b4fc', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catsGastoGrupos.map(grupo => {
                  const gId = grupo.grupo.replace(/\s+/g, '_')
                  const isCollapsed = collapsedGroups.has(gId)
                  const grupoAsignado = grupo.cats.reduce((s, c) => s + (asignados[c.id] || 0), 0)
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
                            asig: {fmt(grupoAsignado)} · gast: {fmt(grupoGastado)} · obj: {fmt(grupoPresup)}
                          </span>
                        </div>
                      </td>
                    </tr>,
                    ...(!isCollapsed ? grupo.cats.map(cat => {
                      const obj = presupuesto[cat.id] || 0
                      const asig = (asignados[cat.id] || 0) + (arrastres[cat.id] || 0)
                      const real = gastoActual[cat.id] || 0
                      const disp = asig - real
                      const pct = asig > 0 ? Math.min((real / asig) * 100, 100) : (real > 0 ? 100 : 0)
                      const barColor = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f97316' : '#3b82f6'
                      const dispColor = disp < 0 ? '#dc2626' : pct >= 80 ? '#d97706' : '#2563eb'
                      const arrStr = arrastres[cat.id] > 0 ? ` (+${fmt(arrastres[cat.id])} arrastrado)` : ''
                      return (
                        <tr key={cat.id} style={{ borderBottom: '1px solid #f1f5ff' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f8faff'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 500 }}>
                              <div style={{ width: 9, height: 9, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                              <div>
                                {cat.label}
                                {arrStr && <div style={{ fontSize: 11, color: '#059669', fontFamily: 'DM Mono, monospace' }}>{arrStr}</div>}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            <input
                              defaultValue={fmtInput(obj)}
                              onBlur={e => handlePresupuestoChange(cat.id, e.target.value)}
                              onFocus={e => { e.target.value = obj || '' }}
                              style={{ background: '#f5f7ff', border: '1px solid #c7d2fe', color: '#94a3b8', fontFamily: 'DM Mono, monospace', fontSize: 13, textAlign: 'right', padding: '5px 10px', borderRadius: 5, width: 120 }}
                            />
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            <input
                              defaultValue={fmtInput(asignados[cat.id] || 0)}
                              onBlur={e => handleAsignado(cat.id, e.target.value)}
                              onFocus={e => { e.target.value = asignados[cat.id] || '' }}
                              style={{ background: asig > 0 ? '#eff6ff' : '#f5f7ff', border: `1px solid ${asig > 0 ? '#93c5fd' : '#c7d2fe'}`, color: '#0f172a', fontFamily: 'DM Mono, monospace', fontSize: 13, textAlign: 'right', padding: '5px 10px', borderRadius: 5, width: 120, fontWeight: asig > 0 ? 600 : 400 }}
                            />
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14 }}>
                            <div>{fmt(real)}</div>
                            <div style={{ height: 4, background: '#e0e7ff', borderRadius: 2, overflow: 'hidden', marginTop: 4, width: 80, marginLeft: 'auto' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2 }} />
                            </div>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {transacciones.map((tx, idx) => {
                  // Duplicate detection
                  const isDuplicate = transacciones.some((other, otherIdx) =>
                    otherIdx !== idx &&
                    other.monto === tx.monto &&
                    other.tipo === tx.tipo &&
                    Math.abs(new Date(other.fecha) - new Date(tx.fecha)) <= 86400000 * 3
                  )
                  return (
                    <div key={tx.id} style={{
                      borderRadius: 8, background: isDuplicate ? '#fffbeb' : '#fff',
                      border: `1px solid ${isDuplicate ? '#fcd34d' : '#e0e7ff'}`,
                      overflow: 'hidden'
                    }}>
                      {isDuplicate && (
                        <div style={{ background: '#fef3c7', padding: '4px 14px', fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                          ⚠️ Posible duplicado — mismo monto en fechas cercanas. ¿Es correcto?
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '95px 1fr 200px 110px 70px', alignItems: 'start', gap: 12, padding: '11px 14px' }}>
                        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#475569', fontWeight: 500, paddingTop: 2 }}>
                          {tx.fecha.split('-').reverse().join('/')}
                        </div>
                        <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.4, wordBreak: 'break-word' }}>
                          {tx.concepto}
                          {tx.cuenta && tx.cuenta !== 'Banorte' && (
                            <span style={{ marginLeft: 6, fontSize: 10, background: '#e0e7ff', color: '#4f46e5', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>{tx.cuenta}</span>
                          )}
                        </div>
                        <select value={tx.categoria} onChange={e => handleUpdateCat(tx.id, e.target.value, tx.concepto)}
                          style={{ background: '#f5f7ff', border: '1px solid #c7d2fe', color: '#0f172a', fontSize: 12, padding: '4px 7px', borderRadius: 5, width: '100%', cursor: 'pointer' }}>
                          <optgroup label="↑ Ingresos">
                            {catsIngreso.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </optgroup>
                          {catsGastoGrupos.map(g => (
                            <optgroup key={g.grupo} label={g.grupo}>
                              {g.cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 600, textAlign: 'right', color: tx.tipo === 'ingreso' ? '#059669' : '#dc2626', paddingTop: 2 }}>
                          {tx.tipo === 'ingreso' ? '+' : '-'}{fmt(tx.monto)}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 2 }}>
                          <button onClick={() => handleDeleteTx(tx.id)}
                            style={{ background: 'none', border: '1px solid #fee2e2', color: '#dc2626', padding: '4px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>✕</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── MODALS ── */}

      {/* Saldo inicial cuenta */}
      <Modal open={modalCuenta} onClose={() => setModalCuenta(false)} title={`Saldo inicial — ${formCuenta.nombre}`} subtitle="El saldo con el que arranca esta cuenta al inicio del mes.">
        <Field label={`Saldo inicial ${formCuenta.nombre} ($MXN)`}>
          <input type="number" value={formCuenta.monto} onChange={e => setFormCuenta(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" step="0.01" style={inputStyle} />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={() => setModalCuenta(false)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleSaveCuenta} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Guardar</button>
        </div>
      </Modal>

      {/* Reconciliar */}
      <Modal open={modalReconciliar} onClose={() => setModalReconciliar(false)} title={`Reconciliar — ${formReconciliar.nombre}`} subtitle="Ingresa el saldo real que muestra tu banco/app ahorita. Si hay diferencia, la app se ajusta automáticamente.">
        <Field label={`Saldo real en ${formReconciliar.nombre} ahorita ($MXN)`}>
          <input type="number" value={formReconciliar.saldoReal} onChange={e => setFormReconciliar(p => ({ ...p, saldoReal: e.target.value }))} placeholder="0.00" step="0.01" style={inputStyle} autoFocus />
        </Field>
        <div style={{ background: '#f5f7ff', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#475569', marginTop: 4 }}>
          💡 La app calcula que tienes: <strong style={{ fontFamily: 'DM Mono, monospace' }}>{fmt(cuentas.find(c => c.nombre === formReconciliar.nombre)?.saldoActual || 0)}</strong>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={() => setModalReconciliar(false)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleReconciliar} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Reconciliar</button>
        </div>
      </Modal>

      {/* Ingreso */}
      <Modal open={modalIngreso} onClose={() => setModalIngreso(false)} title="Registrar ingreso" subtitle="Agrega un ingreso manualmente">
        <Field label="Fecha"><input type="date" value={formIngreso.fecha} onChange={e => setFormIngreso(p => ({ ...p, fecha: e.target.value }))} style={inputStyle} /></Field>
        <Field label="Concepto"><input type="text" value={formIngreso.concepto} onChange={e => setFormIngreso(p => ({ ...p, concepto: e.target.value }))} placeholder="Ej: Pago cliente X" style={inputStyle} /></Field>
        <Field label="Monto ($MXN)"><input type="number" value={formIngreso.monto} onChange={e => setFormIngreso(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" step="0.01" style={inputStyle} /></Field>
        <Field label="Categoría">
          <select value={formIngreso.categoria} onChange={e => setFormIngreso(p => ({ ...p, categoria: e.target.value }))} style={selectStyle}>
            {catsIngreso.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Cuenta">
          <select value={formIngreso.cuenta} onChange={e => setFormIngreso(p => ({ ...p, cuenta: e.target.value }))} style={selectStyle}>
            {CUENTAS_DEFAULT.filter(c => c.tipo === 'debito').map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
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
        <Field label="Cuenta">
          <select value={formGasto.cuenta} onChange={e => setFormGasto(p => ({ ...p, cuenta: e.target.value }))} style={selectStyle}>
            {CUENTAS_DEFAULT.map(c => <option key={c.nombre} value={c.nombre}>{c.tipo === 'credito' ? '💳 ' : '🏦 '}{c.nombre}</option>)}
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
            {catsGasto.filter(c => (presupuesto[c.id] || 0) - (gastoActual[c.id] || 0) > 0).map(c => {
              const disp = (presupuesto[c.id] || 0) - (gastoActual[c.id] || 0)
              return <option key={c.id} value={c.id}>{c.label} — disponible: {fmt(disp)}</option>
            })}
          </select>
        </Field>
        <Field label="Dar a">
          <select value={formMover.hacia} onChange={e => setFormMover(p => ({ ...p, hacia: e.target.value }))} style={selectStyle}>
            {[...overspendCats, ...catsGasto.filter(c => !overspendCats.includes(c))].map(c => {
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

      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onCatsChanged={() => { loadCategories(); loadData() }}
        />
      )}

      <Notif msg={notif} onClose={() => setNotif('')} />
    </div>
  )
}
