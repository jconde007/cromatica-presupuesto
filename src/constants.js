export const CATS_GASTO_GRUPOS = [
  {
    grupo: '📦 Consumibles',
    cats: [
      { id: 'Viniles',   label: 'Viniles / Sustratos', color: '#f59e0b' },
      { id: 'Tintas',    label: 'Tintas',              color: '#ef4444' },
      { id: 'Sobres',    label: 'Sobres',              color: '#f97316' },
      { id: 'Cajas',     label: 'Cajas',               color: '#84cc16' },
    ]
  },
  {
    grupo: '🔧 Gastos Variables',
    cats: [
      { id: 'Cabezales',    label: 'Cabezales',          color: '#06b6d4' },
      { id: 'Reparaciones', label: 'Reparaciones',       color: '#dc2626' },
      { id: 'Adecuaciones', label: 'Adecuaciones local', color: '#7c3aed' },
      { id: 'Envios',       label: 'Envíos',             color: '#2563eb' },
    ]
  },
  {
    grupo: '🏢 Operación Fija',
    cats: [
      { id: 'CFE',      label: 'CFE',                color: '#fbbf24' },
      { id: 'Telmex',   label: 'Telmex',             color: '#34d399' },
      { id: 'Odoo',     label: 'Odoo',               color: '#818cf8' },
      { id: 'Canva',    label: 'Canva',              color: '#f472b6' },
      { id: 'Adobe',    label: 'Adobe',              color: '#fb7185' },
      { id: 'GDrive',   label: 'Google Drive',       color: '#4ade80' },
      { id: 'Shopify',  label: 'Shopify',            color: '#a3e635' },
      { id: 'MantoPl',  label: 'Mantenimiento Plaza',color: '#94a3b8' },
    ]
  },
  {
    grupo: '👥 Personal',
    cats: [
      { id: 'SueldoJorge', label: 'Sueldo Jorge', color: '#38bdf8' },
      { id: 'SueldoMemo',  label: 'Sueldo Memo',  color: '#818cf8' },
      { id: 'SueldoMony',  label: 'Sueldo Mony',  color: '#f0abfc' },
    ]
  },
  {
    grupo: '🧾 Impuestos y Finanzas',
    cats: [
      { id: 'SAT',          label: 'SAT / Impuestos', color: '#f87171' },
      { id: 'GastosVarios', label: 'Gastos varios',   color: '#94a3b8' },
    ]
  },
]

export const CATS_GASTO = CATS_GASTO_GRUPOS.flatMap(g => g.cats)

export const CATS_INGRESO = [
  { id: 'VentasDirectas', label: 'Ventas directas',            color: '#00e676' },
  { id: 'Marketplace',    label: 'Marketplace (Shopify/MeLi)', color: '#40c4ff' },
  { id: 'OtroIngreso',    label: 'Otro ingreso',               color: '#b2ff59' },
]

export const DEFAULT_PRESUPUESTO = {
  Viniles: 22000, Tintas: 16000, Sobres: 800, Cajas: 800,
  Cabezales: 2000, Reparaciones: 0, Adecuaciones: 0, Envios: 1500,
  CFE: 1000, Telmex: 649, Odoo: 493, Canva: 300, Adobe: 400,
  GDrive: 100, Shopify: 600, MantoPl: 480,
  SueldoJorge: 32000, SueldoMemo: 3500, SueldoMony: 0,
  SAT: 8000, GastosVarios: 1500,
}

export function categorizeAuto(concepto, tipo) {
  const c = concepto.toUpperCase()
  if (tipo === 'ingreso') {
    if (c.includes('PAYPAL') || c.includes('MERCADO PAGO') || c.includes('MERCADO*PAGO') || c.includes('SHOPIFY')) return 'Marketplace'
    return 'VentasDirectas'
  }
  if (c.includes('VINIL') || c.includes('SIO SUPPLY') || c.includes('SOL PLAST') || c.includes('SINO SUPPL') || c.includes('SUPPLY') || c.includes('CAPTOP') || c.includes('SIGNOS ROTULACIO') || c.includes('AVANC')) return 'Viniles'
  if (c.includes('TINTA') || c.includes('INK')) return 'Tintas'
  if (c.includes('SOBRE')) return 'Sobres'
  if (c.includes('CAJA')) return 'Cajas'
  if (c.includes('CABEZAL') || c.includes('PRINTHEAD')) return 'Cabezales'
  if (c.includes('REPARACION') || c.includes('SERVICIO TECNICO')) return 'Reparaciones'
  if (c.includes('ADECUACION') || c.includes('CONSTRUCCION')) return 'Adecuaciones'
  if (c.includes('YOLOENVIO') || c.includes('ENVIOSHOP') || c.includes('FEDEX') || c.includes('DHL') || c.includes('ESTAFETA')) return 'Envios'
  if (c.includes('CFE')) return 'CFE'
  if (c.includes('TELMEX')) return 'Telmex'
  if (c.includes('ODOO')) return 'Odoo'
  if (c.includes('CANVA')) return 'Canva'
  if (c.includes('ADOBE')) return 'Adobe'
  if (c.includes('GOOGLE') && (c.includes('DRIVE') || c.includes('STORAGE') || c.includes('ONE'))) return 'GDrive'
  if (c.includes('SHOPIFY')) return 'Shopify'
  if (c.includes('TOTAL PLAY') || c.includes('TOTALPLAY')) return 'MantoPl'
  if (c.includes('GUILLERMO CALV') || c.includes('BONO MENSUAL')) return 'SueldoMemo'
  if (c.includes('SAT') || c.includes('IMPUESTO') || c.includes('REFERENCIADO') || c.includes('PAGO REFERENCIADO')) return 'SAT'
  return 'GastosVarios'
}

export function shouldExclude(concepto) {
  const c = concepto.toUpperCase()
  return (
    c.includes('JORGE MANUEL CONDE') ||
    c.includes('AMERICAN EXPRES') ||
    c.includes('DISTRIBUIDORA VOLKSW') ||
    c.includes('VIDEOS VW')
  )
}

export function fmt(n) {
  return '$' + Math.abs(n).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function fmtInput(n) {
  if (!n && n !== 0) return ''
  return Number(n).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function parseFmt(str) {
  if (!str) return 0
  return parseFloat(String(str).replace(/[$,\s]/g, '')) || 0
}

export function getMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function formatMonthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
}
