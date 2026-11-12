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
