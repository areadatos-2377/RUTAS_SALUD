from rest_framework import serializers

from .models import Entrega, EvidenciaArchivo
from .storage import generar_url_descarga


class EvidenciaArchivoSerializer(serializers.ModelSerializer):
    # ruta_almacen (la key del objeto en R2) nunca se expone -- mismo patron
    # que legacy/referencia_almacenamiento_documentos.md: el frontend solo
    # ve una URL firmada que se genera al vuelo y expira sola.
    url_descarga = serializers.SerializerMethodField()

    class Meta:
        model = EvidenciaArchivo
        fields = ["id", "tipo", "nombre_original", "creado_en", "url_descarga"]
        read_only_fields = fields

    def get_url_descarga(self, obj):
        return generar_url_descarga(obj.ruta_almacen)


class EntregaSerializer(serializers.ModelSerializer):
    evidencias = EvidenciaArchivoSerializer(many=True, read_only=True)

    class Meta:
        model = Entrega
        fields = ["id", "programacion_visita", "entregado", "fecha_entrega", "evidencias"]
        read_only_fields = ["programacion_visita"]


class EvidenciaArchivoConsultaSerializer(serializers.ModelSerializer):
    """Para la pantalla de consulta (lista todo lo subido, con el contexto de
    a que distribucion/entidad/unidad pertenece) -- distinto del serializer
    del panel porque ahi el contexto ya se conoce (una sola unidad a la vez)."""

    url_descarga = serializers.SerializerMethodField()
    subido_por_nombre = serializers.CharField(source="subido_por.username", read_only=True)
    jornada_id = serializers.IntegerField(source="entrega.programacion_visita.jornada_id", read_only=True)
    jornada_nombre = serializers.CharField(source="entrega.programacion_visita.jornada.nombre", read_only=True)
    entidad_nombre = serializers.CharField(
        source="entrega.programacion_visita.unidad_medica.entidad.nombre", read_only=True
    )
    unidad_medica_clues = serializers.CharField(source="entrega.programacion_visita.unidad_medica_id", read_only=True)
    unidad_medica_nombre = serializers.CharField(
        source="entrega.programacion_visita.unidad_medica.nombre", read_only=True
    )
    entregado = serializers.BooleanField(source="entrega.entregado", read_only=True)
    fecha_entrega = serializers.DateField(source="entrega.fecha_entrega", read_only=True)

    class Meta:
        model = EvidenciaArchivo
        fields = [
            "id", "tipo", "nombre_original", "creado_en", "url_descarga", "subido_por_nombre",
            "jornada_id", "jornada_nombre", "entidad_nombre", "unidad_medica_clues",
            "unidad_medica_nombre", "entregado", "fecha_entrega",
        ]
        read_only_fields = fields

    def get_url_descarga(self, obj):
        return generar_url_descarga(obj.ruta_almacen)
