from django.conf import settings
from django.db import models

from programacion.models import ProgramacionVisita


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
