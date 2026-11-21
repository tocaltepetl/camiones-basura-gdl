// Grabador permanente de los recorridos de los camiones de basura de GDL.
//
// Un Durable Object (`Grabador`, una sola instancia) mantiene UNA conexión al
// WebSocket público (protocolo Pusher) que usa la Guadalajara App, suscrita a
// todos los canales geocerca.N, y guarda cada mensaje. Al cerrar cada día
// (hora de Guadalajara) publica en R2 el archivo crudo del día y el registro de
// conexiones, y actualiza el índice. Nada se publica en vivo.
//
// Durabilidad: búfer en memoria → lote en SQLite cada 10 s → cada hora, un
// miembro gzip por hora → al cerrar el día, los miembros se concatenan tal cual
// (un .gz válido) hacia R2, sin recomprimir.
//
// Ver docs/decisiones.md («Grabador permanente y datos crudos»).

import { DurableObject } from "cloudflare:workers";
import PLANTILLA from "./indice.html";
import * as L from "./lib.js";

const TICK_MS = 10 * L.SEGUNDO;       // guardar el búfer y revisar el ping
const PING_MS = 60 * L.SEGUNDO;       // sin tráfico → ping (el servidor corta a los 90 s)
const MUERTO_MS = 120 * L.SEGUNDO;    // sin tráfico ni respuesta al ping → reconectar
const ALARMA_MS = L.MINUTO;           // mientras está conectado (mantiene vivo el objeto)
const REINTENTO_PUBLICAR_MS = 15 * L.MINUTO;
const WS_NORMAL = 1000;

const GZ = {
  contentType: "application/gzip",   // sin Content-Encoding: el navegador lo baja tal cual
  cacheControl: "public, max-age=31536000, immutable",
};
const INDICE = { cacheControl: "public, max-age=300" };

/** Configuración desde `vars` (grabador/wrangler.jsonc). */
function config(env) {
  const n = (k, d) => (env[k] === undefined || env[k] === "" ? d : Number(env[k]));
  return {
    url: String(env.URL_WS).replace(/^ws(s?):/, "http$1:"),
    canales: L.canales(env.CANALES ?? "1-300"),
    conecta: n("HORA_CONECTA", 5),
    desconecta: n("HORA_DESCONECTA", 21),
    ventanaMs: n("VENTANA_MIN", 30) * L.MINUTO,
    estacionadas: n("UNIDADES_ESTACIONADAS", 3),
    avisoDesde: n("AVISO_DESDE", 6),
    avisoHasta: n("AVISO_HASTA", 20),
    umbralMin: n("UMBRAL_MIN", 10),
    canalAviso: n("CANAL_AVISO", 280),
    respaldoMs: n("DIAS_RESPALDO", 3) * L.DIA,
    base: String(env.BASE_URL ?? "").replace(/\/?$/, "/"),
  };
}

export class Grabador extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.cfg = config(env);
    this.ws = null;
    this.conectando = false;
    this.intento = 0;
    this.reintento = null;       // setTimeout de la reconexión
    this.tick = null;            // setInterval mientras hay conexión
    this.buffer = new Map();     // "dia|hora" → {dia, hora, lineas, n, t1, canales, vehiculos}
    this.ultimoRx = 0;
    this.ultimoPing = 0;
    this.conectadoDesde = 0;
    this.suscritos = 0;
    this.unidades = new Map();   // vehículo → último mensaje (para la pausa nocturna)
    this.cola = Promise.resolve(); // ver mantener()
    this.compactadoEn = null;    // "dia|hora" de la última compactación (ver mantener())
    ctx.blockConcurrencyWhile(async () => {
      this.crearTablas();
      this.canalMax = Number(this.kv("canal_max") ?? 0);
      this.ultimoMsg = this.sql.exec(
        "SELECT max(t) AS t FROM (SELECT max(t1) AS t FROM lote UNION ALL SELECT max(t1) FROM hora)",
      ).one().t ?? 0;
      const t = Date.now();
      // Un reinicio en horario es un hueco: queda en el registro con lo último guardado.
      if (this.accion(t) === "conectar") this.evento("inicio", { datos_hasta: this.ultimoMsg || null });
      await ctx.storage.setAlarm(t + L.SEGUNDO);
    });
  }

  crearTablas() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS lote (id INTEGER PRIMARY KEY, dia TEXT, hora INTEGER, n INTEGER,
        t1 INTEGER, canales TEXT, vehiculos TEXT, texto TEXT);
      CREATE TABLE IF NOT EXISTS hora (id INTEGER PRIMARY KEY, dia TEXT, hora INTEGER, n INTEGER,
        t1 INTEGER, canales TEXT, vehiculos TEXT, gz BLOB);
      CREATE TABLE IF NOT EXISTS conexion (id INTEGER PRIMARY KEY, t INTEGER, dia TEXT, linea TEXT);
      CREATE TABLE IF NOT EXISTS dia (dia TEXT PRIMARY KEY, mensajes INTEGER, vehiculos INTEGER,
        canales INTEGER, minutos INTEGER, bytes INTEGER, sha256 TEXT, bytes_conexion INTEGER,
        publicado INTEGER);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
      CREATE INDEX IF NOT EXISTS lote_dh ON lote (dia, hora);
      CREATE INDEX IF NOT EXISTS hora_d ON hora (dia);
      CREATE INDEX IF NOT EXISTS conexion_d ON conexion (dia);
    `);
  }

  kv(k) { return this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray()[0]?.v ?? null; }
  kvSet(k, v) {
    if (v === null) this.sql.exec("DELETE FROM kv WHERE k = ?", k);
    else this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", k, String(v));
  }

  /** Registro de conexiones: {t, ev, ...extra}, como el grabador anterior. */
  evento(ev, extra = {}) {
    const t = Date.now();
    this.sql.exec("INSERT INTO conexion (t, dia, linea) VALUES (?, ?, ?)", t, L.diaGDL(t), JSON.stringify({ t, ev, ...extra }));
  }

  accion(t) {
    for (const [v, tv] of this.unidades) if (t - tv > this.cfg.ventanaMs) this.unidades.delete(v);
    return L.decidir(t, this.cfg, {
      pausadoDia: this.kv("pausado_dia"),
      conectadoDesde: this.conectadoDesde,
      unidades: this.unidades.size,
    });
  }

  // ---------- conexión ----------

  async conectar() {
    if (this.ws || this.conectando || this.reintento) return;
    this.conectando = true;
    if (this.kv("en_pausa")) { this.evento("reanuda"); this.kvSet("en_pausa", null); }
    try {
      const resp = await fetch(this.cfg.url, { headers: { Upgrade: "websocket" } });
      const ws = resp.webSocket;
      if (!ws) throw new Error(`sin upgrade (HTTP ${resp.status})`);
      ws.accept();
      this.ws = ws;
      this.ultimoRx = this.ultimoPing = Date.now();
      this.evento("open");
      ws.addEventListener("message", (e) => this.alMensaje(e.data));
      ws.addEventListener("close", (e) => this.alCerrar(ws, e.code, e.reason));
      ws.addEventListener("error", (e) => this.evento("error", { error: String(e?.message ?? e) }));
      this.tick ??= setInterval(() => this.alTick(), TICK_MS);
    } catch (e) {
      this.evento("error", { error: String(e?.message ?? e).slice(0, 300) });
      this.reintentar();
    } finally {
      this.conectando = false;
    }
  }

  enviar(o) { try { this.ws?.send(JSON.stringify(o)); } catch { /* el close se encarga */ } }

  alMensaje(raw) {
    const t = Date.now();
    this.ultimoRx = t;
    if (typeof raw !== "string") raw = new TextDecoder().decode(raw);
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.event) {
      case "pusher:connection_established":
        this.intento = 0;
        this.conectadoDesde = t;
        this.suscritos = 0;
        this.evento("established");
        for (const ch of this.cfg.canales) this.enviar({ event: "pusher:subscribe", data: { channel: ch } });
        break;
      case "pusher_internal:subscription_succeeded":
        if (++this.suscritos === this.cfg.canales.length) this.evento("suscrito", { canales: this.suscritos });
        break;
      case "pusher:ping": this.enviar({ event: "pusher:pong", data: {} }); break;
      case "pusher:error": this.evento("pusher_error", { frame: raw.slice(0, 1000) }); break;
      case "geocerca.messages": this.grabar(t, m.channel, m.data); break;
      // geocerca.status no se graba (es la geocerca del servidor), igual que antes.
    }
  }

  grabar(t, ch, crudo) {
    const data = L.desenvolver(crudo);
    if (data == null) return;
    const limpio = L.limpiar(data);
    const { vehiculo, canal } = L.resumen(ch, limpio);
    const dia = L.diaGDL(t), hora = Math.floor(L.horaGDL(t)), k = `${dia}|${hora}`;
    let b = this.buffer.get(k);
    if (!b) this.buffer.set(k, (b = { dia, hora, lineas: [], n: 0, t1: 0, canales: new Set(), vehiculos: new Set() }));
    b.lineas.push(L.linea(t, ch, limpio));
    b.n++;
    b.t1 = t;
    b.canales.add(ch);
    if (vehiculo) { b.vehiculos.add(vehiculo); this.unidades.set(vehiculo, t); }
    this.ultimoMsg = t;
    if (canal > this.canalMax) { this.canalMax = canal; this.kvSet("canal_max", canal); }
  }

  /** Búfer → SQLite (un renglón por hora con datos). */
  guardar() {
    for (const b of this.buffer.values()) {
      this.sql.exec(
        "INSERT INTO lote (dia, hora, n, t1, canales, vehiculos, texto) VALUES (?, ?, ?, ?, ?, ?, ?)",
        b.dia, b.hora, b.n, b.t1, JSON.stringify([...b.canales]), JSON.stringify([...b.vehiculos]), b.lineas.join(""),
      );
    }
    this.buffer.clear();
  }

  alTick() {
    this.guardar();
    const t = Date.now();
    if (!this.ws) return;
    if (t - this.ultimoRx > MUERTO_MS) {
      const ws = this.ws;
      this.alCerrar(ws, 4000, "sin tráfico");
      try { ws.close(WS_NORMAL, "sin tráfico"); } catch { /* ya cerrado */ }
    } else if (t - this.ultimoRx > PING_MS && t - this.ultimoPing > PING_MS) {
      this.ultimoPing = t;
      this.enviar({ event: "pusher:ping", data: {} });
    }
  }

  alCerrar(ws, code, reason) {
    if (ws !== this.ws) return;      // ya se cerró (pausa o socket viejo)
    this.ws = null;
    this.conectadoDesde = 0;
    this.evento("close", { code, reason: String(reason ?? "").slice(0, 200) });
    this.guardar();
    this.reintentar();
  }

  reintentar() {
    if (this.reintento) return;
    const ms = L.espera(this.intento++);
    this.evento("reconnect", { espera_ms: ms });
    this.reintento = setTimeout(() => { this.reintento = null; this.conectar(); }, ms);
  }

  pausar(motivo, todoElDia) {
    clearTimeout(this.reintento);
    this.reintento = null;
    const ws = this.ws;
    this.ws = null;
    this.conectadoDesde = 0;
    if (ws) { try { ws.close(WS_NORMAL, "pausa"); } catch { /* ya cerrado */ } }
    clearInterval(this.tick);
    this.tick = null;
    this.guardar();
    if (!this.kv("en_pausa")) { this.evento("pausa", { motivo }); this.kvSet("en_pausa", "1"); }
    if (todoElDia) this.kvSet("pausado_dia", L.diaGDL(Date.now()));
  }

  // ---------- alarma: conexión, compactación, publicación ----------

  async alarm() {
    const t = Date.now();
    const a = this.accion(t);
    if (a === "conectar") await this.conectar();
    else if (this.ws || this.reintento || !this.kv("en_pausa"))
      this.pausar(a === "pausar" ? "sin camiones en servicio" : "fuera de horario", a === "pausar");
    const pendiente = await this.mantener(t);
    await this.ctx.storage.setAlarm(this.siguienteAlarma(t, a, pendiente));
  }

  /** Guardar, compactar, publicar y purgar, de uno en uno: la compresión es
   *  asíncrona y otro evento podría compactar las mismas filas dos veces.
   *
   *  Corre con cada alarma (cada minuto mientras hay conexión), pero compactar
   *  solo hace falta al cambiar la hora y publicar/purgar al cambiar el día: las
   *  consultas que buscan qué falta recorren tablas enteras, y hacerlas cada
   *  minuto agotó las 5 M de filas leídas al día del plan gratuito (21-nov). */
  mantener(t) {
    const tarea = this.cola.then(async () => {
      this.guardar();
      try {
        const hora = `${L.diaGDL(t)}|${Math.floor(L.horaGDL(t))}`;
        if (this.compactadoEn !== hora) {
          await this.compactar(t);
          this.compactadoEn = hora;
        }
        const hoy = L.diaGDL(t);
        if (!L.tocaRevisar(t, { revisado: this.kv("revisado"), reintentarDesde: Number(this.kv("reintentar_desde") ?? 0) }))
          return this.kv("revisado") !== hoy;
        const pendiente = await this.publicarPendientes(t);
        this.purgar(t);
        if (pendiente) this.kvSet("reintentar_desde", t + REINTENTO_PUBLICAR_MS);
        else { this.kvSet("revisado", hoy); this.kvSet("reintentar_desde", null); }
        return pendiente;
      } catch (e) {
        console.error("grabador:", e?.stack ?? e);
        this.kvSet("reintentar_desde", t + REINTENTO_PUBLICAR_MS);
        return true;
      }
    });
    this.cola = tarea.catch(() => {});
    return tarea;
  }

  siguienteAlarma(t, a, pendiente) {
    if (a === "conectar" || this.ws) return t + ALARMA_MS;
    let x = L.siguienteHora(t, this.cfg.conecta);
    if (pendiente) x = Math.min(x, t + REINTENTO_PUBLICAR_MS);
    // Hay datos de hoy: despertar justo después de medianoche para publicar el día.
    const hoy = L.diaGDL(t);
    // EXISTS se detiene en la primera fila (UNION leía todas las de hoy).
    const hayHoy = this.sql.exec(
      `SELECT EXISTS (SELECT 1 FROM lote WHERE dia = ?1) OR EXISTS (SELECT 1 FROM hora WHERE dia = ?1)
         OR EXISTS (SELECT 1 FROM conexion WHERE dia = ?1) AS x`, hoy,
    ).one().x;
    if (hayHoy) x = Math.min(x, L.epochGDL(L.diaSiguiente(hoy)) + L.MINUTO);
    return x;
  }

  /** Cada hora ya terminada → un miembro gzip en `hora`. */
  async compactar(t) {
    const actual = `${L.diaGDL(t)}|${Math.floor(L.horaGDL(t))}`;
    const grupos = this.sql.exec("SELECT dia, hora FROM lote GROUP BY dia, hora ORDER BY dia, hora").toArray()
      .filter((g) => `${g.dia}|${g.hora}` !== actual);
    for (const { dia, hora } of grupos) {
      const filas = this.sql.exec("SELECT id, n, t1, canales, vehiculos FROM lote WHERE dia = ? AND hora = ? ORDER BY id", dia, hora).toArray();
      const gz = await gzip(filas.map((f) => () => this.sql.exec("SELECT texto FROM lote WHERE id = ?", f.id).one().texto));
      const canales = new Set(), vehiculos = new Set();
      for (const f of filas) { JSON.parse(f.canales).forEach((c) => canales.add(c)); JSON.parse(f.vehiculos).forEach((v) => vehiculos.add(v)); }
      const ids = filas.map((f) => f.id);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "INSERT INTO hora (dia, hora, n, t1, canales, vehiculos, gz) VALUES (?, ?, ?, ?, ?, ?, ?)",
          dia, hora, filas.reduce((s, f) => s + f.n, 0), Math.max(...filas.map((f) => f.t1)),
          JSON.stringify([...canales]), JSON.stringify([...vehiculos]), gz.buffer,
        );
        this.sql.exec(`DELETE FROM lote WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
      });
    }
  }

  /** Publica los días cerrados que falten. Devuelve true si alguno quedó pendiente. */
  async publicarPendientes(t) {
    const hoy = L.diaGDL(t);
    const dias = this.sql.exec(
      `SELECT dia FROM hora WHERE dia < ? UNION SELECT dia FROM conexion WHERE dia < ?
       EXCEPT SELECT dia FROM dia ORDER BY dia`, hoy, hoy,
    ).toArray().map((r) => r.dia);
    let pendiente = false;
    for (const dia of dias) {
      if (this.sql.exec("SELECT 1 FROM lote WHERE dia = ? LIMIT 1", dia).toArray().length) { pendiente = true; continue; }
      try { await this.publicarDia(dia, t); }
      catch (e) { console.error(`publicar ${dia}:`, e?.stack ?? e); pendiente = true; }
    }
    // También la primera vez, para que el índice exista antes del primer día.
    if (dias.length || this.kv("indice_pendiente") || !this.kv("indice_publicado")) {
      this.kvSet("indice_pendiente", "1");
      await this.publicarIndice(t);
      this.kvSet("indice_pendiente", null);
      this.kvSet("indice_publicado", "1");
    }
    return pendiente;
  }

  async publicarDia(dia, t) {
    const partes = this.sql.exec("SELECT id, length(gz) AS len, n, canales, vehiculos FROM hora WHERE dia = ? ORDER BY id", dia).toArray();
    const vacio = partes.length ? null : await gzip([() => ""]);
    const piezas = vacio ? [() => vacio] : partes.map((p) => () => new Uint8Array(this.sql.exec("SELECT gz FROM hora WHERE id = ?", p.id).one().gz));
    const total = vacio ? vacio.byteLength : partes.reduce((s, p) => s + p.len, 0);
    const llave = `crudo/mensajes-${dia}.jsonl.gz`;

    // Concatenar los miembros gzip tal cual (sin recomprimir) y sacar el sha256 de paso.
    const { readable, writable } = new FixedLengthStream(total);
    const digest = new crypto.DigestStream("SHA-256");
    const escribir = (async () => {
      const w = writable.getWriter(), d = digest.getWriter();
      for (const p of piezas) { const b = p(); await d.write(b.slice()); await w.write(b); }
      await w.close();
      await d.close();
    })();
    await Promise.all([this.env.DATOS.put(llave, readable, { httpMetadata: GZ }), escribir]);
    const sha256 = [...new Uint8Array(await digest.digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
    const h = await this.env.DATOS.head(llave);
    if (!h || h.size !== total) throw new Error(`${llave}: tamaño ${h?.size} ≠ ${total}`);

    const lineas = this.sql.exec("SELECT linea FROM conexion WHERE dia = ? ORDER BY id", dia).toArray().map((r) => r.linea);
    const con = await gzip([() => lineas.map((l) => l + "\n").join("")]);
    await this.env.DATOS.put(`crudo/conexion-${dia}.jsonl.gz`, con, { httpMetadata: GZ });

    const canales = new Set(), vehiculos = new Set();
    for (const p of partes) { JSON.parse(p.canales).forEach((c) => canales.add(c)); JSON.parse(p.vehiculos).forEach((v) => vehiculos.add(v)); }
    const minutos = L.minutosConectado(lineas.map((l) => JSON.parse(l)), L.epochGDL(dia), L.epochGDL(L.diaSiguiente(dia)));
    this.sql.exec(
      "INSERT OR REPLACE INTO dia VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      dia, partes.reduce((s, p) => s + p.n, 0), vehiculos.size, canales.size, minutos, total, sha256, con.byteLength, t,
    );
  }

  async publicarIndice(t) {
    const filas = this.sql.exec("SELECT * FROM dia ORDER BY dia").toArray();
    const dias = L.completarDias(filas, L.diaGDL(t - L.DIA));
    const u = (tipo, d) => `${this.cfg.base}crudo/${tipo}-${d}.jsonl.gz`;
    const json = {
      descripcion: "Recorridos crudos de los camiones de basura de Guadalajara: un archivo por día (hora de Guadalajara, UTC−6).",
      fuente: "Señal pública en vivo de la Guadalajara App (Ayuntamiento de Guadalajara). No oficial.",
      proyecto: "https://github.com/tocaltepetl/camiones-basura-gdl",
      licencia: "Libre uso, citando la fuente y este proyecto. Para analizar el servicio, no para vigilar a las cuadrillas.",
      formato: "https://github.com/tocaltepetl/camiones-basura-gdl#recorridos-crudos-por-día",
      actualizado: new Date(t).toISOString(),
      dias: dias.map((d) => d.faltante ? { dia: d.dia, faltante: true } : {
        dia: d.dia, mensajes: d.mensajes, vehiculos: d.vehiculos, canales: d.canales,
        minutos_conectado: d.minutos, mensajes_url: u("mensajes", d.dia), mensajes_bytes: d.bytes,
        mensajes_sha256: d.sha256, conexion_url: u("conexion", d.dia),
      }),
    };
    await this.env.DATOS.put("index.json", JSON.stringify(json, null, 1), {
      httpMetadata: { ...INDICE, contentType: "application/json; charset=utf-8" },
    });
    const pagina = PLANTILLA
      .replace("{{FILAS}}", () => L.filasIndice(dias) || '<tr><td colspan="6">Todavía no hay días publicados.</td></tr>')
      .replace("{{ACTUALIZADO}}", () => L.html(new Date(t + L.DESFASE_GDL).toISOString().slice(0, 16).replace("T", " ")));
    await this.env.DATOS.put("index.html", pagina, {
      httpMetadata: { ...INDICE, contentType: "text/html; charset=utf-8" },
    });
  }

  /** Borra de SQLite lo ya publicado hace más de DIAS_RESPALDO días. */
  purgar(t) {
    const viejo = t - this.cfg.respaldoMs;
    this.sql.exec("DELETE FROM hora WHERE dia IN (SELECT dia FROM dia WHERE publicado < ?)", viejo);
    this.sql.exec("DELETE FROM conexion WHERE dia IN (SELECT dia FROM dia WHERE publicado < ?)", viejo);
  }

  /** Solo para pruebas locales (ver `fetch`): compacta y publica como si fuera la hora `t`. */
  async probarCierre(t) {
    if (this.env.PRUEBA !== "1") throw new Error("solo en pruebas");
    const pendiente = await this.mantener(t);
    return {
      pendiente,
      dias: this.sql.exec("SELECT * FROM dia").toArray(),
      lote: this.sql.exec("SELECT count(*) AS n FROM lote").one().n,
      horas: this.sql.exec("SELECT dia, hora, n, length(gz) AS bytes FROM hora ORDER BY id").toArray(),
      conexion: this.sql.exec("SELECT linea FROM conexion ORDER BY id").toArray().map((r) => JSON.parse(r.linea)),
    };
  }

  // ---------- RPC para el cron (vigía) ----------

  async vigilar() {
    const t = Date.now();
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(t + L.SEGUNDO);
    const antes = { sinDatos: this.kv("sin_datos") === "1", canalAlto: this.kv("canal_alto") === "1" };
    const { avisos, estado } = L.vigilar(t, this.cfg, { ...antes, ultimoMsg: this.ultimoMsg, canalMax: this.canalMax });
    if (estado.sinDatos !== antes.sinDatos) this.kvSet("sin_datos", estado.sinDatos ? "1" : null);
    if (estado.canalAlto !== antes.canalAlto) this.kvSet("canal_alto", estado.canalAlto ? "1" : null);
    return { avisos, conectado: Boolean(this.ws), ultimoMsg: this.ultimoMsg };
  }
}

/** Comprime en un solo miembro gzip, pidiendo los textos uno por uno (sin juntarlos en memoria). */
async function gzip(textos) {
  const cs = new CompressionStream("gzip");
  const salida = new Response(cs.readable).arrayBuffer();
  const w = cs.writable.getWriter();
  const enc = new TextEncoder();
  for (const f of textos) await w.write(enc.encode(f()));
  await w.close();
  return new Uint8Array(await salida);
}

async function avisar(env, { titulo, texto }) {
  if (!env.NTFY_TOPIC) { console.log("aviso (sin NTFY_TOPIC):", titulo, "—", texto); return; }
  // Título por parámetro: los encabezados HTTP no admiten acentos.
  const u = new URL(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`);
  u.searchParams.set("title", titulo);
  u.searchParams.set("tags", "wastebasket");
  const r = await fetch(u, { method: "POST", body: texto });
  if (!r.ok) console.error("ntfy:", r.status);
}

export default {
  async fetch(req, env) {
    // Solo en `wrangler dev` con --var PRUEBA:1: cerrar el día con el reloj adelantado.
    if (env.PRUEBA === "1") {
      const url = new URL(req.url);
      const stub = env.GRABADOR.get(env.GRABADOR.idFromName("gdl"));
      if (url.pathname === "/prueba/cerrar") return Response.json(await stub.probarCierre(Date.parse(url.searchParams.get("t"))));
      if (url.pathname === "/prueba/vigilar") return Response.json(await stub.vigilar());
    }
    return new Response("Los datos están en https://datos.basuragdl.tocaltepetl.org/\n", { status: 404 });
  },

  // Cada 5 min: despierta al objeto (segundo vigía además de su alarma) y avisa por ntfy.
  async scheduled(ev, env) {
    const stub = env.GRABADOR.get(env.GRABADOR.idFromName("gdl"));
    try {
      const r = await stub.vigilar();
      for (const a of r.avisos) await avisar(env, a);
    } catch (e) {
      console.error("vigía:", e?.stack ?? e);
      // Sin estado aquí: como mucho un aviso cada 30 min mientras siga fallando.
      if (new Date(ev.scheduledTime).getUTCMinutes() % 30 < 5)
        await avisar(env, {
          titulo: "Grabador de camiones: el objeto no responde",
          texto: `${String(e?.message ?? e).slice(0, 200)}. Si es el límite diario del plan gratuito, se reinicia a las 18:00 (GDL).`,
        });
    }
  },
};
