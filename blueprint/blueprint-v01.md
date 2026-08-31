# Blueprint v01 — Sistema de Programación y Seguimiento de Distribución de Insumos para la Salud

> Estado del documento: **v01**, incorpora las respuestas del área requirente en `preguntas-area-requirente.md` (2026-08-24) sobre el borrador `blueprint-v00.md`. Las secciones marcadas `[RESUELTO]` ya tienen respuesta confirmada; `[ABIERTO]` sigue pendiente.

## 0. Control de versiones

| Versión | Fecha | Cambios |
|---|---|---|
| v00 | 2026-08-21 | Borrador inicial: contexto, glosario, roles, módulos, modelo de datos preliminar y stack. |
| v01 | 2026-08-24 | Incorpora respuestas del área requirente: reglas de negocio de jornadas/rutas/programación/entrega, roles y permisos definitivos, catálogos, no funcionales y etapas. Simplifica el modelo de datos (la cantidad programada es agregada por unidad, no desglosada por insumo). |

---

## 1. Contexto y objetivo `[sin cambios respecto a v00]`

Las entidades (estados) programan la distribución de insumos para la salud hacia unidades médicas, organizada en **jornadas de distribución** de varios días. Antes de cada jornada, cada entidad define su plan de distribución: **rutas** que agrupan las unidades médicas a visitar, y para cada ruta/unidad, qué cantidad de insumos se llevará. Durante o después de la distribución, la entidad sube **evidencia** de la entrega. Objetivo: comparar lo *programado* contra lo *entregado*.

## 2. Reglas de negocio confirmadas

### 2.1 Jornadas `[RESUELTO]`

- Una jornada es siempre **nacional** (todas las entidades participan), no hay jornadas de una sola entidad.
- La abre el **administrador nacional** o el **super administrador**.
- Puede haber **más de una jornada activa al mismo tiempo**.
- Catálogo de tipos de jornada: **ordinaria, extraordinaria, emergencia**.
- **Categoría (agregado 2026-08-24):** cada jornada es de **una sola categoría**: **primer nivel**, o **segundo y tercer nivel** (combinados en una sola categoría, no separados). Puede existir "sexta distribución" de primer nivel y otra "sexta distribución" de segundo y tercer nivel al mismo tiempo, como jornadas independientes con fechas distintas. Una jornada no mezcla unidades de categorías distintas — se valida en duro (no solo se sugiere en la interfaz), igual que la regla de "unidad no repetida en la misma jornada".
- `[ABIERTO]` El ciclo de vida exacto (qué estatus tiene una jornada además de "abierta/cerrada", quién la cierra) no quedó del todo especificado — a definir en el diseño detallado de este módulo.

### 2.2 Rutas `[RESUELTO]`

- Al crear una jornada, el sistema **precarga una fila por cada CLUES** compatible con la categoría. El usuario completa la ruta, fecha, cantidades y contacto directamente en cada fila, sin agregar unidades una por una.
- La ruta es **libre** y se captura como dato de cada fila, sin optimización geográfica ni de capacidad.
- Solo importa el **conjunto de unidades** de la ruta — el orden de visita no es relevante para el sistema.
- **Fuera de alcance**: asociar vehículo, transportista o chofer a una ruta.
- Una misma unidad médica **no puede** aparecer en más de una ruta dentro de la misma jornada.
- Las rutas **se pueden reutilizar como plantilla** de una jornada a otra. Una entidad tiene **varias rutas simultáneas** en una misma jornada, cada una visitando un subconjunto distinto de unidades.

### 2.3 Programación de distribución `[RESUELTO]`

- La cantidad programada se define **por unidad médica**, como valores agregados — **no se desglosa qué claves de insumo específicas se entregan** (confirma lo ya observado en el Excel real: "claves a desplazar" es un conteo, "piezas de medicamento" y "piezas de material de curación" son totales, no un detalle por clave).
- **Sin límite ni validación** de cantidades contra inventario o presupuesto.
- El capturista **publica directamente**, sin flujo de aprobación previo.
- La programación **se puede modificar** aún iniciada la jornada. Debe existir la opción de **bloquear la edición** en algún momento (para todas las unidades) y de **desbloquear todas o solo algunas**.

### 2.4 Entrega y evidencia `[RESUELTO]`

- No hay un mínimo de evidencia requerido — **se sube la que se tenga**.
- **No se captura firma ni nombre de quien recibe** como parte de la evidencia (distinto del campo "¿quién recibe en unidad?" de la *programación*, que es un contacto esperado, no una firma de recepción).
- Formatos: **foto, video, PDF y documentos**. `[ABIERTO]` Aún no está definido dónde se almacenarán estos archivos (object storage a decidir).
- La evidencia **se sube después**, desde una oficina con conectividad — **no en tiempo real en campo**.
- Si la cantidad entregada difiere de la programada, **se registra sin necesidad de motivo/justificación**.
- **No hay entregas parciales**: cada unidad se marca entregada/no entregada **una sola vez** por jornada.

### 2.5 Comparativo programado vs. entregado `[RESUELTO]`

- **Sin umbrales de alerta** — no hay una desviación que se marque automáticamente como crítica.
- Debe poder **exportarse a Excel**. Primer paso concreto ya construido: la [herramienta de captura de programación](../tools/captura-programacion/) exporta lo programado a un `.xlsx` con el formato institucional real.
- El comparativo en tiempo real lo consultan **administradores nacionales y super administradores**.

## 3. Roles y permisos `[RESUELTO]`

```
Super Administrador (varias personas)
   └─ Administrador nacional (solo lectura de programaciones, todas las entidades)
        └─ Usuario de entidad (~2 por entidad)
             — una misma persona puede capturar programación Y subir evidencia
               (no son roles forzosamente distintos)
```

- **No existe** un nivel jerárquico intermedio entre entidad y nacional (sin jurisdicción/región).
- El administrador nacional **solo puede ver** las programaciones — no edita, aprueba ni rechaza.
- Dimensionamiento esperado: ~2 usuarios por entidad × 23 entidades ≈ 46, más administradores nacionales y super administradores → **~64 usuarios concurrentes en picos** (jornada activa).

## 4. Catálogos maestros `[RESUELTO]`

- El catálogo de **unidades médicas** se ingresa desde `data/raw/CLUES_IMB.xlsx`, actualizado **cada mes**.
- Recordatorio del hallazgo de la sub-herramienta de captura: los CLUES de este catálogo **no cubren** todos los códigos que aparecen en la programación real (ver `herramienta-captura-programacion-plan-v00.md`, sección 1) — se resolvió con captura manual de respaldo ahí; el sistema principal deberá decidir si adopta la misma mitigación o si se consigue un catálogo más completo antes del corte a producción.
- No se definió un catálogo de insumos/claves con el nivel de detalle que se pensaba en v00 — ver sección 5 (modelo de datos), ya no hace falta porque la programación no se desglosa por clave.

## 5. Modelo de datos — actualizado y simplificado `[RESOLUCIÓN IMPORTANTE]`

La respuesta a la pregunta 10 (la cantidad programada es agregada por unidad, no por insumo) simplifica bastante el modelo de v00: **no se necesita una relación detallada Programación×Insumo**. El modelo queda más cerca de lo que ya se implementó en la sub-herramienta de captura:

- **Entidad** — estado (23), con su coordinador.
- **UnidadMedica** — CLUES, nombre, entidad, tipo de unidad médica (derivado de tipología), municipio.
- **Usuario** — rol (`super_admin` | `admin_nacional` | `usuario_entidad`), entidad asociada si aplica. Un `usuario_entidad` tiene permiso de programación y de evidencia por default (no hace falta un sub-rol separado, según 2.3 de este documento).
- **Jornada** — tipo (ordinaria/extraordinaria/emergencia), fecha inicio, fecha fin, estatus.
- **Ruta** — modelo histórico para conservar programaciones previas; las nuevas capturas registran el número/nombre directamente en la fila.
- **ProgramacionVisita** — jornada, unidad médica, número/nombre de ruta, fecha de distribución programada, claves a desplazar (conteo), piezas de medicamento, piezas de material de curación, tipo de unidad médica, quién recibe, teléfono, correo, **bloqueada** (booleano, para el mecanismo de bloqueo de edición de 2.3). Existe una sola fila por combinación jornada + unidad médica.
- **Entrega** — referencia 1-a-1 a `ProgramacionVisita` (no hay entregas parciales), estatus entregado/no entregado, fecha, usuario que capturó.
- **EvidenciaArchivo** — entrega asociada, tipo (foto/video/pdf/documento), archivo, metadatos.
- **HistoricoMovimientos** — bitácora de cambios (tabla, registro, usuario, acción, timestamp, antes/después).

**Ya no aparece** en este modelo un catálogo de `Insumo` como entidad relacional de primer nivel — si se necesita más adelante (p. ej. para otro módulo), se puede reintroducir, pero no es requisito para programación/entrega/comparativo tal como se confirmó con el área.

## 6. Requisitos no funcionales `[parcialmente RESUELTO]`

- ~64 usuarios concurrentes en picos (jornada activa).
- Sin acceso desde dispositivos móviles por ahora — **queda fuera de alcance** (solo navegador de escritorio).
- Sin requisitos especiales de accesibilidad o idioma (solo español, sin normativa adicional mencionada).
- Infraestructura: **Railway** (ya en uso — ver `tools/captura-programacion/README.md` para la configuración de despliegue de la sub-herramienta actual).
- `[ABIERTO]` No se definió un SLA/requisito de disponibilidad explícito.

## 7. Alcance confirmado `[RESUELTO]`

- El sistema es **únicamente para seguimiento de la distribución** — no controla inventario/existencias (eso vive en otro sistema, fuera de este proyecto).
- **Sin notificaciones automáticas** (correo/SMS) por ahora.
- **Sin integración** con otros sistemas institucionales (incluyendo el módulo de Contrataciones/CE mencionado en `legacy/`).

## 8. Etapas y piloto `[RESUELTO]`

- No hay una fecha objetivo específica para tener el sistema operativo.
- Criterio de etapas: **primero la parte de captura de programación**, y después se analiza dónde/cómo se capturará lo distribuido (evidencia) — coincide con el orden en que ya se avanzó (la sub-herramienta de captura de programación es el primer entregable concreto).
- **Entidad piloto: Colima.**

## 9. Pendientes que siguen abiertos `[ABIERTO]`

Estas preguntas del documento original no se respondieron todavía — no bloquean seguir avanzando con programación/captura, pero sí antes de diseñar evidencia/migración a fondo:

1. **Datos históricos y migración** (preguntas 31-33 del documento de preguntas): ¿existe un sistema o Excel actual del que haya que migrar histórico de jornadas pasadas? ¿Hay un sistema legacy en operación que este proyecto sustituye, y cuál es su alcance? ¿Qué tan atrás debe llegar el histórico retenido?
2. **SLA / disponibilidad** (pregunta 35): sin respuesta aún.
3. Dónde se almacenarán los archivos de evidencia (mencionado como pendiente en la propia respuesta a la pregunta 16).
4. El ciclo de vida completo de una jornada (qué estatus tiene más allá de abierta, quién la cierra formalmente).

## 10. Próximos pasos

1. ~~Diseñar el diagrama ER definitivo a partir del modelo simplificado de la sección 5.~~ Hecho: ver `blueprint/diagrama-er-v01.md`.
2. ~~Empezar el diseño del backend Django (modelos, catálogos, autenticación) para el módulo de programación.~~ Hecho: ver `backend/` (modelos, admin y migraciones de los 5 apps, probados contra SQLite).
3. Construir la API DREST (serializers/viewsets) sobre esos modelos.
4. Definir el mecanismo de bloqueo/desbloqueo de edición de programación (2.3) — a nivel de qué (jornada completa, por ruta, por unidad individual). El campo `bloqueada` ya existe a nivel fila en `ProgramacionVisita`.
5. Cerrar los 4 pendientes de la sección 9 con el área antes de diseñar el módulo de evidencia.
