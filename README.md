# Camiones GDL

Mapa en vivo, **no oficial**, de los camiones de basura de Guadalajara.

Un solo archivo estático (`index.html`), sin servidor propio: el navegador se
conecta directo al WebSocket público que usa la app municipal. Esa fuente no
está documentada y puede fallar o cambiar sin aviso.

## Qué muestra
- Un marcador por camión con su número de ruta, y su estela reciente.
- Hora del último mensaje; gris si lleva más de 5 min sin mensajes.
- Contador de camiones activos.
- **Cerca de mí** (geolocalización del navegador) y **Elegir punto** (tocar el
  mapa; el pin se puede arrastrar): lista los 5 camiones más cercanos. Ninguna
  de las dos ubicaciones sale del navegador.
- Modo claro y oscuro según el sistema; pensada para celular.

## Uso
Abre `index.html` con doble clic (funciona con `file://`) o sírvelo:

```sh
python -m http.server 8765
```

Agrega `?debug` a la URL para ver estadísticas en la consola cada 10 s.

`probe.html` es una prueba mínima de conexión: se suscribe a 20 canales y
cuenta mensajes. Sirve para diagnosticar si la fuente cambió.

## Decisiones
Ver [`docs/decisiones.md`](docs/decisiones.md).
