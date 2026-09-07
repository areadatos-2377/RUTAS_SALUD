from rest_framework import serializers

from entregas.storage import generar_url_descarga

from .models import Evidencia


class EvidenciaSerializer(serializers.ModelSerializer):
    # ruta_almacen (la key del objeto en R2) nunca se expone -- mismo patron
    # que entregas.EvidenciaArchivoSerializer: el frontend solo ve una URL
    # firmada que se genera al vuelo y expira sola.
    url_descarga = serializers.SerializerMethodField()
    entidad_nombre = serializers.CharField(source="entidad.nombre", read_only=True)
    subido_por_nombre = serializers.CharField(source="subido_por.username", read_only=True)

    class Meta:
        model = Evidencia
        fields = [
            "id", "jornada", "entidad", "entidad_nombre", "fecha", "tipo",
            "nombre_original", "creado_en", "url_descarga", "subido_por_nombre",
        ]
        read_only_fields = ["id", "entidad_nombre", "nombre_original", "creado_en", "url_descarga", "subido_por_nombre"]

    def get_url_descarga(self, obj):
        return generar_url_descarga(obj.ruta_almacen)
