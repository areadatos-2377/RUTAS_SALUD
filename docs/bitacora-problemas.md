# Bitácora de problemas

Registro de problemas reales encontrados en el desarrollo y despliegue de
Rutas_01, con su causa raíz y la solución aplicada. Se agrega una entrada
nueva cada vez que se resuelve algo que valga la pena no tener que
re-diagnosticar desde cero la próxima vez.

Formato de cada entrada: **Síntoma** (lo que se vio) → **Causa raíz** (lo
que realmente pasaba) → **Solución** (qué se cambió) → **Cómo se detectó**.

---

## 2026-08-30 — "Tu sesión expiró" al hacer login en producción (causa raíz real)

**Síntoma:** Al iniciar sesión en producción con credenciales correctas,
la app mostraba "Tu sesión expiró. Vuelve a iniciar sesión para
continuar." El problema no era parejo: pasaba en algunos
navegadores/dispositivos y en otros no.

**Causa raíz:** `up.railway.app` está en la Public Suffix List (la lista
que usan los navegadores para decidir qué es un "sitio" independiente).
Frontend (`frontend-production-*.up.railway.app`) y backend
(`backend-production-*.up.railway.app`) son, para el navegador, dos
sitios completamente distintos — no subdominios relacionados. La cookie
de sesión que pone el backend es entonces una cookie de **tercero** desde
el punto de vista del navegador. El arreglo anterior (`SameSite=None;
Secure`, ver entrada de abajo) permite que la cookie *viaje* en una
petición cross-site, pero no evita que el navegador la **bloquee por ser
de tercero** — y cada vez más navegadores lo hacen por default (Safari
siempre, Chrome/Edge en buena parte de usuarios, Firefox en modo
estricto, o cualquiera con "bloquear cookies de terceros" activado). Por
eso el bug era inconsistente entre navegadores/dispositivos.

**Solución:** Eliminar el cruce de dominios de raíz en vez de intentar
convencer al navegador de aceptar la cookie. `frontend/server.js`
reemplaza el servidor estático puro (`serve`) por un servidor Express que
sirve el build (`dist/`) **y** reenvía `/api/*` al backend por la red
privada de Railway (`http-proxy-middleware`). El navegador ya solo le
habla a un origen (el del frontend) — sin cruce de dominios, sin cookie
de tercero, sin depender de la configuración de privacidad de cada
navegador.

Detalles de la implementación:
- `client.js`: `VITE_API_BASE_URL` vacío en producción → rutas relativas,
  el proxy resuelve a dónde van.
- `settings.py`: `RAILWAY_PRIVATE_DOMAIN` agregado a `ALLOWED_HOSTS`
  (las peticiones ya no llegan del dominio público sino de la red
  privada) y `USE_X_FORWARDED_HOST=True` + el proxy manda
  `X-Forwarded-Host`, para que los links `next`/`previous` de paginación
  de DRF usen el dominio público del frontend en vez del interno
  `backend.railway.internal` (irresoluble desde el navegador).
- Railway: `PORT` fijo (8080) en el backend para poder apuntarle desde el
  proxy con una URL interna estable (`http://backend.railway.internal:8080`).

**Cómo se detectó:** Una prueba automatizada (Playwright, navegador
Chromium por defecto sin restricciones de cookies de terceros) hacía
login sin problema contra producción, mientras que el usuario real fallaba
en su navegador. Esa discrepancia fue la pista: el código del lado
servidor estaba bien, el problema vivía en la política de cookies del
navegador cliente. Confirmado revisando la Public Suffix List de Mozilla
y viendo que `up.railway.app` está listada.

**Efecto secundario #2 — falso "sesión expiró" justo después de un login
exitoso:** Después del fix de raíz, apareció una variante nueva del mismo
mensaje, esta vez inmediata: el login devolvía `200` pero la app volvía a
mostrar "tu sesión expiró" y se quedaba en `/login`. Causa: una carrera
preexistente (no introducida por el proxy, pero mucho más fácil de
disparar con el salto de red extra que agrega) entre el login del usuario
y la llamada a `/api/auth/me/` que `AuthProvider` dispara al montar (para
saber si ya había sesión activa). Si el `401` esperado de esa llamada
inicial resolvía *después* de un login exitoso, dos lugares del código la
malinterpretaban como "la sesión que acabas de iniciar ya expiró":
1. El manejador global de `401` en `client.js`, que disparaba el evento
   `sesion-expirada` para cualquier `401` salvo el del propio login.
2. El `catch` del efecto de montaje en `AuthContext.jsx`, que hacía
   `setUsuario(null)` sin condición — pisando el usuario que el login ya
   había puesto.

Solución: excluir también `/api/auth/me/` del disparo del evento (un 401
ahí es "todavía no has iniciado sesión", no "tu sesión expiró"), y
cambiar el `catch` del montaje a `setUsuario((actual) => actual ?? null)`
— solo limpia si de verdad seguía sin sesión. Probado localmente
corriendo el login repetidas veces seguidas contra el proxy hasta
reproducir la carrera a propósito (la llamada a `/me/` resolviendo
después del login) y confirmando que ya no pasa nada raro.

**Efecto secundario #1 al desplegar el proxy — `DisallowedHost` (400):**
Con `USE_X_FORWARDED_HOST=True`, Django valida `ALLOWED_HOSTS` contra el
header `X-Forwarded-Host`, **no** contra el host real de la conexión TCP.
El proxy manda ahí el dominio público del frontend (para que
`build_absolute_uri` funcione, ver arriba) — así que agregar solo
`RAILWAY_PRIVATE_DOMAIN` a `ALLOWED_HOSTS` no bastaba: toda petición vía
el proxy se rechazaba con 400 porque el host que Django realmente valida
no estaba en la lista. Solución: agregar también el hostname de
`FRONTEND_URL` a `ALLOWED_HOSTS`. Detectado de inmediato al probar el
despliegue (curl directo a `/api/jornadas/` vía el frontend devolvía 400
en vez de 401).

---

## 2026-08-28 — Bucket de Cloudflare R2 rechazaba las credenciales (`400 Bad Request`)

**Síntoma:** `head_bucket` contra el bucket de R2 fallaba con
`400 Bad Request` usando el nombre de bucket tal como aparecía copiado
del panel de Cloudflare (`Rutas-evidencias`, con mayúscula y guion).

**Causa raíz:** Los nombres de bucket estilo S3 deben ser
DNS-compliant (minúsculas). Cloudflare normalizó el nombre a minúsculas
al crear el bucket aunque el panel lo mostrara con mayúscula.

**Solución:** Usar `rutas-evidencias` (todo minúsculas) en
`STORAGE_BUCKET_NAME`. Confirmado probando `head_bucket` con ambas
variantes directamente contra la API de R2 antes de asumir cuál era la
correcta.

**Cómo se detectó:** Prueba directa contra la API S3 de R2 (`boto3`)
antes de intentar subir un archivo real — más rápido que depurar el
error a través de toda la cadena backend → frontend → navegador.

---

## 2026-08-26 — "Tu sesión expiró" recurrente (primer intento de arreglo, incompleto)

**Síntoma:** Mismo mensaje que la entrada de arriba, detectado por primera
vez poco después del despliegue inicial a Railway.

**Causa raíz (parcial — ver entrada de 2026-08-30 para la causa completa):**
Dos partes:
1. Cookies `SameSite=Lax` (default de Django) bloqueadas en peticiones
   cross-subdomain por el navegador.
2. El frontend no podía leer el token CSRF vía `document.cookie` cross-domain
   incluso después de arreglar el punto 1.

**Solución aplicada en ese momento:** `SESSION_COOKIE_SAMESITE = "None"` +
`SESSION_COOKIE_SECURE = True` (solo cuando `DEBUG=False`); el token CSRF
se empezó a devolver en el cuerpo JSON de `/api/auth/csrf/` y
`/api/auth/login/` en vez de esperar que el frontend lo leyera de la
cookie, y se guarda en memoria del lado del cliente.

**Por qué no fue suficiente:** Resolvía el *SameSite* pero no el bloqueo
de cookies de **terceros**, que es una protección de navegador distinta e
independiente de `SameSite`. El bug volvió a aparecer más tarde en
navegadores con esa protección activa — ver la entrada de 2026-08-30 para
el arreglo de raíz.

---

## 2026-08-24 a 2026-08-28 — Crash-loop del backend en Railway tras fusionar la rama de Jorge

**Síntoma:** `django.db.utils.OperationalError: cannot ALTER TABLE ...
because it has pending trigger events` en el arranque del backend en
Railway, después de fusionar el modelo de datos rediseñado de un
compañero de equipo (Jorge).

**Causa raíz:** Cada migración de Django corre en su propia transacción
por default. Postgres rechaza `ALTER TABLE`/`CREATE INDEX` en la misma
transacción que un DML masivo previo sobre la misma tabla ("pending
trigger events") — incluyendo la creación de índices para FKs nuevas que
Django difiere al final de la migración, que abarca TODAS las
operaciones de esa migración, no solo los `AlterField`/`AddConstraint`
explícitos. Un primer intento de separar solo las operaciones de esquema
al final no fue suficiente por esta razón.

**Solución:** Partir la migración en 3: una de solo esquema, una de solo
datos (`RunPython`), y una final de "hardening" (constraints/índices que
dependen de que los datos ya estén migrados). Verificado directo contra
Postgres de producción vía túnel SSH (`railway connect Postgres
--tunnel-only`) antes de volver a desplegar.

**Nota aparte:** El estado de migraciones en local ya había aplicado la
migración combinada original antes de partirla en archivos separados —
hubo que fake-aplicar (`--fake`) las migraciones ya reflejadas en la BD
local y aplicar de verdad solo la genuinamente nueva.

**Cómo se detectó:** Logs de deploy de Railway (crash-loop visible ahí
directamente).

---

## 2026-08-25 — SSH tunnel a Postgres de Railway se caía a medio cargar el catálogo de CLUES

**Síntoma:** El túnel SSH hacia la base de datos de producción
(`railway connect Postgres --tunnel-only`) se desconectaba a medio
cargar el catálogo de unidades médicas (CLUES).

**Causa raíz:** El comando de carga usaba `update_or_create` fila por
fila — decenas de miles de idas y vueltas a la base de datos sobre una
conexión no del todo estable (túnel SSH).

**Solución:** Reescribir `cargar_clues` para usar `bulk_create`/
`bulk_update` con un flag `--batch-size`, cargando en lotes en vez de
fila por fila.

**Cómo se detectó:** El túnel se caía consistentemente a medio proceso;
al perfilar el comando se vio el patrón de miles de queries individuales.

---

## 2026-08-24 — "Mixed Content" bloqueaba la paginación en producción

**Síntoma:** Las listas con más de 50 filas (donde hay que pedir la
página 2) fallaban silenciosamente en producción, pero funcionaban en
local.

**Causa raíz:** Railway termina HTTPS en su proxy de borde y le manda
HTTP liso al contenedor. Sin decírselo a Django, `request.build_absolute_uri()`
(usado para armar los links `next`/`previous` de DRF) generaba URLs
`http://...`, que el navegador bloqueaba como "Mixed Content" al pedirlas
desde una página servida por `https://`.

**Solución:** `SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")`
en `settings.py`, para que Django confíe en el header que synciende Railway
y sepa que la petición original sí fue HTTPS.

**Cómo se detectó:** Reproducido con Playwright contra producción; el
error en consola del navegador decía explícitamente "Mixed Content".

---

## 2026-08-24 — `tipo_unidad_medica` truncaba datos reales del catálogo

**Síntoma:** La carga del catálogo de CLUES fallaba en Postgres
(producción) pero no en SQLite (local).

**Causa raíz:** El campo `tipo_unidad_medica` tenía `max_length=50`, pero
el catálogo real trae valores de hasta 57 caracteres. SQLite no valida el
límite de longitud de un `VARCHAR` al insertar; Postgres sí lo rechaza.

**Solución:** Migración ampliando el `max_length` del campo.

**Cómo se detectó:** Solo apareció al probar contra Postgres real, no en
desarrollo local con SQLite — lección: probar contra el motor de base de
datos real antes de dar por buena una migración.
