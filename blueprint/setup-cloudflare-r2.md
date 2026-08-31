# Configurar Cloudflare R2 para evidencia de entregas

Guía para crear lo necesario en tu cuenta de Cloudflare. Esto lo tienes que
hacer tú (requiere tu propia cuenta) — cuando termines, me pasas los 4
valores del final y yo los conecto al proyecto (Railway + `.env` local).

## 1. Cuenta de Cloudflare

Si no tienes una, créala en [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
— es gratis, no pide tarjeta para usar R2 dentro de la capa gratuita.

## 2. Activar R2 y crear el bucket

1. En el panel de Cloudflare, busca **R2 Object Storage** en el menú lateral
   (puede pedirte "activar" R2 la primera vez — sigue el flujo, sigue siendo
   gratis dentro de la capa gratuita).
2. Crea un bucket nuevo. Nombre sugerido: `rutas-evidencias` (o
   `rutas-evidencias-prod` si más adelante quieres uno separado para pruebas).
3. Ubicación: la que te sugiera por default está bien (R2 no usa regiones
   como AWS — ver nota más abajo).
4. **No actives "acceso público"** en el bucket. Lo dejamos privado a
   propósito — el backend genera enlaces temporales para ver/descargar cada
   archivo, nadie accede al bucket directo (mismo patrón del documento de
   referencia que ya revisamos).

## 3. Generar credenciales de API (token con acceso al bucket)

1. Dentro de R2, busca **Manage API Tokens** (o "API" en el menú de R2).
2. Crea un token nuevo:
   - Permisos: **Object Read & Write** (lectura y escritura de objetos).
   - Alcance: limítalo al bucket que creaste en el paso 2 (no "todos los
     buckets"), si la opción está disponible.
3. Al crear el token, Cloudflare te muestra **una sola vez**:
   - **Access Key ID**
   - **Secret Access Key**

   Cópialos de inmediato a algún lugar seguro (como el `.env` del proyecto,
   igual que hiciste con los tokens de GitHub) — si cierras esa pantalla sin
   copiarlos, tienes que generar un token nuevo.

## 4. Datos que necesito de ti al terminar

Junta estos 4 valores y pásamelos (puedes agregarlos a `.env` con una
etiqueta como hiciste con los tokens de GitHub, o pegármelos directo):

| Valor | Dónde lo encuentras |
|---|---|
| **Account ID** | Panel principal de Cloudflare, columna derecha, o en la URL del dashboard (`dash.cloudflare.com/<ACCOUNT_ID>/r2`) |
| **Nombre del bucket** | El que elegiste en el paso 2 (ej. `rutas-evidencias`) |
| **Access Key ID** | Del token que generaste en el paso 3 |
| **Secret Access Key** | Del token que generaste en el paso 3 (solo se muestra una vez) |

Con el Account ID armamos el endpoint que necesita el proyecto:
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com` — no hace falta que lo
armes tú, con darme el Account ID yo lo completo.

## Notas

- **Región**: R2 no funciona con regiones tipo AWS (`us-east-1`, etc.) —
  usa el valor especial `auto`. Esto ya lo dejo fijo en el código, no es
  algo que tengas que configurar.
- **Costo esperado**: capa gratuita de R2 = 10 GB de almacenamiento y 1
  millón de operaciones de lectura al mes, **sin costo de salida de datos
  nunca** (a diferencia de AWS S3, que sí cobra por descargar). Para el
  volumen de este proyecto (fotos de evidencia de entregas), es muy
  probable que no salga de la capa gratuita por bastante tiempo.
- **No necesitas** activar dominio público, Workers, ni ningún otro
  producto de Cloudflare — solo R2 y el token de API de arriba.
