# Backend — Rutas_01

Django 5 + Django REST Framework. Ver `blueprint/blueprint-v01.md` y `blueprint/diagrama-er-v01.md` para las reglas de negocio y el modelo de datos detrás de estos apps.

## Apps

| App | Contiene |
|---|---|
| `usuarios` | `Usuario` (custom, `AUTH_USER_MODEL`) — roles `super_admin` / `admin_nacional` / `usuario_entidad`. |
| `catalogos` | `Entidad`, `UnidadMedica` (CLUES como PK, admite altas manuales). |
| `programacion` | `Jornada`, `Ruta` histórica, `ProgramacionVisita` precargada por CLUES. |
| `entregas` | `Entrega` (1 a 1 con `ProgramacionVisita`), `EvidenciaArchivo`. |
| `historico` | `HistoricoMovimientos` — bitácora genérica vía `ContentType`/`GenericForeignKey`. |

## Arrancar en local

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Sin `DATABASE_URL` en `.env`, cae automáticamente a SQLite local — no hace falta Postgres corriendo para desarrollar. En producción (Railway), `DATABASE_URL` la provee el addon de Postgres.

## API (módulo de programación y catálogos — completa)

Endpoints, todos requieren sesión iniciada (`POST /api/auth/login/`):

- `POST /api/auth/login/`, `POST /api/auth/logout/`, `GET /api/auth/me/`
- `GET/POST/PATCH/DELETE /api/entidades/` — lectura para cualquiera, escritura solo `super_admin`.
- `GET/POST/PATCH/DELETE /api/unidades-medicas/` (admite `?entidad=<id>`) — mismos permisos.
- `GET/POST/PATCH/DELETE /api/jornadas/` — lectura para cualquiera, escritura solo `admin_nacional`/`super_admin`.
- `GET/POST/PATCH/DELETE /api/rutas/` y `/api/programacion-visitas/` — `usuario_entidad`/`super_admin` leen y escriben (un `usuario_entidad` solo ve/edita lo de su propia entidad, forzado server-side); `admin_nacional` solo lee.

Al crear una jornada se precarga automáticamente una fila por cada CLUES compatible con su categoría. Cada fila se edita para capturar ruta, fecha, cantidades y contacto; también puede eliminarse de esa jornada. La restricción única `(jornada, unidad_medica)` impide duplicados en la base de datos.

## Catálogo de CLUES (carga mensual)

El área actualiza `data/raw/CLUES_IMB.xlsx` cada mes. Cuando eso pase:

```powershell
cd backend
python manage.py cargar_clues --dry-run   # revisar qué haría, sin escribir
python manage.py cargar_clues             # aplicar de verdad
```

Es **seguro re-ejecutarlo** las veces que haga falta: agrega los CLUES nuevos, actualiza los que cambiaron de nombre/tipo/municipio, y **nunca toca ni borra** las unidades con `origen=manual` (las capturadas a mano porque su CLUES no estaba en el catálogo oficial — ver `blueprint/herramienta-captura-programacion-plan-v00.md`). Tampoco borra CLUES que hayan desaparecido del nuevo Excel; darlas de baja formalmente es una decisión de negocio aparte.

## Pendientes conocidos (no bloquean lo ya construido)

- Autenticación de la API (por ahora `SessionAuthentication` vía DRF/cookies; falta decidir si se agrega JWT cuando exista el frontend React, para no depender de cookies same-site).
- Granularidad del bloqueo de `ProgramacionVisita.bloqueada` a nivel Jornada completa (hoy es por fila) — ver nota en `programacion/models.py`.
- Backend de almacenamiento de `EvidenciaArchivo.archivo` (object storage vs filesystem) — ver nota en `entregas/models.py` y `blueprint/blueprint-v01.md` sección 9.
- Ciclo de vida completo de `Jornada.estatus` — los 4 valores actuales son un punto de partida, no una decisión cerrada con el área.
