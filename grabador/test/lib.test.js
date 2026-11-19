// Pruebas de las funciones puras del grabador: `node --test grabador/test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import * as L from "../src/lib.js";

const gdl = (s) => Date.parse(s + "-06:00");   // "2026-11-17T21:30" en hora de GDL

test("día y hora de Guadalajara en los bordes", () => {
  assert.equal(L.diaGDL(gdl("2026-11-17T23:59:59")), "2026-11-17");
  assert.equal(L.diaGDL(gdl("2026-11-18T00:00:00")), "2026-11-18");
  assert.equal(L.diaGDL(Date.parse("2026-11-18T05:59:59Z")), "2026-11-17");
  assert.equal(L.horaGDL(gdl("2026-11-17T21:30")), 21.5);
  assert.equal(L.epochGDL("2026-11-18"), Date.parse("2026-11-18T06:00:00Z"));
  assert.equal(L.epochGDL("2026-11-18", 5), Date.parse("2026-11-18T11:00:00Z"));
  assert.equal(L.diaSiguiente("2026-12-31"), "2027-01-01");
  assert.equal(L.siguienteHora(gdl("2026-11-17T21:00"), 5), gdl("2026-11-18T05:00"));
  assert.equal(L.siguienteHora(gdl("2026-11-17T04:00"), 5), gdl("2026-11-17T05:00"));
  assert.equal(L.siguienteHora(gdl("2026-11-17T05:00"), 5), gdl("2026-11-18T05:00"));
});

test("canales", () => {
  assert.deepEqual(L.canales("1-3 7"), ["geocerca.1", "geocerca.2", "geocerca.3", "geocerca.7"]);
  assert.equal(L.canales("1-300").length, 300);
});

test("desenvolver y limpiar: quita unitVehicleIdInternal a cualquier profundidad, nada más", () => {
  const msg = {
    geocerca_id: 9, timestamp: "2026-11-17 08:00:00",
    message: {
      vehicleId: 8, routeCode: "8", unitVehicleIdInternal: "X1",
      ultimasPosiciones: [["-103.312345678", "20.7312345"]], coordenadas: [-103.312345678, 20.7312345],
      message: { unitVehicleIdInternal: "X2", vehicleId: 8 },
    },
  };
  const data = L.desenvolver(JSON.stringify(JSON.stringify(msg)));   // doblemente codificado
  const l = L.limpiar(data);
  assert.ok(!JSON.stringify(l).includes("unitVehicleIdInternal"));
  assert.deepEqual(l.message.coordenadas, msg.message.coordenadas);   // precisión intacta
  assert.deepEqual(l.message.ultimasPosiciones, msg.message.ultimasPosiciones);
  assert.equal(l.timestamp, msg.timestamp);
  assert.equal(data.message.unitVehicleIdInternal, "X1");             // no muta el original
  assert.equal(L.desenvolver("{no es json"), null);
  assert.deepEqual(L.resumen("geocerca.142", l), { vehiculo: "8", canal: 142 });
});

test("línea compatible con procesar2.py", () => {
  const r = JSON.parse(L.linea(1763388000000, "geocerca.1", { message: { coordenadas: [-103.3, 20.6] } }));
  assert.deepEqual(Object.keys(r), ["t", "ch", "data"]);
  assert.equal(r.data.message.coordenadas[0], -103.3);
});

test("espera creciente con jitter y tope", () => {
  assert.equal(L.espera(0, 1), 1000);
  assert.equal(L.espera(0, 0), 500);
  assert.equal(L.espera(3, 1), 8000);
  assert.equal(L.espera(9, 1), 60000);
  assert.equal(L.espera(10, 1), 300000);
  for (let i = 0; i < 20; i++) {
    const e = L.espera(i);
    assert.ok(e >= Math.min(L.MINUTO, 1000 * 2 ** i) / 2 - 1 && e <= 300000);
  }
});

test("decidir: horario, pausa nocturna adaptativa y medianoche", () => {
  const cfg = { conecta: 5, desconecta: 21, ventanaMs: 30 * L.MINUTO, estacionadas: 3 };
  const s = { pausadoDia: null, conectadoDesde: 0, unidades: 0 };
  assert.equal(L.decidir(gdl("2026-11-17T04:59"), cfg, s), "fuera");
  assert.equal(L.decidir(gdl("2026-11-17T05:00"), cfg, s), "conectar");
  assert.equal(L.decidir(gdl("2026-11-17T20:59"), cfg, s), "conectar");
  // Después de las 21: recién conectado (p. ej. tras un reinicio) → observa la ventana completa.
  assert.equal(L.decidir(gdl("2026-11-17T22:00"), cfg, { ...s, conectadoDesde: gdl("2026-11-17T21:50") }), "conectar");
  // Ventana completa con solo las estacionadas → pausa.
  assert.equal(L.decidir(gdl("2026-11-17T21:30"), cfg, { ...s, conectadoDesde: gdl("2026-11-17T05:00"), unidades: 2 }), "pausar");
  // Camiones trabajando tarde → sigue.
  assert.equal(L.decidir(gdl("2026-11-17T21:30"), cfg, { ...s, conectadoDesde: gdl("2026-11-17T05:00"), unidades: 12 }), "conectar");
  // Ya pausado hoy → no vuelve.
  assert.equal(L.decidir(gdl("2026-11-17T23:00"), cfg, { ...s, pausadoDia: "2026-11-17" }), "fuera");
  // Medianoche → fuera siempre.
  assert.equal(L.decidir(gdl("2026-11-18T00:00"), cfg, { ...s, conectadoDesde: gdl("2026-11-17T05:00"), unidades: 12 }), "fuera");
});

test("minutos conectado según el registro", () => {
  const d = L.epochGDL("2026-11-17"), f = L.epochGDL("2026-11-18");
  const ev = [
    { t: gdl("2026-11-17T05:00"), ev: "open" },
    { t: gdl("2026-11-17T05:00"), ev: "established" },
    { t: gdl("2026-11-17T10:00"), ev: "close" },
    { t: gdl("2026-11-17T10:00"), ev: "reconnect" },
    { t: gdl("2026-11-17T10:01"), ev: "established" },
    { t: gdl("2026-11-17T12:00"), ev: "inicio" },        // reinicio del objeto
    { t: gdl("2026-11-17T12:01"), ev: "established" },
    { t: gdl("2026-11-17T21:31"), ev: "pausa" },
  ];
  assert.equal(L.minutosConectado(ev, d, f), 300 + 119 + 570);
  assert.equal(L.minutosConectado(ev.slice(0, 2), d, f), 19 * 60);   // sin cierre: hasta el fin del día
});

test("vigilar: un aviso por incidente, recuperación y canal alto", () => {
  const cfg = { avisoDesde: 6, avisoHasta: 20, umbralMin: 10, canalAviso: 280 };
  const t = gdl("2026-11-17T10:00");
  let r = L.vigilar(t, cfg, { ultimoMsg: t - 11 * L.MINUTO, sinDatos: false, canalMax: 200 });
  assert.equal(r.avisos.length, 1);
  assert.equal(r.estado.sinDatos, true);
  r = L.vigilar(t, cfg, { ...r.estado, ultimoMsg: t - 12 * L.MINUTO });
  assert.equal(r.avisos.length, 0);                                  // no repite
  r = L.vigilar(t, cfg, { ...r.estado, ultimoMsg: t - L.MINUTO });
  assert.equal(r.avisos.length, 1);                                  // volvieron
  assert.equal(r.estado.sinDatos, false);
  // De noche no avisa.
  assert.equal(L.vigilar(gdl("2026-11-17T22:00"), cfg, { ultimoMsg: 0, canalMax: 0 }).avisos.length, 0);
  r = L.vigilar(t, cfg, { ultimoMsg: t, canalMax: 281 });
  assert.equal(r.avisos.length, 1);
  assert.equal(r.estado.canalAlto, true);
});

test("índice: marca los días faltantes", () => {
  const dias = L.completarDias([
    { dia: "2026-11-24", mensajes: 10, bytes: 2e6, vehiculos: 3, minutos: 900 },
    { dia: "2026-11-26", mensajes: 5, bytes: 100, vehiculos: 2, minutos: 60 },
  ], "2026-11-27");
  assert.deepEqual(dias.map((d) => d.dia), ["2026-11-27", "2026-11-26", "2026-11-25", "2026-11-24"]);
  assert.ok(dias[0].faltante && dias[2].faltante);
  const h = L.filasIndice(dias);
  assert.match(h, /crudo\/mensajes-2026-11-24\.jsonl\.gz/);
  assert.match(h, /Sin archivo/);
  assert.equal(L.completarDias([], "2026-11-27").length, 0);
});

test("miembros gzip concatenados = un .gz válido para zcat y Python", () => {
  const horas = ["a\n", "b\nc\n", "", "d\n"].map((s) => gzipSync(s));
  const todo = Buffer.concat(horas);
  assert.equal(execFileSync("zcat", { input: todo }).toString(), "a\nb\nc\nd\n");
  const py = execFileSync("python3", ["-I", "-c", "import gzip,sys; sys.stdout.write(gzip.decompress(sys.stdin.buffer.read()).decode())"], { input: todo });
  assert.equal(py.toString(), "a\nb\nc\nd\n");
});
