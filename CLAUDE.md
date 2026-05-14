# Cromática Presupuesto

App de presupuesto estilo YNAB para **Cromática**, negocio de impresión de stickers y vinil en Pachuca, México. Owner/operador: Jorge.

URL producción: `cromatica-presupuesto.vercel.app`
Repo: `jconde007/cromatica-presupuesto`

---

## Stack

- **Frontend:** React + Vite (`App.jsx` como componente principal)
- **Backend:** Supabase (PostgreSQL) — toda interacción con DB en `db.js`
- **Auth:** Google OAuth vía Supabase (cuenta Gmail de Cromática)
- **Deploy:** Vercel (auto-deploy desde `main`)
- **Versionado:** GitHub (`jconde007/cromatica-presupuesto`)

---

## Cuentas del sistema

| Cuenta        | Tipo    | Notas                                              |
|---------------|---------|----------------------------------------------------|
| Banorte       | Débito  | Cuenta principal. Import CSV diario/semanal.       |
| MP Billetera  | Débito  | Import CSV mensual solo para reconciliación.       |
| MP Tarjeta    | Crédito | `saldo_inicial` debe ser **negativo**. Gastos manuales. |

`setSaldoInicial` auto-negativiza para cuentas de crédito.

---

## Metodología YNAB implementada

- Columnas por categoría: **Objetivo / Asignado / Gastado / Disponible**
- **"Listo para asignar"** se calcula SOLO de cuentas débito (no incluye crédito)
- **True Expenses con arrastre** mes a mes vía botón "Cerrar mes"
- **Detección de overspending** con flujo "Cubrir ahora" / "Mover dinero"
- **Reconciliación** por cuenta
- **Gestión dinámica** de categorías y grupos vía modal de Configuración
- **Input aritmético** en campo asignado: acepta `800+200`, `+200`, `-100`, etc.

### Categorías típicas de Cromática

- **Consumibles:** viniles, tintas, sobres, cajas
- **Costos variables:** cabezales, reparaciones, envíos
- **Fijos operativos:** CFE, Telmex, Odoo, Canva, Adobe, Google Drive, Shopify, plaza
- **Personal:** sueldos (Jorge, Memo, Mony)
- **Impuestos/finanzas:** SAT

---

## Funcionalidades clave

### Import Banorte CSV
- Deduplicación automática
- Auto-categorización por CLABE

### Deadlines / fechas límite
- Semáforo de color según proximidad
- Muestra % de progreso inline

### Apartados de tarjeta de crédito
- Tabla `apartados_tarjeta`
- Permite "apartar" dinero de categorías hacia el pago de MP Tarjeta

---

## Bugs ya resueltos (no volver a introducir)

- ❌ Overspending usaba `presupuesto` en vez de `asignados` — **corregido**
- ❌ `saldo_inicial` de MP Tarjeta en positivo — **debe ser negativo**
- ❌ Input de asignado con `onBlur` leía valor stale — **resuelto con input controlado**
- ❌ `setSaldoInicial` no auto-negativizaba crédito — **corregido**

---

## Convenciones de código

- **Toda interacción con Supabase pasa por `db.js`.** No hacer queries directas desde `App.jsx`.
- Componente principal monolítico en `App.jsx` (no fragmentar todavía salvo que se pida explícitamente).
- Estado de inputs editables = **controlados** (evitar bugs de `onBlur` con valores stale).
- Montos en MXN, sin decimales en UI salvo que se necesite precisión.

---

## Workflow de desarrollo

1. **Siempre trabajar contra el archivo actual del repo.** Antes de cambios grandes, verificar que la versión local coincide con `main`.
2. **Deploy:** `git push` a `main` → Vercel auto-deploy.
3. **No testear en localhost.** Vercel Auth tiene problemas con redirect en Safari sobre localhost. Probar directo en producción tras push.
4. **Bundle de cambios:** preferir un solo push con varios fixes que múltiples pushes pequeños.
5. **Cambios de schema / data fixes:** usar Supabase SQL Editor directamente.

---

## Workflow de transacciones (uso real)

- **Banorte:** CSV importado diario o semanal
- **MP Tarjeta:** gastos logueados manualmente cuando ocurren
- **MP Billetera:** CSV mensual solo para reconciliación

---

## Supabase — notas importantes

- Si una tabla tiene RLS activado, necesita políticas explícitas para `authenticated` (SELECT/INSERT/UPDATE/DELETE según el caso).
- Verificar consistencia de RLS entre tablas — todas activadas con políticas, o todas desactivadas. Mezclarlas causa errores difíciles de debuggear.
- Para inspeccionar RLS:
  ```sql
  SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'nombre_tabla';
  SELECT * FROM pg_policies WHERE tablename = 'nombre_tabla';
  ```

---

## Contexto de negocio (relevante para decisiones de producto)

- Esta app es **paso 1** de un plan más amplio: estabilizar Cromática Pachuca con sistemas financieros claros antes de relanzar el canal nacional vía Shopify + Meta Ads (planeado para julio).
- **Pay yourself first:** sueldo de Jorge se trata como gasto del negocio, separado de la utilidad.
- **No mezclar gastos personales y de negocio.** Separación estricta.
- Regla de oro: **"funcional en dos semanas"** — evitar over-engineering.

---

## Roadmap inmediato (mayo–junio)

- ✅ Estabilizar funcionalidad core de la app
- 🔄 Empezar mes nuevo limpio el **1 de junio** (evita la complejidad de reconciliar a media-mes que pasó en mayo)
- 🔲 Pulir flujo de apartados de tarjeta
- 🔲 Refinar reportes / vistas de cierre de mes

---

## Preferencias de colaboración

- Jorge prefiere **explicaciones concretas** y **soluciones accionables**, no teoría abstracta.
- Cuando algo no funciona, Jorge reporta directo qué ve en pantalla — responder con diagnóstico + fix, no con preguntas en cascada.
- Si hay duda sobre el estado del archivo, **leer el archivo primero** antes de proponer cambios.
