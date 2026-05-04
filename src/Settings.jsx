import { useState, useEffect } from 'react'
import { supabase } from './supabase'

const COLORS = [
  '#f59e0b','#ef4444','#f97316','#84cc16','#06b6d4','#dc2626',
  '#7c3aed','#2563eb','#fbbf24','#34d399','#818cf8','#f472b6',
  '#fb7185','#4ade80','#a3e635','#94a3b8','#38bdf8','#f0abfc',
  '#f87171','#00e676','#40c4ff','#b2ff59','#ff9100','#e040fb',
]

const DEFAULT_GRUPOS = [
  '📦 Consumibles',
  '🔧 Gastos Variables',
  '🏢 Operación Fija',
  '👥 Personal',
  '🧾 Impuestos y Finanzas',
]

const DEFAULT_CATS = [
  { cat_id:'Viniles', label:'Viniles / Sustratos', color:'#f59e0b', grupo:'📦 Consumibles', grupo_orden:0, cat_orden:0 },
  { cat_id:'Tintas', label:'Tintas', color:'#ef4444', grupo:'📦 Consumibles', grupo_orden:0, cat_orden:1 },
  { cat_id:'Sobres', label:'Sobres', color:'#f97316', grupo:'📦 Consumibles', grupo_orden:0, cat_orden:2 },
  { cat_id:'Cajas', label:'Cajas', color:'#84cc16', grupo:'📦 Consumibles', grupo_orden:0, cat_orden:3 },
  { cat_id:'Cabezales', label:'Cabezales', color:'#06b6d4', grupo:'🔧 Gastos Variables', grupo_orden:1, cat_orden:0 },
  { cat_id:'Reparaciones', label:'Reparaciones', color:'#dc2626', grupo:'🔧 Gastos Variables', grupo_orden:1, cat_orden:1 },
  { cat_id:'Adecuaciones', label:'Adecuaciones local', color:'#7c3aed', grupo:'🔧 Gastos Variables', grupo_orden:1, cat_orden:2 },
  { cat_id:'Envios', label:'Envíos', color:'#2563eb', grupo:'🔧 Gastos Variables', grupo_orden:1, cat_orden:3 },
  { cat_id:'CFE', label:'CFE', color:'#fbbf24', grupo:'🏢 Operación Fija', grupo_orden:2, cat_orden:0 },
  { cat_id:'Telmex', label:'Telmex', color:'#34d399', grupo:'🏢 Operación Fija', grupo_orden:2, cat_orden:1 },
  { cat_id:'Odoo', label:'Odoo', color:'#818cf8', grupo:'🏢 Operación Fija', grupo_orden:2, cat_orden:2 },
  { cat_id:'Canva', label:'Canva', color:'#f472b6', grupo:'🏢 Operación Fija', grupo_orden:2, cat_orden:3 },
  { cat_id:'Adobe', label:'Adobe', color:'#fb7185', grupo:'🏢 Operación Fija', grupo_orden:2, cat_orden:4 },
  { cat_id:'GDrive', label:'Google Drive', color:'#4ade80', grupo:'🏢 Operación Fija', grupo_orden:2, cat_orden:5 },
  { cat_id:'Shopify', label:'Shopify', color:'#a3e635', grupo:'🏢 Operación Fija', grupo_orden:2, cat_orden:6 },
  { cat_id:'MantoPl', label:'Mantenimiento Plaza', color:'#94a3b8', grupo:'🏢 Operación Fija', grupo_orden:2, cat_orden:7 },
  { cat_id:'SueldoJorge', label:'Sueldo Jorge', color:'#38bdf8', grupo:'👥 Personal', grupo_orden:3, cat_orden:0 },
  { cat_id:'SueldoMemo', label:'Sueldo Memo', color:'#818cf8', grupo:'👥 Personal', grupo_orden:3, cat_orden:1 },
  { cat_id:'SueldoMony', label:'Sueldo Mony', color:'#f0abfc', grupo:'👥 Personal', grupo_orden:3, cat_orden:2 },
  { cat_id:'SAT', label:'SAT / Impuestos', color:'#f87171', grupo:'🧾 Impuestos y Finanzas', grupo_orden:4, cat_orden:0 },
  { cat_id:'PagoMPTarjeta', label:'Pago MP Tarjeta', color:'#f97316', grupo:'🧾 Impuestos y Finanzas', grupo_orden:4, cat_orden:1 },
  { cat_id:'GastosVarios', label:'Gastos varios', color:'#94a3b8', grupo:'🧾 Impuestos y Finanzas', grupo_orden:4, cat_orden:2 },
  { cat_id:'VentasDirectas', label:'Ventas directas', color:'#00e676', grupo:'Ingresos', grupo_orden:99, cat_orden:0, es_ingreso:true },
  { cat_id:'Marketplace', label:'Marketplace (Shopify/MeLi)', color:'#40c4ff', grupo:'Ingresos', grupo_orden:99, cat_orden:1, es_ingreso:true },
  { cat_id:'OtroIngreso', label:'Otro ingreso', color:'#b2ff59', grupo:'Ingresos', grupo_orden:99, cat_orden:2, es_ingreso:true },
]

export default function Settings({ onClose, onCatsChanged }) {
  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalAdd, setModalAdd] = useState(false)
  const [modalGrupo, setModalGrupo] = useState(false)
  const [editCat, setEditCat] = useState(null)
  const [form, setForm] = useState({ label: '', color: '#4f46e5', grupo: DEFAULT_GRUPOS[0] })
  const [formGrupo, setFormGrupo] = useState({ nombre: '' })
  const [grupos, setGrupos] = useState(DEFAULT_GRUPOS)
  const [notif, setNotif] = useState('')

  const notify = (msg) => {
    setNotif(msg)
    setTimeout(() => setNotif(''), 3000)
  }

  useEffect(() => { loadCats() }, [])

  async function loadCats() {
    setLoading(true)
    const { data, error } = await supabase
      .from('categorias')
      .select('*')
      .eq('activa', true)
      .order('grupo_orden')
      .order('cat_orden')

    if (error || !data || data.length === 0) {
      // seed defaults
      await supabase.from('categorias').upsert(
        DEFAULT_CATS.map(c => ({ ...c, activa: true })),
        { onConflict: 'cat_id' }
      )
      setCats(DEFAULT_CATS)
    } else {
      setCats(data)
      const gs = [...new Set(data.filter(c => !c.es_ingreso).map(c => c.grupo))]
      setGrupos(gs)
    }
    setLoading(false)
  }

  async function saveCat() {
    if (!form.label.trim()) { notify('⚠️ Escribe un nombre'); return }
    const cat_id = form.label.trim().replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '')
    const grupo_orden = grupos.indexOf(form.grupo)
    const catsInGrupo = cats.filter(c => c.grupo === form.grupo)
    const cat_orden = catsInGrupo.length

    if (editCat) {
      await supabase.from('categorias').update({ label: form.label, color: form.color, grupo: form.grupo }).eq('cat_id', editCat.cat_id)
      notify('✓ Categoría actualizada')
    } else {
      await supabase.from('categorias').insert({ cat_id, label: form.label, color: form.color, grupo: form.grupo, grupo_orden, cat_orden, activa: true, es_ingreso: false })
      notify('✓ Categoría agregada')
    }
    setModalAdd(false)
    setEditCat(null)
    await loadCats()
    onCatsChanged()
  }

  async function deleteCat(cat_id) {
    if (!confirm('¿Eliminar esta categoría?')) return
    await supabase.from('categorias').update({ activa: false }).eq('cat_id', cat_id)
    notify('Categoría eliminada')
    await loadCats()
    onCatsChanged()
  }

  async function saveGrupo() {
    if (!formGrupo.nombre.trim()) { notify('⚠️ Escribe un nombre'); return }
    const nuevo = formGrupo.nombre.trim()
    const nuevosGrupos = [...grupos, nuevo]
    setGrupos(nuevosGrupos)
    setModalGrupo(false)
    setFormGrupo({ nombre: '' })
    notify(`✓ Grupo "${nuevo}" creado`)
  }

  const gastosCats = cats.filter(c => !c.es_ingreso)
  const ingresosCats = cats.filter(c => c.es_ingreso)
  const gruposUnicos = [...new Set(gastosCats.map(c => c.grupo))]

  const inp = {
    width: '100%', background: '#f5f7ff', border: '1px solid #c7d2fe',
    color: '#0f172a', fontFamily: 'DM Sans, sans-serif', fontSize: 14,
    padding: '9px 12px', borderRadius: 7, outline: 'none'
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000000cc', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 16, width: 680, maxWidth: '95vw', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid #e0e7ff' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '2px solid #e0e7ff' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>⚙️ Configuración de categorías</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Agrega, edita o elimina categorías de gasto e ingreso</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setModalGrupo(true)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#475569' }}>+ Grupo</button>
            <button onClick={() => { setEditCat(null); setForm({ label: '', color: '#4f46e5', grupo: grupos[0] }); setModalAdd(true) }}
              style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: '#4f46e5', color: '#fff', border: 'none' }}>+ Categoría</button>
            <button onClick={onClose} style={{ padding: '7px 12px', borderRadius: 7, fontSize: 14, cursor: 'pointer', background: 'none', border: '1px solid #e0e7ff', color: '#94a3b8' }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
          {loading ? <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Cargando...</div> : (
            <>
              {/* Gastos */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Gastos</div>
              {gruposUnicos.map(grupo => (
                <div key={grupo} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, padding: '8px 12px', background: '#f5f7ff', borderRadius: 8 }}>{grupo}</div>
                  {gastosCats.filter(c => c.grupo === grupo).map(cat => (
                    <div key={cat.cat_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid #f1f5ff' }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                      <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{cat.label}</div>
                      <button onClick={() => { setEditCat(cat); setForm({ label: cat.label, color: cat.color, grupo: cat.grupo }); setModalAdd(true) }}
                        style={{ padding: '4px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#475569' }}>Editar</button>
                      <button onClick={() => deleteCat(cat.cat_id)}
                        style={{ padding: '4px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid #fee2e2', color: '#dc2626' }}>Eliminar</button>
                    </div>
                  ))}
                </div>
              ))}

              {/* Ingresos */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '20px 0 12px' }}>Ingresos</div>
              <div style={{ marginBottom: 20 }}>
                {ingresosCats.map(cat => (
                  <div key={cat.cat_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid #f1f5ff' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{cat.label}</div>
                    <button onClick={() => { setEditCat(cat); setForm({ label: cat.label, color: cat.color, grupo: cat.grupo }); setModalAdd(true) }}
                      style={{ padding: '4px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid #c7d2fe', color: '#475569' }}>Editar</button>
                    <button onClick={() => deleteCat(cat.cat_id)}
                      style={{ padding: '4px 10px', borderRadius: 5, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid #fee2e2', color: '#dc2626' }}>Eliminar</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal agregar/editar categoría */}
      {modalAdd && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setModalAdd(false)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: 420, maxWidth: '95vw', border: '1px solid #e0e7ff' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{editCat ? 'Editar categoría' : 'Nueva categoría'}</h3>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>Los cambios se aplican inmediatamente.</p>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 5, fontWeight: 600 }}>Nombre</label>
              <input value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))} placeholder="Ej: Marketing" style={inp} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 5, fontWeight: 600 }}>Grupo</label>
              <select value={form.grupo} onChange={e => setForm(p => ({ ...p, grupo: e.target.value }))} style={{ ...inp, cursor: 'pointer' }}>
                {grupos.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 8, fontWeight: 600 }}>Color</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {COLORS.map(c => (
                  <div key={c} onClick={() => setForm(p => ({ ...p, color: c }))}
                    style={{ width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer', border: form.color === c ? '3px solid #0f172a' : '3px solid transparent', transition: 'border 0.15s' }} />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setModalAdd(false); setEditCat(null) }} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={saveCat} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                {editCat ? 'Guardar cambios' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nuevo grupo */}
      {modalGrupo && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setModalGrupo(false)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: 380, maxWidth: '95vw', border: '1px solid #e0e7ff' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Nuevo grupo</h3>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>Crea un grupo para organizar categorías relacionadas.</p>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 5, fontWeight: 600 }}>Nombre del grupo</label>
              <input value={formGrupo.nombre} onChange={e => setFormGrupo({ nombre: e.target.value })} placeholder="Ej: 🚀 Marketing" style={inp} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalGrupo(false)} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: 'none', border: '1px solid #c7d2fe', color: '#475569', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={saveGrupo} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 13, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Crear grupo</button>
            </div>
          </div>
        </div>
      )}

      {notif && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#fff', border: '1px solid #4f46e5', padding: '12px 18px', borderRadius: 8, fontSize: 13, zIndex: 999 }}>{notif}</div>
      )}
    </div>
  )
}
