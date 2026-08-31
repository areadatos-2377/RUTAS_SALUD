from rest_framework import serializers

from catalogos.models import Entidad
from usuarios.models import Usuario

from .models import Jornada, ProgramacionVisita, Ruta


class JornadaSerializer(serializers.ModelSerializer):
    # Para que el frontend pueda advertir antes de borrar una jornada con
    # datos ya capturados (en vez de un confirm() generico que no dice que
    # se va a perder).
    rutas_count = serializers.SerializerMethodField()
    visitas_count = serializers.SerializerMethodField()

    class Meta:
        model = Jornada
        fields = [
            "id",
            "nombre",
            "tipo",
            "categoria",
            "fecha_inicio",
            "fecha_fin",
            "estatus",
            "rutas_count",
            "visitas_count",
        ]

    def get_rutas_count(self, obj):
        return obj.rutas.count()

    def get_visitas_count(self, obj):
        # Las unidades se precargan TODAS (miles) al crear la jornada -- contar
        # esas filas crudas haria que la advertencia de borrado dijera "tiene
        # 10,136 unidades programadas" aunque nadie haya capturado nada de
        # verdad. Cuenta solo las que ya tienen algo capturado (ruta o fecha).
        return (
            ProgramacionVisita.objects.filter(jornada=obj)
            .exclude(ruta_numero="", fecha_distribucion_programada__isnull=True)
            .count()
        )


class RutaSerializer(serializers.ModelSerializer):
    jornada_nombre = serializers.CharField(source="jornada.nombre", read_only=True)
    jornada_categoria = serializers.CharField(source="jornada.categoria", read_only=True)
    entidad_nombre = serializers.CharField(source="entidad.nombre", read_only=True)
    # No requerido aqui: para usuario_entidad el viewset lo fuerza server-side en
    # perform_create y el frontend ni lo manda. Solo super_admin debe mandarlo
    # explicitamente (el viewset valida eso).
    entidad = serializers.PrimaryKeyRelatedField(queryset=Entidad.objects.all(), required=False)

    class Meta:
        model = Ruta
        fields = [
            "id",
            "jornada",
            "jornada_nombre",
            "jornada_categoria",
            "entidad",
            "entidad_nombre",
            "numero_o_nombre",
        ]


class ProgramacionVisitaSerializer(serializers.ModelSerializer):
    unidad_medica_nombre = serializers.CharField(source="unidad_medica.nombre", read_only=True)
    unidad_medica_entidad = serializers.IntegerField(
        source="unidad_medica.entidad_id", read_only=True
    )
    unidad_medica_entidad_nombre = serializers.CharField(
        source="unidad_medica.entidad.nombre", read_only=True
    )
    unidad_medica_municipio = serializers.CharField(
        source="unidad_medica.municipio", read_only=True
    )
    unidad_medica_nivel = serializers.CharField(
        source="unidad_medica.nivel_atencion", read_only=True
    )
    # Anotados en ProgramacionVisitaViewSet.get_queryset() (Exists subqueries
    # sobre EvidenciaArchivo) -- para pintar los marcadores de evidencia en la
    # tabla sin una consulta aparte por fila.
    tiene_evidencia_imagen = serializers.BooleanField(read_only=True)
    tiene_evidencia_documento = serializers.BooleanField(read_only=True)
    tiene_evidencia_video = serializers.BooleanField(read_only=True)

    class Meta:
        model = ProgramacionVisita
        fields = [
            "id",
            "jornada",
            "ruta",
            "ruta_numero",
            "unidad_medica",
            "unidad_medica_nombre",
            "unidad_medica_entidad",
            "unidad_medica_entidad_nombre",
            "unidad_medica_municipio",
            "unidad_medica_nivel",
            "fecha_distribucion_programada",
            "claves_a_desplazar",
            "piezas_medicamento",
            "piezas_material_curacion",
            "tipo_unidad_medica",
            "quien_recibe",
            "telefono",
            "correo",
            "bloqueada",
            "tiene_evidencia_imagen",
            "tiene_evidencia_documento",
            "tiene_evidencia_video",
        ]
        # tipo_unidad_medica viene del catalogo (UnidadMedica.tipo_unidad_medica)
        # al precargarse -- no debe poder editarse a mano y desincronizarse.
        read_only_fields = ["jornada", "ruta", "unidad_medica", "bloqueada", "tipo_unidad_medica"]

    def validate(self, attrs):
        request = self.context["request"]
        if self.instance is None:
            raise serializers.ValidationError(
                "Las unidades se precargan automáticamente al crear la distribución."
            )

        if (
            request.user.rol == Usuario.ROL_USUARIO_ENTIDAD
            and self.instance.unidad_medica.entidad_id != request.user.entidad_id
        ):
            raise serializers.ValidationError("No puedes programar sobre una ruta de otra entidad.")
        return attrs
