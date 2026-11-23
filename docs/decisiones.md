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
| `release.yml` | Push a `main` | Calcula la versión; si hay, espera **aprobación manual** en `production`, despliega y crea tag y Release. (Hasta la 0.1.0 usaba release-please; ver abajo.) |
| `desplegar.yml` | Manual con un tag | `wrangler deploy` del tag, con aprobación en `production`. Sirve para volver a una versión anterior. |

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
- Identidad visual (hecha en otra sesión, portada aquí para no publicar una
  versión a medias): logos y versiones horizontales en `assets/brand/`
  (fuente, no se publica), `public/favicon.svg` y `public/og.png` (1200×630)
  con etiquetas Open Graph/Twitter hacia `https://basuragdl.tocaltepetl.org/`.
  Las etiquetas originales apuntaban a GitHub Pages, que no se usa.

### Sin PR de versión (2026-11-12)
release-please obligaba a hacer merge de un «PR de versión» que se quedaba
abierto como recordatorio, y sus checks quedaban en `action_required` por
abrirlo el `GITHUB_TOKEN`. Se reemplaza por `.github/scripts/siguiente-version.sh`
(bash, sin dependencias): con cada push a `main` calcula la versión desde el
último tag con las mismas reglas (0.x: `feat` y cambios incompatibles suben
el menor; `fix`/`perf`/`revert` el parche) y escribe las notas agrupadas.
- La única decisión de publicar es la **aprobación en `production`**, que ya
  existía. El tag y el Release se crean **después** de desplegar bien, así
  que un despliegue fallido no deja versiones fantasma.
- El bot ya no hace commits a `main`: la versión se escribe en la página al
  desplegar (sobre el enlace `class="ver"`; en el repo dice `dev`).
- Las notas viven en los GitHub Releases; `CHANGELOG.md` queda como histórico
  hasta la 0.1.0.
- `concurrency` compartida (`produccion`) en ambos workflows: con varios
  merges sin aprobar, GitHub cancela el pendiente anterior y queda el último.

## Conteo anónimo de reportes y mapa de calor (2026-11-12, issue #14)

Se quería saber cuánto se usa la guía de GuaZap, si la gente obtiene folio y
si los menús del bot coinciden con la guía en cada escenario. Esto rompe a
propósito el «nada sale del navegador»: el sitio deja de ser solo estático.

**Opciones:** Workers Analytics Engine · **D1 (elegida)** · KV.
Analytics Engine solo se consulta con su API SQL y un token de cuenta guardado
en el Worker; D1 se consulta desde el propio Worker con un binding y agrega
con SQL normal. KV no sirve para agregar.

- `src/worker.js` atiende solo `/api/*` (`run_worker_first`); lo demás sigue
  saliendo directo de `public/` sin pasar por el Worker.
- `POST /api/evento`: solo valores de listas cerradas (municipio, tipo de
  falla, días agrupados en 1/2/3/4–7/8+, resultado, paso, qué cambió). Sin
  texto libre, cookies, IP ni identificadores. La IP solo es la llave en memoria
  del límite de peticiones (10/min, binding `LIMITE`).
- **Ubicación:** el navegador manda la celda `floor(lat/0.005), floor(lng/0.005)`
  (~550 m), solo si hay punto marcado. El Worker rechaza celdas fuera de la ZMG.
- `GET /api/reportes?dias=7|30&k=0..8`: agregados cacheados 1 h. Las celdas con
  **menos de 5** reportes en el periodo no se publican.
- Solo el dominio de producción (y `localhost`) guarda eventos: las vistas
  previas de los PR comparten la base y no deben ensuciarla.
- **Seguimiento:** al tocar «Abrir GuaZap» se cuenta un evento `abrir`; al volver
  a la pestaña la ficha pregunta una vez cómo le fue y si el bot preguntó lo
  mismo (y en qué paso cambió). Eso dice qué escenarios de la guía corregir.
- **Optar por no participar:** casilla en la ficha, recordada en `localStorage`
  (`camiones-basura-gdl:contar-reportes`).
- **Mapa:** botón «Reportes», capa `heatmap` de MapLibre (se vuelve a agregar
  tras cambiar el estilo claro/oscuro), filtros por tipo y periodo, totales y
  % con folio. Se aclara que cuenta solo a quien usó la guía.
- **Migraciones:** `migrations/`, aplicadas por `release.yml` antes de desplegar.
  Solo migraciones que agregan, para que `desplegar.yml` pueda volver a una
  versión anterior.
- **Verificado** con `wrangler dev` y D1 local: validación (400/403), umbral de
  celda, agregados, ficha de seguimiento y capa de calor en Chromium.

### Para activarlo (una sola vez, en la cuenta de Cloudflare)
1. ~~`npx wrangler@4.160.1 d1 create camiones-basura-gdl` y poner el
   `database_id` en `wrangler.jsonc`.~~ Hecho el 2026-11-12.
2. Dar al token de los ambientes `preview` y `production` el permiso
   **D1: Edit**.

**Pendiente:** retención (borrar eventos de más de un año) con un cron.

### Datos abiertos (2026-11-12)
El proyecto busca dar a la ciudadanía la mayor cantidad de datos posible.
`/api/reportes` es público, con `Access-Control-Allow-Origin: *` y
documentado en el README. El panel muestra también dónde el bot no coincidió
con la guía y enlaza al JSON. Los límites de privacidad no cambian: no se
publican eventos sueltos ni celdas con menos de 5 reportes.

### Reportes individuales (2026-11-12)
Para dar más datos se publica también un renglón por reporte en
`/api/reportes.csv`, generalizado en vez de aleatorizado:
- **Por qué no mover los puntos al azar:** varios reportes de la misma casa se
  agrupan alrededor del punto real, y la hora exacta más la zona identifica
  aunque la zona sea grande.
- **Por qué no privacidad diferencial:** con tan pocos reportes el ruido tapa la
  señal y los números dejan de cuadrar; la generalización es más fácil de
  explicar.
- **Reglas:** fecha sin hora; zona de 0.01° (~1.1 km) solo si hay ≥ 3 reportes
  con el mismo día, zona y tipo (si no, solo municipio); tipos 5–7 (sobre el
  personal) sin zona y por semana, por riesgo de represalias de la cuadrilla;
  los `resultado` sin zona; sin id ni hora, renglones ordenados por columnas.
- Fechas en UTC−6 fijo (Guadalajara no tiene horario de verano desde 2022).
- **Verificado** con `wrangler dev` y datos de ejemplo: zona con 3 reportes,
  sin zona con 1, tipo sensible por semana y sin zona, error con rango invertido.

### Exigir el mapa oficial y datos abiertos (2026-11-14)
El mapa oficial (tequierolimpia.guadalajara.gob.mx) no funciona y este
proyecto depende de una fuente sin documentar. La solución de fondo no es este
mapa, sino que el Ayuntamiento publique los datos. Se agrega una ficha
«Exige el mapa oficial y datos abiertos» (menú «Más», aviso en la bienvenida y
en «Acerca de», enlace directo `/?exige`):
- **Qué se pide:** arreglar el mapa oficial y publicar como datos abiertos,
  documentados y de libre uso la ubicación de los camiones, las rutas con
  colonias, días y horarios, y los reportes de recolección.
- **Cómo:** mensajes para X (mencionando a @GobGDL), Facebook y WhatsApp, y una
  solicitud de transparencia lista para copiar en la Plataforma Nacional de
  Transparencia. Se invita a compartir las respuestas para publicarlas.
- **Por qué sin contador:** la ficha no manda nada al Worker. Contar
  «exigencias» agregaría datos y backend sin mucho valor; lo que pesa es la
  solicitud formal, que deja folio y obliga a responder.
- **Solicitud en su archivo:** sigue la
  [guía común](https://github.com/tocaltepetl/.github/blob/main/docs/solicitudes/README.md):
  `docs/solicitudes/2026-11-14-ayuntamiento-guadalajara-recoleccion.md`. La
  página no puede leer `docs/` (sirve solo `public/` y funciona con `file://`),
  así que copia el texto en `EXIGE_REQ` con un comentario que apunta a la
  fuente. Se pide documentos, no explicaciones: reportes de incidencia y plan
  para restablecer el mapa, en vez de «por qué no funciona».

---

## Grabador permanente y datos crudos (2026-11-19, issue #24)

Para reconstruir rutas y horarios típicos (issue #24) hacen falta semanas de
recorridos. Se graba todo lo que manda la fuente y se publica como datos
abiertos, un archivo por día.

**Opciones:** VPS mínimo · **Cloudflare (Worker + Durable Object + R2,
elegida)**. Cloudflare ya aloja el sitio y despliega desde GitHub Actions, y
el plan gratuito alcanza (cuentas abajo). El 2026-11-18 se comprobó que el
servidor de la fuente acepta una conexión WebSocket saliente desde un Worker
(status 101, suscripciones aceptadas, mensajes reales).

### Cómo funciona
- Worker aparte del sitio (`grabador/`, su propio `wrangler.jsonc` y el
  workflow `grabador.yml`). No toca el despliegue del sitio.
- Un Durable Object (`Grabador`, una sola instancia) abre **una conexión** para
  todos los canales `geocerca.1`–`300`. Igual que el cliente de la página:
  responde `pusher:ping`, manda ping propio tras 60 s sin tráfico, reconecta si
  pasan 120 s sin nada, con espera creciente (1 s → 60 s) y *jitter*; tras 10
  fallos seguidos espera 5 min, por si cambió la key.
- **Durabilidad:** búfer en memoria → un lote en SQLite (el almacenamiento del
  Durable Object) cada 10 s → cada hora terminada, un miembro gzip por hora →
  al cerrar el día, los miembros se concatenan tal cual hacia R2. Varios
  miembros gzip seguidos son un `.gz` válido (`zcat`, `gzip.open` de Python),
  así que no se recomprime el día: copiar bytes casi no gasta CPU, y no hace
  falta multipart ni «append», que R2 no tiene. Medido con días reales:
  comprimir por hora ocupa solo 0.08 % más que comprimir el día completo.
- **Reinicios** (despliegues, mantenimiento): se pierde a lo más lo que había en
  memoria (≤ 10 s). El constructor anota `inicio` con la hora del último dato
  guardado, así el hueco queda explícito. Una alarma por minuto mantiene vivo
  el objeto y reconecta si hace falta: una conexión saliente solo evita el
  desalojo por 15 min. Además, un cron cada 5 min lo despierta (segundo vigía).
- **Aviso por ntfy** (secreto `NTFY_TOPIC`, fuera del repo): de 06:00 a 20:00,
  si pasan más de 10 min sin mensajes; un aviso por incidente y otro al
  recuperarse. Otro si llegan mensajes por arriba del canal 280. Si el objeto no
  responde (p. ej. límite diario agotado), el cron, que tiene su propia cuota,
  avisa cada 30 min.
- Un `fetch` de prueba (`/prueba/…`) solo existe con `--var PRUEBA:1` en
  `wrangler dev`; en producción todo responde 404. No hay nada en vivo.

### Horario: pausa de madrugada
Para dejar margen en el plan gratuito. Conecta a las 05:00. Después de las
21:00 se pausa cuando, tras 30 min conectado, solo se vieron 3 unidades o
menos (las estacionadas), y a las 00:00 siempre. Si el objeto se reinicia
después de las 21:00, vuelve a conectar y observa otros 30 min.
- **Qué se pierde**, medido el 13, 14 y 17 de noviembre: 1.8–2.5 % de los
  mensajes del día. De 00:00 a 05:00 son solo 2 o 3 unidades estacionadas. De
  21:00 a 00:00 normalmente también, pero el 17-nov hubo 12 camiones
  trabajando entre 21 y 22 h; por eso la pausa espera a que no haya camiones
  en vez de cortar fija a las 21:00.
- La pausa queda en el registro (`pausa`, `reanuda`), para no confundirla con un
  corte.

### Cuentas con el plan gratuito (volumen del 17-nov: 233 mil mensajes, 160 MB, 17 MB en gzip)
| Recurso | Límite | Uso por día |
|---|---|---|
| Duración del Durable Object | 13,000 GB-s (se reinicia a las 00:00 UTC = 18:00 GDL) | 16–19 h × 0.125 GB ≈ 7,200–8,600 GB-s (55–66 %). Conectado 24 h serían ~11,000 (85 %) |
| Peticiones al Durable Object | 100,000 | mensajes ÷ 20 ≈ 11,700 + alarmas ~1,200 + cron 288 |
| Filas escritas en SQLite | 100,000 | ~14,000 (lotes, borrados, alarmas, registro) |
| Filas leídas en SQLite | 5,000,000 | unos miles: compactar una vez por hora y buscar días por publicar una vez al día (ver abajo) |
| Almacenamiento del Durable Object | 5 GB | ≤ 30 MB (la hora en curso + 3 días de respaldo) |
| CPU | 30 s por evento | gzip de una hora (≤ 22 MB) ≈ décimas de segundo |
| R2 | 10 GB-mes, 1 M escrituras y 10 M lecturas al mes | ~5.5–6 GB al año; 3 escrituras al día |

- **Por confirmar en el primer día:** la documentación aplica el 20:1 a los
  mensajes que llegan a sockets *aceptados* por el Durable Object, pero no dice
  cómo cuenta los de una conexión *saliente*. Si contaran 1:1, no cabría y
  haría falta el plan de US$5 al mes. Se revisa en las métricas del panel.
- **Filas leídas (21-nov):** no estaban en estas cuentas y fue el primer límite
  que se agotó, en el segundo día completo. Cada alarma (cada minuto mientras hay
  conexión) buscaba días por publicar con una consulta que recorre el registro
  de conexiones de los días en respaldo, y compactaba con un `GROUP BY` sobre
  `lote`. Ahora compactar corre solo al cambiar la hora, y la búsqueda y la
  purga, una vez por día de Guadalajara (si algo queda pendiente, se reintenta
  cada 15 min). Cuando se agota, las consultas fallan hasta las 00:00 UTC
  (18:00 GDL) y lo de esas horas se pierde.
- **Parámetros por consulta (23-nov):** el ajuste del 21-nov no bastó: siguió
  agotándose cada día y no se publicó ningún día. La causa de fondo: compactar
  borraba los lotes de la hora con `DELETE … WHERE id IN (?, ?, …)`, un
  parámetro por lote, y una consulta admite como mucho 100 (límite de SQLite en
  Durable Objects). Una hora con conexión tiene ~360 lotes, así que fallaba
  siempre, se revertía y `lote` crecía ~6–8 mil filas al día. Esa tabla se
  recorría cada minuto (reintentos) y cada 5 min (el constructor, al despertar
  el cron). Ahora se borra por rango (`dia`, `hora`, `id <= máximo`), un atraso
  se compacta de 6 horas en 6, un error se reintenta a la hora siguiente y el
  constructor lee una sola fila. Lo que estaba en `lote` no se perdió y se
  publica al ponerse al día. Sí se perdieron las horas en que el límite estaba
  agotado: 21-nov 13–18 h, 22-nov 8–18 h y 23-nov desde las 7 h (quedan como
  huecos en `minutos_conectado` y en el registro de conexiones).
- R2 se llena en ~1.5 años. Después: pagar el excedente (US$0.015 por GB al
  mes) o mover los años viejos a otro lado.

### Datos abiertos
- Un archivo por día de Guadalajara, publicado **al cerrar el día**. Formato
  JSONL en gzip, una línea `{"t", "ch", "data"}` por mensaje: el mismo que la
  grabación con la que empezó el análisis, para que los scripts sirvan igual.
- `data` sin cambios, salvo que se quita `unitVehicleIdInternal`. No se
  recortan paradas ni la precisión del GPS: los camiones son vehículos
  públicos en servicio y su posición ya se transmite en abierto.
- Aparte, el registro de conexiones del día, e `index.json` / `index.html`
  con tamaño, SHA-256, mensajes, camiones y minutos conectado de cada día.
  Los días sin archivo aparecen marcados.
- **Libre uso**, como los reportes, citando la fuente sin repetir la app key.
  Aviso: son para analizar el servicio, no para vigilar a las cuadrillas.
- Se sirve desde R2 por `datos.basuragdl.tocaltepetl.org`. El índice está en
  `/index.html`: R2 no sirve un índice en la raíz, y una Redirect Rule de la
  zona no se aplicó al dominio de R2 (probado el 2026-11-19), así que los
  enlaces apuntan directo a `/index.html`. Caché larga en
  los archivos de cada día (no cambian) y de 5 min en los índices. CORS
  abierto para lectura.
- Solo se publica lo que graba este servicio. No se suben grabaciones previas.
- Conteo de visitas del índice con Cloudflare Web Analytics, sin cookies ni
  datos personales, avisado en la página.

### Carga sobre la fuente
Una conexión permanente más, de 05:00 a ~21:00, para todas las rutas: lo mismo
que una persona con el mapa abierto todo el día. Durante unas semanas convive
con la grabación de prueba con la que empezó el análisis, para comparar que
graben lo mismo (`grabador/herramientas/conteo.py`). Después, esa se apaga.

### Para activarlo (una sola vez, en la cuenta de Cloudflare)
1. Crear el bucket R2 `camiones-basura-datos`.
2. Conectarle el dominio `datos.basuragdl.tocaltepetl.org` (R2 → bucket →
   Settings → Custom domains). Sin `r2.dev`.
3. Dar al token del ambiente `production` el permiso **Workers R2 Storage:
   Edit** (despliegue y CORS del bucket).
4. Tras el primer despliegue, el secreto `NTFY_TOPIC` en el Worker
   `camiones-basura-grabador` (Settings → Variables and Secrets). Se conserva
   entre despliegues.

### Cómo revertir
Borrar el Worker `camiones-basura-grabador` (con su Durable Object) en el panel
y quitar `grabador/` y el workflow. Lo publicado en R2 se puede dejar o borrar
con el bucket. El sitio no depende de nada de esto.
