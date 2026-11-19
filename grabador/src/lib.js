// Funciones puras del grabador: sin dependencias de Cloudflare, para probarlas
// con `node --test` (ver grabador/test/). Ver docs/decisiones.md («Grabador
// permanente y datos crudos»).

export const SEGUNDO = 1000, MINUTO = 60 * SEGUNDO, HORA = 60 * MINUTO, DIA = 24 * HORA;
// Guadalajara: UTC−6 fijo (sin horario de verano desde 2022).
export const DESFASE_GDL = -6 * HORA;

/** Día de Guadalajara (AAAA-MM-DD) de un epoch en ms. */
export function diaGDL(t) {
  return new Date(t + DESFASE_GDL).toISOString().slice(0, 10);
}

/** Hora de Guadalajara con fracción (0 ≤ h < 24). */
export function horaGDL(t) {
  return (((t + DESFASE_GDL) % DIA) + DIA) % DIA / HORA;
}

/** Epoch en ms de las `h` horas (GDL) del día `dia`. */
export function epochGDL(dia, h = 0) {
  return Date.parse(dia + "T00:00:00Z") - DESFASE_GDL + h * HORA;
}

/** Siguiente vez (en ms, > t) que el reloj de GDL marca la hora `h`. */
export function siguienteHora(t, h) {
  let x = epochGDL(diaGDL(t), h);
  while (x <= t) x += DIA;
  return x;
}

/** Día siguiente (AAAA-MM-DD). */
export function diaSiguiente(dia) {
  return new Date(Date.parse(dia + "T00:00:00Z") + DIA).toISOString().slice(0, 10);
}

/** "1-3 7" → ["geocerca.1", "geocerca.2", "geocerca.3", "geocerca.7"]. */
export function canales(spec) {
  const out = [];
  for (const parte of String(spec).split(/[\s,]+/).filter(Boolean)) {
    const [a, b = a] = parte.split("-").map(Number);
    for (let i = a; i <= b; i++) out.push(`geocerca.${i}`);
  }
  return out;
}

/** Pusher manda `data` como cadena JSON, a veces doblemente codificada. */
export function desenvolver(x) {
  for (let i = 0; i < 3 && typeof x === "string"; i++) {
    try { x = JSON.parse(x); } catch { return null; }
  }
  return typeof x === "string" ? null : x;
}

// Campos que no se publican. `unitVehicleIdInternal` es un identificador interno
// de la unidad que no hace falta para analizar el servicio.
const QUITAR = new Set(["unitVehicleIdInternal"]);

/** Copia de `data` sin los campos de QUITAR, a cualquier profundidad. */
export function limpiar(x) {
  if (Array.isArray(x)) return x.map(limpiar);
  if (x && typeof x === "object") {
    const o = {};
    for (const [k, v] of Object.entries(x)) if (!QUITAR.has(k)) o[k] = limpiar(v);
    return o;
  }
  return x;
}

/** Datos del mensaje que usa el grabador: vehículo y número de canal. */
export function resumen(ch, data) {
  const m = data && typeof data === "object" ? data.message : null;
  const v = m && typeof m === "object" ? (m.vehicleId ?? m.message?.vehicleId) : undefined;
  const n = Number(String(ch).split(".").pop());
  return { vehiculo: v == null ? null : String(v), canal: Number.isInteger(n) ? n : null };
}

/** Una línea del archivo crudo (con salto de línea). */
export function linea(t, ch, data) {
  return JSON.stringify({ t, ch, data }) + "\n";
}

/** Espera antes de reintentar: 1 s, 2 s, 4 s… hasta 60 s; tras 10 fallos, 5 min.
 *  Jitter: entre 50 y 100 % (como el cliente de public/index.html). */
export function espera(intento, azar = Math.random()) {
  const tope = intento >= 10 ? 5 * MINUTO : MINUTO;
  return Math.round(Math.min(tope, SEGUNDO * 2 ** intento) * (0.5 + azar / 2));
}

/**
 * ¿Qué hacer con la conexión a la hora `t`?
 * - Antes de `conecta` (madrugada): fuera.
 * - De `conecta` a `desconecta`: conectado.
 * - Después de `desconecta`: sigue conectado mientras haya camiones trabajando;
 *   se pausa cuando, tras `ventanaMs` conectado, solo se vieron `estacionadas`
 *   unidades o menos en esa ventana. Una vez pausado, no vuelve hasta mañana.
 * @returns {"conectar"|"pausar"|"fuera"}
 */
export function decidir(t, cfg, s) {
  const h = horaGDL(t);
  if (h < cfg.conecta) return "fuera";
  if (h < cfg.desconecta) return "conectar";
  if (s.pausadoDia === diaGDL(t)) return "fuera";
  if (s.conectadoDesde && t - s.conectadoDesde >= cfg.ventanaMs && s.unidades <= cfg.estacionadas)
    return "pausar";
  return "conectar";
}

/**
 * Minutos conectado (con `established`) dentro de [desde, hasta), a partir del
 * registro de conexiones del día. Lo que corta la conexión: close, error,
 * pausa, inicio (reinicio del objeto) y fin.
 */
export function minutosConectado(eventos, desde, hasta, conectadoAlInicio = false) {
  let total = 0, abierto = conectadoAlInicio ? desde : null;
  for (const e of eventos) {
    const t = Math.min(Math.max(e.t, desde), hasta);
    if (e.ev === "established") { if (abierto === null) abierto = t; }
    else if (["close", "error", "pausa", "inicio"].includes(e.ev)) {
      if (abierto !== null) { total += t - abierto; abierto = null; }
    }
  }
  if (abierto !== null) total += hasta - abierto;
  return Math.round(total / MINUTO);
}

/** ¿Hay que avisar? Un aviso por incidente y otro al recuperarse. */
export function vigilar(t, cfg, s) {
  const avisos = [], estado = { ...s };
  const h = horaGDL(t);
  const sin = s.ultimoMsg ? (t - s.ultimoMsg) / MINUTO : Infinity;
  if (h >= cfg.avisoDesde && h < cfg.avisoHasta && sin > cfg.umbralMin) {
    if (!s.sinDatos) {
      avisos.push({
        titulo: "Grabador de camiones sin datos",
        texto: s.ultimoMsg
          ? `Llevan ${Math.round(sin)} min sin mensajes geocerca.messages.`
          : "No hay mensajes geocerca.messages registrados.",
      });
      estado.sinDatos = true;
    }
  } else if (s.sinDatos && sin <= cfg.umbralMin) {
    avisos.push({ titulo: "Grabador de camiones: volvieron los datos", texto: `Último mensaje hace ${Math.round(sin)} min.` });
    estado.sinDatos = false;
  }
  if (s.canalMax > cfg.canalAviso && !s.canalAlto) {
    avisos.push({
      titulo: `Camiones: canal geocerca.${s.canalMax}`,
      texto: "Llegan mensajes cerca del límite suscrito; sube CANALES en grabador/wrangler.jsonc.",
    });
    estado.canalAlto = true;
  }
  return { avisos, estado };
}

/** Escapa texto para HTML. */
export function html(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** Tamaño legible. */
export function tamano(b) {
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return Math.round(b / 1e3) + " kB";
  return b + " B";
}

/**
 * Lista completa de días desde el primero hasta `hasta` (inclusive), con los
 * días sin archivo marcados, para que un hueco no pase desapercibido.
 */
export function completarDias(dias, hasta) {
  if (!dias.length) return [];
  const por = new Map(dias.map((d) => [d.dia, d]));
  const out = [];
  for (let d = dias.map((x) => x.dia).sort()[0]; d <= hasta; d = diaSiguiente(d))
    out.push(por.get(d) ?? { dia: d, mensajes: 0, faltante: true });
  return out.reverse();
}

/** Filas de la tabla del índice HTML. */
export function filasIndice(dias, base = "crudo/") {
  return dias.map((d) => {
    const sem = DIAS_SEMANA[new Date(d.dia + "T12:00:00Z").getUTCDay()];
    if (d.faltante)
      return `<tr class="falta"><td>${d.dia} <span class="sem">${sem}</span></td><td colspan="5">Sin archivo: el grabador no estuvo conectado.</td></tr>`;
    const m = `${base}mensajes-${d.dia}.jsonl.gz`, c = `${base}conexion-${d.dia}.jsonl.gz`;
    return `<tr><td>${d.dia} <span class="sem">${sem}</span></td>` +
      `<td class="n">${d.mensajes.toLocaleString("es-MX")}</td>` +
      `<td class="n">${d.vehiculos ?? ""}</td>` +
      `<td class="n">${d.minutos == null ? "" : (d.minutos / 60).toFixed(1) + " h"}</td>` +
      `<td><a href="${html(m)}" download>mensajes</a> <span class="sem">${tamano(d.bytes)}</span></td>` +
      `<td><a href="${html(c)}" download>conexiones</a></td></tr>`;
  }).join("\n");
}
