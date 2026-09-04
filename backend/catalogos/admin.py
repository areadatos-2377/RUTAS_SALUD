from django.contrib import admin

from .models import Entidad, UnidadMedica


@admin.register(Entidad)
class EntidadAdmin(admin.ModelAdmin):
    list_display = ["nombre", "coordinador"]
    search_fields = ["nombre"]


@admin.register(UnidadMedica)
class UnidadMedicaAdmin(admin.ModelAdmin):
    list_display = [
        "clues",
        "nombre",
        "entidad",
        "nivel_atencion",
        "tipo_unidad_medica",
        "quien_recibe",
        "telefono",
        "correo",
        "origen",
    ]
    list_filter = ["entidad", "nivel_atencion", "origen", "tipo_unidad_medica"]
    search_fields = ["clues", "nombre"]
