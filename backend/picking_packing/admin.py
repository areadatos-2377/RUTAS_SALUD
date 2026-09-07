from django.contrib import admin

from .models import Evidencia


@admin.register(Evidencia)
class EvidenciaAdmin(admin.ModelAdmin):
    list_display = ["entidad", "jornada", "fecha", "tipo", "subido_por", "creado_en"]
    list_filter = ["tipo", "jornada"]
