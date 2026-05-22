#!/usr/bin/env node
// Daily Meta Ads review agent for Cromática.
// Pulls campaign + ad-level insights from Meta Marketing API,
// asks Claude for recommendations, sends an email via Resend.

const {
  META_ACCESS_TOKEN,
  META_AD_ACCOUNT_ID,
  ANTHROPIC_API_KEY,
  RESEND_API_KEY,
  EMAIL_TO,
  EMAIL_FROM = "Cromática Ads <onboarding@resend.dev>",
  CLAUDE_MODEL = "claude-sonnet-4-6",
  META_API_VERSION = "v21.0",
  DRY_RUN = "false",
} = process.env;

const required = { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, ANTHROPIC_API_KEY, RESEND_API_KEY, EMAIL_TO };
for (const [k, v] of Object.entries(required)) {
  if (!v) throw new Error(`Missing required env var: ${k}`);
}

const adAccount = META_AD_ACCOUNT_ID.startsWith("act_") ? META_AD_ACCOUNT_ID : `act_${META_AD_ACCOUNT_ID}`;
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const INSIGHT_FIELDS = [
  "campaign_name",
  "adset_name",
  "ad_name",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
  "cost_per_action_type",
  "objective",
].join(",");

async function metaFetch(path, params = {}) {
  const url = new URL(`${META_BASE}/${path}`);
  url.searchParams.set("access_token", META_ACCESS_TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Meta API ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchInsights({ level, datePreset }) {
  const params = {
    level,
    fields: INSIGHT_FIELDS,
    date_preset: datePreset,
    limit: "100",
  };
  const all = [];
  let next = null;
  let page = await metaFetch(`${adAccount}/insights`, params);
  all.push(...(page.data ?? []));
  next = page.paging?.next;
  while (next) {
    const res = await fetch(next);
    const body = await res.json();
    if (!res.ok) throw new Error(`Meta paging ${res.status}: ${JSON.stringify(body)}`);
    all.push(...(body.data ?? []));
    next = body.paging?.next;
  }
  return all;
}

async function fetchAccountInfo() {
  return metaFetch(adAccount, {
    fields: "name,currency,timezone_name,amount_spent,balance,account_status",
  });
}

function summarizeNumeric(rows) {
  const sum = (key) => rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const spend = sum("spend");
  return {
    spend: spend.toFixed(2),
    impressions,
    clicks,
    ctr: impressions ? ((clicks / impressions) * 100).toFixed(2) + "%" : "—",
    cpc: clicks ? (spend / clicks).toFixed(2) : "—",
    cpm: impressions ? ((spend / impressions) * 1000).toFixed(2) : "—",
    rows: rows.length,
  };
}

async function askClaude({ account, yesterdayCampaigns, last7Campaigns, last7Ads, last30Campaigns }) {
  const system = `Eres analista de Meta Ads para Cromática, negocio de impresión de stickers y vinil en Pachuca, México.
Owner: Jorge. Moneda: MXN. La cuenta está corriendo campañas reales y Jorge necesita una revisión diaria.

Contexto de negocio:
- Producto: stickers y vinil personalizado, ticket promedio bajo-medio
- Canal: Shopify + Meta Ads (relanzamiento nacional en progreso)
- Métricas que importan: CPA, ROAS si hay tracking de purchases, costo por lead/mensaje si la campaña es de engagement, CTR como señal de creativo
- Jorge prefiere recomendaciones CONCRETAS y ACCIONABLES, no teoría

Tu tarea: revisar los datos de ayer + 7d + 30d y producir un brief diario en español, formato HTML simple (sin <html> ni <body>, solo el contenido para meter en un email). Estructura:

<h2>Resumen de ayer</h2>
<ul> ... métricas clave de ayer vs 7d promedio ... </ul>

<h2>Top 3 acciones para hoy</h2>
<ol>
  <li><strong>Acción concreta</strong>: razón en 1-2 líneas con números</li>
  ...
</ol>

<h2>Alertas</h2>
<ul> ... fatiga de anuncios (frequency > 3), spend sin conversiones, CPA disparado, etc. Si no hay alertas, di "Sin alertas hoy." ... </ul>

<h2>Qué está funcionando</h2>
<ul> ... 1-3 ganadores con números ... </ul>

Reglas:
- Si los datos están vacíos o incompletos, dilo claro, no inventes
- Cita números reales (spend, CTR, CPA)
- Máximo 350 palabras total
- No recomiendes "aumentar budget" sin justificarlo con CPA estable o ROAS positivo
- Si hay anuncios con frequency > 3 y CTR cayendo, marcar fatiga de creativo`;

  const userContent = `Datos de la cuenta:
${JSON.stringify(account, null, 2)}

Ayer (por campaña):
${JSON.stringify(yesterdayCampaigns, null, 2)}

Últimos 7 días (por campaña):
${JSON.stringify(last7Campaigns, null, 2)}

Últimos 7 días (por anuncio, top spenders):
${JSON.stringify(last7Ads.slice(0, 20), null, 2)}

Últimos 30 días (por campaña):
${JSON.stringify(last30Campaigns, null, 2)}

Genera el brief diario.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${JSON.stringify(body)}`);
  return body.content?.[0]?.text ?? "(sin contenido)";
}

async function sendEmail({ subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      subject,
      html,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function todayLabel() {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting Meta daily review for ${adAccount}`);

  const [account, yesterdayCampaigns, last7Campaigns, last7Ads, last30Campaigns] = await Promise.all([
    fetchAccountInfo(),
    fetchInsights({ level: "campaign", datePreset: "yesterday" }),
    fetchInsights({ level: "campaign", datePreset: "last_7d" }),
    fetchInsights({ level: "ad", datePreset: "last_7d" }),
    fetchInsights({ level: "campaign", datePreset: "last_30d" }),
  ]);

  last7Ads.sort((a, b) => Number(b.spend ?? 0) - Number(a.spend ?? 0));

  console.log("Totals — yesterday:", summarizeNumeric(yesterdayCampaigns));
  console.log("Totals — last 7d:", summarizeNumeric(last7Campaigns));

  const brief = await askClaude({
    account,
    yesterdayCampaigns,
    last7Campaigns,
    last7Ads,
    last30Campaigns,
  });

  const totals = summarizeNumeric(yesterdayCampaigns);
  const subject = `Meta Ads · ${todayLabel()} · $${totals.spend} MXN ayer`;
  const html = `${brief}
<hr>
<p style="color:#888;font-size:12px">
Resumen automático generado por el agente diario.<br>
Ayer: ${totals.rows} campañas activas · ${totals.impressions} imp · ${totals.clicks} clicks · CTR ${totals.ctr} · CPC $${totals.cpc} · CPM $${totals.cpm}
</p>`;

  if (DRY_RUN === "true") {
    console.log("DRY_RUN=true, no se envía email. Brief generado:\n");
    console.log(html);
    return;
  }

  const result = await sendEmail({ subject, html });
  console.log("Email enviado:", result.id);
}

main().catch((err) => {
  console.error("Daily review failed:", err);
  process.exit(1);
});
