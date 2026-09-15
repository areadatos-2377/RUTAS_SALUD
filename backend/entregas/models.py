from django.conf import settings
from django.db import models

from programacion.models import Jornada, ProgramacionVisita


class Entrega(models.Model):
    # Relacion 1 a 1: no hay entregas parciales, cada unidad se marca una sola vez
    # por jornada (blueprint-v01.md seccion 2.4).
    programacion_visita = models.OneToOneField(
        ProgramacionVisita, on_delete=models.CASCADE, related_name="entrega"
    )
    entregado = models.BooleanField(default=False)
    fecha_entrega = models.DateField(null=True, blank=True)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="entregas_capturadas"
    )

    class Meta:
        verbose_name = "entrega"
        verbose_name_plural = "entregas"
        ordering = ["-fecha_entrega"]

    def __str__(self):
        estado = "entregado" if self.entregado else "no entregado"
        return f"{self.programacion_visita} — {estado}"


class EvidenciaArchivo(models.Model):
    TIPO_FOTO = "foto"
    TIPO_VIDEO = "video"
    TIPO_PDF = "pdf"
    TIPO_DOCUMENTO = "documento"
    TIPO_CHOICES = [
        (TIPO_FOTO, "Foto"),
        (TIPO_VIDEO, "Video"),
        (TIPO_PDF, "PDF"),
        (TIPO_DOCUMENTO, "Documento"),
    ]

    entrega = models.ForeignKey(Entrega, on_delete=models.CASCADE, related_name="evidencias")
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES)
    # Almacenamiento: Cloudflare R2 (compatible S3), decidido 2026-08-28
    # (blueprint-v01.md seccion 9, pendiente #3 -- resuelto). Solo se guarda
    # la key del objeto, nunca el archivo en la base ni en disco del
    # contenedor (Railway lo borra en cada deploy) -- ver entregas/storage.py.
    ruta_almacen = models.CharField(max_length=500)
    nombre_original = models.CharField(max_length=255)
    subido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="evidencias_subidas"
    )
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "archivo de evidencia"
        verbose_name_plural = "archivos de evidencia"
        ordering = ["-creado_en"]

    def __str__(self):
        return f"{self.get_tipo_display()} — {self.entrega}"


class PresentacionJob(models.Model):
    """Generar la presentacion de evidencia puede implicar cientos de
    descargas a R2 (una jornada grande) -- eso ya no cabe en el ciclo
    sincrono de una request HTTP (se probo: revienta el WORKER TIMEOUT de
    gunicorn). Este modelo trackea el avance de una corrida en segundo
    plano (ver entregas/jobs.py) para que el frontend pueda hacer polling
    en vez de esperar la respuesta de un solo POST larguisimo."""

    ESTADO_PENDIENTE = "pendiente"
    ESTADO_PROCESANDO = "procesando"
    ESTADO_LISTO = "listo"
    ESTADO_ERROR = "error"
    ESTADO_CHOICES = [
        (ESTADO_PENDIENTE, "Pendiente"),
        (ESTADO_PROCESANDO, "Procesando"),
        (ESTADO_LISTO, "Listo"),
        (ESTADO_ERROR, "Error"),
    ]

    jornada = models.ForeignKey(Jornada, on_delete=models.CASCADE, related_name="presentacion_jobs")
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="presentacion_jobs"
    )
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default=ESTADO_PENDIENTE)
    total_fotos = models.PositiveIntegerField(default=0)
    fotos_procesadas = models.PositiveIntegerField(default=0)
    # Key en R2 del .pptx ya armado (solo una vez estado == listo) -- el
    # archivo no se guarda en el contenedor, Railway lo borra en cada deploy.
    archivo_key = models.CharField(max_length=500, blank=True)
    nombre_archivo = models.CharField(max_length=255, blank=True)
    error_mensaje = models.TextField(blank=True)
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "job de presentación"
        verbose_name_plural = "jobs de presentación"
        ordering = ["-creado_en"]

    def __str__(self):
        return f"Presentación {self.jornada} — {self.estado} ({self.fotos_procesadas}/{self.total_fotos})"


class NotificacionEvidencia(models.Model):
    """Nacional/super_admin marca una evidencia (foto/documento/video)
    subida por un usuario_entidad como "tiene un problema" y deja un
    comentario -- esto le avisa al usuario_entidad de esa entidad (en la
    pestana Notificaciones) hasta que alguno marque que ya corrigio, y le
    sigue avisando a quien la creo hasta que el mismo la marque lista
    (2 estados independientes, ver plan 2026-09-15-notificaciones-evidencia).
    Sin campo "estado" separado -- se deriva de corregido_en/resuelto_en,
    para que nunca puedan desincronizarse entre si."""

    visita = models.ForeignKey(
        ProgramacionVisita, on_delete=models.CASCADE, related_name="notificaciones_evidencia"
    )
    # Nullable + SET_NULL a proposito: si el usuario_entidad borra el
    # archivo malo al corregirlo, la notificacion debe sobrevivir (si no,
    # se cerraria sola sin que quien la creo alcance a revisar la
    # correccion). tipo_evidencia/nombre_archivo_original quedan copiados
    # aparte para poder mostrar de que trataba aunque el archivo ya no este.
    evidencia = models.ForeignKey(
        EvidenciaArchivo, on_delete=models.SET_NULL, null=True, related_name="notificaciones"
    )
    tipo_evidencia = models.CharField(max_length=20, choices=EvidenciaArchivo.TIPO_CHOICES)
    nombre_archivo_original = models.CharField(max_length=255)

    comentario = models.TextField()
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="notificaciones_creadas"
    )
    creado_en = models.DateTimeField(auto_now_add=True)

    # Se pone cuando un usuario_entidad de la entidad indica que ya
    # corrigio (o elimino) el archivo marcado -- un solo boton, sin
    # distinguir cual de las 2 cosas hizo (mismo mensaje para quien creo la
    # notificacion en cualquier caso: "ya puedes revisar").
    corregido_en = models.DateTimeField(null=True, blank=True)
    corregido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="notificaciones_corregidas",
    )

    resuelto_en = models.DateTimeField(null=True, blank=True)
    resuelto_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="notificaciones_resueltas",
    )

    class Meta:
        verbose_name = "notificación de evidencia"
        verbose_name_plural = "notificaciones de evidencia"
        ordering = ["-creado_en"]

    def __str__(self):
        return f"{self.get_tipo_evidencia_display()} {self.nombre_archivo_original} — {self.visita}"
