# Decisiones

Registro de decisiones del proyecto, por etapa. Etapas acordadas:
1. Local, en la laptop.
2. ~~Publicada como Artifact de claude.ai, privada.~~ Descartada: ver abajo.
3. Dominio propio (GitHub Pages o Cloudflare Pages, por decidir).

---

## Etapa 1 — local (2026-11-11)

### Fuente de datos
WebSocket público con protocolo Pusher (Laravel Echo + Reverb):
`wss://workspace.guadalajara.gob.mx/socket/app/6cnmouj20xedzawxb98f?protocol=7&client=js&version=8.4.0&flash=false`.
La app key es pública (viene en el JS de la app municipal). API no oficial.

- Canales públicos `geocerca.N`, sin autenticación. Cada canal es una **ruta**
  con su camión, no una colonia.
- Evento `geocerca.messages`: `data` es una cadena JSON con
  `message.ultimasPosiciones` (~12 puntos `[lng, lat]` como cadenas),
  `message.coordenadas` (`[lng, lat]` números) y `message.routeCode`.
  Posición actual = último punto de la estela (como hace la app); si falta,
  `coordenadas`.
- `geocerca.status` se ignora: es la geocerca del servidor, no aporta al mapa.
- Observado: los mensajes llegan **en ráfagas** con huecos de 20–30 s; en
  ~1 min se ven 55–60 camiones.

### Conexión directa desde el navegador (sin proxy)
**Opciones:** WebSocket directo · proxy o servidor propio.
**Elegida:** directo. Los WebSocket no están sujetos a CORS; el único filtro
posible es que el servidor revise `Origin`. Verificado con `probe.html` en
Chromium: acepta `Origin: null` (`file://`) y `http://127.0.0.1:8765`
(`python -m http.server`), sin errores ni cierres. Un proxy propio queda
descartado por diseño: el proyecto no depende de ninguna infraestructura
propia.

**Pendiente:** verificar el origen del Artifact de claude.ai (etapa 2) y el
del dominio propio (etapa 3).

### Cliente Pusher propio en vez de `pusher-js`
~60 líneas: suscripción a `geocerca.1–250` en una sola conexión, respuesta a
`pusher:ping`, ping propio tras 60 s sin tráfico (activity_timeout = 90 s),
reconexión con espera creciente (1 s → 60 s) y *jitter*. Razones: una
dependencia menos y control exacto de qué canales se abren, necesario para
limitar la carga más adelante.

### Mapa base: OpenFreeMap + MapLibre GL
| Opción | Resultado |
|---|---|
| Carto (Positron / Dark Matter) | Ya exige API key: devuelve una tesela "API KEY REQUIRED" con cualquier referer. Descartado. |
| OSM estándar + Leaflet | 403 "Access blocked" con `file://` (no hay `Referer`); su política de uso prohíbe el tráfico de un sitio público. Sin modo oscuro (solo invirtiendo colores con CSS). Descartado. |
| **OpenFreeMap + MapLibre GL (elegida)** | Gratis, sin key ni cuenta, pensado para sitios públicos. Estilos `positron` y `dark`. Teselas vectoriales: funciona con `file://`. |

- Costo: MapLibre pesa ~800 KB contra ~150 KB de Leaflet y requiere WebGL.
- MapLibre **5.24.0** (abril 2026) desde cdnjs, versión fija. La 6.x se
  distribuye como módulos ES y en cdnjs solo trae el CSS.
- Riesgo: OpenFreeMap es un proyecto pequeño financiado con donativos. Plan B:
  es software libre; sus teselas (archivos PMTiles/MBTiles) se pueden
  hospedar en almacenamiento estático (p. ej. Cloudflare R2/Pages).

### Privacidad
- "Cerca de mí" y "Elegir punto" calculan distancias (haversine) en el
  navegador. Ninguna ubicación se envía a ningún lado ni se guarda.
- La página no contiene coordenadas personales, ni logos, nombres o imágenes
  del Ayuntamiento o de su app. Aviso visible de que no es oficial.

### Carga sobre el servidor de origen
Una página abierta a mucha gente multiplica las conexiones al servidor del
Ayuntamiento y podría provocar que cambien la key o cierren el acceso.
Medidas ya incluidas:
- Una sola conexión por pestaña.
- La conexión se cierra cuando la pestaña queda oculta (`visibilitychange`)
  y se reabre al volver.
- Reconexión con espera creciente y *jitter* para no reconectar en masa.

Por eso la etapa 2 va privada, y **antes de la etapa 3** hay que acordar
límites adicionales (p. ej. suscribirse solo a las rutas de la zona visible,
desconexión por inactividad, tope de tiempo por sesión).

### Cómo revertir
Nada fuera de este repo depende de la página: basta con borrar el repo o el
sitio publicado.

---

## Etapa 2 — Artifact de claude.ai: descartada (2026-11-11)

Se publicó `probe.html` como Artifact privado. El navegador bloqueó el
WebSocket antes de conectarse:

```
NS_ERROR_CONTENT_BLOCKED — "The load for this content was blocked."
origin: https://<id>.frame.claudeusercontent.com
```

Es la política de seguridad (CSP) de los Artifacts, que solo permite
conexiones a dominios autorizados por claude.ai. El servidor del Ayuntamiento
nunca recibió la conexión. No se intenta rodear: la etapa 2 se reemplaza por
publicar en un dominio propio.

### Repositorio público (2026-11-12)
El código se publica en la organización de GitHub `tocaltepetl`, pensada para
proyectos cívicos y separada de cualquier identidad personal. Licencia MIT.
Un repo público hace más visible el uso de la fuente de datos; por eso el
README y `CONTRIBUTING.md` incluyen reglas de uso responsable y cada PR
declara si aumenta la carga.

---

## Etapa 3 — límites de carga antes de publicar (2026-11-12)

Cada visitante recibía los mensajes de todas las rutas (~150 camiones, uno cada
10–20 s: ~10 mensajes/s por pestaña). Sin servidor propio no hay tope global,
así que el límite tiene que salir del diseño de la página.

**Opciones consideradas**
- A. Escuchar solo las rutas de la zona visible. ✅
- B. Pausa por inactividad. ✅ (desactivable por quien usa la página)
- C. Desconectar con la pestaña oculta. Ya existía.
- D. Reconexión con espera creciente y *jitter*. Ya existía.
- E. Zoom mínimo para datos en vivo. Pendiente (ver abajo).

### A. Zona visible
- Cada canal es una ruta que recorre siempre la misma zona. La página guarda
  el rectángulo (bbox) de todo lo visto de cada ruta en `localStorage`
  (`camiones-basura-gdl:areas-v1`), así que en la siguiente visita no hay que
  redescubrirlas.
- Tras mover el mapa (con espera de `SYNC_DEBOUNCE_MS`) se calcula qué rutas
  tocan la vista ampliada `VIEW_MARGIN` (50 %) por lado: se manda
  `pusher:subscribe` a las que entran y `pusher:unsubscribe` a las que salen,
  y sus marcadores se quitan (en vez de quedar grises, que sugeriría "sin
  señal").
- Los canales sin área conocida se escuchan siempre: o están en silencio (no
  generan mensajes) o son rutas por descubrir.
- El contador pasó de "activos" a "en el mapa": fuera de la vista ya no se
  sabe cuántos hay.

**Verificado** (de noche, con 2–3 camiones): con zoom 15 baja de 250 a 249
canales y al alejar vuelve a 250. **Pendiente** medir la reducción de día
(~150 camiones).

**Límite conocido:** con el zoom inicial (`START_ZOOM` 11.5) se ve toda la
ciudad y, con el margen, entran todas las rutas; quien no hace zoom sigue
recibiendo todo. Opciones por decidir: empezar más cerca (zoom ~13), aplicar
E, o dejarlo así.

### B. Pausa por inactividad
- Tras `IDLE_MS` (10 min) sin interacción se cierra la conexión; el indicador
  muestra "En pausa · toca para reanudar" y cualquier toque reconecta.
- Casilla en el pie para desactivarla; la elección se guarda en
  `localStorage` (`camiones-basura-gdl:pausa-auto`).
- Solo cuentan como actividad los movimientos del mapa hechos por la persona
  (`movestart` con `originalEvent`); los programáticos reiniciaban el
  contador y la pausa nunca llegaba.
- `?debug&idle=SEG` acorta el tiempo para probarla. **Verificado**: con 20 s
  se pausa, un toque reanuda y, desactivada, no se pausa.

### Constantes
Los valores de configuración (tiempos, márgenes, zoom, tamaños) viven en un
bloque al inicio del script, con nombre y comentario; no hay números sueltos
en la lógica.

## Etapa 3 — despliegue desde GitHub (2026-11-12)

### El servidor acepta el origen de Cloudflare
Se publicó `probe.html` en un Worker desechable
(`https://cbg-prueba.<subdominio>.workers.dev`): conexión establecida y 20/20
suscripciones, sin errores ni cierres. Después se borró el Worker.

### Cloudflare Workers en vez de Pages
Wrangler 4.160 ya no crea proyectos de Pages sin `--force`: indica que Pages
«ahora es parte de Workers» y recomienda Workers con archivos estáticos. Para
no construir sobre algo de salida, el sitio es un **Worker solo con archivos
estáticos** (`wrangler.jsonc`, sin código de servidor):
- Dominio propio `basuragdl.tocaltepetl.org` declarado como `custom_domain`
  (Cloudflare crea el DNS); `workers_dev: false`.
- `preview_urls: true` para las vistas previas de los PR.
- Solo se publica la carpeta `public/`. Se descartó publicar la raíz con un
  `.assetsignore`: Wrangler no permite listar qué subiría, y un error ahí
  publicaría `docs/` o algo peor.

### GitHub como única vía de publicación
Nada se despliega desde una computadora. Workflows en `.github/workflows/`:

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `pr-titulo.yml` | PR abierto o editado | Exige título Conventional Commits. |
| `vista-previa.yml` | PR desde una rama del repo | `wrangler versions upload --preview-alias pr-N` (no toca producción) y comenta la URL. |
| `vista-previa-fork.yml` | PR desde un fork | Sin secretos ni checkout del fork (`pull_request_target`): comenta un enlace de raw.githack.com al commit. |
| `release.yml` | Push a `main` | release-please mantiene el PR de versión; al hacer merge crea tag y Release y llama a `desplegar.yml`. |
| `desplegar.yml` | Release, o manual con un tag | `wrangler deploy` del tag, con **aprobación manual** en el ambiente `production`. Sirve para volver a una versión anterior. |

- **Versiones:** release-please (`release-type: simple`), `CHANGELOG.md` en
  español, tags `vX.Y.Z`, empieza en 0.x (`bump-minor-pre-major`). La versión
  se muestra en el pie de la página (marcador `x-release-please-version`).
- **Squash merge** obligatorio: el título del PR es el commit que lee
  release-please.
- **Seguridad:** actions fijadas por SHA, `permissions: {}` por defecto y
  mínimos por job, `persist-credentials: false`, Wrangler con versión exacta,
  entradas del evento siempre por variables de entorno (nunca interpoladas en
  el script). El token de Cloudflare vive solo en los ambientes `preview` y
  `production`; el de `production` exige aprobación y solo corre desde `main`.
- **Límite conocido:** los PR que crea release-please con el `GITHUB_TOKEN`
  no disparan otros workflows (regla de GitHub), así que el PR de versión no
  tiene vista previa ni check de título; no los necesita.

### Subdominio de cuenta `cbg-deploy`
Al desplegar la prueba, Wrangler registró el subdominio de `workers.dev` de la
cuenta con el nombre de la carpeta temporal (`cbg-deploy`). Aparece en las URLs
de vista previa; se puede cambiar en el panel (Workers & Pages → Settings →
Subdomain).

### Correcciones tras el primer PR de versión (2026-11-12)
- release-please propuso **1.0.0**: sin releases previos usa su versión
  inicial por defecto e ignora el manifiesto. Se fija `initial-version: 0.1.0`.
- El ícono de la marca (`assets/brand/`) quedó fuera de `public/`, así que no
  se publicaría. Se copia a `public/favicon.svg` (revisado: SVG sin scripts ni
  referencias externas); `assets/brand/` queda como fuente de la marca, sin
  publicar.
