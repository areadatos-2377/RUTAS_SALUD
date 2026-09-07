from django.http import HttpResponse
from django.utils.dateparse import parse_date
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from catalogos.models import Entidad
from entregas import storage
from entregas.fechas import formato_fecha_es
from programacion.models import Jornada
from usuarios.models import Usuario
from usuarios.permissions import PuedeGestionarJornadas, PuedeGestionarProgramacion

from . import checklist, presentacion
from .models import Evidencia
from .serializers import EvidenciaSerializer

# Picking & Packing solo admite foto y video (a diferencia de entregas, que
# tambien admite pdf/documento) -- el formato de la plantilla solo trae esos
# 2 slots por entidad (ver picking_packing/presentacion.py).
_EXTENSIONES_PERMITIDAS = {
    ext: tipo for ext, tipo in storage.EXTENSION_A_TIPO.items() if tipo in (Evidencia.TIPO_FOTO, Evidencia.TIPO_VIDEO)
}


class EvidenciaViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "delete", "head", "options"]
    queryset = Evidencia.objects.select_related("entidad", "jornada", "subido_por")
    serializer_class = EvidenciaSerializer
    permission_classes = [permissions.IsAuthenticated, PuedeGestionarProgramacion]

    def get_queryset(self):
        qs = super().get_queryset()
        usuario = self.request.user
        if usuario.rol == Usuario.ROL_USUARIO_ENTIDAD:
            qs = qs.filter(entidad=usuario.entidad)
        jornada_id = self.request.query_params.get("jornada")
        if jornada_id:
            qs = qs.filter(jornada_id=jornada_id)
        entidad_id = self.request.query_params.get("entidad")
        if entidad_id:
            qs = qs.filter(entidad_id=entidad_id)
        fecha = self.request.query_params.get("fecha")
        if fecha:
            qs = qs.filter(fecha=fecha)
        return qs

    def create(self, request, *args, **kwargs):
        usuario = request.user
        try:
            jornada = Jornada.objects.get(pk=request.data.get("jornada"))
        except (Jornada.DoesNotExist, ValueError, TypeError):
            return Response({"jornada": ["No existe."]}, status=400)

        entidad_id = request.data.get("entidad")
        try:
            entidad = Entidad.objects.get(pk=entidad_id)
        except (Entidad.DoesNotExist, ValueError, TypeError):
            return Response({"entidad": ["No existe."]}, status=400)

        if usuario.rol == Usuario.ROL_USUARIO_ENTIDAD and entidad_id and str(usuario.entidad_id) != str(entidad_id):
            return Response({"detail": "No puedes cargar evidencia de otra entidad."}, status=403)

        fecha = parse_date(request.data.get("fecha") or "")
        if fecha is None:
            return Response({"fecha": ["Este campo es requerido, formato AAAA-MM-DD."]}, status=400)
        if not (jornada.fecha_inicio <= fecha <= jornada.fecha_fin):
            return Response({
                "fecha": [f"Debe estar dentro del periodo de la distribución "
                          f"({jornada.fecha_inicio} al {jornada.fecha_fin})."],
            }, status=400)

        archivo = request.FILES.get("file")
        if archivo is None:
            return Response({"detail": "No se envió ningún archivo."}, status=400)

        ext = storage.extension(archivo.name)
        if ext not in _EXTENSIONES_PERMITIDAS:
            return Response({
                "detail": "Formato no permitido. Usa JPG, JPEG o PNG para la foto, MP4 o MOV para el video.",
            }, status=400)
        if archivo.size > storage.MAX_EVIDENCIA_BYTES:
            return Response({"detail": "El archivo excede el límite de 15MB."}, status=400)

        key = storage.construir_key_picking_packing(jornada, entidad, fecha, archivo.name)
        storage.subir_evidencia(archivo, key)
        evidencia = Evidencia.objects.create(
            jornada=jornada,
            entidad=entidad,
            fecha=fecha,
            tipo=_EXTENSIONES_PERMITIDAS[ext],
            ruta_almacen=key,
            nombre_original=archivo.name,
            subido_por=usuario,
        )
        return Response(EvidenciaSerializer(evidencia).data, status=201)

    def perform_destroy(self, instance):
        storage.eliminar_evidencia(instance.ruta_almacen)
        instance.delete()


class GenerarPresentacionView(APIView):
    """Arma la presentacion de evidencia de picking & packing de UN dia (ver
    picking_packing/presentacion.py) -- a diferencia de
    entregas.GenerarPresentacionView, aqui no se recibe una lista de fotos
    elegidas a mano: el cliente solo manda la jornada y la fecha, y el
    servidor resuelve solo, por cada entidad, la foto y el video mas
    recientes de ese dia (si los hay)."""

    permission_classes = [permissions.IsAuthenticated, PuedeGestionarJornadas]

    def post(self, request):
        try:
            jornada = Jornada.objects.get(pk=request.data.get("jornada_id"))
        except (Jornada.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Distribución no encontrada."}, status=400)

        fecha = parse_date(request.data.get("fecha") or "")
        if fecha is None:
            return Response({"fecha": ["Este campo es requerido, formato AAAA-MM-DD."]}, status=400)
        if not (jornada.fecha_inicio <= fecha <= jornada.fecha_fin):
            return Response({
                "fecha": [f"Debe estar dentro del periodo de la distribución "
                          f"({jornada.fecha_inicio} al {jornada.fecha_fin})."],
            }, status=400)

        # Se resuelve todo desde la base, no se confia en nada que mande el
        # cliente -- por cada (entidad, tipo) se toma la evidencia mas
        # reciente de ESE dia (Evidencia.Meta.ordering ya deja lo mas
        # reciente primero dentro de una misma fecha).
        evidencias_dia = (
            Evidencia.objects.filter(jornada_id=jornada.id, fecha=fecha)
            .select_related("entidad")
            .order_by("entidad_id", "tipo", "-creado_en")
        )
        por_entidad = {}
        for ev in evidencias_dia:
            item = por_entidad.setdefault(ev.entidad_id, {"entidad": ev.entidad, "foto": None, "video": None})
            if item[ev.tipo] is None:
                item[ev.tipo] = ev

        entidades = list(por_entidad.values())
        if not entidades:
            return Response({"detail": "No hay evidencia cargada para esa fecha."}, status=400)

        dia_texto = formato_fecha_es(fecha)
        buffer = presentacion.construir_presentacion(dia_texto, jornada.get_categoria_display(), entidades)

        respuesta = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
        nombre_archivo = f"picking_packing_{jornada.nombre}_{fecha.isoformat()}".replace(" ", "_") + ".pptx"
        respuesta["Content-Disposition"] = f'attachment; filename="{nombre_archivo}"'
        return respuesta


class GenerarChecklistView(APIView):
    """Arma el checklist en Excel de TODA la jornada -- a diferencia de la
    presentacion, no es de un dia puntual: una pestana por cada dia del
    periodo, cada una con lo que se llevaba subido hasta ahora (ver
    picking_packing/checklist.py)."""

    permission_classes = [permissions.IsAuthenticated, PuedeGestionarJornadas]

    def post(self, request):
        try:
            jornada = Jornada.objects.get(pk=request.data.get("jornada_id"))
        except (Jornada.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Distribución no encontrada."}, status=400)

        entidades = list(
            Entidad.objects.filter(unidades_medicas__visitas_programadas__jornada_id=jornada.id).distinct()
        )
        if not entidades:
            return Response({"detail": "Esta distribución no tiene entidades participando."}, status=400)

        evidencias = Evidencia.objects.filter(jornada_id=jornada.id).only("fecha", "entidad_id", "tipo")
        evidencia_por_dia = {}
        for ev in evidencias:
            marcas_dia = evidencia_por_dia.setdefault(ev.fecha, {})
            marcas_entidad = marcas_dia.setdefault(ev.entidad_id, {"foto": False, "video": False})
            marcas_entidad[ev.tipo] = True

        buffer = checklist.construir_checklist(jornada, entidades, evidencia_por_dia)

        respuesta = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        nombre_archivo = f"checklist_picking_packing_{jornada.nombre}".replace(" ", "_") + ".xlsx"
        respuesta["Content-Disposition"] = f'attachment; filename="{nombre_archivo}"'
        return respuesta
