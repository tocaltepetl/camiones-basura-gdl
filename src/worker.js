// Worker delante de los archivos estáticos. Solo atiende /api/* (ver
// `run_worker_first` en wrangler.jsonc); todo lo demás lo sirve `public/`.
//
// Conteo anónimo de reportes hechos con la guía de GuaZap (issue #14):
// - Solo se aceptan valores de listas cerradas; nada de texto libre.
// - No se guardan IP, cookies ni identificadores. La IP solo se usa, en
//   memoria, como llave del límite de peticiones.
// - La ubicación llega ya redondeada a una celda de CELL_DEG grados.
// - Las celdas con menos de MIN_CELL reportes no se publican.
// Ver docs/decisiones.md («Conteo anónimo de reportes»).

const PROD_HOST = "basuragdl.tocaltepetl.org";  // las vistas previas no guardan eventos
const CELL_DEG = 0.005;            // ~550 m; debe coincidir con REPORT_CELL_DEG de la página
const MIN_CELL = 5;                // reportes mínimos para publicar una celda
const PERIODS = [7, 30];           // días que se pueden consultar
const CACHE_S = 3600;              // los agregados se recalculan como mucho cada hora
const DAY_MS = 86400000;

// Listas cerradas. Deben coincidir con la página (GUAZAP_MUNIS, GUAZAP_KINDS…).
const MUNIS = 3;                   // índices 0..2
const KINDS = 8;                   // tipos 1..8 del menú «Recolección de basura»
const DAY_BUCKETS = [1, 2, 3, 4, 8];   // «días sin pasar»: 1, 2, 3, 4–7, 8+
const RESULTS = ["folio", "sin-folio", "atorado"];
const CHANGES = ["igual", "menu", "foto", "direccion", "ubicacion", "datos", "otro"];
const MAX_STEP = 12;
// Celdas válidas: solo dentro de la ZMG (igual que ZMG_BOUNDS de la página).
const ZMG = {w: -103.75, s: 20.30, e: -102.95, n: 21.05};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/evento") return await evento(req, env, url);
      if (url.pathname === "/api/reportes") return await reportes(req, env, ctx, url);
      if (url.pathname === "/api/reportes.csv") return await reportesCsv(req, env, ctx, url);
    } catch (e) {   // p. ej. D1 sin migrar o caída: la página muestra «No se pudieron cargar»
      console.error(e);
      return json({error: "no disponible"}, 503);
    }
    if (url.pathname.startsWith("/api/")) return json({error: "no existe"}, 404);
    return env.ASSETS.fetch(req);
  },
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json; charset=utf-8", ...headers}});
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max ? v : null;

async function evento(req, env, url) {
  if (req.method !== "POST") return json({error: "usa POST"}, 405);
  // Solo desde la propia página (sendBeacon manda Origin en peticiones POST).
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return json({error: "origen"}, 403);
  if (env.LIMITE) {
    const {success} = await env.LIMITE.limit({key: req.headers.get("cf-connecting-ip") || "?"});
    if (!success) return json({error: "demasiadas"}, 429);
  }
  let b;
  try { b = JSON.parse(await req.text()); } catch { return json({error: "json"}, 400); }
  if (!b || typeof b !== "object") return json({error: "json"}, 400);

  const tipo = b.t === "abrir" || b.t === "resultado" ? b.t : null;
  const mun = int(b.mun, 0, MUNIS - 1), k = int(b.k, 1, KINDS);
  if (!tipo || mun === null || k === null) return json({error: "campos"}, 400);
  const d = int(b.d, 1, 60);
  const dias = k === 1 && d !== null ? DAY_BUCKETS.findLast(x => x <= d) : null;

  let ci = null, cj = null;   // celda: índices de la cuadrícula (lat, lng)
  if (Array.isArray(b.c) && b.c.length === 2) {
    const [i, j] = b.c;
    if (int(i, Math.floor(ZMG.s / CELL_DEG), Math.floor(ZMG.n / CELL_DEG)) !== null &&
        int(j, Math.floor(ZMG.w / CELL_DEG), Math.floor(ZMG.e / CELL_DEG)) !== null) { ci = i; cj = j; }
  }
  let res = null, paso = null, cambio = null;
  if (tipo === "resultado") {
    res = RESULTS.includes(b.r) ? b.r : null;
    if (!res) return json({error: "resultado"}, 400);
    cambio = CHANGES.includes(b.q) ? b.q : null;
    paso = cambio && cambio !== "igual" || res === "atorado" ? int(b.p, 1, MAX_STEP) : null;
  }

  // En `wrangler dev` (localhost) se guarda en la D1 local; en las vistas previas no.
  if (url.host !== PROD_HOST && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return new Response(null, {status: 204, headers: {"x-guardado": "no (vista previa)"}});
  await env.DB.prepare(
    "INSERT INTO eventos (ts, tipo, mun, k, dias, ci, cj, res, paso, cambio) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).bind(Date.now(), tipo, mun, k, dias, ci, cj, res, paso, cambio).run();
  return new Response(null, {status: 204});
}

async function reportes(req, env, ctx, url) {
  if (req.method !== "GET") return json({error: "usa GET"}, 405);
  const dias = PERIODS.includes(+url.searchParams.get("dias")) ? +url.searchParams.get("dias") : PERIODS[0];
  const k = int(+url.searchParams.get("k"), 0, KINDS) ?? 0;   // 0 = todos los tipos
  // Llave de caché normalizada: parámetros desconocidos no generan consultas nuevas.
  const key = new Request(`${url.origin}/api/reportes?dias=${dias}&k=${k}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;

  const desde = Date.now() - dias * DAY_MS;
  const fk = k ? " AND k = ?2" : "";
  const args = k ? [desde, k] : [desde];
  const q = sql => env.DB.prepare(sql).bind(...args);
  const [celdas, tipos, resultados, cambios] = await env.DB.batch([
    q(`SELECT ci, cj, COUNT(*) n FROM eventos WHERE tipo = 'abrir' AND ts >= ?1${fk} AND ci IS NOT NULL
       GROUP BY ci, cj HAVING n >= ${MIN_CELL}`),
    env.DB.prepare(`SELECT k, mun, COUNT(*) n FROM eventos WHERE tipo = 'abrir' AND ts >= ?1 GROUP BY k, mun`).bind(desde),
    q(`SELECT res, COUNT(*) n FROM eventos WHERE tipo = 'resultado' AND ts >= ?1${fk} GROUP BY res`),
    q(`SELECT mun, k, cambio, paso, COUNT(*) n FROM eventos
       WHERE tipo = 'resultado' AND ts >= ?1${fk} AND cambio IS NOT NULL AND cambio <> 'igual'
       GROUP BY mun, k, cambio, paso`),
  ]);
  const body = {
    dias, k, minCelda: MIN_CELL, celdaGrados: CELL_DEG, generado: new Date().toISOString(),
    // Centro de cada celda [lng, lat] y número de reportes.
    celdas: celdas.results.map(r => ({c: [+((r.cj + 0.5) * CELL_DEG).toFixed(5), +((r.ci + 0.5) * CELL_DEG).toFixed(5)], n: r.n})),
    porTipo: tipos.results,
    resultados: Object.fromEntries(resultados.results.map(r => [r.res, r.n])),
    cambios: cambios.results,
  };
  // Datos abiertos: cualquier sitio o herramienta puede leerlos (README → «Datos abiertos»).
  const resp = json(body, 200, {"cache-control": `public, max-age=${CACHE_S}`, "access-control-allow-origin": "*"});
  ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}

// ---------- un renglón por reporte (CSV de datos abiertos) ----------
// Generalizado para que no se pueda reconocer a nadie (docs/decisiones.md,
// «Reportes individuales»):
// - Fecha: solo el día, en hora de Guadalajara. Para los tipos sensibles, el
//   lunes de su semana.
// - Zona: celda de CSV_CELL_DEG (~1.1 km), solo si al menos CSV_MIN reportes
//   comparten día, zona y tipo; si no, va vacía (queda el municipio). Los
//   tipos sensibles nunca llevan zona.
// - Las respuestas de seguimiento («resultado») no llevan zona.
// - Sin id ni hora; los renglones van ordenados por sus columnas, no por llegada.
const CSV_CELL_DEG = 0.01;          // múltiplo exacto de CELL_DEG (2×)
const CSV_MIN = 3;
const CSV_MAX_DAYS = 366;           // rango máximo por descarga
const CSV_DEFAULT_DAYS = 90;
const TZ_OFFSET_MS = -6 * 3600000;  // Guadalajara: UTC−6 todo el año (sin horario de verano desde 2022)
// Tipos que podría leer la cuadrilla de la ruta y adivinar quién reportó.
const SENSITIVE = new Set([5, 6, 7]);
const MUNI_NAMES = ["Guadalajara", "Zapopan", "Otro municipio de la ZMG"];
const KIND_NAMES = [   // como en el menú de GuaZap (GUAZAP_KINDS de la página)
  "Camión recolector no ha pasado en días",
  "Camión no recorre toda la calle",
  "Derrames al compactar la basura",
  "La unidad pasa muy rápido",
  "Personal condiciona el servicio",
  "Personal grosero",
  "Personal no campanea",
  "Recolección inconclusa",
];
const DAY_LABELS = {1: "1", 2: "2", 3: "3", 4: "4-7", 8: "8+"};
const CSV_COLS = ["tipo", "fecha", "municipio", "falla", "falla_nombre", "dias_sin_pasar", "zona_lat", "zona_lng", "resultado", "paso", "cambio"];

const isoDay = ms => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
function weekStart(ms) {   // lunes de la semana, en hora local
  const d = new Date(ms + TZ_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
const parseDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "") && !isNaN(Date.parse(v + "T00:00:00Z")) ? Date.parse(v + "T00:00:00Z") - TZ_OFFSET_MS : null;
const csvCell = v => v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

async function reportesCsv(req, env, ctx, url) {
  if (req.method !== "GET") return json({error: "usa GET"}, 405);
  const today = parseDay(isoDay(Date.now()));
  let hasta = parseDay(url.searchParams.get("hasta")) ?? today;
  hasta = Math.min(hasta, today);
  let desde = parseDay(url.searchParams.get("desde")) ?? hasta - (CSV_DEFAULT_DAYS - 1) * DAY_MS;
  if (desde > hasta) return json({error: "desde > hasta"}, 400);
  desde = Math.max(desde, hasta - (CSV_MAX_DAYS - 1) * DAY_MS);
  const key = new Request(`${url.origin}/api/reportes.csv?desde=${isoDay(desde)}&hasta=${isoDay(hasta)}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;

  const {results} = await env.DB.prepare(
    "SELECT ts, tipo, mun, k, dias, ci, cj, res, paso, cambio FROM eventos WHERE ts >= ?1 AND ts < ?2"
  ).bind(desde, hasta + DAY_MS).all();

  const rows = results.map(e => {
    const sensitive = SENSITIVE.has(e.k);
    const zone = e.tipo === "abrir" && !sensitive && e.ci !== null
      ? [Math.floor(e.ci / 2), Math.floor(e.cj / 2)] : null;   // celda de 0.005° → de 0.01°
    return {e, fecha: sensitive ? weekStart(e.ts) : isoDay(e.ts), zone};
  });
  // Regla de mínimo: zona solo si CSV_MIN reportes comparten día, zona y tipo.
  const groups = new Map();
  const gk = r => `${r.fecha}|${r.zone}|${r.e.k}`;
  for (const r of rows) if (r.zone) groups.set(gk(r), (groups.get(gk(r)) || 0) + 1);
  const lines = rows.map(({e, fecha, zone}) => {
    const z = zone && groups.get(`${fecha}|${zone}|${e.k}`) >= CSV_MIN ? zone : null;
    return [e.tipo, fecha, MUNI_NAMES[e.mun], e.k, KIND_NAMES[e.k - 1], DAY_LABELS[e.dias] ?? null,
      z ? ((z[0] + 0.5) * CSV_CELL_DEG).toFixed(3) : null, z ? ((z[1] + 0.5) * CSV_CELL_DEG).toFixed(3) : null,
      e.res, e.paso, e.cambio].map(csvCell).join(",");
  }).sort();   // orden por columnas: no revela el orden de llegada

  const body = "﻿" + [CSV_COLS.join(","), ...lines].join("\n") + "\n";   // BOM: Excel abre bien los acentos
  const resp = new Response(body, {headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `inline; filename="reportes-guazap-${isoDay(desde)}_${isoDay(hasta)}.csv"`,
    "cache-control": `public, max-age=${CACHE_S}`,
    "access-control-allow-origin": "*",
  }});
  ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}
