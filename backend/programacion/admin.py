from django.contrib import admin

from .models import Jornada, ProgramacionVisita, Ruta


@admin.register(Jornada)
class JornadaAdmin(admin.ModelAdmin):
    list_display = ["nombre", "tipo", "categoria", "fecha_inicio", "fecha_fin", "estatus"]
    list_filter = ["categoria", "tipo", "estatus"]


@admin.register(Ruta)
class RutaAdmin(admin.ModelAdmin):
    list_display = ["jornada", "entidad", "numero_o_nombre"]
    list_filter = ["jornada", "entidad"]


@admin.register(ProgramacionVisita)
class ProgramacionVisitaAdmin(admin.ModelAdmin):
    list_display = [
        "unidad_medica",
        "jornada",
        "ruta_numero",
        "fecha_distribucion_programada",
        "piezas_medicamento",
        "piezas_material_curacion",
        "bloqueada",
    ]
    list_filter = ["jornada", "unidad_medica__entidad", "bloqueada"]
    search_fields = ["unidad_medica__clues", "unidad_medica__nombre"]
