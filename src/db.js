import { supabase } from './supabase'
import { DEFAULT_PRESUPUESTO } from './constants'

// ─── PRESUPUESTO ─────────────────────────────────────────────────────────────

export async function getPresupuesto(mes) {
  const { data, error } = await supabase
    .from('presupuestos')
    .select('categoria, monto')
    .eq('mes', mes)
  if (error) throw error
  if (!data || data.length === 0) {
    // primer mes: insertar defaults
    const rows = Object.entries(DEFAULT_PRESUPUESTO).map(([categoria, monto]) => ({ mes, categoria, monto }))
    await supabase.from('presupuestos').insert(rows)
    return { ...DEFAULT_PRESUPUESTO }
  }
  return Object.fromEntries(data.map(r => [r.categoria, r.monto]))
}

export async function setPresupuesto(mes, categoria, monto) {
  const { error } = await supabase
    .from('presupuestos')
    .upsert({ mes, categoria, monto }, { onConflict: 'mes,categoria' })
  if (error) throw error
}

// ─── TRANSACCIONES ────────────────────────────────────────────────────────────

export async function getTransacciones(mes) {
  const { data, error } = await supabase
    .from('transacciones')
    .select('*')
    .eq('mes', mes)
    .order('fecha', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addTransaccion(tx) {
  // dedup check
  const { data: existing } = await supabase
    .from('transacciones')
    .select('id')
    .eq('mes', tx.mes)
    .eq('fecha', tx.fecha)
    .eq('monto', tx.monto)
    .eq('concepto', tx.concepto.substring(0, 40))
    .limit(1)
  if (existing && existing.length > 0) return false
  const { error } = await supabase.from('transacciones').insert({
    ...tx,
    concepto: tx.concepto.substring(0, 200)
  })
  if (error) throw error
  return true
}

export async function updateTransaccionCat(id, categoria) {
  const { error } = await supabase
    .from('transacciones')
    .update({ categoria })
    .eq('id', id)
  if (error) throw error
}

export async function deleteTransaccion(id) {
  const { error } = await supabase.from('transacciones').delete().eq('id', id)
  if (error) throw error
}

// ─── SALDO REAL ───────────────────────────────────────────────────────────────

export async function getSaldo(mes) {
  const { data, error } = await supabase
    .from('saldos')
    .select('saldo_real, saldo_fecha')
    .eq('mes', mes)
    .single()
  if (error) return { saldo_real: 0, saldo_fecha: null }
  return data
}

export async function setSaldo(mes, saldo_real, saldo_fecha) {
  const { error } = await supabase
    .from('saldos')
    .upsert({ mes, saldo_real, saldo_fecha, updated_at: new Date().toISOString() }, { onConflict: 'mes' })
  if (error) throw error
}

// ─── MOVIMIENTOS ─────────────────────────────────────────────────────────────

export async function getMovimientos(mes) {
  const { data, error } = await supabase
    .from('movimientos')
    .select('*')
    .eq('mes', mes)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addMovimiento(mes, desde, hacia, monto) {
  const fecha = new Date().toISOString().split('T')[0]
  const { error } = await supabase
    .from('movimientos')
    .insert({ mes, desde, hacia, monto, fecha })
  if (error) throw error
  // Update presupuesto
  await Promise.all([
    supabase.rpc('decrement_presupuesto', { p_mes: mes, p_cat: desde, p_monto: monto }),
    supabase.rpc('increment_presupuesto', { p_mes: mes, p_cat: hacia, p_monto: monto }),
  ])
}
