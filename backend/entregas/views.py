from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from programacion.models import Jornada, ProgramacionVisita
from usuarios.models import Usuario
from usuarios.permissions import PuedeGestionarJornadas, PuedeGestionarProgramacion

from . import jobs, storage
from .models import Entrega, EvidenciaArchivo, PresentacionJob
from .serializers import (
    EntregaSerializer,
    EvidenciaArchivoConsultaSerializer,
    EvidenciaArchivoSerializer,
    PresentacionJobSerializer,
)


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
    a la vez, agrupadas por region al construir el .pptx.

    Antes armaba el .pptx dentro del mismo request POST y lo regresaba
    directo -- con jornadas de cientos de unidades (cientos de descargas a
    R2, una por una) eso tardaba mas que el timeout del worker de gunicorn y
    tumbaba la request con un 500 (visto en produccion con 595 unidades).
    Ahora el POST solo valida y lanza un PresentacionJob en segundo plano
    (ver entregas/jobs.py) y regresa de inmediato -- el frontend hace
    polling a PresentacionJobEstadoView hasta que quede "listo"."""

    permission_classes = [permissions.IsAuthenticated, PuedeGestionarJornadas]

    def post(self, request):
        try:
            jornada = Jornada.objects.get(pk=request.data.get("jornada_id"))
        except (Jornada.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Distribución no encontrada."}, status=400)

        items_crudos = request.data.get("fotos") or []
        if not items_crudos:
            return Response({"detail": "No se envió ninguna foto."}, status=400)

        # Se valida aqui (rapido, antes de lanzar el hilo) que cada item
        # traiga los 2 ids -- la resolucion real contra la base (que
        # confirma que la evidencia es de tipo foto y pertenece de verdad a
        # esa visita Y a esta jornada, para que no se puedan mezclar datos
        # de otra distribucion armando la peticion a mano) pasa a
        # entregas/jobs.py, que corre en el hilo en segundo plano.
        items = [
            {"visita_id": item.get("visita_id"), "evidencia_id": item.get("evidencia_id")}
            for item in items_crudos
            if item.get("visita_id") and item.get("evidencia_id")
        ]
        if not items:
            return Response({"detail": "No se envió ninguna foto válida."}, status=400)

        job = PresentacionJob.objects.create(
            jornada=jornada, creado_por=request.user, total_fotos=len(items),
        )
        jobs.lanzar_job(job.id, jornada.id, items)
        return Response(PresentacionJobSerializer(job).data, status=202)


class PresentacionJobEstadoView(APIView):
    """Para el polling del frontend mientras un PresentacionJob corre en
    segundo plano. Solo quien lo lanzo (o super_admin) puede consultarlo --
    no hay razon para que alguien vea el avance del job de otra persona."""

    permission_classes = [permissions.IsAuthenticated, PuedeGestionarJornadas]

    def get(self, request, pk=None):
        job = PresentacionJob.objects.filter(pk=pk).first()
        if job is None:
            return Response({"detail": "No encontrado."}, status=404)
        if job.creado_por_id != request.user.id and request.user.rol != Usuario.ROL_SUPER_ADMIN:
            return Response({"detail": "No tienes permiso para ver este job."}, status=403)

        datos = PresentacionJobSerializer(job).data
        if job.estado == PresentacionJob.ESTADO_LISTO:
            datos["url_descarga"] = storage.generar_url_descarga(
                job.archivo_key, expira_segundos=3600, nombre_archivo=job.nombre_archivo,
            )
        return Response(datos)
