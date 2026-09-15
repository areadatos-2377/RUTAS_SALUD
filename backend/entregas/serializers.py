from rest_framework import serializers

from .models import Entrega, EvidenciaArchivo, NotificacionEvidencia, PresentacionJob
from .storage import generar_url_descarga


class EvidenciaArchivoSerializer(serializers.ModelSerializer):
    # ruta_almacen (la key del objeto en R2) nunca se expone -- mismo patron
    # que legacy/referencia_almacenamiento_documentos.md: el frontend solo
    # ve una URL firmada que se genera al vuelo y expira sola.
    url_descarga = serializers.SerializerMethodField()
    # Para que EvidenciaPanel sepa si mostrar "Marcar problema" o ya hay una
    # notificacion sin resolver sobre este archivo (evita duplicados, ver
    # NotificacionEvidenciaViewSet.create).
    tiene_notificacion_abierta = serializers.SerializerMethodField()

    class Meta:
        model = EvidenciaArchivo
        fields = [
            "id", "tipo", "nombre_original", "creado_en", "url_descarga",
            "tiene_notificacion_abierta",
        ]
        read_only_fields = fields

    def get_url_descarga(self, obj):
        return generar_url_descarga(obj.ruta_almacen)

    def get_tiene_notificacion_abierta(self, obj):
        return obj.notificaciones.filter(resuelto_en__isnull=True).exists()


class PresentacionJobSerializer(serializers.ModelSerializer):
    # url_descarga NO va aqui -- generarla implica una llamada a R2 (firmar
    # la URL), y este serializer se usa tambien justo al crear el job
    # (estado "pendiente", archivo_key todavia vacio). La vista la agrega a
    # mano solo cuando estado == "listo" (ver PresentacionJobEstadoView).
    class Meta:
        model = PresentacionJob
        fields = ["id", "estado", "total_fotos", "fotos_procesadas", "error_mensaje"]
        read_only_fields = fields


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


class NotificacionEvidenciaSerializer(serializers.ModelSerializer):
    evidencia_url_descarga = serializers.SerializerMethodField()
    creado_por_nombre = serializers.CharField(source="creado_por.username", read_only=True)
    corregido_por_nombre = serializers.CharField(source="corregido_por.username", read_only=True)
    resuelto_por_nombre = serializers.CharField(source="resuelto_por.username", read_only=True)
    unidad_medica = serializers.CharField(source="visita.unidad_medica_id", read_only=True)
    unidad_medica_nombre = serializers.CharField(source="visita.unidad_medica.nombre", read_only=True)
    entidad_nombre = serializers.CharField(source="visita.unidad_medica.entidad.nombre", read_only=True)
    jornada_id = serializers.IntegerField(source="visita.jornada_id", read_only=True)
    jornada_nombre = serializers.CharField(source="visita.jornada.nombre", read_only=True)

    class Meta:
        model = NotificacionEvidencia
        fields = [
            "id", "comentario", "tipo_evidencia", "nombre_archivo_original", "evidencia_url_descarga",
            "creado_por_nombre", "creado_en", "corregido_en", "corregido_por_nombre",
            "resuelto_en", "resuelto_por_nombre",
            "unidad_medica", "unidad_medica_nombre", "entidad_nombre", "jornada_id", "jornada_nombre",
        ]
        read_only_fields = fields

    def get_evidencia_url_descarga(self, obj):
        return generar_url_descarga(obj.evidencia.ruta_almacen) if obj.evidencia_id else None
