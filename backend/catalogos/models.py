from django.db import models


class Entidad(models.Model):
    nombre = models.CharField(max_length=100, unique=True)
    coordinador = models.CharField(max_length=150, blank=True)

    class Meta:
        verbose_name = "entidad"
        verbose_name_plural = "entidades"
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


class UnidadMedica(models.Model):
    ORIGEN_CATALOGO_MENSUAL = "catalogo_mensual"
    ORIGEN_MANUAL = "manual"
    ORIGEN_CHOICES = [
        (ORIGEN_CATALOGO_MENSUAL, "Catálogo mensual (CLUES_IMB.xlsx)"),
        (ORIGEN_MANUAL, "Capturado manualmente"),
    ]

    NIVEL_PRIMER = "PRIMER NIVEL"
    NIVEL_SEGUNDO = "SEGUNDO NIVEL"
    NIVEL_TERCER = "TERCER NIVEL"
    NIVEL_ATENCION_CHOICES = [
        (NIVEL_PRIMER, "Primer nivel"),
        (NIVEL_SEGUNDO, "Segundo nivel"),
        (NIVEL_TERCER, "Tercer nivel"),
    ]

    # CLUES como llave primaria (decisión 2026-08-24, ver blueprint/diagrama-er-v01.md).
    # El catálogo mensual no cubre todos los CLUES reales de programación, por lo que
    # esta tabla también admite altas manuales (origen=manual) para no bloquear la
    # captura cuando un CLUES no aparece en el catálogo oficial.
    clues = models.CharField(max_length=20, primary_key=True)
    nombre = models.CharField(max_length=200)
    entidad = models.ForeignKey(Entidad, on_delete=models.PROTECT, related_name="unidades_medicas")
    # 100, no 50: algunas tipologias del catalogo oficial no matchean ningun
    # patron de mapear_tipo_unidad_medica() y caen al nombre crudo del Excel
    # (ej. "CENTROS AVANZADOS DE ATENCION PRIMARIA A LA SALUD (CAAPS)", 57
    # caracteres) -- SQLite lo dejaba pasar silenciosamente, Postgres no.
    tipo_unidad_medica = models.CharField(max_length=100, blank=True)
    municipio = models.CharField(max_length=100, blank=True)
    quien_recibe = models.CharField(max_length=150, blank=True)
    telefono = models.CharField(max_length=100, blank=True)
    correo = models.CharField(max_length=150, blank=True)
    ruta_programacion = models.CharField(max_length=50, blank=True)
    fecha_programacion_referencia = models.DateField(null=True, blank=True)
    origen = models.CharField(max_length=20, choices=ORIGEN_CHOICES, default=ORIGEN_MANUAL)
    # Viene tal cual de la columna "NIVEL ATENCION" de CLUES_IMB.xlsx. El
    # catalogo mensual solo importa PRIMER/SEGUNDO/TERCER NIVEL (excluye
    # "NO APLICA" de la fuente) -- decision 2026-08-24, amplia el alcance
    # original de blueprint-v00 que solo consideraba primer nivel.
    nivel_atencion = models.CharField(
        max_length=20, choices=NIVEL_ATENCION_CHOICES, default=NIVEL_PRIMER
    )

    class Meta:
        verbose_name = "unidad médica"
        verbose_name_plural = "unidades médicas"
        ordering = ["entidad", "nombre"]

    def __str__(self):
        return f"{self.clues} — {self.nombre}"
