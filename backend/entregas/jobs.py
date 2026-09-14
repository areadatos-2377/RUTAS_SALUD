"""Ejecuta un PresentacionJob en un hilo en segundo plano -- ver
entregas/models.py:PresentacionJob para el por que (un POST sincrono con
cientos de fotos revienta el timeout del worker de gunicorn, se vio en
produccion con una jornada de 595 unidades).

Se usa threading.Thread en vez de un broker de jobs (Celery/RQ): no hay
Redis ni un proceso worker aparte desplegados, y agregar esa
infraestructura solo para esto seria desproporcionado -- generar una
presentacion es una accion manual, disparada por un admin, no un job de
alto volumen. Limitacion conocida y aceptada: si el proceso de gunicorn se
reinicia (deploy, restart) a medio job, ese job se queda "procesando" para
siempre -- el usuario puede simplemente volver a lanzarlo.
"""

import logging
import threading

from django.db import connection

from . import presentacion, storage
from .fechas import formato_fecha_es
from .models import EvidenciaArchivo, PresentacionJob

logger = logging.getLogger(__name__)


def lanzar_job(job_id, jornada_id, items):
    """items: lista de {"visita_id": int, "evidencia_id": int}, ya
    saneada (ambos ids presentes) por la vista -- la resolucion real
    contra la base pasa aqui. Arranca un hilo y regresa de inmediato; el
    avance se seguido via PresentacionJob (ver PresentacionJobEstadoView)."""
    hilo = threading.Thread(target=_ejecutar, args=(job_id, jornada_id, items), daemon=True)
    hilo.start()


def _ejecutar(job_id, jornada_id, items):
    try:
        job = PresentacionJob.objects.select_related("jornada").get(pk=job_id)
        _procesar(job, jornada_id, items)
    except Exception:
        logger.exception("Fallo inesperado ejecutando PresentacionJob id=%s", job_id)
        PresentacionJob.objects.filter(pk=job_id).update(
            estado=PresentacionJob.ESTADO_ERROR,
            error_mensaje="Ocurrió un error inesperado generando la presentación.",
        )
    finally:
        # Este hilo abre su propia conexion a la base (las conexiones de
        # Django son thread-local, no comparte la del request que lo lanzo)
        # -- cerrarla explicitamente, si no se queda viva hasta que el
        # proceso completo termine.
        connection.close()


def _procesar(job, jornada_id, items):
    job.estado = PresentacionJob.ESTADO_PROCESANDO
    job.save(update_fields=["estado", "actualizado_en"])

    fotos = []
    for item in items:
        # Mismo criterio de validez que tenia la vista sincrona original:
        # se resuelve la evidencia desde la base (no se confia en texto que
        # mando el cliente) y se exige que sea tipo foto y pertenezca de
        # verdad a esa visita Y a esta jornada.
        evidencia = EvidenciaArchivo.objects.select_related(
            "entrega__programacion_visita__unidad_medica__entidad",
        ).filter(
            pk=item["evidencia_id"],
            tipo="foto",
            entrega__programacion_visita_id=item["visita_id"],
            entrega__programacion_visita__jornada_id=jornada_id,
        ).first()
        if evidencia is None:
            continue
        fotos.append({"visita": evidencia.entrega.programacion_visita, "evidencia": evidencia})

    if not fotos:
        job.estado = PresentacionJob.ESTADO_ERROR
        job.error_mensaje = "Ninguna de las fotos enviadas es válida."
        job.save(update_fields=["estado", "error_mensaje", "actualizado_en"])
        return

    def on_progreso(procesadas, total):
        # No una escritura por cada foto -- con cientos de descargas
        # terminando casi al mismo tiempo (12 hilos en paralelo) eso son
        # muchos UPDATE de mas; se reporta cada 5 y siempre en la ultima.
        if procesadas == total or procesadas % 5 == 0:
            PresentacionJob.objects.filter(pk=job.id).update(fotos_procesadas=procesadas)

    dia_texto = formato_fecha_es(job.jornada.fecha_inicio)
    buffer = presentacion.construir_presentacion(
        dia_texto, job.jornada.get_categoria_display(), fotos, on_progreso=on_progreso,
    )

    nombre_archivo = f"evidencia_{job.jornada.nombre}".replace(" ", "_") + ".pptx"
    key = storage.construir_key_presentacion(job.jornada, nombre_archivo)
    storage.subir_bytes(
        buffer.getvalue(), key,
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )

    job.estado = PresentacionJob.ESTADO_LISTO
    job.archivo_key = key
    job.nombre_archivo = nombre_archivo
    job.fotos_procesadas = job.total_fotos
    job.save(update_fields=[
        "estado", "archivo_key", "nombre_archivo", "fotos_procesadas", "actualizado_en",
    ])
