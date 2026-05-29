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
  getDeadlines, setDeadline,
  getTransacciones, addTransaccion, updateTransaccionCat, deleteTransaccion, marcarNoDuplicado,
  getSaldosCuentas, setSaldoInicial, reconciliar, CUENTAS_DEFAULT,
  getClabeMap, saveClabe,
  getApartadosTarjeta, addApartadoTarjeta, pagarTarjeta,
} from './db'
import Settings from './Settings.jsx'
import { supabase } from './supabase'
import './App.css'

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
function simplifyConcepto(raw) {
  // SPEI RECIBIDO: extraer CONCEPTO:
  if (raw.includes('SPEI RECIBIDO')) {
    const m = raw.match(/CONCEPTO:\s*(.+?)\s+REFERENCIA/i)
    if (m) return m[1].trim()
  }
  // COMPRA ORDEN DE PAGO SPEI: extraer CONCEPTO: o BENEF:
  if (raw.includes('COMPRA ORDEN DE PAGO SPEI') || raw.includes('ORDEN DE PAGO SPEI')) {
    const mc = raw.match(/CONCEPTO:\s*(.+?)(?:\s+CVE|\s+REFERENCIA|$)/i)
    if (mc) return mc[1].trim()
    const mb = raw.match(/BENEF:\s*(.+?)(?:\s+\(DATO|\s+CVE|$)/i)
    if (mb) return mb[1].trim()
  }
  // TEF / transferencia genérica
  if (raw.includes('TEF BCO')) {
    const mb = raw.match(/(?:TEF BCO:\d+\s+)(.+?)(?:\s+CTA\/CLABE|$)/i)
    if (mb) return mb[1].trim()
  }
  return raw
}

function dedupeKey(tx) {
  // Clave única: fecha + monto + tipo + primeros 60 chars del concepto RAW (antes de simplificar)
  return `${tx.fecha}|${tx.monto}|${tx.tipo}|${tx.rawConcepto.substring(0, 60)}`
}

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
    const rawConcepto = rest.substring(0, lastComma0).trim().replace(/^"|"$/g, '')
    const cargosStr = rest.substring(lastComma0 + 1, lastComma1).trim()
    const abonosStr = rest.substring(lastComma1 + 1, lastComma2).trim()
    if (!fecha || !rawConcepto) continue
    if (shouldExclude(rawConcepto)) continue
    const parts = fecha.split('/')
    if (parts.length !== 3) continue
    const isoDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    const mes = isoDate.substring(0, 7)
    const cargo = parseFloat(cargosStr) || 0
    const abono = parseFloat(abonosStr) || 0
    if (cargo === 0 && abono === 0) continue
    const tipo = abono > 0 ? 'ingreso' : 'gasto'
    const monto = abono > 0 ? abono : Math.abs(cargo)
    const display = simplifyConcepto(rawConcepto)
    const categoria = categorizeAuto(display, tipo)
    txs.push({ mes, fecha: isoDate, concepto: display, rawConcepto, monto, tipo, categoria })
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
  const [apartados, setApartados] = useState([])
  const [modalApartar, setModalApartar] = useState(false)
  const [modalDetalleTarjeta, setModalDetalleTarjeta] = useState(null) // null o nombre de cuenta
  const [modalPagar, setModalPagar] = useState(false)
  const [formApartar, setFormApartar] = useState({ cuenta: '', monto: '', desde: '' })
  const [formPagar, setFormPagar] = useState({ cuentaCredito: '', cuentaDebito: 'Banorte', monto: '', fecha: '' })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('presupuesto')
  const [notif, setNotif] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const [filtroDisponible, setFiltroDisponible] = useState(false)
  const [filtroCuentaTx, setFiltroCuentaTx] = useState('todas')
  const [cuentaPorCuenta, setCuentaPorCuenta] = useState('Banorte')
  const [inputAsignado, setInputAsignado] = useState({}) // { [cat.id]: string }
  const [showSettings, setShowSettings] = useState(false)
  const [showReconciliar, setShowReconciliar] = useState(false)
  const [arrastres, setArrastres] = useState({})
  const [asignados, setAsignados] = useState({})
  const [deadlines, setDeadlines] = useState({})
  const [clabeMap, setClabeMap] = useState({})
  const [modalDeadline, setModalDeadline] = useState(false)
  const [formDeadline, setFormDeadline] = useState({ catId: '', catLabel: '', fecha: '', frecuencia: 'unica' })

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
      const [pres, txs, arr, cts, asig, clMap, dlns, aps] = await Promise.all([
        getPresupuesto(currentMonth),
        getTransacciones(currentMonth),
        getArrastres(currentMonth),
        getSaldosCuentas(currentMonth),
        getAsignados(currentMonth),
        getClabeMap(),
        getDeadlines(currentMonth),
        getApartadosTarjeta(currentMonth),
      ])
      setPresupuestoState(pres)
      setTransacciones(txs)
      setArrastres(arr)
      setCuentasState(cts)
      setAsignados(asig)
      setClabeMap(clMap)
      setDeadlines(dlns)
      setApartados(aps)
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
  // Set de cuentas crédito para identificar gastos de tarjeta
  const cuentasCredito = new Set(cuentas.filter(c => c.tipo === 'credito').map(c => c.nombre))

  const ingresoActual = {}
  const gastoActual = {}
  // Pagos a tarjetas por cuenta — para calcular pago disponible
  const pagosPorCuenta = {}
  for (const tx of transacciones) {
    // IGNORAR transferencias (pagos de tarjeta) en cálculos de ingresos/gastos del mes
    if (tx.es_transferencia) {
      // Pero sí trackear los pagos hechos a cada tarjeta
      if (tx.tipo === 'ingreso' && cuentasCredito.has(tx.cuenta)) {
        pagosPorCuenta[tx.cuenta] = (pagosPorCuenta[tx.cuenta] || 0) + Number(tx.monto)
      }
      continue
    }
    if (tx.tipo === 'ingreso') {
      ingresoActual[tx.categoria] = (ingresoActual[tx.categoria] || 0) + Number(tx.monto)
    } else {
      gastoActual[tx.categoria] = (gastoActual[tx.categoria] || 0) + Math.abs(Number(tx.monto))
    }
  }
  const totalIngresos = Object.values(ingresoActual).reduce((a, b) => a + b, 0)
  const totalGastos = Object.values(gastoActual).reduce((a, b) => a + b, 0)
  const totalPresupuestado = Object.values(presupuesto).reduce((a, b) => a + b, 0)
  const resultado = totalIngresos - totalGastos
  const margen = totalIngresos > 0 ? (resultado / totalIngresos * 100).toFixed(1) : 0

  // Saldo neto = débito - crédito
  const saldoNeto = cuentas.reduce((s, c) => c.tipo === 'credito' ? s - Math.abs(c.saldoActual) : s + c.saldoActual, 0)
  const saldoDebito = cuentas.filter(c => c.tipo === 'debito').reduce((s, c) => s + c.saldoActual, 0)
  const deudaCredito = cuentas.filter(c => c.tipo === 'credito').reduce((s, c) => s + Math.abs(c.saldoActual), 0)

  // ── Lógica YNAB de tarjeta de crédito ──
  // Por cada cuenta crédito, calcula:
  //   - cubierto: gastos cubiertos por dinero asignado en categorías
  //   - descubierto: gastos sin cobertura (overspending real)
  //   - apartadosManuales: dinero apartado manualmente con botón "Apartar"
  //   - pagosHechos: transferencias ya registradas hacia esta tarjeta
  //   - pagoDisponible: cubierto + apartados - pagosHechos
  const cuentasCreditoArr = cuentas.filter(c => c.tipo === 'credito')
  const cuentaInfo = {} // { [nombreCuenta]: { cubierto, descubierto, apartados, pagos, disponible } }
  let creditDescubiertoTotal = 0
  for (const cc of cuentasCreditoArr) {
    let cubierto = 0
    let descubierto = 0
    // Por categoría, ver gastos hechos con esta cuenta crédito
    for (const cat of catsGasto) {
      const gastoTarjeta = transacciones
        .filter(t => !t.es_transferencia && t.tipo === 'gasto' && t.categoria === cat.id && t.cuenta === cc.nombre)
        .reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
      if (gastoTarjeta === 0) continue
      const asig = (asignados[cat.id] || 0) + (arrastres[cat.id] || 0)
      cubierto += Math.min(gastoTarjeta, asig)
      descubierto += Math.max(0, gastoTarjeta - asig)
    }
    const apartadosManuales = apartados.filter(a => a.cuenta === cc.nombre).reduce((s, a) => s + Number(a.monto), 0)
    const pagosHechos = pagosPorCuenta[cc.nombre] || 0
    const pagoDisponible = Math.max(0, cubierto + apartadosManuales - pagosHechos)
    cuentaInfo[cc.nombre] = { cubierto, descubierto, apartadosManuales, pagosHechos, pagoDisponible }
    creditDescubiertoTotal += descubierto
  }

  // Apartados manuales totales (salen del Listo para asignar porque movieron dinero de categorías)
  const apartadosTotales = apartados.reduce((s, a) => s + Number(a.monto), 0)

  // Gastos que salieron de cuentas DÉBITO
  // SÍ contamos transferencias hacia tarjeta (porque ese dinero también salió de débito y bajó el saldo)
  let gastosDebito = 0
  for (const tx of transacciones) {
    if (tx.tipo === 'gasto' && !cuentasCredito.has(tx.cuenta)) {
      gastosDebito += Math.abs(Number(tx.monto))
    }
  }

  const totalAsignado = Object.values(asignados).reduce((a, b) => a + b, 0)
  // Apartados que vinieron directo del Listo para asignar (no descontaron categoría)
  const apartadosDesdeListo = apartados.filter(a => a.desde_categoria === '__listo__').reduce((s, a) => s + Number(a.monto), 0)
  // Listo para asignar:
  // = saldo débito + gastos débito - asignado - descubierto en tarjeta - apartados directos
  // Los apartados desde categorías NO se restan (ya redujeron el asignado de su categoría origen)
  const paraAsignar = saldoDebito + gastosDebito - totalAsignado - creditDescubiertoTotal - apartadosDesdeListo

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
      const res = await deleteTransaccion(id)
      notify(res?.deleted > 1 ? `✓ Transferencia eliminada (${res.deleted} transacciones)` : '✓ Transacción eliminada')
      await loadData()
    } catch (e) { notify('Error: ' + e.message) }
  }

  const calcAsignado = (val, current) => {
    const str = String(val).trim().replace(/,/g, '')
    // Caso: "800+200", "1000-300", "500*2", "1000/4"
    const exprMatch = str.match(/^(\d+\.?\d*)\s*([+\-*/])\s*(\d+\.?\d*)$/)
    if (exprMatch) {
      const a = parseFloat(exprMatch[1])
      const op = exprMatch[2]
      const b = parseFloat(exprMatch[3])
      if (op === '+') return Math.max(0, a + b)
      if (op === '-') return Math.max(0, a - b)
      if (op === '*') return Math.max(0, a * b)
      if (op === '/' && b !== 0) return Math.max(0, a / b)
    }
    // Caso: "+200", "-100" (solo operador + número, suma/resta al actual)
    const opMatch = str.match(/^([+\-])(\d+\.?\d*)$/)
    if (opMatch) {
      const op = opMatch[1]
      const n = parseFloat(opMatch[2])
      const base = current || 0
      if (op === '+') return Math.max(0, base + n)
      if (op === '-') return Math.max(0, base - n)
    }
    return parseFmt(val)
  }

  const handleAsignado = async (cat, val) => {
    const current = asignados[cat] || 0
    const monto = calcAsignado(val, current)
    setAsignados(prev => ({ ...prev, [cat]: monto }))
    try { await setAsignado(currentMonth, cat, monto) }
    catch (e) { notify('Error guardando: ' + e.message) }
  }

  const handleDeadlineSave = async () => {
    try {
      const freq = formDeadline.frecuencia || 'unica'
      await setDeadline(currentMonth, formDeadline.catId, formDeadline.fecha || null, freq)
      setDeadlines(prev => ({ ...prev, [formDeadline.catId]: formDeadline.fecha ? { fecha: formDeadline.fecha, frecuencia: freq } : null }))
      setModalDeadline(false)
      notify(`✓ Fecha límite guardada`)
    } catch (e) { notify('Error: ' + e.message) }
  }

  // Helper para obtener fecha y frecuencia de un deadline
  function getDeadlineInfo(catId) {
    const dl = deadlines[catId]
    if (!dl) return null
    if (typeof dl === 'string') return { fecha: dl, frecuencia: 'unica' }
    return { fecha: dl.fecha, frecuencia: dl.frecuencia || 'unica' }
  }

  // Calcula la fecha efectiva del deadline considerando la frecuencia
  // Si la fecha original ya pasó y es recurrente, avanza al siguiente periodo
  function getNextDeadline(fechaStr, frecuencia) {
    if (!fechaStr) return null
    const fecha = new Date(fechaStr)
    if (frecuencia === 'unica') return fecha
    const ahora = new Date()
    let next = new Date(fecha)
    while (next < ahora) {
      if (frecuencia === 'quincenal') next.setDate(next.getDate() + 15)
      else if (frecuencia === 'mensual') next.setMonth(next.getMonth() + 1)
      else break
    }
    return next
  }

  // Deadline alerts — categorías con fecha próxima y sin suficiente asignado
  const hoy = new Date()
  const deadlineAlerts = catsGasto.filter(c => {
    const info = getDeadlineInfo(c.id)
    if (!info) return false
    const dl = getNextDeadline(info.fecha, info.frecuencia)
    if (!dl) return false
    const diasRestantes = Math.ceil((dl - hoy) / 86400000)
    const asig = asignados[c.id] || 0
    const obj = presupuesto[c.id] || 0
    return diasRestantes <= 7 && diasRestantes >= 0 && asig < obj
  }).map(c => {
    const info = getDeadlineInfo(c.id)
    const dl = getNextDeadline(info.fecha, info.frecuencia)
    const diasRestantes = Math.ceil((dl - hoy) / 86400000)
    const asig = asignados[c.id] || 0
    const obj = presupuesto[c.id] || 0
    return { ...c, diasRestantes, falta: obj - asig }
  })

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

  const handleMarcarNoDuplicado = async (id) => {
    try {
      await marcarNoDuplicado(id)
      await loadData()
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handleMover = async () => {
    const monto = parseFloat(formMover.monto)
    if (!formMover.desde || !formMover.hacia) { notify('⚠️ Selecciona origen y destino'); return }
    if (formMover.desde === formMover.hacia) { notify('⚠️ Origen y destino deben ser distintos'); return }
    if (!monto || monto <= 0) { notify('⚠️ Ingresa un monto válido'); return }
    const desdeListo = formMover.desde === '__listo__'
    try {
      const asigHacia = asignados[formMover.hacia] || 0
      if (desdeListo) {
        // Tomar de Listo para asignar: solo aumenta el destino (paraAsignar baja solo porque sube totalAsignado)
        if (monto > paraAsignar) { notify(`⚠️ Solo tienes ${fmt(paraAsignar)} disponible para asignar`); return }
        setAsignados(prev => ({ ...prev, [formMover.hacia]: asigHacia + monto }))
        await setAsignado(currentMonth, formMover.hacia, asigHacia + monto)
      } else {
        const asigDesde = asignados[formMover.desde] || 0
        setAsignados(prev => ({ ...prev, [formMover.desde]: asigDesde - monto, [formMover.hacia]: asigHacia + monto }))
        await Promise.all([
          setAsignado(currentMonth, formMover.desde, asigDesde - monto),
          setAsignado(currentMonth, formMover.hacia, asigHacia + monto),
        ])
      }
      setModalMover(false)
      const dLabel = desdeListo ? 'Listo para asignar' : (catsGasto.find(c => c.id === formMover.desde)?.label || formMover.desde)
      const hLabel = catsGasto.find(c => c.id === formMover.hacia)?.label || formMover.hacia
      notify(`✓ ${fmt(monto)} movido de ${dLabel} → ${hLabel}`)
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handleApartar = async () => {
    const monto = parseFloat(formApartar.monto)
    if (!formApartar.desde) { notify('⚠️ Selecciona origen'); return }
    if (!monto || monto <= 0) { notify('⚠️ Ingresa un monto válido'); return }
    const desdeListo = formApartar.desde === '__listo__'
    if (desdeListo) {
      if (monto > paraAsignar) { notify(`⚠️ Solo tienes ${fmt(paraAsignar)} disponible para asignar`); return }
    } else {
      const asigDesde = asignados[formApartar.desde] || 0
      const dispDesde = asigDesde - (gastoActual[formApartar.desde] || 0)
      if (monto > dispDesde) { notify(`⚠️ Solo hay ${fmt(dispDesde)} disponible en esa categoría`); return }
    }
    try {
      if (!desdeListo) {
        const asigDesde = asignados[formApartar.desde] || 0
        setAsignados(prev => ({ ...prev, [formApartar.desde]: asigDesde - monto }))
        await setAsignado(currentMonth, formApartar.desde, asigDesde - monto)
      }
      // Si viene del Listo para asignar, no se descuenta de ninguna categoría;
      // el apartado simplemente reduce el paraAsignar al ser parte del cálculo
      await addApartadoTarjeta(currentMonth, formApartar.cuenta, monto, desdeListo ? '__listo__' : formApartar.desde)
      setModalApartar(false)
      const origenLabel = desdeListo ? 'Listo para asignar' : (catsGasto.find(c => c.id === formApartar.desde)?.label || formApartar.desde)
      notify(`✓ ${fmt(monto)} apartado de ${origenLabel} → ${formApartar.cuenta}`)
      await loadData()
    } catch (e) { notify('Error: ' + e.message) }
  }

  const handlePagar = async () => {
    const monto = parseFloat(formPagar.monto)
    if (!monto || monto <= 0) { notify('⚠️ Ingresa un monto válido'); return }
    if (!formPagar.fecha) { notify('⚠️ Ingresa fecha'); return }
    if (formPagar.cuentaDebito === formPagar.cuentaCredito) { notify('⚠️ Las cuentas deben ser distintas'); return }
    // Validar que no se pague más del pago disponible (evita "disponible fantasma" en categorías)
    const pagoDispCC = cuentaInfo[formPagar.cuentaCredito]?.pagoDisponible || 0
    if (monto > pagoDispCC + 0.01) {
      notify(`⚠️ Pago disponible es ${fmt(pagoDispCC)}. Para pagar más, primero "Aparta" dinero de categorías.`)
      return
    }
    try {
      const mes = formPagar.fecha.substring(0, 7)
      await pagarTarjeta(mes, formPagar.fecha, formPagar.cuentaDebito, formPagar.cuentaCredito, monto)
      setModalPagar(false)
      notify(`✓ Pagaste ${fmt(monto)} a ${formPagar.cuentaCredito}`)
      await loadData()
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
      <div className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', background: '#fff', borderBottom: '2px solid #c7d2fe', position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="app-header-brand" style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, fontWeight: 500, color: '#4f46e5', letterSpacing: '0.08em' }}>
          CROMÁTICA <span style={{ color: '#94a3b8' }}>/ presupuesto</span>
        </div>
        <div className="app-header-month" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => changeMonth(-1)} style={{ background: 'none', border: '1px solid #c7d2fe', color: '#94a3b8', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>‹</button>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#0f172a', minWidth: 120, textAlign: 'center', textTransform: 'capitalize' }}>{formatMonthLabel(currentMonth)}</div>
          <button onClick={() => changeMonth(1)} style={{ background: 'none', border: '1px solid #c7d2fe', color: '#94a3b8', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>›</button>
        </div>
        <div className="app-header-actions" style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setFormIngreso({ fecha: new Date().toISOString().split('T')[0], concepto: '', monto: '', categoria: 'VentasDirectas' }); setModalIngreso(true) }} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#475569' }}>+ Ingreso</button>
          <button onClick={() => { setFormGasto({ fecha: new Date().toISOString().split('T')[0], concepto: '', monto: '', categoria: 'Viniles', cuenta: 'MP Tarjeta' }); setModalGasto(true) }} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#475569' }}>+ Gasto</button>
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
      <div className="tabs-bar" style={{ display: 'flex', padding: '0 28px', background: '#fff', borderBottom: '2px solid #c7d2fe' }}>
        {[
          { id: 'presupuesto', label: 'Presupuesto' },
          { id: 'transacciones', label: 'Transacciones' },
          { id: 'por_cuenta', label: 'Por cuenta' },
        ].map(tab => (
          <div key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '12px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            color: activeTab === tab.id ? '#4f46e5' : '#94a3b8',
            borderBottom: activeTab === tab.id ? '2px solid #4f46e5' : '2px solid transparent',
            userSelect: 'none'
          }}>{tab.label}</div>
        ))}
      </div>

      <div className="app-main" style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>

        {/* ── TAB: PRESUPUESTO ── */}
        {activeTab === 'presupuesto' && (
          <>
            {/* SUMMARY CARDS */}
            <div className="summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
              <div style={{ background: '#fff', border: '1px solid #e0e7ff', borderTop: '3px solid #059669', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Ingresos del mes</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 500, color: '#059669' }}>{fmt(totalIngresos)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{transacciones.filter(t => t.tipo === 'ingreso' && !t.es_transferencia).length} transacciones</div>
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
            <div className="cuentas-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
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
            <div className="listo-asignar-banner" style={{
              borderRadius: 12,
              marginBottom: deudaCredito > 0 ? 0 : 20,
              background: paraAsignar > 0 ? 'linear-gradient(135deg, #059669, #10b981)' :
                          paraAsignar >= -1 ? 'linear-gradient(135deg, #4f46e5, #7c3aed)' :
                          'linear-gradient(135deg, #dc2626, #ef4444)',
              padding: '20px 28px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
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
                   paraAsignar >= -1 ? '✅ Perfecto — todo el dinero está asignado' :
                   '🔴 Te pasaste — asignaste más de lo que tienes disponible'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>En cuentas débito</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{fmt(saldoDebito)}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 8, marginBottom: 4 }}>Total asignado</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{fmt(totalAsignado)}</div>
              </div>
            </div>

            {/* TARJETAS DE CRÉDITO */}
            {cuentasCreditoArr.map(cc => {
              const info = cuentaInfo[cc.nombre] || { pagoDisponible: 0, descubierto: 0, apartadosManuales: 0, pagosHechos: 0, cubierto: 0 }
              const deuda = Math.abs(cc.saldoActual)
              return (
                <div key={cc.nombre} style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '14px 20px', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e' }}>💳 {cc.nombre}</div>
                      <div style={{ fontSize: 11, color: '#92400e', opacity: 0.8, marginTop: 2 }}>Tarjeta de crédito</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: '#92400e', opacity: 0.7 }}>Deuda actual</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 700, color: '#dc2626' }}>-{fmt(deuda)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid #fed7aa', paddingTop: 10 }}>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontSize: 11, color: '#92400e', opacity: 0.7 }}>Pago disponible</div>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 16, fontWeight: 700, color: info.pagoDisponible > 0 ? '#15803d' : '#94a3b8' }}>
                        {fmt(info.pagoDisponible)}
                      </div>
                      <div style={{ fontSize: 10, color: '#92400e', opacity: 0.6, marginTop: 2 }}>
                        Cubierto: {fmt(info.cubierto)} · Apartado: {fmt(info.apartadosManuales)} · Pagado: {fmt(info.pagosHechos)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setModalDetalleTarjeta(cc.nombre)} style={{
                        padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: 'none', color: '#92400e', border: '1px solid #fed7aa'
                      }}>👁 Detalle</button>
                      <button onClick={() => { setFormApartar({ cuenta: cc.nombre, monto: '', desde: '' }); setModalApartar(true) }} style={{
                        padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: 'none', color: '#92400e', border: '1px solid #fed7aa'
                      }}>↔ Apartar</button>
                      <button onClick={() => { setFormPagar({ cuentaCredito: cc.nombre, cuentaDebito: 'Banorte', monto: String(info.pagoDisponible || ''), fecha: new Date().toISOString().split('T')[0] }); setModalPagar(true) }} style={{
                        padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: '#dc2626', color: '#fff', border: 'none'
                      }}>💵 Pagar</button>
                    </div>
                  </div>
                  {info.descubierto > 0 && (
                    <div style={{ marginTop: 10, padding: 8, background: '#fef2f2', borderRadius: 7, fontSize: 12, color: '#dc2626' }}>
                      ⚠️ Gastaste {fmt(info.descubierto)} con la tarjeta sin tener dinero asignado en las categorías
                    </div>
                  )}
                </div>
              )
            })}

            {/* OVERSPENDING BANNER */}
            {overspendCats.length > 0 && (
              <div style={{ background: '#fef2f2', border: '2px solid #ef4444', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#dc2626' }}>⚠️ Overspending detectado</div>
                    <div style={{ fontSize: 13, color: '#991b1b', marginTop: 2 }}>
                      {overspendCats.length} categoría{overspendCats.length > 1 ? 's' : ''} excedida{overspendCats.length > 1 ? 's' : ''} · Total sin cubrir: {fmt(overspendCats.reduce((s, c) => s + ((gastoActual[c.id] || 0) - (asignados[c.id] || 0)), 0))}
                    </div>
                  </div>
                  <button onClick={() => {
                    const catConDinero = catsGasto.find(c => (asignados[c.id] || 0) - (gastoActual[c.id] || 0) > 0)
                    const catOS = overspendCats[0]
                    const exceso = catOS ? (gastoActual[catOS.id] || 0) - (asignados[catOS.id] || 0) : 0
                    setFormMover({ desde: catConDinero?.id || '', hacia: catOS?.id || '', monto: exceso > 0 ? String(Math.ceil(exceso)) : '' })
                    setModalMover(true)
                  }}
                    style={{ padding: '7px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Cubrir ahora →
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {overspendCats.map(c => {
                    const exceso = (gastoActual[c.id] || 0) - (asignados[c.id] || 0)
                    return <span key={c.id} style={{ background: '#fee2e2', color: '#dc2626', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{c.label} -{fmt(exceso)}</span>
                  })}
                </div>
              </div>
            )}

            {/* DEADLINE ALERTS */}
            {deadlineAlerts.length > 0 && (
              <div style={{ background: '#fffbeb', border: '2px solid #fcd34d', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>⏰ Fechas límite próximas</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {deadlineAlerts.map(c => (
                    <span key={c.id} style={{ background: c.diasRestantes <= 2 ? '#fee2e2' : '#fef3c7', color: c.diasRestantes <= 2 ? '#dc2626' : '#92400e', padding: '5px 12px', borderRadius: 20, fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>
                      {c.label} — {c.diasRestantes === 0 ? '¡hoy!' : `${c.diasRestantes}d`} — falta {fmt(c.falta)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '20px 0 8px' }}>Ingresos</div>
            <table className="budget-table budget-table-ingresos" style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 10, overflow: 'hidden' }}>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '24px 0 8px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Gastos</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setFormMover({ desde: '', hacia: '', monto: '' }); setModalMover(true) }} style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: 'none', color: '#4f46e5', border: '1px solid #c7d2fe', transition: 'all 0.15s'
                }}>
                  ↔ Mover dinero
                </button>
                <button onClick={() => setFiltroDisponible(p => !p)} style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: filtroDisponible ? '#4f46e5' : 'none',
                  color: filtroDisponible ? '#fff' : '#94a3b8',
                  border: `1px solid ${filtroDisponible ? '#4f46e5' : '#c7d2fe'}`,
                  transition: 'all 0.15s'
                }}>
                  {filtroDisponible ? '✓ Con dinero' : 'Ver con dinero'}
                </button>
              </div>
            </div>
            <table className="budget-table" style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 10, overflow: 'hidden' }}>
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
                  // Con filtro activo, ocultar grupos donde ninguna cat tiene dinero disponible
                  if (filtroDisponible) {
                    const tieneDisponible = grupo.cats.some(c => {
                      const asig = (asignados[c.id] || 0) + (arrastres[c.id] || 0)
                      return (asig - (gastoActual[c.id] || 0)) > 0
                    })
                    if (!tieneDisponible) return null
                  }
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
                    ...(!isCollapsed ? grupo.cats.filter(cat => {
                      // Ocultar categorías legacy de pago de tarjeta
                      if (cat.id === 'PagoMPTarjeta' || cat.id === 'PagoTDCMercadopago') return false
                      if (!filtroDisponible) return true
                      const asig = (asignados[cat.id] || 0) + (arrastres[cat.id] || 0)
                      const real = gastoActual[cat.id] || 0
                      return (asig - real) > 0
                    }).map(cat => {
                      const obj = presupuesto[cat.id] || 0
                      const asig = (asignados[cat.id] || 0) + (arrastres[cat.id] || 0)
                      const real = gastoActual[cat.id] || 0
                      const disp = asig - real
                      const pct = asig > 0 ? Math.min((real / asig) * 100, 100) : (real > 0 ? 100 : 0)
                      const pctObj = obj > 0 ? Math.min(((asignados[cat.id] || 0) / obj) * 100, 100) : 0
                      const barColor = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f97316' : '#3b82f6'
                      const dispColor = disp < 0 ? '#dc2626' : pct >= 80 ? '#d97706' : '#2563eb'
                      const arrStr = arrastres[cat.id] > 0 ? ` (+${fmt(arrastres[cat.id])} arrastrado)` : ''
                      const dlInfo = getDeadlineInfo(cat.id)
                      const dl = dlInfo?.fecha
                      const dlFreq = dlInfo?.frecuencia || 'unica'
                      const dlDate = dlInfo ? getNextDeadline(dlInfo.fecha, dlInfo.frecuencia) : null
                      const diasDl = dlDate ? Math.ceil((dlDate - hoy) / 86400000) : null
                      const dlColor = diasDl !== null ? (diasDl <= 2 ? '#dc2626' : diasDl <= 7 ? '#d97706' : '#94a3b8') : '#94a3b8'
                      const freqIcon = dlFreq === 'quincenal' ? '🔁' : dlFreq === 'mensual' ? '🔂' : '📅'
                      return (
                        <tr key={cat.id} style={{ borderBottom: '1px solid #f1f5ff' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f8faff'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 9, height: 9, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                <div style={{ fontSize: 15, fontWeight: 500 }}>
                                  {cat.label}
                                  {arrStr && <div style={{ fontSize: 11, color: '#059669', fontFamily: 'DM Mono, monospace', marginTop: 2 }}>{arrStr}</div>}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span onClick={() => { setFormDeadline({ catId: cat.id, catLabel: cat.label, fecha: dl || '', frecuencia: dlFreq }); setModalDeadline(true) }}
                                    style={{
                                      fontSize: 11, cursor: 'pointer', fontWeight: 600,
                                      color: dl ? (diasDl <= 2 ? '#fff' : diasDl <= 7 ? '#92400e' : '#475569') : '#94a3b8',
                                      padding: '2px 8px',
                                      background: dl ? (diasDl <= 2 ? '#dc2626' : diasDl <= 7 ? '#fef3c7' : '#f1f5f9') : '#f8faff',
                                      border: `1px solid ${dl ? (diasDl <= 2 ? '#dc2626' : diasDl <= 7 ? '#fcd34d' : '#e0e7ff') : '#e0e7ff'}`,
                                      borderRadius: 5, fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap'
                                    }}>
                                    {dl ? (diasDl < 0 ? '⚠️ vencido' : diasDl === 0 ? `${freqIcon} ¡hoy!` : diasDl === 1 ? `${freqIcon} mañana` : `${freqIcon} ${diasDl}d`) : '📅 fecha'}
                                  </span>
                                  {obj > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <div style={{ width: 44, height: 8, background: '#e0e7ff', borderRadius: 4, overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${pctObj}%`, background: pctObj >= 100 ? '#059669' : '#818cf8', borderRadius: 4 }} />
                                      </div>
                                      <span style={{ fontSize: 11, color: pctObj >= 100 ? '#059669' : '#818cf8', fontFamily: 'DM Mono, monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>{pctObj.toFixed(0)}%</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            <input
                              defaultValue={fmtInput(obj)}
                              onBlur={e => handlePresupuestoChange(cat.id, e.target.value)}
                              onFocus={e => { e.target.value = obj || '' }}
                              style={{ background: '#f5f7ff', border: '1px solid #c7d2fe', color: '#94a3b8', fontFamily: 'DM Mono, monospace', fontSize: 13, textAlign: 'right', padding: '5px 10px', borderRadius: 5, width: 110 }}
                            />
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            <input
                              value={inputAsignado[cat.id] ?? fmtInput(asignados[cat.id] || 0)}
                              onChange={e => setInputAsignado(p => ({ ...p, [cat.id]: e.target.value }))}
                              onFocus={e => { setInputAsignado(p => ({ ...p, [cat.id]: String(asignados[cat.id] || '') })); setTimeout(() => e.target.select(), 0) }}
                              onBlur={e => { handleAsignado(cat.id, e.target.value); setInputAsignado(p => { const n = {...p}; delete n[cat.id]; return n }) }}
                              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                              style={{ background: asig > 0 ? '#eff6ff' : '#f5f7ff', border: `1px solid ${asig > 0 ? '#93c5fd' : '#c7d2fe'}`, color: '#0f172a', fontFamily: 'DM Mono, monospace', fontSize: 13, textAlign: 'right', padding: '5px 10px', borderRadius: 5, width: 110, fontWeight: asig > 0 ? 600 : 400 }}
                            />
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'DM Mono, monospace', fontSize: 14 }}>
                            <div>{fmt(real)}</div>
                            <div style={{ height: 8, background: '#e0e7ff', borderRadius: 4, overflow: 'hidden', marginTop: 5, width: 80, marginLeft: 'auto' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 4 }} />
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
        {activeTab === 'transacciones' && (() => {
          const txsFiltradas = filtroCuentaTx === 'todas'
            ? transacciones
            : transacciones.filter(t => (t.cuenta || 'Banorte') === filtroCuentaTx)
          return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 13, color: '#475569' }}>{txsFiltradas.length} transacciones{filtroCuentaTx !== 'todas' ? ` en ${filtroCuentaTx}` : ''}</div>
                <select value={filtroCuentaTx} onChange={e => setFiltroCuentaTx(e.target.value)}
                  style={{ background: '#f5f7ff', border: '1px solid #c7d2fe', color: '#0f172a', fontSize: 12, padding: '5px 8px', borderRadius: 5, cursor: 'pointer' }}>
                  <option value="todas">Todas las cuentas</option>
                  {cuentas.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
                </select>
              </div>
              <label style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: '#4f46e5', color: '#fff', border: 'none' }}>
                ↑ Importar CSV Banorte
                <input type="file" accept=".csv" onChange={handleCSV} style={{ display: 'none' }} />
              </label>
            </div>

            {txsFiltradas.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <p>{transacciones.length === 0 ? <>No hay transacciones este mes.<br />Importa tu CSV de Banorte para comenzar.</> : <>No hay transacciones en {filtroCuentaTx} este mes.</>}</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {txsFiltradas.map((tx) => {
                  // Duplicate detection — ignora transacciones ya marcadas como no-duplicado
                  const isDuplicate = !tx.no_es_duplicado && transacciones.some(other =>
                    other.id !== tx.id &&
                    !other.no_es_duplicado &&
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
                        <div style={{ background: '#fef3c7', padding: '4px 14px', fontSize: 11, color: '#92400e', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span>⚠️ Posible duplicado — mismo monto en fechas cercanas. ¿Es correcto?</span>
                          <button onClick={() => handleMarcarNoDuplicado(tx.id)}
                            title="No es duplicado — ocultar aviso"
                            style={{ background: 'transparent', border: '1px solid #92400e', color: '#92400e', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            ✕ No es duplicado
                          </button>
                        </div>
                      )}
                      <div className="tx-row" style={{ display: 'grid', gridTemplateColumns: '95px 1fr 200px 110px 70px', alignItems: 'start', gap: 12, padding: '11px 14px' }}>
                        <div className="tx-fecha" style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#475569', fontWeight: 500, paddingTop: 2 }}>
                          {tx.fecha.split('-').reverse().join('/')}
                        </div>
                        <div className="tx-concepto" style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.4, wordBreak: 'break-word' }}>
                          {tx.concepto}
                          {tx.cuenta && tx.cuenta !== 'Banorte' && (
                            <span style={{ marginLeft: 6, fontSize: 10, background: '#e0e7ff', color: '#4f46e5', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>{tx.cuenta}</span>
                          )}
                        </div>
                        <select className="tx-cat" value={tx.categoria} onChange={e => handleUpdateCat(tx.id, e.target.value, tx.concepto)}
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
                        <div className="tx-monto" style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 600, textAlign: 'right', color: tx.tipo === 'ingreso' ? '#059669' : '#dc2626', paddingTop: 2 }}>
                          {tx.tipo === 'ingreso' ? '+' : '-'}{fmt(tx.monto)}
                        </div>
                        <div className="tx-delete" style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 2 }}>
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
          )
        })()}

        {/* ── TAB: POR CUENTA ── */}
        {activeTab === 'por_cuenta' && (() => {
          const cuentaSel = cuentas.find(c => c.nombre === cuentaPorCuenta) || cuentas[0]
          if (!cuentaSel) {
            return <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>No hay cuentas configuradas.</div>
          }
          // Transacciones de esta cuenta, ordenadas ASC por fecha (para saldo corriente)
          const txsCuenta = transacciones
            .filter(t => (t.cuenta || 'Banorte') === cuentaSel.nombre)
            .slice()
            .sort((a, b) => {
              const cmp = a.fecha.localeCompare(b.fecha)
              return cmp !== 0 ? cmp : (a.id || 0) - (b.id || 0)
            })
          // Saldo corriente: ingreso suma, gasto resta — funciona igual para débito y crédito
          const saldoInicial = Number(cuentaSel.saldo_inicial) || 0
          let running = saldoInicial
          const rows = txsCuenta.map(tx => {
            const monto = Math.abs(Number(tx.monto))
            running += tx.tipo === 'ingreso' ? monto : -monto
            return { tx, balance: running }
          })
          const saldoFinal = running
          const totalIngresosCta = txsCuenta.filter(t => t.tipo === 'ingreso').reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
          const totalGastosCta = txsCuenta.filter(t => t.tipo === 'gasto').reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
          return (
            <>
              {/* Selector + summary */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <select value={cuentaPorCuenta} onChange={e => setCuentaPorCuenta(e.target.value)}
                  style={{ background: '#f5f7ff', border: '1px solid #c7d2fe', color: '#0f172a', fontSize: 13, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                  {cuentas.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre} {c.tipo === 'credito' ? '(crédito)' : ''}</option>)}
                </select>
                <div style={{ fontSize: 13, color: '#475569' }}>{txsCuenta.length} movimientos</div>
              </div>

              <div className="por-cuenta-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
                <div style={{ background: '#fff', padding: 14, borderRadius: 8, border: '1px solid #e0e7ff' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Saldo inicial</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 600, color: saldoInicial < 0 ? '#dc2626' : '#0f172a' }}>{saldoInicial < 0 ? '-' : ''}{fmt(Math.abs(saldoInicial))}</div>
                </div>
                <div style={{ background: '#fff', padding: 14, borderRadius: 8, border: '1px solid #e0e7ff' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Ingresos</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 600, color: '#059669' }}>+{fmt(totalIngresosCta)}</div>
                </div>
                <div style={{ background: '#fff', padding: 14, borderRadius: 8, border: '1px solid #e0e7ff' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Gastos</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 600, color: '#dc2626' }}>-{fmt(totalGastosCta)}</div>
                </div>
                <div style={{ background: '#fff', padding: 14, borderRadius: 8, border: `1px solid ${saldoFinal < 0 ? '#fecaca' : '#bbf7d0'}` }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Saldo final</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 600, color: saldoFinal < 0 ? '#dc2626' : '#059669' }}>{saldoFinal < 0 ? '-' : ''}{fmt(Math.abs(saldoFinal))}</div>
                </div>
              </div>

              {/* Tabla con saldo corriente */}
              {rows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                  <p>No hay movimientos en {cuentaSel.nombre} este mes.</p>
                </div>
              ) : (
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e0e7ff', overflow: 'hidden' }}>
                  <div className="por-cuenta-header" style={{ display: 'grid', gridTemplateColumns: '95px 1fr 120px 130px', gap: 12, padding: '10px 14px', background: '#f5f7ff', borderBottom: '1px solid #e0e7ff', fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    <div>Fecha</div>
                    <div>Concepto</div>
                    <div style={{ textAlign: 'right' }}>Monto</div>
                    <div style={{ textAlign: 'right' }}>Saldo</div>
                  </div>
                  {rows.map(({ tx, balance }) => (
                    <div key={tx.id} className="por-cuenta-row" style={{ display: 'grid', gridTemplateColumns: '95px 1fr 120px 130px', gap: 12, padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
                      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#475569', fontWeight: 500 }}>
                        {tx.fecha.split('-').reverse().join('/')}
                      </div>
                      <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.4, wordBreak: 'break-word' }}>
                        {tx.concepto}
                        {tx.es_transferencia && (
                          <span style={{ marginLeft: 6, fontSize: 10, background: '#e0e7ff', color: '#4f46e5', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>transferencia</span>
                        )}
                      </div>
                      <div className="pc-monto" style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 600, textAlign: 'right', color: tx.tipo === 'ingreso' ? '#059669' : '#dc2626' }}>
                        {tx.tipo === 'ingreso' ? '+' : '-'}{fmt(tx.monto)}
                      </div>
                      <div className="pc-balance" style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, textAlign: 'right', color: balance < 0 ? '#dc2626' : '#0f172a' }}>
                        {balance < 0 ? '-' : ''}{fmt(Math.abs(balance))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        })()}
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
            <option value="">— Selecciona —</option>
            {paraAsignar > 0 && <option value="__listo__">💰 Listo para asignar — disponible: {fmt(paraAsignar)}</option>}
            {catsGasto.filter(c => (asignados[c.id] || 0) - (gastoActual[c.id] || 0) > 0).map(c => {
              const disp = (asignados[c.id] || 0) - (gastoActual[c.id] || 0)
              return <option key={c.id} value={c.id}>{c.label} — disponible: {fmt(disp)}</option>
            })}
          </select>
        </Field>
        <Field label="Dar a">
          <select value={formMover.hacia} onChange={e => setFormMover(p => ({ ...p, hacia: e.target.value }))} style={selectStyle}>
            {[...overspendCats, ...catsGasto.filter(c => !overspendCats.includes(c))].map(c => {
              const exceso = (gastoActual[c.id] || 0) - (asignados[c.id] || 0)
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

      {/* Apartar dinero para tarjeta */}
      <Modal open={modalApartar} onClose={() => setModalApartar(false)} title={`Apartar dinero para ${formApartar.cuenta}`} subtitle="Mueve dinero de una categoría hacia el pago de la tarjeta.">
        <Field label="Tomar de">
          <select value={formApartar.desde} onChange={e => setFormApartar(p => ({ ...p, desde: e.target.value }))} style={selectStyle}>
            <option value="">— Selecciona —</option>
            {paraAsignar > 0 && <option value="__listo__">💰 Listo para asignar — disponible: {fmt(paraAsignar)}</option>}
            {catsGasto.filter(c => c.id !== 'PagoMPTarjeta' && c.id !== 'PagoTDCMercadopago' && (asignados[c.id] || 0) - (gastoActual[c.id] || 0) > 0).map(c => {
              const disp = (asignados[c.id] || 0) - (gastoActual[c.id] || 0)
              return <option key={c.id} value={c.id}>{c.label} — disponible: {fmt(disp)}</option>
            })}
          </select>
        </Field>
        <Field label="Monto ($MXN)"><input type="number" value={formApartar.monto} onChange={e => setFormApartar(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" step="0.01" style={inputStyle} /></Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={() => setModalApartar(false)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handleApartar} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Apartar</button>
        </div>
      </Modal>

      {/* Detalle de tarjeta */}
      {modalDetalleTarjeta && (() => {
        const info = cuentaInfo[modalDetalleTarjeta] || {}
        const txsCubiertos = transacciones.filter(t => !t.es_transferencia && t.tipo === 'gasto' && t.cuenta === modalDetalleTarjeta)
        // Calcular cuánto cubrió cada tx
        const desgloseCubierto = []
        // Acumular asignado disponible por categoría para ir descontando
        const asignadoRestante = {}
        for (const cat of catsGasto) {
          asignadoRestante[cat.id] = (asignados[cat.id] || 0) + (arrastres[cat.id] || 0)
        }
        // Ordenar por fecha para que los gastos antiguos consuman primero el asignado
        const txsOrdenadas = [...txsCubiertos].sort((a, b) => a.fecha.localeCompare(b.fecha))
        for (const tx of txsOrdenadas) {
          const monto = Math.abs(Number(tx.monto))
          const disp = asignadoRestante[tx.categoria] || 0
          const cubierto = Math.min(monto, disp)
          const descubierto = monto - cubierto
          asignadoRestante[tx.categoria] = Math.max(0, disp - monto)
          desgloseCubierto.push({ ...tx, cubierto, descubierto })
        }
        const apartadosCuenta = apartados.filter(a => a.cuenta === modalDetalleTarjeta)
        const pagosTxs = transacciones.filter(t => t.es_transferencia && t.tipo === 'ingreso' && t.cuenta === modalDetalleTarjeta)

        return (
          <Modal open={true} onClose={() => setModalDetalleTarjeta(null)} title={`Detalle de pago — ${modalDetalleTarjeta}`} subtitle="De dónde sale el pago disponible.">
            <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  ✓ Gastos cubiertos por categorías ({fmt(info.cubierto || 0)})
                </div>
                {desgloseCubierto.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#94a3b8', padding: 8 }}>Sin gastos con esta tarjeta</div>
                ) : (
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f5f7ff' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Fecha</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Concepto</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Categoría</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>Cubierto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {desgloseCubierto.map((tx, i) => {
                        const catLabel = catsGasto.find(c => c.id === tx.categoria)?.label || tx.categoria
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '6px 8px', fontFamily: 'DM Mono, monospace', color: '#64748b' }}>{tx.fecha.substring(5)}</td>
                            <td style={{ padding: '6px 8px', color: '#0f172a' }}>{tx.concepto.substring(0, 30)}</td>
                            <td style={{ padding: '6px 8px', color: '#475569' }}>{catLabel}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'DM Mono, monospace', color: tx.cubierto > 0 ? '#15803d' : '#dc2626' }}>
                              {fmt(tx.cubierto)}
                              {tx.descubierto > 0 && <span style={{ color: '#dc2626', fontSize: 10, display: 'block' }}>(descubierto: {fmt(tx.descubierto)})</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  ↔ Apartados manuales ({fmt(info.apartadosManuales || 0)})
                </div>
                {apartadosCuenta.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#94a3b8', padding: 8 }}>Sin apartados manuales</div>
                ) : (
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f5f7ff' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Fecha</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Desde</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apartadosCuenta.map((a, i) => {
                        const catLabel = a.desde_categoria === '__listo__' ? '💰 Listo para asignar' : (catsGasto.find(c => c.id === a.desde_categoria)?.label || a.desde_categoria)
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '6px 8px', fontFamily: 'DM Mono, monospace', color: '#64748b' }}>{(a.created_at || '').substring(5, 10)}</td>
                            <td style={{ padding: '6px 8px', color: '#475569' }}>{catLabel}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'DM Mono, monospace', color: '#4f46e5' }}>{fmt(a.monto)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  💵 Pagos ya hechos ({fmt(info.pagosHechos || 0)})
                </div>
                {pagosTxs.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#94a3b8', padding: 8 }}>Sin pagos registrados</div>
                ) : (
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f5f7ff' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Fecha</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Concepto</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagosTxs.map((tx, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 8px', fontFamily: 'DM Mono, monospace', color: '#64748b' }}>{tx.fecha.substring(5)}</td>
                          <td style={{ padding: '6px 8px', color: '#475569' }}>{tx.concepto}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'DM Mono, monospace', color: '#dc2626' }}>{fmt(tx.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ marginTop: 16, padding: 12, background: '#f0fdf4', borderRadius: 8, borderLeft: '3px solid #15803d' }}>
                <div style={{ fontSize: 11, color: '#15803d', fontWeight: 600 }}>PAGO DISPONIBLE TOTAL</div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 700, color: '#15803d', marginTop: 2 }}>
                  {fmt(info.pagoDisponible || 0)}
                </div>
                <div style={{ fontSize: 10, color: '#15803d', opacity: 0.7, marginTop: 4 }}>
                  = Cubierto ({fmt(info.cubierto || 0)}) + Apartado ({fmt(info.apartadosManuales || 0)}) − Pagado ({fmt(info.pagosHechos || 0)})
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setModalDetalleTarjeta(null)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Cerrar</button>
            </div>
          </Modal>
        )
      })()}

      {/* Pagar tarjeta */}
      <Modal open={modalPagar} onClose={() => setModalPagar(false)} title={`Pagar ${formPagar.cuentaCredito}`} subtitle="Registra una transferencia desde una cuenta débito hacia la tarjeta.">
        <Field label="Fecha"><input type="date" value={formPagar.fecha} onChange={e => setFormPagar(p => ({ ...p, fecha: e.target.value }))} style={inputStyle} /></Field>
        <Field label="Desde cuenta">
          <select value={formPagar.cuentaDebito} onChange={e => setFormPagar(p => ({ ...p, cuentaDebito: e.target.value }))} style={selectStyle}>
            {cuentas.filter(c => c.tipo === 'debito').map(c => (
              <option key={c.nombre} value={c.nombre}>{c.nombre} — saldo: {fmt(c.saldoActual)}</option>
            ))}
          </select>
        </Field>
        <Field label="Monto ($MXN)"><input type="number" value={formPagar.monto} onChange={e => setFormPagar(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" step="0.01" style={inputStyle} /></Field>
        {formPagar.cuentaCredito && (() => {
          const pagoDispCC = cuentaInfo[formPagar.cuentaCredito]?.pagoDisponible || 0
          return (
            <div style={{ marginTop: -6, marginBottom: 10, padding: '8px 12px', background: '#f5f7ff', border: '1px solid #c7d2fe', borderRadius: 7, fontSize: 12, color: '#475569' }}>
              💡 Pago disponible: <strong style={{ fontFamily: 'DM Mono, monospace', color: pagoDispCC > 0 ? '#15803d' : '#94a3b8' }}>{fmt(pagoDispCC)}</strong>
              {pagoDispCC === 0 && <div style={{ marginTop: 4, fontSize: 11, color: '#92400e' }}>Para pagar más, primero usa "↔ Apartar" para mover dinero de categorías hacia esta tarjeta.</div>}
            </div>
          )
        })()}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={() => setModalPagar(false)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={handlePagar} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Pagar tarjeta</button>
        </div>
      </Modal>

      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onCatsChanged={() => { loadCategories(); loadData() }}
        />
      )}

      {/* Deadline */}
      <Modal open={modalDeadline} onClose={() => setModalDeadline(false)} title={`Fecha límite — ${formDeadline.catLabel}`} subtitle="La app te avisará cuando se acerque y no tengas suficiente asignado.">
        <Field label="Primera fecha">
          <input type="date" value={formDeadline.fecha} onChange={e => setFormDeadline(p => ({ ...p, fecha: e.target.value }))} style={inputStyle} />
        </Field>
        <Field label="Frecuencia">
          <select value={formDeadline.frecuencia || 'unica'} onChange={e => setFormDeadline(p => ({ ...p, frecuencia: e.target.value }))} style={selectStyle}>
            <option value="unica">📅 Solo una vez</option>
            <option value="quincenal">🔁 Cada 15 días (quincenal)</option>
            <option value="mensual">🔂 Cada mes</option>
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 20 }}>
          <button onClick={() => { setFormDeadline(p => ({ ...p, fecha: '', frecuencia: 'unica' })); handleDeadlineSave() }} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #fee2e2', color: '#dc2626', cursor: 'pointer' }}>Quitar fecha</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setModalDeadline(false)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
            <button onClick={handleDeadlineSave} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Guardar</button>
          </div>
        </div>
      </Modal>

      <Notif msg={notif} onClose={() => setNotif('')} />
    </div>
  )
}
