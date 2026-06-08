import { supabase } from './supabase'
import { DEFAULT_PRESUPUESTO } from './constants'

function nextMonth(mes) {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function prevMonth(mes) {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── CUENTAS ─────────────────────────────────────────────────────────────────

export const CUENTAS_DEFAULT = [
  { nombre: 'Banorte', tipo: 'debito' },
  { nombre: 'MP Billetera', tipo: 'debito' },
  { nombre: 'Efectivo', tipo: 'debito' },
  { nombre: 'MP Tarjeta', tipo: 'credito' },
]

export async function getCuentas(mes) {
  const { data } = await supabase.from('cuentas').select('*').eq('mes', mes)
  const existentes = new Set((data || []).map(c => c.nombre))
  // Solo auto-rellenar cuentas para el mes actual o pasados.
  // Para meses futuros, no creamos data — esos meses solo se llenan via cerrarMes.
  const today = new Date()
  const mesActual = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  if (mes > mesActual) {
    return data || []
  }
  const faltantes = CUENTAS_DEFAULT.filter(c => !existentes.has(c.nombre))
  if (faltantes.length > 0) {
    const rows = faltantes.map(c => ({ ...c, saldo_inicial: 0, mes }))
    await supabase.from('cuentas').insert(rows)
    return [...(data || []), ...rows]
  }
  return data || []
}

export async function setSaldoInicial(mes, nombre, saldo_inicial) {
  const tipo = CUENTAS_DEFAULT.find(c => c.nombre === nombre)?.tipo || 'debito'
  // Para crédito, el saldo inicial siempre se guarda negativo (es deuda)
  const montoFinal = tipo === 'credito' ? -Math.abs(saldo_inicial) : saldo_inicial
  const { error } = await supabase.from('cuentas')
    .upsert({ mes, nombre, saldo_inicial: montoFinal, tipo }, { onConflict: 'nombre,mes' })
  if (error) throw error
}

// Calcula saldo actual de cada cuenta basado en saldo_inicial + transacciones
export async function getSaldosCuentas(mes) {
  const [cuentas, txs] = await Promise.all([
    getCuentas(mes),
    supabase.from('transacciones').select('monto, tipo, cuenta').eq('mes', mes)
  ])
  const movs = txs.data || []
  return cuentas.map(c => {
    const txsCuenta = movs.filter(t => (t.cuenta || 'Banorte') === c.nombre)
    const ingresos = txsCuenta.filter(t => t.tipo === 'ingreso').reduce((s, t) => s + Number(t.monto), 0)
    const gastos = txsCuenta.filter(t => t.tipo === 'gasto').reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
    // Para crédito: saldo_inicial es negativo (-22432), gastos lo hacen más negativo, ingresos/pagos lo reducen
    const saldoActual = c.tipo === 'credito'
      ? (c.saldo_inicial || 0) - gastos + ingresos
      : (c.saldo_inicial || 0) + ingresos - gastos
    return { ...c, saldoActual }
  })
}

// ─── PRESUPUESTO ─────────────────────────────────────────────────────────────

export async function getPresupuesto(mes) {
  const { data, error } = await supabase.from('presupuestos').select('categoria, monto, arrastre').eq('mes', mes)
  if (error) throw error
  if (!data || data.length === 0) {
    const rows = Object.entries(DEFAULT_PRESUPUESTO).map(([categoria, monto]) => ({ mes, categoria, monto, arrastre: 0 }))
    await supabase.from('presupuestos').insert(rows)
    return { ...DEFAULT_PRESUPUESTO }
  }
  return Object.fromEntries(data.map(r => [r.categoria, r.monto]))
}

export async function getArrastres(mes) {
  const { data } = await supabase.from('presupuestos').select('categoria, arrastre').eq('mes', mes)
  if (!data) return {}
  return Object.fromEntries(data.map(r => [r.categoria, r.arrastre || 0]))
}

export async function setPresupuesto(mes, categoria, monto) {
  const { error } = await supabase.from('presupuestos')
    .upsert({ mes, categoria, monto, arrastre: 0 }, { onConflict: 'mes,categoria' })
  if (error) throw error
}

export async function cerrarMes(mes, gastoActual) {
  // Traemos presupuestos del mes actual (incluye deadline y frecuencia para arrastrar)
  const { data: presData } = await supabase.from('presupuestos')
    .select('categoria, monto, arrastre, asignado, deadline, deadline_frecuencia')
    .eq('mes', mes)
  if (!presData) return
  const next = nextMonth(mes)
  // Para cada categoría: arrastra el sobrante (dinero que quedó) Y copia el objetivo.
  // NO copia el asignado — cada mes empiezas en 0 y asignas solo lo que tienes (estilo YNAB clásico).
  // Idempotente: al re-cerrar, los arrastres se RECALCULAN (incluso a 0). Si junio ya
  // tiene asignados manuales, los preservamos (solo actualizamos arrastre y objetivo).
  const { data: nextRows } = await supabase.from('presupuestos').select('categoria').eq('mes', next)
  const nextSet = new Set((nextRows || []).map(r => r.categoria))
  for (const row of presData) {
    const gastado = gastoActual[row.categoria] || 0
    const totalCubierto = (row.asignado || 0) + (row.arrastre || 0)
    const sobrante = Math.max(0, totalCubierto - gastado)
    const objetivo = row.monto || DEFAULT_PRESUPUESTO[row.categoria] || 0
    // Arrastrar deadline si es recurrente (mensual/quincenal) o si es única y aún no ha vencido
    const freq = row.deadline_frecuencia || 'unica'
    const heredarDeadline = row.deadline && (freq === 'mensual' || freq === 'quincenal' ||
      (freq === 'unica' && new Date(row.deadline) >= new Date()))
    const deadlinePayload = heredarDeadline
      ? { deadline: row.deadline, deadline_frecuencia: freq }
      : {}
    if (nextSet.has(row.categoria)) {
      // Ya existe en junio — solo actualizar arrastre, objetivo y deadline. Preservar asignado del usuario.
      await supabase.from('presupuestos')
        .update({ arrastre: sobrante, monto: objetivo, ...deadlinePayload })
        .eq('mes', next).eq('categoria', row.categoria)
    } else if (sobrante > 0 || objetivo > 0 || heredarDeadline) {
      // No existe — insertar limpio con asignado=0
      await supabase.from('presupuestos').insert({
        mes: next,
        categoria: row.categoria,
        monto: objetivo,
        arrastre: sobrante,
        asignado: 0,
        ...deadlinePayload,
      })
    }
  }
  // Pasar saldos de cuentas: saldoActual al fin del mes = saldo_inicial del mes siguiente
  const cuentasFinDeMes = await getSaldosCuentas(mes)
  for (const cta of cuentasFinDeMes) {
    await supabase.from('cuentas').upsert({
      mes: next,
      nombre: cta.nombre,
      tipo: cta.tipo,
      saldo_inicial: cta.saldoActual,
      updated_at: new Date().toISOString(), // marca como reconciliada hoy
    }, { onConflict: 'nombre,mes' })
  }
}

// ─── TRANSACCIONES ────────────────────────────────────────────────────────────

export async function getTransacciones(mes) {
  const { data, error } = await supabase.from('transacciones').select('*').eq('mes', mes).order('fecha', { ascending: false })
  if (error) throw error
  return data || []
}

// Datos agregados para reportes — varios meses de una sola query
export async function getReporteMultiMes(meses) {
  const [txsRes, cuentasRes] = await Promise.all([
    supabase.from('transacciones').select('mes, tipo, monto, categoria, cuenta, es_transferencia').in('mes', meses),
    supabase.from('cuentas').select('mes, nombre, tipo, saldo_inicial').in('mes', meses),
  ])
  return {
    transacciones: txsRes.data || [],
    cuentas: cuentasRes.data || [],
  }
}

// Detecta los meses con transacciones registradas (útil para reportes: no muestra meses vacíos)
export async function getMesesConData() {
  const { data } = await supabase.from('transacciones').select('mes')
  if (!data) return []
  const meses = [...new Set(data.map(r => r.mes))].sort()
  return meses
}

export async function addTransaccion(tx) {
  const { rawConcepto, ...txClean } = tx
  const { error } = await supabase.from('transacciones').insert({
    ...txClean,
    concepto: txClean.concepto.substring(0, 200),
    cuenta: txClean.cuenta || 'Banorte'
  })
  if (error) throw error
  return true
}

export async function updateTransaccionCat(id, categoria) {
  const { error } = await supabase.from('transacciones').update({ categoria }).eq('id', id)
  if (error) throw error
}

export async function marcarNoDuplicado(id) {
  const { error } = await supabase.from('transacciones').update({ no_es_duplicado: true }).eq('id', id)
  if (error) throw error
}

export async function deleteTransaccion(id) {
  // Si es una transferencia, borrar también la mitad correspondiente (gasto + ingreso ligados)
  const { data: tx } = await supabase.from('transacciones').select('*').eq('id', id).single()
  if (!tx) {
    const { error } = await supabase.from('transacciones').delete().eq('id', id)
    if (error) throw error
    return { deleted: 1 }
  }
  if (tx.es_transferencia) {
    const tipoOpuesto = tx.tipo === 'gasto' ? 'ingreso' : 'gasto'
    const { data: pair } = await supabase.from('transacciones')
      .select('id')
      .eq('mes', tx.mes)
      .eq('fecha', tx.fecha)
      .eq('concepto', tx.concepto)
      .eq('monto', tx.monto)
      .eq('es_transferencia', true)
      .eq('tipo', tipoOpuesto)
      .neq('id', id)
    const ids = [id, ...(pair || []).map(p => p.id)]
    const { error } = await supabase.from('transacciones').delete().in('id', ids)
    if (error) throw error
    return { deleted: ids.length }
  }
  const { error } = await supabase.from('transacciones').delete().eq('id', id)
  if (error) throw error
  return { deleted: 1 }
}

// ─── RECONCILIACIÓN ──────────────────────────────────────────────────────────

export async function reconciliar(mes, nombre, saldoReal) {
  const cuentas = await getSaldosCuentas(mes)
  const cuenta = cuentas.find(c => c.nombre === nombre)
  if (!cuenta) return null
  const diferencia = saldoReal - cuenta.saldoActual
  const tipo = CUENTAS_DEFAULT.find(c => c.nombre === nombre)?.tipo || 'debito'
  if (Math.abs(diferencia) > 0.01) {
    await supabase.from('cuentas').upsert({
      mes, nombre, tipo,
      saldo_inicial: (cuenta.saldo_inicial || 0) + diferencia,
      updated_at: new Date().toISOString()
    }, { onConflict: 'nombre,mes' })
  } else {
    await supabase.from('cuentas').update({ updated_at: new Date().toISOString() }).eq('mes', mes).eq('nombre', nombre)
  }
  return diferencia
}

// ─── ASIGNADO (SOBRES VIRTUALES) ─────────────────────────────────────────────

export async function getAsignados(mes) {
  const { data } = await supabase.from('presupuestos').select('categoria, asignado').eq('mes', mes)
  if (!data) return {}
  return Object.fromEntries(data.map(r => [r.categoria, r.asignado || 0]))
}

export async function setAsignado(mes, categoria, asignado) {
  const { error } = await supabase.from('presupuestos')
    .upsert({ mes, categoria, asignado }, { onConflict: 'mes,categoria' })
  if (error) throw error
}


// ─── CLABE CATEGORIAS (APRENDIZAJE) ──────────────────────────────────────────

export async function getClabeMap() {
  const { data } = await supabase.from('clabe_categorias').select('clabe, categoria, descripcion')
  if (!data) return {}
  return Object.fromEntries(data.map(r => [r.clabe, { categoria: r.categoria, descripcion: r.descripcion }]))
}

export async function saveClabe(clabe, categoria, descripcion) {
  if (!clabe || clabe.length < 6) return
  await supabase.from('clabe_categorias')
    .upsert({ clabe, categoria, descripcion }, { onConflict: 'clabe' })
}

export async function getUltimaReconciliacion(mes, nombre) {
  const { data } = await supabase.from('cuentas').select('updated_at').eq('mes', mes).eq('nombre', nombre).single()
  return data?.updated_at || null
}

// ─── DEADLINES ────────────────────────────────────────────────────────────────

export async function setDeadline(mes, categoria, deadline, frecuencia = 'unica') {
  const { error } = await supabase.from('presupuestos')
    .upsert({ mes, categoria, deadline, deadline_frecuencia: frecuencia }, { onConflict: 'mes,categoria' })
  if (error) throw error
}

export async function getDeadlines(mes) {
  const { data } = await supabase.from('presupuestos')
    .select('categoria, deadline, deadline_frecuencia')
    .eq('mes', mes)
    .not('deadline', 'is', null)
  if (!data) return {}
  // Devuelve un objeto por categoría con { fecha, frecuencia }
  return Object.fromEntries(data.map(r => [r.categoria, { fecha: r.deadline, frecuencia: r.deadline_frecuencia || 'unica' }]))
}

// ─── APARTADOS MANUALES PARA TARJETA DE CRÉDITO ──────────────────────────────

export async function getApartadosTarjeta(mes) {
  const { data, error } = await supabase.from('apartados_tarjeta')
    .select('*').eq('mes', mes)
  if (error) throw error
  return data || []
}

export async function addApartadoTarjeta(mes, cuenta, monto, desdeCategoria) {
  const { error } = await supabase.from('apartados_tarjeta')
    .insert({ mes, cuenta, monto, desde_categoria: desdeCategoria })
  if (error) throw error
}

export async function deleteApartadoTarjeta(id) {
  const { error } = await supabase.from('apartados_tarjeta').delete().eq('id', id)
  if (error) throw error
}

// ─── PAGAR TARJETA (TRANSFERENCIA ENTRE CUENTAS) ──────────────────────────────

export async function pagarTarjeta(mes, fecha, cuentaDebito, cuentaCredito, monto) {
  // Crea dos transacciones marcadas como transferencia para no contaminar ingresos/gastos del mes
  const concepto = `Pago de ${cuentaCredito} desde ${cuentaDebito}`
  const txGasto = {
    mes, fecha, concepto, monto,
    tipo: 'gasto',
    categoria: '__transferencia__',
    cuenta: cuentaDebito,
    es_transferencia: true,
  }
  const txIngreso = {
    mes, fecha, concepto, monto,
    tipo: 'ingreso',
    categoria: '__transferencia__',
    cuenta: cuentaCredito,
    es_transferencia: true,
  }
  const { error: e1 } = await supabase.from('transacciones').insert(txGasto)
  if (e1) throw e1
  const { error: e2 } = await supabase.from('transacciones').insert(txIngreso)
  if (e2) throw e2
}

