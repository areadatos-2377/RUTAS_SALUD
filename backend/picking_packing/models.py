from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from catalogos.models import Entidad
from programacion.models import Jornada


class Evidencia(models.Model):
    """Evidencia fotografica/de video de picking-y-packing, por entidad y por
    dia -- NO por unidad medica (a diferencia de entregas.EvidenciaArchivo,
    que va ligada a una Entrega/ProgramacionVisita puntual). Una entidad
    puede subir varias veces en dias distintos de la misma jornada; la mas
    reciente de cada tipo (foto/video) para un dia dado es la que se usa al
    generar la presentacion (ver picking_packing/presentacion.py)."""

    TIPO_FOTO = "foto"
    TIPO_VIDEO = "video"
    TIPO_CHOICES = [
        (TIPO_FOTO, "Foto"),
        (TIPO_VIDEO, "Video"),
    ]

    jornada = models.ForeignKey(
        Jornada, on_delete=models.CASCADE, related_name="evidencias_picking_packing"
    )
    entidad = models.ForeignKey(
        Entidad, on_delete=models.PROTECT, related_name="evidencias_picking_packing"
    )
    # Elegida por quien sube el archivo (no la fecha de subida) -- debe caer
    # dentro de jornada.fecha_inicio..fecha_fin, validado en clean().
    fecha = models.DateField()
    tipo = models.CharField(max_length=10, choices=TIPO_CHOICES)
    # Mismo patron que entregas.EvidenciaArchivo.ruta_almacen: solo la key del
    # objeto en R2, nunca el archivo en la base (ver entregas/storage.py).
    ruta_almacen = models.CharField(max_length=500)
    nombre_original = models.CharField(max_length=255)
    subido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="evidencias_picking_packing"
    )
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "evidencia de picking & packing"
        verbose_name_plural = "evidencias de picking & packing"
        ordering = ["-fecha", "-creado_en"]

    def clean(self):
        super().clean()
        if self.jornada_id and self.fecha:
            if not (self.jornada.fecha_inicio <= self.fecha <= self.jornada.fecha_fin):
                raise ValidationError(
                    {"fecha": "La fecha debe estar dentro del periodo de la distribución "
                              f"({self.jornada.fecha_inicio} al {self.jornada.fecha_fin})."}
                )

    def __str__(self):
        return f"{self.get_tipo_display()} — {self.entidad} — {self.fecha}"
