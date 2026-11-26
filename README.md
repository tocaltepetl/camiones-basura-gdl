# Camiones de basura GDL

> **English:** unofficial live map of Guadalajara's **garbage trucks** (not public transit buses). A single
> static HTML page that connects straight from the browser to the public
> WebSocket used by the city's app. No backend. Contributions welcome — see
> [CONTRIBUTING.md](CONTRIBUTING.md) (in Spanish; English is fine in issues and PRs).

Mapa en vivo, **no oficial**, de los camiones de basura de Guadalajara.

Un archivo estático (`public/index.html`) más un Worker mínimo para contar
reportes de forma anónima (`src/worker.js`). Aparte, un grabador
(`grabador/`) publica los recorridos crudos de cada día como datos abiertos
(ver [Recorridos crudos por día](#recorridos-crudos-por-día)). El navegador se
conecta directo al WebSocket público que usa la app municipal. Esa fuente no
está documentada y puede fallar o cambiar sin aviso.

## Qué muestra
- Un marcador por camión con su número de ruta, y su estela reciente.
- Hora del último mensaje; gris si lleva más de 5 min sin mensajes.
- Contador de camiones en el mapa.
- Para no cargar al servidor de origen: solo escucha las rutas de la zona
  visible y se pausa tras 10 min sin uso (desactivable en «No oficial · ⓘ»,
  abajo a la izquierda del mapa).
- **Cerca de mí** (geolocalización del navegador) y **Elegir punto** (tocar el
  mapa; el pin se puede arrastrar): lista los 5 camiones más cercanos. Ninguna
  de las dos ubicaciones sale del navegador.
- **Reportar recolección**: desde la lista de cercanos, una guía para reportar
  por GuaZap (WhatsApp del Ayuntamiento) que el camión no pasó u otra falla,
  con las respuestas del menú listas para copiar. Solo abre WhatsApp; el
  reporte lo envía la persona.
- **Reportes**: mapa de calor y totales de los reportes hechos con la guía.
  Solo se cuenta, de forma anónima y desactivable, el tipo de falla, el
  municipio y una zona de ~500 m; zonas con menos de 5 reportes no se muestran.
- **Horario aproximado** (menú «Más», o el enlace `/?horario`, `/?horario=50`):
  eliges una ruta, o tocas tu calle y se elige sola, y dibuja su recorrido
  de un día típico coloreado por hora, con entre qué horas suele pasar por tu
  calle en días normales y en lunes o días después de feriado, y qué tan
  estable es. Se calcula cada noche con los recorridos publicados (ver
  [Horario aproximado](#horario-aproximado)). El horario se baja completo: el
  punto no sale del navegador.
- **Exige el mapa oficial y datos abiertos** (menú «Más», o el enlace
  `/?exige`): el mapa oficial, tequierolimpia.guadalajara.gob.mx, no funciona.
  La ficha invita a pedir al Ayuntamiento que lo arregle y que publique la
  ubicación de los camiones, las rutas, los horarios y los reportes como datos
  abiertos y documentados: mensajes listos para X, Facebook y WhatsApp, y el
  texto de una solicitud de transparencia para pegar en la Plataforma Nacional
  de Transparencia (texto y seguimiento en
  [`docs/solicitudes/`](docs/solicitudes/), según la
  [guía común](https://github.com/tocaltepetl/.github/blob/main/docs/solicitudes/README.md)).
  No envía ni cuenta nada; solo abre enlaces y copia textos.
- Conteo de visitas con Cloudflare Web Analytics (sin cookies ni datos
  personales), solo para saber cuánta gente usa el mapa. Ver la
  [política de privacidad común](https://github.com/tocaltepetl/.github/blob/main/docs/privacidad.md).
- Modo claro y oscuro según el sistema; pensada para celular.

## Datos abiertos
Los reportes hechos con la guía son públicos y de libre uso (sin datos
personales), en `https://basuragdl.tocaltepetl.org/api/reportes?dias=7|30&k=0..8`
(`k=0` = todos los tipos de falla; se actualiza cada hora):

| Campo | Qué es |
|---|---|
| `celdas` | Zonas de ~550 m (`c` = centro `[lng, lat]`) con su número de reportes `n`. Solo las que tienen al menos `minCelda` (5). |
| `porTipo` | Reportes por tipo de falla `k` (1–8, en el orden del menú de GuaZap) y municipio `mun` (0 Guadalajara, 1 Zapopan, 2 otro de la ZMG). |
| `resultados` | Cuántos dijeron que obtuvieron `folio`, que terminaron `sin-folio` o que se atoraron (`atorado`). |
| `cambios` | Dónde el bot no coincidió con la guía: municipio, tipo de falla, `paso` y qué pidió (`menu`, `foto`, `direccion`, `ubicacion`, `datos`, `otro`). |

### Un renglón por reporte (CSV)
`https://basuragdl.tocaltepetl.org/api/reportes.csv?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`
(por omisión, los últimos 90 días; máximo 366 por descarga). Columnas: `tipo`
(`abrir` = abrió GuaZap; `resultado` = contó cómo le fue), `fecha`,
`municipio`, `falla`, `falla_nombre`, `dias_sin_pasar`, `zona_lat`,
`zona_lng`, `resultado`, `paso`, `cambio`.

Para que no se pueda reconocer a nadie, cada reporte está generalizado:
- Fecha sin hora (día en hora de Guadalajara).
- Zona de ~1.1 km (centro de la celda), solo si al menos 3 reportes comparten
  día, zona y tipo de falla; si no, va vacía y queda el municipio.
- «Personal condiciona el servicio», «Personal grosero» y «Personal no
  campanea» nunca llevan zona y su fecha es el lunes de esa semana: la
  cuadrilla de la ruta podría adivinar quién reportó.
- Los renglones de `resultado` no llevan zona ni se pueden ligar a su reporte.
- Sin identificador ni hora; el orden de los renglones no es el de llegada.

Cuenta a quien usó esta guía, no el total de reportes al Ayuntamiento.

### Recorridos crudos por día
Todos los mensajes que mandan los camiones, un archivo por día, en
**https://datos.basuragdl.tocaltepetl.org/index.html** (índice en HTML y en
[`index.json`](https://datos.basuragdl.tocaltepetl.org/index.json), con tamaño y
SHA-256). Sirven para reconstruir rutas y horarios, que el Ayuntamiento no
publica.

- **Fuente:** la señal pública en vivo de la Guadalajara App (Ayuntamiento de
  Guadalajara), la misma que usa el mapa. No oficial.
- **Libre uso**, citando la fuente y este proyecto. Son para **analizar el
  servicio** (rutas, horarios, cobertura), **no para vigilar a las cuadrillas**.
- **Se publica al cerrar el día** (hora de Guadalajara, UTC−6), poco después de
  medianoche. Nada es en vivo. Solo hay datos desde que empezó a grabar este
  servicio (noviembre de 2026).
- `crudo/mensajes-AAAA-MM-DD.jsonl.gz`: JSON Lines en gzip, una línea por
  mensaje:
  ```json
  {"t": 1763388000123, "ch": "geocerca.8", "data": {"geocerca_id": 8, "timestamp": "…", "message": {"vehicleId": 8, "routeCode": "8", "coordenadas": [-103.31, 20.73], "ultimasPosiciones": [["-103.31", "20.73"], …]}}}
  ```
  `t` es la hora de recepción (ms desde 1970, UTC) y `data`, el mensaje tal
  como llegó, sin recortar paradas ni la precisión del GPS. Solo se quita
  `unitVehicleIdInternal`, un identificador interno de la unidad.
- `crudo/conexion-AAAA-MM-DD.jsonl.gz`: cuándo estuvo conectado el grabador
  (`open`, `established`, `suscrito`, `close`, `reconnect`, `error`, `pausa`,
  `reanuda`, `inicio` = reinicio del grabador). Sirve para distinguir «no
  pasó el camión» de «no estábamos escuchando».
- **Horario:** conecta a las 05:00. Después de las 21:00 se pausa cuando en 30
  min solo se ven las unidades estacionadas, y a las 00:00 se pausa siempre.
  De madrugada solo mandan señal 2 o 3 unidades estacionadas. Domingos y
  festivos casi no hay recolección.
- Leer un día en Python: `gzip.open("mensajes-AAAA-MM-DD.jsonl.gz", "rt")`,
  una línea por `json.loads`.

## Uso
Abre `public/index.html` con doble clic (funciona con `file://`) o sírvelo:

```sh
python -m http.server 8765 --directory public
```

Agrega `?debug` a la URL para ver estadísticas en la consola cada 10 s, y
`?debug&idle=20` para probar la pausa por inactividad con 20 s.

`probe.html` es una prueba mínima de conexión: se suscribe a 20 canales y
cuenta mensajes. Sirve para diagnosticar si la fuente cambió.

## Uso responsable
La fuente de datos no es oficial ni está documentada. Si se abusa de ella,
pueden cerrarla y el proyecto deja de funcionar para todos. No uses este
código para abrir más conexiones, hacer scrapers o guardar datos en masa: los
recorridos ya se graban con una sola conexión y se publican cada día en
[Recorridos crudos por día](#recorridos-crudos-por-día); usa esos archivos.
Detalles en [CONTRIBUTING.md](CONTRIBUTING.md#uso-responsable-de-la-fuente-de-datos).

## Contribuir
Issues y PRs bienvenidos. Lee [CONTRIBUTING.md](CONTRIBUTING.md) y el
[código de conducta](https://github.com/tocaltepetl/.github/blob/main/CODE_OF_CONDUCT.md).

## Licencia
El código: [MIT](LICENSE). Los datos que muestra la página no son de este
proyecto: los publica el Ayuntamiento de Guadalajara por su app.

### Horario aproximado
Cada noche, `horarios/horarios.py` (workflow «Horarios») resume los recorridos
del día, recalcula el horario con las **últimas 6 semanas** y revisa qué fue
raro. Publica en `https://datos.basuragdl.tocaltepetl.org/horarios/`:

- **`horarios.json`**: un renglón por cuadro de ~80 m y ruta en `puntos`, con
  las columnas de `columnas`: `i`, `j` (centro = `i × celda_lat`,
  `j × celda_lng`), `ruta`, `ini` y `fin` (minutos desde medianoche: entre qué
  horas suele pasar en día normal), `nivel` (0 estable, rango de 45 min o
  menos; 1 varía, hasta 2 h; 2 varía mucho) e `ini_cargado`, `fin_cargado`
  (lo mismo en lunes o días después de feriado). En `dias`, qué días se usaron
  y cuáles se excluyeron y por qué.
- **`anomalias.json`**: por día, su tipo (`normal`, `cargado` = después de un
  día sin servicio, `sin_servicio`), la carga (duración de las rutas contra un
  día normal), y lo raro: rutas que no salieron, que empezaron tarde
  (`inicio_tarde`, y `muchas_rutas_tarde` si son 10 o más), que fueron por
  otras calles (`calles_nuevas`; `cambio_de_ruta` si pasa 3 días seguidos), que
  cubrieron poco, que pasaron tarde, días cargados sin explicación y días con
  datos incompletos. Las de nivel `alta` llegan como aviso por ntfy.
  En `rutas`, por ruta: cuántos puntos tiene, su nivel, cuánto se atrasa en
  día cargado y su `dia_tipico`.
- **`rutas/<ruta>.json`**: el recorrido real de la ruta en su **día típico**
  (el día normal cuyas horas por cuadro quedaron más cerca de la mediana), en
  `tramos`: listas de `[lat, lng, minuto]`. Solo los tramos recolectando, sin
  los viajes a descargar, simplificados a ~8 m. Es lo que dibuja la página.
- **`dias/AAAA-MM-DD.json.gz`**: el resumen de cada día del que sale todo: por
  ruta, inicio, fin, la primera hora en que pasó **recolectando** (a menos de
  15 km/h) por cada cuadro y la traza simplificada de esos tramos (`version`
  2; los de versión anterior se rehacen del crudo).

**Cómo se calcula.** Un punto se publica si se vio al menos 4 días normales. El
rango deja fuera el 20 % de días más tempranos y el 20 % más tardíos, y se
redondea a 5 min hacia afuera. No cuentan los días con datos incompletos, los
días normales con rutas 7 % más largas de lo común (como el miércoles después
de un puente) ni las rutas que ese día empezaron 1.5 h tarde: eso va a
`anomalias.json`. Si una ruta cambia, el horario se acomoda solo en unas
semanas, y mientras tanto el detector lo avisa. Los parámetros están al inicio
de `horarios/horarios.py`.

**Recalcular en tu compu** (solo Python 3, sin dependencias):
```sh
cp horarios/semilla/*.json.gz /tmp/res/      # días previos al grabador
python3 horarios/horarios.py sincronizar --resumenes /tmp/res
python3 horarios/horarios.py actualizar --resumenes /tmp/res --salida /tmp/sal
python3 -m unittest discover -s horarios      # pruebas
```

## Publicación
Sitio: **https://basuragdl.tocaltepetl.org** (Cloudflare Workers, solo archivos
estáticos). Se publica desde GitHub Actions al liberar una versión; los
cambios están en los [Releases](https://github.com/tocaltepetl/camiones-basura-gdl/releases).

Grabador: **https://datos.basuragdl.tocaltepetl.org/index.html** (Cloudflare Workers con
un Durable Object y R2; código en `grabador/`, configuración aparte en
`grabador/wrangler.jsonc`). Lo despliega el workflow «Grabador» al hacer merge
de cambios en `grabador/`. Pruebas: `cd grabador && npm test`.

Horario aproximado: lo publica cada noche el workflow «Horarios» en
`datos.basuragdl.tocaltepetl.org/horarios/` (ver arriba). No requiere desplegar
el sitio: la página lo baja de ahí.

## Decisiones
Ver [`docs/decisiones.md`](docs/decisiones.md).
