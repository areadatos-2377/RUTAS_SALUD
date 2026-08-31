from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from programacion.models import ProgramacionVisita
from usuarios.models import Usuario
from usuarios.permissions import PuedeGestionarProgramacion

from . import storage
from .models import Entrega, EvidenciaArchivo
from .serializers import EntregaSerializer, EvidenciaArchivoConsultaSerializer, EvidenciaArchivoSerializer


class EntregaViewSet(viewsets.ModelViewSet):
    queryset = Entrega.objects.select_related(
        "programacion_visita__unidad_medica__entidad", "programacion_visita__jornada"
    ).prefetch_related("evidencias")
    serializer_class = EntregaSerializer
    permission_classes = [permissions.IsAuthenticated, PuedeGestionarProgramacion]

    def get_queryset(self):
        qs = super().get_queryset()
        usuario = self.request.user
        if usuario.rol == Usuario.ROL_USUARIO_ENTIDAD:
            qs = qs.filter(programacion_visita__unidad_medica__entidad=usuario.entidad)
        visita_id = self.request.query_params.get("programacion_visita")
        if visita_id:
            qs = qs.filter(programacion_visita_id=visita_id)
        return qs

    def create(self, request, *args, **kwargs):
        """No se crea una Entrega por cada unidad precargada -- solo la
        primera vez que alguien abre el panel de evidencia de una visita
        especifica (perezoso, no en bloque como la precarga de unidades)."""
        visita_id = request.data.get("programacion_visita")
        if not visita_id:
            return Response({"programacion_visita": ["Este campo es requerido."]}, status=400)
        try:
            visita = ProgramacionVisita.objects.select_related("unidad_medica").get(pk=visita_id)
        except ProgramacionVisita.DoesNotExist:
            return Response({"programacion_visita": ["No existe."]}, status=400)

        usuario = request.user
        if usuario.rol == Usuario.ROL_USUARIO_ENTIDAD and visita.unidad_medica.entidad_id != usuario.entidad_id:
            return Response({"detail": "No puedes gestionar la entrega de otra entidad."}, status=403)

        entrega, creada = Entrega.objects.get_or_create(
            programacion_visita=visita, defaults={"usuario": usuario}
        )
        status_code = status.HTTP_201_CREATED if creada else status.HTTP_200_OK
        return Response(EntregaSerializer(entrega).data, status=status_code)

    @action(detail=True, methods=["post"], url_path="evidencias")
    def subir_evidencia(self, request, pk=None):
        entrega = self.get_object()
        archivo = request.FILES.get("file")
        if archivo is None:
            return Response({"detail": "No se envió ningún archivo."}, status=400)

        ext = storage.extension(archivo.name)
        if ext not in storage.EXTENSION_A_TIPO:
            return Response({"detail": "Tipo de archivo no permitido."}, status=400)
        if archivo.size > storage.MAX_EVIDENCIA_BYTES:
            return Response({"detail": "El archivo excede el límite de 15MB."}, status=400)

        key = storage.construir_key(entrega, archivo.name)
        storage.subir_evidencia(archivo, key)
        evidencia = EvidenciaArchivo.objects.create(
            entrega=entrega,
            tipo=storage.EXTENSION_A_TIPO[ext],
            ruta_almacen=key,
            nombre_original=archivo.name,
            subido_por=request.user,
        )
        return Response(EvidenciaArchivoSerializer(evidencia).data, status=201)


class EvidenciaArchivoViewSet(viewsets.ModelViewSet):
    # Subir es exclusivamente via EntregaViewSet.subir_evidencia -- aqui se
    # consulta lo ya subido (pantalla de consulta, con filtros) y se borra.
    http_method_names = ["get", "delete", "head", "options"]
    queryset = EvidenciaArchivo.objects.select_related(
        "subido_por",
        "entrega__programacion_visita__jornada",
        "entrega__programacion_visita__unidad_medica__entidad",
    ).order_by("-creado_en")
    serializer_class = EvidenciaArchivoConsultaSerializer
    permission_classes = [permissions.IsAuthenticated, PuedeGestionarProgramacion]

    def get_queryset(self):
        qs = super().get_queryset()
        usuario = self.request.user
        # usuario_entidad solo ve lo de su propia entidad; admin_nacional y
        # super_admin ven todo lo subido, sin restriccion.
        if usuario.rol == Usuario.ROL_USUARIO_ENTIDAD:
            qs = qs.filter(entrega__programacion_visita__unidad_medica__entidad=usuario.entidad)
        jornada_id = self.request.query_params.get("jornada")
        if jornada_id:
            qs = qs.filter(entrega__programacion_visita__jornada_id=jornada_id)
        entidad_id = self.request.query_params.get("entidad")
        if entidad_id:
            qs = qs.filter(entrega__programacion_visita__unidad_medica__entidad_id=entidad_id)
        return qs

    def perform_destroy(self, instance):
        storage.eliminar_evidencia(instance.ruta_almacen)
        instance.delete()
