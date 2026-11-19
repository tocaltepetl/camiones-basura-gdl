#!/usr/bin/env python3
"""Conteos de una grabación cruda, para comparar dos grabaciones del mismo día.

Uso:
  conteo.py resumen mensajes-AAAA-MM-DD.jsonl[.gz] … > resumen.json
  conteo.py comparar a.json b.json

`resumen` saca, por día (hora de Guadalajara): total de mensajes, mensajes por
canal, vehículos únicos, mensajes por bloque de 10 minutos y la llave de cada
mensaje (canal, vehículo, timestamp de la fuente), que no depende de la hora de
recepción. `comparar` dice qué falta en cada lado y en qué bloques de 10 min;
los huecos se explican con el registro de conexiones (conexion-*.jsonl.gz).
Solo biblioteca estándar.
"""
import collections
import gzip
import json
import sys
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=-6))  # Guadalajara, sin horario de verano


def abrir(ruta):
    return gzip.open(ruta, "rt", encoding="utf-8") if ruta.endswith(".gz") else open(ruta, encoding="utf-8")


def resumen(rutas):
    dias = {}
    for ruta in rutas:
        with abrir(ruta) as f:
            for linea in f:
                try:
                    r = json.loads(linea)
                    m = r["data"]["message"]
                except (ValueError, KeyError, TypeError):
                    continue
                t = datetime.fromtimestamp(r["t"] / 1000, TZ)
                d = dias.setdefault(t.strftime("%Y-%m-%d"), {
                    "mensajes": 0, "canales": collections.Counter(), "vehiculos": set(),
                    "bloques": collections.Counter(), "llaves": set()})
                d["mensajes"] += 1
                d["canales"][r["ch"]] += 1
                d["vehiculos"].add(str(m.get("vehicleId")))
                d["bloques"][t.strftime("%H:") + f"{t.minute // 10}0"] += 1
                d["llaves"].add(f'{r["ch"]}|{m.get("vehicleId")}|{r["data"].get("timestamp")}')
    return {dia: {"mensajes": d["mensajes"], "canales": dict(sorted(d["canales"].items())),
                  "vehiculos": len(d["vehiculos"]), "bloques": dict(sorted(d["bloques"].items())),
                  "llaves": sorted(d["llaves"])} for dia, d in sorted(dias.items())}


def comparar(a, b):
    for dia in sorted(set(a) | set(b)):
        da, db = a.get(dia), b.get(dia)
        if not da or not db:
            print(f"{dia}: solo en {'A' if da else 'B'}")
            continue
        la, lb = set(da["llaves"]), set(db["llaves"])
        comun = len(la & lb)
        print(f"{dia}: A {da['mensajes']} msj ({len(la)} únicos) · B {db['mensajes']} msj ({len(lb)} únicos) · "
              f"en ambos {comun} · solo A {len(la - lb)} ({100 * len(la - lb) / max(len(la), 1):.2f} %) · "
              f"solo B {len(lb - la)} ({100 * len(lb - la) / max(len(lb), 1):.2f} %)")
        print(f"  vehículos: A {da['vehiculos']} · B {db['vehiculos']}")
        canales = sorted(set(da["canales"]) ^ set(db["canales"]), key=lambda c: int(c.split(".")[-1]))
        if canales:
            print("  canales solo en un lado:", ", ".join(canales))
        for k in sorted(set(da["bloques"]) | set(db["bloques"])):
            x, y = da["bloques"].get(k, 0), db["bloques"].get(k, 0)
            if abs(x - y) > max(5, 0.02 * max(x, y)):
                print(f"  {k}  A {x:6d}  B {y:6d}")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "resumen":
        json.dump(resumen(sys.argv[2:]), sys.stdout)
    elif len(sys.argv) == 4 and sys.argv[1] == "comparar":
        cargar = lambda p: json.load(open(p, encoding="utf-8"))
        comparar(cargar(sys.argv[2]), cargar(sys.argv[3]))
    else:
        sys.exit(__doc__)
