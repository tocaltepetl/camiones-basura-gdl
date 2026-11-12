# Camiones de basura GDL

> **English:** unofficial live map of Guadalajara's **garbage trucks** (not public transit buses). A single
> static HTML page that connects straight from the browser to the public
> WebSocket used by the city's app. No backend. Contributions welcome — see
> [CONTRIBUTING.md](CONTRIBUTING.md) (in Spanish; English is fine in issues and PRs).

Mapa en vivo, **no oficial**, de los camiones de basura de Guadalajara.

Un solo archivo estático (`public/index.html`), sin servidor propio: el navegador se
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
- Modo claro y oscuro según el sistema; pensada para celular.

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
[código de conducta](CODE_OF_CONDUCT.md).

## Licencia
El código: [MIT](LICENSE). Los datos que muestra la página no son de este
proyecto: los publica el Ayuntamiento de Guadalajara por su app.

## Publicación
Sitio: **https://basuragdl.tocaltepetl.org** (Cloudflare Workers, solo archivos
estáticos). Se publica desde GitHub Actions al liberar una versión; los
cambios están en los [Releases](https://github.com/tocaltepetl/camiones-basura-gdl/releases).

## Decisiones
Ver [`docs/decisiones.md`](docs/decisiones.md).
