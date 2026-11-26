#!/usr/bin/env python3
"""Horario aproximado de recolección y detector de anomalías.

Parte de los recorridos crudos que publica el grabador
(https://datos.basuragdl.tocaltepetl.org/index.json). Todo se recalcula desde
cero cada día con una ventana móvil, así que no hay estado que mantener: si una
ruta cambia, el horario se acomoda solo en unas semanas y, mientras tanto, el
detector lo avisa.

Pasos:
  resumir CRUDO.jsonl.gz SALIDA.json.gz
      Un día crudo → resumen por ruta: a qué hora pasó por primera vez,
      recolectando (despacio), por cada cuadro de ~80 m.
  sincronizar --resumenes DIR [--base URL] [--nuevos ARCHIVO]
      Baja el índice; por cada día de la ventana sin resumen en DIR, baja el
      resumen ya publicado o, si no hay, el crudo, y lo resume. Anota en
      --nuevos los resúmenes que hizo él (para subirlos).
  actualizar --resumenes DIR --salida DIR [--hasta AAAA-MM-DD]
      Resúmenes → horarios.json (horario por punto), anomalias.json (qué fue
      raro cada día), resumen.md (para el registro de Actions) y aviso.txt
      (solo si hay algo que avisar).

Método y formato: README («Horario aproximado») y docs/decisiones.md.
Solo biblioteca estándar.
"""
import argparse
import gzip
import json
import math
import os
import statistics as st
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

TZ = timezone(timedelta(hours=-6))  # Guadalajara, sin horario de verano

# ---------- parámetros (cambiarlos aquí; quedan anotados en horarios.json) ----------
CELDA_LAT, CELDA_LNG = 0.00072, 0.00077  # cuadro de ~80 m
MOVIMIENTO_MIN = 0.00025          # menos que esto (~27 m) entre señales: no se movió
VEL_RECOLECCION_KMH = 15          # más rápido que esto va de paso, no recogiendo
SALTO_MAX_MIN = 5                 # con más tiempo entre señales no se calcula velocidad
HORA_MIN = 4                      # antes de las 4:00 no se cuenta (camiones en el patio)
PUNTOS_RUTA_MIN = 80              # una ruta con menos señales en movimiento no trabajó
RUTAS_SERVICIO_MIN = 30           # menos rutas activas: día sin servicio (domingo, feriado)
VENTANA_DIAS = 42                 # el horario usa las últimas 6 semanas
DIAS_MIN = 4                      # un punto se publica con al menos 4 días vistos
DIAS_MIN_CARGADO = 2
PCT_INI, PCT_FIN = 0.2, 0.8       # el rango deja fuera el 20 % más temprano y el más tarde
NIVEL_ESTABLE, NIVEL_APROX = 45, 120   # ancho del rango (min) para «estable» y «aproximado»
REDONDEO = 5                      # el rango se redondea a 5 min hacia afuera
BLOQUE_SIN_DATOS = (7 * 60, 14 * 60)   # horario en que un hueco de la fuente cuenta
SIN_DATOS_MAX = 30                # más minutos sin ningún mensaje: día incompleto
CARGA_ATIPICA = 1.07              # día normal con rutas 7 % más largas: atípico (lo normal: 0.98–1.01)
RUTA_HABITUAL = 0.7               # una ruta que trabaja ≥70 % de los días normales
CALLES_NUEVAS = 0.5               # >50 % de los cuadros del día fuera de su recorrido típico
COBERTURA_BAJA = 0.5              # <50 % de su recorrido típico cubierto
RETRASO_MIN = 45                  # pasa 45 min o más tarde que lo típico
INICIO_TARDE = 90                 # empieza 90 min o más tarde: no cuenta para el horario
TIPICO_FRACCION = 0.4             # recorrido típico: cuadros vistos en ≥40 % de los días normales
MUCHAS_RUTAS = 10                 # a partir de aquí, un aviso por ruta se vuelve aviso del día
CAMBIO_PERSISTENTE = 3            # días seguidos con calles nuevas: cambio de ruta
HISTORIAL_DIAS = 90
BASE = "https://datos.basuragdl.tocaltepetl.org/"
UA = {"User-Agent": "camiones-basura-gdl-horarios (+https://github.com/tocaltepetl/camiones-basura-gdl)"}


# ---------- utilidades ----------
def abrir(ruta, modo="rt"):
    return gzip.open(ruta, modo, encoding="utf-8") if ruta.endswith(".gz") else open(ruta, modo, encoding="utf-8")


def leer_json(ruta):
    with abrir(ruta) as f:
        return json.load(f)


def escribir_json(ruta, obj, compacto=False):
    os.makedirs(os.path.dirname(ruta) or ".", exist_ok=True)
    with abrir(ruta, "wt") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":") if compacto else None,
                  indent=None if compacto else 1)


def metros(lat1, lng1, lat2, lng2):
    r = math.pi / 180
    x = (lng2 - lng1) * r * math.cos((lat1 + lat2) / 2 * r)
    return 6371000 * math.hypot(x, (lat2 - lat1) * r)


def percentil(vals, p):
    """Percentil con interpolación lineal (vals ordenados)."""
    if len(vals) == 1:
        return vals[0]
    k = (len(vals) - 1) * p
    i = int(k)
    return vals[i] + (vals[min(i + 1, len(vals) - 1)] - vals[i]) * (k - i)


def dia_de(fecha):
    return date.fromisoformat(fecha)


# ---------- 1. resumir un día ----------
def resumir(ruta_crudo, dia=None):
    """Resumen de un día crudo. dia: AAAA-MM-DD (por omisión, el del nombre del archivo)."""
    dia = dia or os.path.basename(ruta_crudo).split("mensajes-")[-1][:10]
    ultimo = {}       # vehículo → (lat, lng, minuto)
    rutas = {}        # ruta → {"celdas": {(i, j): minuto}, "ini", "fin", "n"}
    bloques = set()   # bloques de 10 min con algún mensaje
    mensajes = 0
    with abrir(ruta_crudo) as f:
        for linea in f:
            try:
                r = json.loads(linea)
                m = r["data"]["message"]
                lng, lat = float(m["coordenadas"][0]), float(m["coordenadas"][1])
                ts = datetime.fromisoformat(r["data"]["timestamp"].replace("Z", "+00:00")).astimezone(TZ)
            except (ValueError, KeyError, TypeError, IndexError):
                continue
            if ts.strftime("%Y-%m-%d") != dia:
                continue
            mensajes += 1
            mi = ts.hour * 60 + ts.minute + ts.second / 60
            bloques.add(int(mi // 10))
            if ts.hour < HORA_MIN:
                continue
            ruta = str(m.get("routeCode") if m.get("routeCode") is not None else r.get("ch", "?").split(".")[-1])
            v = (ruta, m.get("vehicleId"))
            p = ultimo.get(v)
            if p and abs(p[0] - lat) < MOVIMIENTO_MIN and abs(p[1] - lng) < MOVIMIENTO_MIN:
                continue
            ultimo[v] = (lat, lng, mi)
            if not p or mi <= p[2] or mi - p[2] > SALTO_MAX_MIN:
                continue
            kmh = metros(p[0], p[1], lat, lng) / ((mi - p[2]) * 60) * 3.6
            if kmh > VEL_RECOLECCION_KMH:
                continue
            d = rutas.setdefault(ruta, {"celdas": {}, "ini": mi, "fin": mi, "n": 0})
            d["n"] += 1
            d["ini"], d["fin"] = min(d["ini"], mi), max(d["fin"], mi)
            c = (round(lat / CELDA_LAT), round(lng / CELDA_LNG))
            if c not in d["celdas"] or mi < d["celdas"][c]:
                d["celdas"][c] = mi
    a, b = BLOQUE_SIN_DATOS
    sin_datos = sum(10 for k in range(a // 10, b // 10) if k not in bloques)
    return {
        "version": 1, "dia": dia, "mensajes": mensajes, "minutos_sin_datos": sin_datos,
        "rutas": {ruta: {"ini": round(d["ini"]), "fin": round(d["fin"]),
                         "celdas": sorted([i, j, round(mi)] for (i, j), mi in d["celdas"].items())}
                  for ruta, d in sorted(rutas.items()) if d["n"] >= PUNTOS_RUTA_MIN},
    }


# ---------- 2. clasificar días ----------
def clasificar(res):
    """res: {dia: resumen}. Devuelve {dia: info} con tipo, incompleto, carga relativa."""
    info = {}
    for d in sorted(res):
        r = res[d]
        n = len(r["rutas"])
        info[d] = {"dia": d, "rutas_activas": n, "minutos_sin_datos": r["minutos_sin_datos"],
                   "servicio": n >= RUTAS_SERVICIO_MIN,
                   "incompleto": n >= RUTAS_SERVICIO_MIN and r["minutos_sin_datos"] > SIN_DATOS_MAX}
    for d, i in info.items():
        if not i["servicio"]:
            i["tipo"] = "sin_servicio"
            continue
        ayer = (dia_de(d) - timedelta(days=1)).isoformat()
        if ayer in info:
            cargado = not info[ayer]["servicio"]
        else:  # sin datos del día anterior: el lunes siempre viene después del domingo
            cargado = dia_de(d).weekday() == 0
        i["tipo"] = "cargado" if cargado else "normal"
    # Duración típica de cada ruta en días normales, para medir la carga de cada día.
    normales = [d for d, i in info.items() if i["tipo"] == "normal" and not i["incompleto"]]
    dur = {}
    for d in normales:
        for ruta, x in res[d]["rutas"].items():
            dur.setdefault(ruta, []).append(x["fin"] - x["ini"])
    base = {ruta: st.median(v) for ruta, v in dur.items() if len(v) >= 3 and st.median(v) > 0}
    for d, i in info.items():
        if not i["servicio"]:
            continue
        rel = [(x["fin"] - x["ini"]) / base[ruta] for ruta, x in res[d]["rutas"].items() if ruta in base]
        i["carga"] = round(st.median(rel), 2) if rel else None
        i["atipico"] = i["tipo"] == "normal" and i["carga"] is not None and i["carga"] > CARGA_ATIPICA
    return info


# ---------- 3. horario por punto ----------
def inicios_tipicos(res, dias):
    """Hora mediana de inicio de cada ruta en esos días."""
    ini = {}
    for d in dias:
        for ruta, x in res[d]["rutas"].items():
            ini.setdefault(ruta, []).append(x["ini"])
    return {ruta: st.median(v) for ruta, v in ini.items()}


def _visitas(res, dias, inicio=None):
    """{(ruta, i, j): [minuto por día]}. Con `inicio`, salta los días en que la ruta empezó tarde."""
    vis = {}
    for d in dias:
        for ruta, x in res[d]["rutas"].items():
            if inicio and ruta in inicio and x["ini"] - inicio[ruta] >= INICIO_TARDE:
                continue
            for i, j, mi in x["celdas"]:
                vis.setdefault((ruta, i, j), []).append(mi)
    return vis


def _rango(vals):
    v = sorted(vals)
    a = math.floor(percentil(v, PCT_INI) / REDONDEO) * REDONDEO
    b = math.ceil(percentil(v, PCT_FIN) / REDONDEO) * REDONDEO
    return a, max(b, a + REDONDEO)


def _nivel(a, b):
    return 0 if b - a <= NIVEL_ESTABLE else 1 if b - a <= NIVEL_APROX else 2


def perfil(res, info, hasta):
    """Horario con los días de la ventana que terminan en `hasta` (incluido)."""
    desde = (dia_de(hasta) - timedelta(days=VENTANA_DIAS - 1)).isoformat()
    ventana = [d for d in sorted(res) if desde <= d <= hasta]
    usables = [d for d in ventana if info[d]["servicio"] and not info[d]["incompleto"]]
    normales = [d for d in usables if info[d]["tipo"] == "normal" and not info[d]["atipico"]]
    cargados = [d for d in usables if info[d]["tipo"] == "cargado"]
    inicio = inicios_tipicos(res, normales)
    vn, vc = _visitas(res, normales, inicio), _visitas(res, cargados, inicio)
    # Retraso típico de cada ruta en día cargado (para los puntos con pocos días cargados).
    retraso = {}
    for (ruta, i, j), vals in vc.items():
        n = vn.get((ruta, i, j))
        if n and len(n) >= DIAS_MIN:
            retraso.setdefault(ruta, []).append(st.median(vals) - st.median(n))
    retraso = {ruta: round(st.median(v) / REDONDEO) * REDONDEO for ruta, v in retraso.items() if len(v) >= 20}
    puntos, por_ruta = [], {}
    for (ruta, i, j), vals in vn.items():
        if len(vals) < DIAS_MIN:
            continue
        a, b = _rango(vals)
        c = vc.get((ruta, i, j), [])
        if len(c) >= DIAS_MIN_CARGADO:
            ca, cb = _rango(c)
        elif ruta in retraso:
            ca, cb = a + retraso[ruta], b + retraso[ruta]
        else:
            ca = cb = None
        nv = _nivel(a, b)
        puntos.append([i, j, ruta, a, b, nv, ca, cb])
        por_ruta.setdefault(ruta, []).append(b - a)
    puntos.sort(key=lambda p: (p[2], p[0], p[1]))
    rutas = {}
    for ruta, anchos in sorted(por_ruta.items()):
        m = st.median(anchos)
        rutas[ruta] = {"puntos": len(anchos), "ancho_mediano": round(m),
                       "nivel": _nivel(0, m), "retraso_cargado": retraso.get(ruta)}
    excluidos = [{"dia": d, "motivo": "datos incompletos" if info[d]["incompleto"] else "día atípico"}
                 for d in ventana if info[d]["servicio"] and (info[d]["incompleto"] or info[d].get("atipico"))]
    return {
        "version": 1,
        "hasta": hasta,
        "dias": {"normal": normales, "cargado": cargados, "excluidos": excluidos},
        "rutas": rutas,
        "puntos": puntos,
        "_vn": vn, "_inicio": inicio,  # para el detector; no se publica
    }


# ---------- 4. anomalías de un día contra el horario de los días anteriores ----------
def anomalias_dia(res, info, d, prev, historial):
    """prev: perfil hasta el día anterior. historial: registros ya calculados (más viejo primero)."""
    i = info[d]
    reg = {"dia": d, "tipo": i["tipo"], "rutas_activas": i["rutas_activas"],
           "carga": i.get("carga"), "minutos_sin_datos": i["minutos_sin_datos"], "anomalias": []}
    al = reg["anomalias"]
    wd = dia_de(d).weekday()
    if not i["servicio"]:
        if wd != 6:
            al.append({"tipo": "sin_servicio", "nivel": "info",
                       "detalle": f"Solo {i['rutas_activas']} rutas activas en día entre semana (¿feriado o falla de la fuente?)."})
        return reg
    if i["incompleto"]:
        al.append({"tipo": "datos_incompletos", "nivel": "alta",
                   "detalle": f"{i['minutos_sin_datos']} min sin ningún mensaje entre 7 y 14 h; el día no se usa para el horario."})
    normales = prev["dias"]["normal"]
    if len(normales) < DIAS_MIN:
        reg["nota"] = "Todavía no hay suficientes días para comparar."
        return reg
    if i["tipo"] == "normal" and i.get("atipico"):
        al.append({"tipo": "dia_cargado", "nivel": "media",
                   "detalle": f"Rutas {round((i['carga'] - 1) * 100)} % más largas que un día normal sin venir de un día sin servicio."})
    if i["tipo"] == "cargado" and i.get("carga") is not None and i["carga"] < 1.1:
        al.append({"tipo": "cargado_sin_retraso", "nivel": "info",
                   "detalle": "Venía de un día sin servicio, pero las rutas duraron lo normal."})
    habituales = {}
    for x in normales:
        for ruta in res[x]["rutas"]:
            habituales[ruta] = habituales.get(ruta, 0) + 1
    tipicas = [ruta for ruta, n in habituales.items() if n >= RUTA_HABITUAL * len(normales)]
    activas = res[d]["rutas"]
    faltan = sorted((ruta for ruta in tipicas if ruta not in activas), key=lambda s: (len(s), s))
    if faltan and not i["incompleto"]:
        al.append({"tipo": "rutas_sin_servicio", "nivel": "media" if len(faltan) < 10 else "alta", "rutas": faltan,
                   "detalle": f"{len(faltan)} rutas que trabajan casi diario no se vieron: {', '.join(faltan[:15])}{'…' if len(faltan) > 15 else ''}."})
    vn = prev["_vn"]
    inicio = prev["_inicio"]
    vistos_min = max(2, math.ceil(TIPICO_FRACCION * len(normales)))
    tip_celdas, tip_hora = {}, {}
    for (ruta, ci, cj), vals in vn.items():
        if len(vals) >= vistos_min:
            tip_celdas.setdefault(ruta, set()).add((ci, cj))
        if len(vals) >= DIAS_MIN:
            tip_hora[(ruta, ci, cj)] = st.median(vals)
    previos = {h["dia"]: h for h in historial}
    tarde = []
    for ruta, x in activas.items():
        if ruta in inicio and x["ini"] - inicio[ruta] >= INICIO_TARDE:
            tarde.append(ruta)
            al.append({"tipo": "inicio_tarde", "nivel": "info", "ruta": ruta, "minutos": round(x["ini"] - inicio[ruta]),
                       "detalle": f"Ruta {ruta}: empezó a las {_hora(x['ini'])}, unos {round((x['ini'] - inicio[ruta]) / 60, 1)} h más tarde que de costumbre ({_hora(inicio[ruta])})."})
            continue
        tc = tip_celdas.get(ruta)
        if not tc or len(tc) < 20:
            continue
        hoy = {(ci, cj): mi for ci, cj, mi in x["celdas"]}
        if len(hoy) < 20:
            continue
        comun = set(hoy) & tc
        nuevas = 1 - len(comun) / len(hoy)
        cubierto = len(comun) / len(tc)
        if nuevas > CALLES_NUEVAS:
            racha = 1
            dd = dia_de(d)
            for _ in range(10):  # cuenta hacia atrás los días con servicio que también tuvieron calles nuevas
                dd -= timedelta(days=1)
                h = previos.get(dd.isoformat())
                if h is None or h["tipo"] == "sin_servicio":
                    continue
                if any(a["tipo"] in ("calles_nuevas", "cambio_de_ruta") and a.get("ruta") == ruta for a in h["anomalias"]):
                    racha += 1
                else:
                    break
            if racha >= CAMBIO_PERSISTENTE:
                al.append({"tipo": "cambio_de_ruta", "nivel": "alta", "ruta": ruta, "dias_seguidos": racha,
                           "detalle": f"Ruta {ruta}: {racha} días seguidos por calles distintas a las de siempre ({round(nuevas * 100)} % nuevas hoy)."})
            else:
                al.append({"tipo": "calles_nuevas", "nivel": "media", "ruta": ruta,
                           "detalle": f"Ruta {ruta}: {round(nuevas * 100)} % de lo que recorrió está fuera de su recorrido típico."})
        elif cubierto < COBERTURA_BAJA and not i["incompleto"]:
            al.append({"tipo": "cobertura_baja", "nivel": "info", "ruta": ruta,
                       "detalle": f"Ruta {ruta}: solo recorrió {round(cubierto * 100)} % de su recorrido típico."})
        con_hora = [c for c in comun if (ruta,) + c in tip_hora]
        if i["tipo"] == "normal" and len(con_hora) >= 20:
            dif = st.median(hoy[c] - tip_hora[(ruta,) + c] for c in con_hora)
            if dif >= RETRASO_MIN:
                al.append({"tipo": "retraso", "nivel": "info", "ruta": ruta, "minutos": round(dif),
                           "detalle": f"Ruta {ruta}: pasó unos {round(dif)} min más tarde de lo típico."})
    orden = lambda r: (len(r), r)
    if len(tarde) >= MUCHAS_RUTAS:
        tarde.sort(key=orden)
        al.insert(0, {"tipo": "muchas_rutas_tarde", "nivel": "alta", "rutas": tarde,
                      "detalle": f"{len(tarde)} rutas empezaron 1.5 h o más tarde que de costumbre: {', '.join(tarde)}."})
    nuevas = sorted((a["ruta"] for a in al if a["tipo"] == "calles_nuevas"), key=orden)
    if len(nuevas) >= MUCHAS_RUTAS:
        al.insert(0, {"tipo": "muchas_rutas_calles_nuevas", "nivel": "alta", "rutas": nuevas,
                      "detalle": f"{len(nuevas)} rutas por calles distintas a las de siempre: {', '.join(nuevas)}."})
    return reg


def _hora(m):
    return f"{int(m) // 60}:{int(m) % 60:02d}"


def actualizar(dir_res, dir_sal, hasta=None):
    res = {}
    for fn in sorted(os.listdir(dir_res)):
        if fn.endswith(".json.gz") or fn.endswith(".json"):
            r = leer_json(os.path.join(dir_res, fn))
            res[r["dia"]] = r
    if not res:
        sys.exit("No hay resúmenes.")
    hasta = hasta or max(res)
    res = {d: r for d, r in res.items() if d <= hasta}
    info = clasificar(res)
    # Anomalías de cada día de la ventana, cada uno contra el horario de los días anteriores.
    historial = []
    desde = (dia_de(hasta) - timedelta(days=HISTORIAL_DIAS - 1)).isoformat()
    for d in sorted(res):
        if d < desde:
            continue
        ayer = (dia_de(d) - timedelta(days=1)).isoformat()
        prev = perfil(res, info, ayer)
        historial.append(anomalias_dia(res, info, d, prev, historial))
    hor = perfil(res, info, hasta)
    del hor["_vn"], hor["_inicio"]
    generado = datetime.now(timezone.utc).isoformat(timespec="seconds")
    comunes = {
        "generado": generado,
        "fuente": "Recorridos crudos de https://datos.basuragdl.tocaltepetl.org/ (señal pública en vivo de la Guadalajara App). No oficial.",
        "proyecto": "https://github.com/tocaltepetl/camiones-basura-gdl",
        "metodo": "https://github.com/tocaltepetl/camiones-basura-gdl#horario-aproximado",
        "licencia": "Libre uso, citando la fuente y este proyecto. Para analizar el servicio, no para vigilar a las cuadrillas.",
    }
    hor = {**comunes, **hor,
           "parametros": {"celda_lat": CELDA_LAT, "celda_lng": CELDA_LNG, "ventana_dias": VENTANA_DIAS,
                          "dias_min": DIAS_MIN, "percentiles": [PCT_INI, PCT_FIN],
                          "nivel_estable_min": NIVEL_ESTABLE, "nivel_aproximado_min": NIVEL_APROX},
           "columnas": ["i", "j", "ruta", "ini", "fin", "nivel", "ini_cargado", "fin_cargado"]}
    escribir_json(os.path.join(dir_sal, "horarios.json"), hor, compacto=True)
    anom = {**comunes,
            "umbrales": {"carga_atipica": CARGA_ATIPICA, "calles_nuevas": CALLES_NUEVAS,
                         "cobertura_baja": COBERTURA_BAJA, "retraso_min": RETRASO_MIN,
                         "cambio_persistente_dias": CAMBIO_PERSISTENTE, "sin_datos_max_min": SIN_DATOS_MAX},
            "dias": list(reversed(historial))}
    escribir_json(os.path.join(dir_sal, "anomalias.json"), anom)
    # Resumen legible del último día y aviso si hay algo de nivel alto.
    ult = historial[-1] if historial else None
    pts = hor["puntos"]
    niveles = [sum(p[5] == k for p in pts) for k in range(3)]
    md = [f"## Horario aproximado ({hasta})", "",
          f"- Días normales usados: {len(hor['dias']['normal'])} · cargados: {len(hor['dias']['cargado'])} · "
          f"excluidos: {', '.join(x['dia'] + ' (' + x['motivo'] + ')' for x in hor['dias']['excluidos']) or 'ninguno'}",
          f"- Puntos: {len(pts)} · estables {niveles[0]} · aproximados {niveles[1]} · variables {niveles[2]}"]
    aviso = []
    if ult:
        md += ["", f"### Último día: {ult['dia']} ({ult['tipo']}, carga {ult.get('carga')}, "
                   f"{ult['rutas_activas']} rutas, {ult['minutos_sin_datos']} min sin datos)", ""]
        md += [f"- **{a['nivel']}** · {a['detalle']}" for a in ult["anomalias"]] or ["- Sin anomalías."]
        aviso = [f"{ult['dia']}: {a['detalle']}" for a in ult["anomalias"] if a["nivel"] == "alta"]
    with open(os.path.join(dir_sal, "resumen.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    ruta_aviso = os.path.join(dir_sal, "aviso.txt")
    if aviso:
        with open(ruta_aviso, "w", encoding="utf-8") as f:
            f.write("\n".join(aviso) + "\n")
    elif os.path.exists(ruta_aviso):
        os.remove(ruta_aviso)
    print("\n".join(md))


# ---------- 5. sincronizar con los datos publicados ----------
def bajar(url, destino=None):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            if destino is None:
                return r.read()
            with open(destino, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def sincronizar(dir_res, base=BASE, nuevos=None, tmp=None):
    os.makedirs(dir_res, exist_ok=True)
    indice = json.loads(bajar(base + "index.json"))
    hoy = max(x["dia"] for x in indice["dias"])
    desde = (dia_de(hoy) - timedelta(days=HISTORIAL_DIAS - 1)).isoformat()
    hechos = []
    tmp = tmp or dir_res
    for x in sorted(indice["dias"], key=lambda x: x["dia"]):
        d = x["dia"]
        dest = os.path.join(dir_res, f"{d}.json.gz")
        if d < desde or os.path.exists(dest):
            continue
        if bajar(f"{base}horarios/dias/{d}.json.gz", dest):
            print(f"{d}: resumen publicado", file=sys.stderr)
            continue
        crudo = os.path.join(tmp, f"mensajes-{d}.jsonl.gz")
        if not bajar(x["mensajes_url"], crudo):
            print(f"{d}: sin crudo", file=sys.stderr)
            continue
        escribir_json(dest, resumir(crudo, d), compacto=True)
        os.remove(crudo)
        hechos.append(dest)
        print(f"{d}: resumido", file=sys.stderr)
    if nuevos:
        with open(nuevos, "w", encoding="utf-8") as f:
            f.write("".join(h + "\n" for h in hechos))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="paso", required=True)
    a = sp.add_parser("resumir")
    a.add_argument("crudo")
    a.add_argument("salida")
    a.add_argument("--dia")
    b = sp.add_parser("sincronizar")
    b.add_argument("--resumenes", required=True)
    b.add_argument("--base", default=BASE)
    b.add_argument("--nuevos")
    b.add_argument("--tmp")
    c = sp.add_parser("actualizar")
    c.add_argument("--resumenes", required=True)
    c.add_argument("--salida", required=True)
    c.add_argument("--hasta")
    o = p.parse_args(argv)
    if o.paso == "resumir":
        escribir_json(o.salida, resumir(o.crudo, o.dia), compacto=True)
    elif o.paso == "sincronizar":
        sincronizar(o.resumenes, o.base, o.nuevos, o.tmp)
    else:
        actualizar(o.resumenes, o.salida, o.hasta)


if __name__ == "__main__":
    main()
