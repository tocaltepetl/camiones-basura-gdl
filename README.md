# Camiones de basura GDL

> **English:** unofficial live map of Guadalajara's **garbage trucks** (not public transit buses). A single
> static HTML page that connects straight from the browser to the public
> WebSocket used by the city's app. No backend. Contributions welcome — see
> [CONTRIBUTING.md](CONTRIBUTING.md) (in Spanish; English is fine in issues and PRs).

Mapa en vivo, **no oficial**, de los camiones de basura de Guadalajara.

Un archivo estático (`public/index.html`) más un Worker mínimo para contar
reportes de forma anónima (`src/worker.js`). El navegador se
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
- **Exige el mapa oficial y datos abiertos** (menú «Más», o el enlace
  `/?exige`): el mapa oficial, tequierolimpia.guadalajara.gob.mx, no funciona.
  La ficha invita a pedir al Ayuntamiento que lo arregle y que publique la
  ubicación de los camiones, las rutas, los horarios y los reportes como datos
  abiertos y documentados: mensajes listos para X, Facebook y WhatsApp, y el
  texto de una solicitud de transparencia para pegar en la Plataforma Nacional
  de Transparencia. No envía ni cuenta nada; solo abre enlaces y copia textos.
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
código para abrir más conexiones, hacer scrapers o guardar datos en masa.
Detalles en [CONTRIBUTING.md](CONTRIBUTING.md#uso-responsable-de-la-fuente-de-datos).

## Contribuir
Issues y PRs bienvenidos. Lee [CONTRIBUTING.md](CONTRIBUTING.md) y el
[código de conducta](https://github.com/tocaltepetl/.github/blob/main/CODE_OF_CONDUCT.md).

## Licencia
El código: [MIT](LICENSE). Los datos que muestra la página no son de este
proyecto: los publica el Ayuntamiento de Guadalajara por su app.

## Publicación
Sitio: **https://basuragdl.tocaltepetl.org** (Cloudflare Workers, solo archivos
estáticos). Se publica desde GitHub Actions al liberar una versión; los
cambios están en los [Releases](https://github.com/tocaltepetl/camiones-basura-gdl/releases).

## Decisiones
Ver [`docs/decisiones.md`](docs/decisiones.md).
