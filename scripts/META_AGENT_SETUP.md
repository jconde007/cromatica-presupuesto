# Setup del agente diario de Meta Ads

Este agente corre todos los días a las **9:00 AM hora de Pachuca**, jala datos de tus campañas de Meta, le pide a Claude que genere recomendaciones y te las manda por email.

## Lo que hace

- Pull de insights de los últimos 1, 7 y 30 días (a nivel campaña + anuncio)
- Manda los datos + contexto de Cromática a Claude (Sonnet 4.6)
- Email con: resumen de ayer, top 3 acciones para hoy, alertas (fatiga, CPA disparado), qué está funcionando

## Lo que necesitas hacer (one-time, ~20 min)

### 1. Sacar tu Meta access token

#### a) Crear app en Meta for Developers
1. Ve a https://developers.facebook.com/apps/ y haz click en **"Create App"**
2. Tipo de app: **"Business"**
3. Nómbrala `cromatica-ads-agent` (o lo que quieras)
4. En el dashboard de la app, en la barra izquierda → **"Add Product"** → busca **"Marketing API"** → **"Set Up"**

#### b) Obtener access token de larga duración (System User)

Lo más estable es un **System User token** porque no expira. Para esto necesitas Business Manager:

1. Ve a https://business.facebook.com/settings/
2. **Users → System Users → Add** → nombre: `cromatica-ads-agent`, role: `Admin`
3. Con el System User seleccionado → **"Add Assets"** → elige tu cuenta publicitaria → permisos: **"Manage ad account"**
4. Click en **"Generate New Token"** → elige la app `cromatica-ads-agent` → permisos: marca al menos:
   - `ads_read`
   - `read_insights`
   - `business_management`
5. **Copia el token y guárdalo seguro.** No lo vas a poder ver de nuevo.

> Si no quieres lidiar con System User ahora, puedes generar un token corto desde el [Graph API Explorer](https://developers.facebook.com/tools/explorer/) con los mismos permisos, pero expira en ~2 horas. Sirve para probar.

#### c) Sacar tu Ad Account ID
1. Ve a https://business.facebook.com/settings/ad-accounts
2. Selecciona tu cuenta — el ID aparece arriba en formato `act_1234567890`
3. Guarda el número sin el prefijo `act_` (el script lo agrega solo)

### 2. Crear cuenta de Resend (para el email)

1. Sign up en https://resend.com (free tier: 100 emails/día, suficiente)
2. **API Keys → Create API Key** → permission: `Sending access` → copia la key
3. Por default el email sale desde `onboarding@resend.dev`. Funciona, pero si quieres que diga `ads@cromatica.com.mx`, en Resend → **Domains → Add Domain** y agregas los DNS records que te dan. Opcional.

### 3. Obtener Anthropic API key

1. https://console.anthropic.com/settings/keys → **Create Key**
2. Asegúrate de tener saldo / payment method configurado
3. Costo estimado: ~$0.05–0.15 USD por día con Sonnet 4.6 (datos no son tan grandes)

### 4. Agregar secretos en GitHub

Ve a https://github.com/jconde007/cromatica-presupuesto/settings/secrets/actions → **New repository secret** y agrega estos cinco:

| Nombre | Valor |
|---|---|
| `META_ACCESS_TOKEN` | El token del paso 1b |
| `META_AD_ACCOUNT_ID` | El número del paso 1c (sin `act_`) |
| `ANTHROPIC_API_KEY` | El del paso 3 |
| `RESEND_API_KEY` | El del paso 2 |
| `EMAIL_TO` | `jmcj84@gmail.com` |

### 5. Probar manualmente

1. Ve a https://github.com/jconde007/cromatica-presupuesto/actions/workflows/meta-daily-review.yml
2. Click **"Run workflow"** → puedes dejar `dry_run` en `false` para que mande el email real, o ponerlo en `true` para solo ver el output en los logs
3. Si pasa verde y te llega el email, ya está. Va a correr solo todos los días 9am.

## Troubleshooting

- **`Meta API 190`**: token expiró o inválido. Regénera el System User token.
- **`Meta API 100, code 33`**: el ad account ID está mal. Verifica el número.
- **`Resend 403`**: dominio no verificado y estás tratando de mandar desde un dominio custom. Cambia `EMAIL_FROM` a `Cromática Ads <onboarding@resend.dev>` (default).
- **No llega email pero el workflow pasa verde**: revisa spam, y los logs del job (te dicen el `email id` que devolvió Resend).

## Ajustes

- **Cambiar hora**: edita el `cron` en `.github/workflows/meta-daily-review.yml`. Está en UTC. 9am Pachuca = 15:00 UTC.
- **Cambiar modelo**: por default Sonnet 4.6. Si quieres más profundidad, agrega un repo variable `CLAUDE_MODEL=claude-opus-4-7` en Settings → Variables. Más caro.
- **Pausar el agente**: en Actions, click en el workflow → menú `···` → **Disable workflow**.
