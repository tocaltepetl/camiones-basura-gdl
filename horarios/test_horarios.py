"""Pruebas de horarios.py con días sintéticos. Correr: python3 -m unittest discover horarios"""
import gzip
import json
import os
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
import horarios as H  # noqa: E402

TZ = timezone(timedelta(hours=-6))
LAT0, LNG0 = 20.67, -103.35


def mensaje(dia, minuto, ruta, lat, lng, veh=None):
    t = datetime.fromisoformat(dia).replace(tzinfo=TZ) + timedelta(minutes=minuto)
    ts = t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000000Z")
    return {"t": int(t.timestamp() * 1000), "ch": f"geocerca.{ruta}",
            "data": {"message": {"vehicleId": veh or int(ruta), "routeCode": str(ruta),
                                 "coordenadas": [lng, lat]}, "timestamp": ts}}


def recorrido(dia, ruta, inicio, fila=0, pasos=120, paso_min=1.0, dlat=0.0004, columna=0):
    """Un camión que avanza despacio (~2.4 km/h) por una «calle» propia de la ruta."""
    base_lat = LAT0 + int(ruta) * 0.02 + fila * 0.003
    base_lng = LNG0 + columna * 0.05
    return [mensaje(dia, inicio + k * paso_min, ruta, base_lat + k * dlat, base_lng) for k in range(pasos)]


def escribir_crudo(carpeta, dia, mensajes):
    ruta = os.path.join(carpeta, f"mensajes-{dia}.jsonl.gz")
    with gzip.open(ruta, "wt", encoding="utf-8") as f:
        for m in sorted(mensajes, key=lambda m: m["data"]["timestamp"]):
            f.write(json.dumps(m) + "\n")
    return ruta


def dia_servicio(dia, rutas=range(1, 41), inicio=420, cambios=None):
    """Mensajes de un día con servicio: 40 rutas, cada una por su calle, más un latido por minuto."""
    cambios = cambios or {}
    msgs = []
    for r in rutas:
        c = cambios.get(r, {})
        msgs += recorrido(dia, r, c.get("inicio", inicio), columna=c.get("columna", 0),
                          pasos=c.get("pasos", 120), paso_min=c.get("paso_min", 1.0))
    # Una unidad estacionada que manda señal cada minuto de 6 a 21 h (evita «sin datos»).
    msgs += [mensaje(dia, m, 999, LAT0, LNG0 - 0.1) for m in range(360, 1260)]
    return msgs


class Resumir(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_despacio_cuenta_rapido_no(self):
        dia = "2026-11-24"
        despacio = recorrido(dia, 1, 420)                                  # ~2.6 km/h
        rapido = recorrido(dia, 2, 420, dlat=0.004, paso_min=0.5)          # ~53 km/h
        r = H.resumir(escribir_crudo(self.tmp, dia, despacio + rapido))
        self.assertIn("1", r["rutas"])
        self.assertNotIn("2", r["rutas"])
        x = r["rutas"]["1"]
        self.assertEqual(x["ini"], 421)   # la primera señal no tiene velocidad
        self.assertGreater(len(x["celdas"]), 50)

    def test_estacionado_y_otro_dia_no_cuentan(self):
        dia = "2026-11-24"
        quieto = [mensaje(dia, 420 + k, 3, LAT0, LNG0) for k in range(200)]
        ayer = recorrido("2026-11-23", 4, 420)
        r = H.resumir(escribir_crudo(self.tmp, dia, quieto + ayer), dia)
        self.assertEqual(r["rutas"], {})
        self.assertEqual(r["mensajes"], 200)

    def test_minutos_sin_datos(self):
        dia = "2026-11-24"
        r = H.resumir(escribir_crudo(self.tmp, dia, recorrido(dia, 1, 420)))  # solo 7:00–9:00
        self.assertEqual(r["minutos_sin_datos"], (14 - 9) * 60)


class Actualizar(unittest.TestCase):
    """Dos semanas sintéticas (L–S, domingos sin servicio) y un último día con cambios."""

    def armar(self, ultimo_cambios=None, dias_cambio=1):
        tmp = tempfile.mkdtemp()
        res, sal = os.path.join(tmp, "res"), os.path.join(tmp, "sal")
        os.makedirs(res)
        d0 = date(2026, 11, 9)  # lunes
        dias = [d0 + timedelta(days=k) for k in range(16)]   # hasta el martes 24
        for k, d in enumerate(dias):
            dia = d.isoformat()
            if d.weekday() == 6:
                msgs = [mensaje(dia, m, 999, LAT0, LNG0) for m in range(360, 1260)]
            else:
                lunes = d.weekday() == 0
                cambios = {}
                if lunes:   # día cargado: todas las rutas van más lento
                    cambios = {r: {"inicio": 420, "paso_min": 1.5} for r in range(1, 41)}
                if ultimo_cambios and k >= len(dias) - dias_cambio:
                    cambios = ultimo_cambios
                msgs = dia_servicio(dia, cambios=cambios)
            H.escribir_json(os.path.join(res, f"{dia}.json.gz"), H.resumir(escribir_crudo(tmp, dia, msgs), dia), True)
        H.actualizar(res, sal)
        def leer(n):
            with open(os.path.join(sal, n), encoding="utf-8") as f:
                return json.load(f)
        self.ultima_salida = sal
        return leer("horarios.json"), leer("anomalias.json"), os.path.exists(os.path.join(sal, "aviso.txt"))

    @classmethod
    def setUpClass(cls):
        t = cls()
        cls.hor, cls.anom, cls.aviso = t.armar()
        cls.sal = t.ultima_salida

    def test_clasifica_dias(self):
        tipos = {d["dia"]: d["tipo"] for d in self.anom["dias"]}
        self.assertEqual(tipos["2026-11-15"], "sin_servicio")
        self.assertEqual(tipos["2026-11-16"], "cargado")
        self.assertEqual(tipos["2026-11-09"], "cargado")   # lunes sin el domingo anterior
        self.assertEqual(tipos["2026-11-17"], "normal")

    def test_horario_estable(self):
        self.assertEqual(len(self.hor["dias"]["normal"]), 11)
        self.assertEqual(len(self.hor["dias"]["cargado"]), 3)
        p = self.hor["puntos"][0]
        i, j, ruta, a, b, nivel, ca, cb = p
        self.assertEqual(nivel, 0)
        self.assertLessEqual(b - a, H.NIVEL_ESTABLE)
        self.assertGreaterEqual(ca, a)   # el lunes pasa más tarde
        self.assertNotIn("_vn", self.hor)

    def test_recorrido_del_dia_tipico(self):
        with open(os.path.join(self.sal, "rutas", "7.json"), encoding="utf-8") as f:
            r = json.load(f)
        normales = set(self.hor["dias"]["normal"])
        self.assertIn(r["dia"], normales)
        self.assertEqual(self.hor["rutas"]["7"]["dia_tipico"], r["dia"])
        tramo = r["tramos"][0]
        self.assertEqual(len(tramo), 2)        # una calle recta queda en sus dos extremos
        mins = [p[2] for p in tramo]
        self.assertEqual(mins, sorted(mins))
        self.assertAlmostEqual(tramo[0][0], LAT0 + 7 * 0.02, delta=0.001)
        self.assertGreater(mins[-1] - mins[0], 100)

    def test_dia_normal_sin_anomalias(self):
        ult = self.anom["dias"][0]
        self.assertEqual(ult["dia"], "2026-11-24")
        self.assertEqual(ult["anomalias"], [])
        self.assertFalse(self.aviso)

    def test_muchas_rutas_tarde(self):
        cambios = {r: {"inicio": 720} for r in range(1, 13)}   # 12 rutas a las 12:00
        hor, anom, aviso = self.armar(cambios)
        tipos = [a["tipo"] for a in anom["dias"][0]["anomalias"]]
        self.assertEqual(tipos[0], "muchas_rutas_tarde")
        self.assertEqual(tipos.count("inicio_tarde"), 12)
        self.assertTrue(aviso)

    def test_ruta_que_falta_y_calles_nuevas(self):
        cambios = {5: {"pasos": 0}, 7: {"columna": 1}}   # la 5 no salió; la 7 se fue a otra zona
        _, anom, _ = self.armar(cambios)
        a = anom["dias"][0]["anomalias"]
        falta = [x for x in a if x["tipo"] == "rutas_sin_servicio"]
        self.assertEqual(falta[0]["rutas"], ["5"])
        self.assertTrue(any(x["tipo"] == "calles_nuevas" and x["ruta"] == "7" for x in a))

    def test_cambio_de_ruta_persistente(self):
        # Sábado, (domingo sin servicio), lunes y martes por otra zona.
        _, anom, aviso = self.armar({7: {"columna": 1}}, dias_cambio=4)
        a = anom["dias"][0]["anomalias"]
        cambio = [x for x in a if x["tipo"] == "cambio_de_ruta"]
        self.assertEqual(cambio[0]["ruta"], "7")
        self.assertEqual(cambio[0]["dias_seguidos"], 3)
        self.assertTrue(aviso)


if __name__ == "__main__":
    unittest.main()
