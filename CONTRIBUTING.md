# Cómo contribuir

¡Gracias por tu interés! Este es un proyecto cívico y voluntario. Cualquier
aporte es bienvenido: reportar errores, proponer ideas, mejorar el diseño o el
código, o corregir la documentación.

## Correr el proyecto
No hay build, dependencias ni servidor. Todo vive en `index.html`.

1. Clona el repo y abre `index.html` con doble clic (funciona con `file://`).
2. O sírvelo: `python -m http.server 8765` y abre `http://localhost:8765`.
3. Agrega `?debug` a la URL para ver estadísticas en la consola cada 10 s.
4. `probe.html` es una prueba mínima de conexión: úsala si sospechas que la
   fuente de datos cambió.

Las librerías se cargan desde cdnjs con **versión fija**. Si propones una
nueva, que sea de cdnjs, con versión exacta y publicada hace al menos dos
semanas.

## Uso responsable de la fuente de datos
Los datos vienen de un WebSocket público **no oficial y no documentado** del
Ayuntamiento de Guadalajara. Si se abusa de él, pueden cerrarlo o cambiarlo y
el proyecto deja de funcionar para todos. Por eso:

- **No aumentes la carga**: nada de abrir más conexiones, suscribirse a más
  canales de los necesarios, reconectar agresivamente ni hacer polling.
- **No hagas scrapers, bots ni almacenamiento masivo** con esta fuente a
  partir de este código.
- Los cambios que **reduzcan** la carga (p. ej. suscribirse solo a la zona
  visible) son especialmente bienvenidos.
- Cualquier PR que toque la conexión se revisa con lupa.

## Privacidad
- La ubicación de quien usa la página (o el punto que elige) **nunca** sale del
  navegador. No se aceptan analíticas, rastreadores ni llamadas a terceros con
  datos del usuario.
- No incluyas coordenadas, direcciones ni datos personales de nadie en el
  código, issues o capturas.

## Identidad del proyecto
El proyecto **no es oficial**. No uses logos, nombres ni imágenes del
Ayuntamiento ni de sus apps, ni textos que hagan parecer que lo es.

## Proceso
1. Para cambios grandes, abre primero un issue y platiquemos la idea.
2. Haz un fork y una rama con un nombre descriptivo.
3. Prueba en un celular (o con la vista móvil del navegador), en modo claro y
   oscuro.
4. Abre el PR llenando la plantilla.

Las decisiones de diseño y su porqué están en
[`docs/decisiones.md`](docs/decisiones.md); léelas antes de proponer cambios
de fondo (p. ej. cambiar de proveedor de mapas).

## Idioma
- **Español** para la interfaz, la documentación, los comentarios del código,
  los mensajes de commit, los issues y los PRs. En issues y PRs también se vale
  inglés.
- **Inglés** para los nombres en el código (variables, funciones), como es
  costumbre.
