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
    if (url.pathname === "/api/evento") return evento(req, env, url);
    if (url.pathname === "/api/reportes") return reportes(req, env, ctx, url);
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
  const resp = json(body, 200, {"cache-control": `public, max-age=${CACHE_S}`});
  ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}
