"""Cliente de almacenamiento de objetos (Cloudflare R2, compatible S3) para
evidencia de entregas. Nadie fuera de aqui importa boto3 directamente --
regla explicita, para que cambiar de proveedor sea cambiar variables de
entorno, no codigo. Adaptado del patron documentado en
legacy/referencia_almacenamiento_documentos.md.

boto3 se importa perezoso (dentro de las funciones, no a nivel de modulo)
para que el resto de la app siga funcionando aunque STORAGE_* todavia no
este configurado -- solo estos endpoints fallarian.
"""

import unicodedata
import uuid
from datetime import date

from django.conf import settings

MAX_EVIDENCIA_BYTES = 15 * 1024 * 1024  # 15MB -- fotos de celular pesan mas que un PDF

# Extension (en minusculas) -> tipo de EvidenciaArchivo.TIPO_CHOICES. Solo
# JPG/PNG para imagenes -- python-pptx (usado al generar la presentacion,
# ver presentacion.py) no puede insertar WEBP/HEIC en una diapositiva, y
# HEIC ademas ni Pillow lo abre sin un plugin aparte. En vez de convertir
# esos formatos al vuelo, se rechazan desde la subida.
EXTENSION_A_TIPO = {
    ".jpg": "foto", ".jpeg": "foto", ".png": "foto",
    ".mp4": "video", ".mov": "video",
    ".pdf": "pdf",
    ".doc": "documento", ".docx": "documento",
}


def _cliente_s3():
    from botocore.client import Config
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=settings.STORAGE_ENDPOINT_URL,
        aws_access_key_id=settings.STORAGE_ACCESS_KEY_ID,
        aws_secret_access_key=settings.STORAGE_SECRET_ACCESS_KEY,
        region_name="auto",  # R2 no usa regiones tipo AWS
        # connect/read_timeout: sin esto, una sola descarga que R2 se tarde
        # en responder se queda colgada indefinidamente (se vio en produccion
        # -- una corrida de generar_presentacion se quedo minutos atorada
        # aqui hasta que gunicorn mato el worker a la fuerza). Con timeout,
        # esa descarga individual falla rapido en vez de tumbar todo el job.
        config=Config(
            s3={"addressing_style": "path"},
            connect_timeout=10,
            read_timeout=20,
            retries={"max_attempts": 2},
        ),
    )


def crear_cliente():
    """Version publica de _cliente_s3, para cuando alguien fuera de este
    modulo necesita crear UN cliente y reutilizarlo en varias llamadas (ej.
    presentacion.py, para no abrir una conexion nueva por cada foto de una
    jornada de cientos de unidades) -- boto3 documenta que un cliente (a
    diferencia de un Resource) si es seguro compartir entre hilos."""
    return _cliente_s3()


def _slug(texto: str) -> str:
    normalizado = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return "-".join(normalizado.lower().split())


def _nombre_seguro(nombre: str) -> str:
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in nombre)


def extension(nombre_archivo: str) -> str:
    return "." + nombre_archivo.rsplit(".", 1)[-1].lower() if "." in nombre_archivo else ""


def construir_key(entrega, nombre_archivo: str) -> str:
    """Distribucion / Entidad / Dia / Unidad -- estructura acordada para que
    el bucket sea navegable/descargable con ese orden desde fuera."""
    visita = entrega.programacion_visita
    jornada = visita.jornada
    entidad = visita.unidad_medica.entidad
    dia = (entrega.fecha_entrega or date.today()).isoformat()
    sufijo = uuid.uuid4().hex[:8]
    return (
        f"evidencias/{jornada.id}_{_slug(jornada.nombre)}/{_slug(entidad.nombre)}/"
        f"{dia}/{visita.unidad_medica_id}/{sufijo}__{_nombre_seguro(nombre_archivo)}"
    )


def construir_key_presentacion(jornada, nombre_archivo: str) -> str:
    """Prefijo propio para los .pptx armados por PresentacionJob -- no son
    evidencia subida por un usuario, son un resultado generado; separarlos
    evita que se mezclen al navegar el bucket."""
    sufijo = uuid.uuid4().hex[:8]
    return f"presentaciones/{jornada.id}_{_slug(jornada.nombre)}/{sufijo}__{_nombre_seguro(nombre_archivo)}"


def construir_key_picking_packing(jornada, entidad, fecha, nombre_archivo: str) -> str:
    """Igual que construir_key, pero para evidencia de picking_packing.Evidencia
    (por entidad y dia, sin unidad medica) -- prefijo propio para que no se
    mezcle en el bucket con la evidencia de Distribucion."""
    sufijo = uuid.uuid4().hex[:8]
    return (
        f"picking-packing/{jornada.id}_{_slug(jornada.nombre)}/{_slug(entidad.nombre)}/"
        f"{fecha.isoformat()}/{sufijo}__{_nombre_seguro(nombre_archivo)}"
    )


def subir_evidencia(archivo, key: str) -> None:
    cliente = _cliente_s3()
    cliente.upload_fileobj(
        archivo, settings.STORAGE_BUCKET_NAME, key,
        ExtraArgs={"ContentType": archivo.content_type or "application/octet-stream"},
    )


def generar_url_descarga(key: str, expira_segundos: int = 300, nombre_archivo: str | None = None) -> str:
    cliente = _cliente_s3()
    params = {"Bucket": settings.STORAGE_BUCKET_NAME, "Key": key}
    if nombre_archivo:
        # Para que el navegador descargue con un nombre legible (en vez del
        # key completo con carpetas/uuid) sin tener que pasar el archivo por
        # el backend -- lo mismo que hace el Content-Disposition en la
        # respuesta directa, pero via el propio presigned URL de R2.
        params["ResponseContentDisposition"] = f'attachment; filename="{nombre_archivo}"'
    return cliente.generate_presigned_url("get_object", Params=params, ExpiresIn=expira_segundos)


def eliminar_evidencia(key: str) -> None:
    cliente = _cliente_s3()
    cliente.delete_object(Bucket=settings.STORAGE_BUCKET_NAME, Key=key)


def descargar_evidencia(key: str, cliente=None) -> bytes:
    """Trae el archivo completo a memoria -- para insertarlo en el .pptx de
    evidencia (generar_url_descarga sirve para que el navegador lo pida
    directo a R2, esto es para cuando el propio backend necesita los bytes).

    Acepta un cliente ya creado (opcional) para reutilizarlo entre muchas
    llamadas -- el cliente de boto3 si es seguro compartirlo entre hilos
    (a diferencia de un Resource), y crear uno nuevo por cada foto de una
    jornada de cientos de unidades es puro overhead de mas."""
    cliente = cliente or _cliente_s3()
    respuesta = cliente.get_object(Bucket=settings.STORAGE_BUCKET_NAME, Key=key)
    return respuesta["Body"].read()


def subir_bytes(datos: bytes, key: str, content_type: str) -> None:
    """Como subir_evidencia, pero para bytes ya armados en memoria (ej. el
    .pptx de una presentacion generada) en vez de un archivo subido por el
    usuario."""
    import io

    cliente = _cliente_s3()
    cliente.upload_fileobj(
        io.BytesIO(datos), settings.STORAGE_BUCKET_NAME, key,
        ExtraArgs={"ContentType": content_type},
    )
