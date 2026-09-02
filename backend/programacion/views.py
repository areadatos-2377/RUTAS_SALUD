from django.db import transaction
from django.db.models import Exists, OuterRef
from rest_framework import permissions, serializers, viewsets

from catalogos.models import UnidadMedica
from entregas.models import EvidenciaArchivo
from usuarios.models import Usuario
from usuarios.permissions import PuedeGestionarJornadas, PuedeGestionarProgramacion

from .models import Jornada, ProgramacionVisita, Ruta
from .serializers import JornadaSerializer, ProgramacionVisitaSerializer, RutaSerializer


class JornadaViewSet(viewsets.ModelViewSet):
    # Nacional: cualquier autenticado ve todas las jornadas, no se filtra por entidad.
    queryset = Jornada.objects.all()
    serializer_class = JornadaSerializer
    permission_classes = [permissions.IsAuthenticated, PuedeGestionarJornadas]

    @transaction.atomic
    def perform_create(self, serializer):
        jornada = serializer.save()
        niveles_validos = Jornada.NIVELES_POR_CATEGORIA[jornada.categoria]
        unidades = UnidadMedica.objects.filter(nivel_atencion__in=niveles_validos)
        ProgramacionVisita.objects.bulk_create(
            [
                ProgramacionVisita(
                    jornada=jornada,
                    unidad_medica=unidad,
                    tipo_unidad_medica=unidad.tipo_unidad_medica,
                )
                for unidad in unidades.iterator()
            ],
            batch_size=500,
        )


class RutaViewSet(viewsets.ModelViewSet):
    queryset = Ruta.objects.select_related("jornada", "entidad").all()
    serializer_class = RutaSerializer
    permission_classes = [permissions.IsAuthenticated, PuedeGestionarProgramacion]

    def get_queryset(self):
        qs = super().get_queryset()
        usuario = self.request.user
        if usuario.rol == Usuario.ROL_USUARIO_ENTIDAD:
            qs = qs.filter(entidad=usuario.entidad)
        jornada_id = self.request.query_params.get("jornada")
        if jornada_id:
            qs = qs.filter(jornada_id=jornada_id)
        return qs

    def perform_create(self, serializer):
        usuario = self.request.user
        if usuario.rol == Usuario.ROL_USUARIO_ENTIDAD:
            # Nunca confiar en el entidad que mande el cliente: se fuerza la propia.
            serializer.save(entidad=usuario.entidad)
        else:
            if "entidad" not in serializer.validated_data:
                raise serializers.ValidationError({"entidad": "Este campo es requerido."})
            serializer.save()

class ProgramacionVisitaViewSet(viewsets.ModelViewSet):
    queryset = (
        ProgramacionVisita.objects.select_related("jornada", "ruta", "unidad_medica__entidad")
        .annotate(
            tiene_evidencia_imagen=Exists(
                EvidenciaArchivo.objects.filter(
                    entrega__programacion_visita=OuterRef("pk"), tipo="foto"
                )
            ),
            tiene_evidencia_documento=Exists(
                EvidenciaArchivo.objects.filter(
                    entrega__programacion_visita=OuterRef("pk"), tipo__in=["pdf", "documento"]
                )
            ),
            tiene_evidencia_video=Exists(
                EvidenciaArchivo.objects.filter(
                    entrega__programacion_visita=OuterRef("pk"), tipo="video"
                )
            ),
        )
        .all()
    )
    serializer_class = ProgramacionVisitaSerializer
    permission_classes = [permissions.IsAuthenticated, PuedeGestionarProgramacion]
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        usuario = self.request.user
        if usuario.rol == Usuario.ROL_USUARIO_ENTIDAD:
            qs = qs.filter(unidad_medica__entidad=usuario.entidad)
        entidad_id = self.request.query_params.get("entidad")
        if entidad_id:
            qs = qs.filter(unidad_medica__entidad_id=entidad_id)
        # Para "Generar presentacion": elegir la primera foto de cada unidad
        # con imagen en TODA la distribucion (no solo la entidad que se esta
        # viendo) sin traer las miles de filas de precarga sin nada
        # capturado -- filtra en la base con la misma anotacion Exists de
        # arriba, no en Python despues de traer todo.
        if self.request.query_params.get("con_evidencia_imagen"):
            qs = qs.filter(tiene_evidencia_imagen=True)
        ruta_id = self.request.query_params.get("ruta")
        if ruta_id:
            qs = qs.filter(ruta_id=ruta_id)
        jornada_id = self.request.query_params.get("jornada")
        if jornada_id:
            qs = qs.filter(jornada_id=jornada_id)
        return qs
