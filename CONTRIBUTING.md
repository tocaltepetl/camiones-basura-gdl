# Cómo contribuir

¡Gracias por tu interés! Este es un proyecto cívico y voluntario. Cualquier
aporte es bienvenido: reportar errores, proponer ideas, mejorar el diseño o el
código, o corregir la documentación.

Las reglas comunes a todos los proyectos de tocaltepetl (privacidad,
identidad, proceso, títulos de PR, idioma y código de conducta) están en el
[CONTRIBUTING común](https://github.com/tocaltepetl/.github/blob/main/CONTRIBUTING.md). Aquí va solo lo específico de
este proyecto.

## Correr el proyecto
No hay build, dependencias ni servidor. El sitio es un solo archivo:
`public/index.html`.

1. Clona el repo y abre `public/index.html` con doble clic (funciona con
   `file://`).
2. O sírvelo: `python -m http.server 8765 --directory public` y abre
   `http://localhost:8765`.

También puedes editar sin instalar nada: en GitHub presiona `.` para abrir
github.dev (VS Code en el navegador), crea una rama y abre el PR desde ahí.
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
Además de la [política común](https://github.com/tocaltepetl/.github/blob/main/docs/privacidad.md): la ubicación de
quien usa la página (o el punto que elige) **nunca** sale del navegador. La
única analítica es el conteo de visitas con Cloudflare Web Analytics, sin
cookies ni datos personales; no se aceptan otras analíticas, rastreadores ni
llamadas a terceros con datos del usuario.

## Identidad del proyecto
El proyecto **no es oficial**. No uses logos, nombres ni imágenes del
Ayuntamiento ni de sus apps, ni textos que hagan parecer que lo es.

## Proceso
1. Para cambios grandes, abre primero un issue y platiquemos la idea.
2. Haz un fork y una rama con un nombre descriptivo.
3. Prueba en un celular (o con la vista móvil del navegador), en modo claro y
   oscuro.
4. Abre el PR llenando la plantilla. **El título sigue
   [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/)**
   (ver abajo); un check lo revisa.
5. Un bot comenta en el PR un enlace de **vista previa** con tu cambio
   funcionando. Se actualiza con cada push.
6. Tras la revisión, se integra con *squash merge*: tu PR se vuelve un solo
   commit en `main` con el título del PR.

### Título del PR
Formato `tipo: descripción` (la descripción en español, en minúscula y sin
punto final). El tipo decide la versión:

| Tipo | Para qué | Versión |
|---|---|---|
| `feat` | Algo nuevo para quien usa la página | 0.**X**.0 |
| `fix` | Corrige un error | 0.0.**X** |
| `perf` | Mejora el rendimiento | 0.0.**X** |
| `docs` | Solo documentación | no publica |
| `refactor`, `style`, `test`, `build`, `ci`, `chore` | Mantenimiento | no publica |

Ejemplos: `feat: muestra la hora estimada de llegada`,
`fix: el pin no se mueve en iOS`, `docs: aclara cómo correr el proyecto`.
Un cambio incompatible lleva `!` (`feat!: …`).

## Versiones y publicación
Esto lo hace quien mantiene el proyecto; lo explicamos para que se entienda
el ciclo.

1. Con cada merge a `main` se calcula la siguiente versión a partir de los
   títulos de los PR desde la última (tabla de arriba). Si solo hubo `docs`,
   `ci`, `chore`…, no se publica nada.
2. Si hay versión nueva, el despliegue a **https://basuragdl.tocaltepetl.org**
   espera aprobación manual en el ambiente `production` de GitHub; el resumen
   del workflow muestra la versión y las notas propuestas.
3. Al aprobar se publica y se crean el tag (`vX.Y.Z`) y el
   [GitHub Release](https://github.com/tocaltepetl/camiones-basura-gdl/releases)
   con sus notas. Si se juntan varios merges sin aprobar, queda solo el más
   reciente, que los incluye todos.
4. Para volver a una versión anterior: Actions → **Desplegar** → *Run
   workflow* con el tag (también pide aprobación).

Las decisiones de diseño y su porqué están en
[`docs/decisiones.md`](docs/decisiones.md); léelas antes de proponer cambios
de fondo (p. ej. cambiar de proveedor de mapas).
