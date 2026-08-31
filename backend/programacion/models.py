from django.core.exceptions import ValidationError
from django.db import models

from catalogos.models import Entidad, UnidadMedica


class Jornada(models.Model):
    TIPO_ORDINARIA = "ordinaria"
    TIPO_EXTRAORDINARIA = "extraordinaria"
    TIPO_EMERGENCIA = "emergencia"
    TIPO_CHOICES = [
        (TIPO_ORDINARIA, "Ordinaria"),
        (TIPO_EXTRAORDINARIA, "Extraordinaria"),
        (TIPO_EMERGENCIA, "Emergencia"),
    ]

    # Ciclo de vida completo aun sin definir con el area (ver blueprint-v01.md
    # seccion 9, pendiente #4). Estos 4 estatus son un punto de partida razonable,
    # no una decision cerrada.
    ESTATUS_PLANEADA = "planeada"
    ESTATUS_EN_CURSO = "en_curso"
    ESTATUS_CERRADA = "cerrada"
    ESTATUS_CANCELADA = "cancelada"
    ESTATUS_CHOICES = [
        (ESTATUS_PLANEADA, "Planeada"),
        (ESTATUS_EN_CURSO, "En curso"),
        (ESTATUS_CERRADA, "Cerrada"),
        (ESTATUS_CANCELADA, "Cancelada"),
    ]

    # Decision 2026-08-24: una jornada de distribucion es entera de UNA
    # categoria -- puede haber "sexta distribucion" de primer nivel Y otra
    # "sexta distribucion" de segundo y tercer nivel (combinados en una sola
    # categoria), como jornadas separadas con sus propias fechas. No se
    # mezclan rutas/visitas de categorias distintas dentro de una misma
    # jornada (validado en ProgramacionVisita.clean()).
    CATEGORIA_PRIMER_NIVEL = "primer_nivel"
    CATEGORIA_SEGUNDO_TERCER_NIVEL = "segundo_tercer_nivel"
    CATEGORIA_CHOICES = [
        (CATEGORIA_PRIMER_NIVEL, "Primer nivel"),
        (CATEGORIA_SEGUNDO_TERCER_NIVEL, "Segundo y tercer nivel"),
    ]
    # Que niveles de UnidadMedica.nivel_atencion son validos para cada categoria.
    NIVELES_POR_CATEGORIA = {
        CATEGORIA_PRIMER_NIVEL: {UnidadMedica.NIVEL_PRIMER},
        CATEGORIA_SEGUNDO_TERCER_NIVEL: {UnidadMedica.NIVEL_SEGUNDO, UnidadMedica.NIVEL_TERCER},
    }

    nombre = models.CharField(max_length=150)
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES)
    categoria = models.CharField(
        max_length=25, choices=CATEGORIA_CHOICES, default=CATEGORIA_PRIMER_NIVEL
    )
    fecha_inicio = models.DateField()
    fecha_fin = models.DateField()
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default=ESTATUS_PLANEADA)

    class Meta:
        # Solo texto visible (admin de Django) -- el modelo/tabla/API siguen
        # llamandose "jornada" por dentro, decision explicita para no arriesgar
        # una migracion de renombrado sin beneficio funcional.
        verbose_name = "distribución"
        verbose_name_plural = "distribuciones"
        ordering = ["-fecha_inicio"]

    def __str__(self):
        return f"{self.nombre} ({self.get_tipo_display()})"


class Ruta(models.Model):
    jornada = models.ForeignKey(Jornada, on_delete=models.CASCADE, related_name="rutas")
    entidad = models.ForeignKey(Entidad, on_delete=models.PROTECT, related_name="rutas")
    numero_o_nombre = models.CharField(max_length=50)

    class Meta:
        verbose_name = "ruta"
        verbose_name_plural = "rutas"
        ordering = ["jornada", "entidad", "numero_o_nombre"]

    def __str__(self):
        return f"{self.entidad} · Ruta {self.numero_o_nombre} ({self.jornada})"


class ProgramacionVisita(models.Model):
    jornada = models.ForeignKey(Jornada, on_delete=models.CASCADE, related_name="visitas")
    # Las unidades se precargan al crear la jornada. La ruta se captura despues
    # como un dato de la fila; este FK queda opcional para conservar las rutas
    # historicas ya registradas.
    ruta = models.ForeignKey(
        Ruta, on_delete=models.SET_NULL, related_name="visitas", null=True, blank=True
    )
    ruta_numero = models.CharField(max_length=50, blank=True)
    unidad_medica = models.ForeignKey(
        UnidadMedica, on_delete=models.PROTECT, related_name="visitas_programadas"
    )
    fecha_distribucion_programada = models.DateField(null=True, blank=True)
    claves_a_desplazar = models.PositiveIntegerField(default=0)
    piezas_medicamento = models.PositiveIntegerField(default=0)
    piezas_material_curacion = models.PositiveIntegerField(default=0)
    # Capturado por fila (puede diferir del catalogo de la unidad), igual que en
    # tools/captura-programacion/.
    tipo_unidad_medica = models.CharField(max_length=100, blank=True)
    quien_recibe = models.CharField(max_length=150, blank=True)
    telefono = models.CharField(max_length=20, blank=True)
    correo = models.EmailField(blank=True)
    # Granularidad de bloqueo sin definir del todo (blueprint-v01.md seccion 9,
    # pendiente #4 del diagrama ER) — por ahora es por fila; un bloqueo a nivel
    # Jornada completa quedaria como una operacion que setea este campo en lote.
    bloqueada = models.BooleanField(default=False)

    class Meta:
        verbose_name = "programación de visita"
        verbose_name_plural = "programaciones de visita"
        ordering = ["jornada", "unidad_medica"]
        constraints = [
            models.UniqueConstraint(
                fields=["jornada", "unidad_medica"],
                name="programacion_jornada_unidad_unica",
            )
        ]

    def clean(self):
        super().clean()
        # Regla de negocio confirmada: una unidad medica no puede aparecer en mas
        # de una ruta dentro de la misma jornada (blueprint-v01.md seccion 2.2).
        conflicto = (
            ProgramacionVisita.objects.filter(
                jornada_id=self.jornada_id,
                unidad_medica_id=self.unidad_medica_id,
            )
            .exclude(pk=self.pk)
            .exists()
        )
        if conflicto:
            raise ValidationError(
                "Esta unidad médica ya está programada en otra ruta de la misma distribución."
            )

        # Decision 2026-08-24: una jornada es de una sola categoria (primer
        # nivel, o segundo y tercer nivel) -- no se puede programar una unidad
        # cuyo nivel de atencion no corresponda a la categoria de la jornada.
        categoria = self.jornada.categoria
        niveles_validos = Jornada.NIVELES_POR_CATEGORIA[categoria]
        if self.unidad_medica.nivel_atencion not in niveles_validos:
            categoria_label = dict(Jornada.CATEGORIA_CHOICES)[categoria]
            raise ValidationError(
                f"Esta distribución es de categoría «{categoria_label}»; "
                f"«{self.unidad_medica}» es de {self.unidad_medica.nivel_atencion.lower()}."
            )

    def __str__(self):
        fecha = self.fecha_distribucion_programada or "pendiente"
        return f"{self.unidad_medica} — {fecha}"
