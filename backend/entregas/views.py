from django.http import HttpResponse
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from programacion.models import Jornada, ProgramacionVisita
from usuarios.models import Usuario
from usuarios.permissions import PuedeGestionarJornadas, PuedeGestionarProgramacion

from . import presentacion, storage
from .models import Entrega, EvidenciaArchivo
from .serializers import EntregaSerializer, EvidenciaArchivoConsultaSerializer, EvidenciaArchivoSerializer

_MESES_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _formato_fecha_es(fecha):
    return f"{fecha.day:02d} de {_MESES_ES[fecha.month - 1]} de {fecha.year}"


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
            return Response({
                "detail": "Formato no permitido. Usa JPG, JPEG o PNG para imágenes, "
                          "PDF, DOC o DOCX para documentos, o MP4 o MOV para video.",
            }, status=400)
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


class GenerarPresentacionView(APIView):
    """Arma la presentacion de evidencia con la plantilla real (ver
    entregas/presentacion.py). No es una accion de EntregaViewSet porque no
    opera sobre una sola Entrega -- recibe fotos de varias unidades/entidades
    a la vez, agrupadas por region al construir el .pptx."""

    permission_classes = [permissions.IsAuthenticated, PuedeGestionarJornadas]

    def post(self, request):
        try:
            jornada = Jornada.objects.get(pk=request.data.get("jornada_id"))
        except (Jornada.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Distribución no encontrada."}, status=400)

        items = request.data.get("fotos") or []
        if not items:
            return Response({"detail": "No se envió ninguna foto."}, status=400)

        fotos = []
        for item in items:
            # Se resuelve CLUES/nombre de unidad/entidad desde la base, no
            # se confia en texto que mande el cliente -- y se exige que la
            # evidencia sea de tipo foto y pertenezca de verdad a esa
            # visita Y a esta jornada, para que no se puedan mezclar datos
            # de otra distribucion armando la peticion a mano.
            evidencia = EvidenciaArchivo.objects.select_related(
                "entrega__programacion_visita__unidad_medica__entidad",
            ).filter(
                pk=item.get("evidencia_id"),
                tipo="foto",
                entrega__programacion_visita_id=item.get("visita_id"),
                entrega__programacion_visita__jornada_id=jornada.id,
            ).first()
            if evidencia is None:
                continue
            fotos.append({"visita": evidencia.entrega.programacion_visita, "evidencia": evidencia})

        if not fotos:
            return Response({"detail": "Ninguna de las fotos enviadas es válida."}, status=400)

        dia_texto = _formato_fecha_es(jornada.fecha_inicio)
        buffer = presentacion.construir_presentacion(dia_texto, jornada.get_categoria_display(), fotos)

        respuesta = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
        nombre_archivo = f"evidencia_{jornada.nombre}".replace(" ", "_") + ".pptx"
        respuesta["Content-Disposition"] = f'attachment; filename="{nombre_archivo}"'
        return respuesta
