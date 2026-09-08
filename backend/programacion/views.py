from django.db import transaction
from django.db.models import Exists, Min, OuterRef
from django.utils.dateparse import parse_date
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from catalogos.models import UnidadMedica
from entregas.models import EvidenciaArchivo
from usuarios.models import Usuario
from usuarios.permissions import PuedeGestionarJornadas, PuedeGestionarProgramacion

from .models import Jornada, ProgramacionVisita, Ruta
from .serializers import JornadaSerializer, ProgramacionVisitaSerializer, RutaSerializer

# Mismos 8 campos que ProgramacionVisitaSerializer deja editables (el resto
# son read_only_fields: jornada, ruta, unidad_medica, bloqueada,
# tipo_unidad_medica) -- ver actualizar_masivo() en el viewset, mas abajo.
_CAMPOS_TEXTO_MASIVO = {"ruta_numero": 50, "quien_recibe": 150, "telefono": 100, "correo": 150}
_CAMPOS_ENTERO_MASIVO = {"claves_a_desplazar", "piezas_medicamento", "piezas_material_curacion"}
_CAMPO_FECHA_MASIVO = "fecha_distribucion_programada"


def fecha_programada_inicial(jornada, fecha_referencia, fecha_base):
    if fecha_referencia is None or fecha_base is None:
        return None
    fecha_programada = jornada.fecha_inicio + (fecha_referencia - fecha_base)
    return min(fecha_programada, jornada.fecha_fin)


def fecha_base_por_categoria(categoria):
    niveles = Jornada.NIVELES_POR_CATEGORIA[categoria]
    return UnidadMedica.objects.filter(nivel_atencion__in=niveles).aggregate(
        fecha=Min("fecha_programacion_referencia")
    )["fecha"]


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
        fecha_base = fecha_base_por_categoria(jornada.categoria)
        ProgramacionVisita.objects.bulk_create(
            [
                ProgramacionVisita(
                    jornada=jornada,
                    unidad_medica=unidad,
                    ruta_numero=unidad.ruta_programacion,
                    fecha_distribucion_programada=fecha_programada_inicial(
                        jornada,
                        unidad.fecha_programacion_referencia,
                        fecha_base,
                    ),
                    tipo_unidad_medica=unidad.tipo_unidad_medica,
                    quien_recibe=unidad.quien_recibe,
                    telefono=unidad.telefono,
                    correo=unidad.correo,
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
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

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

    @action(detail=False, methods=["post"], url_path="actualizar-masivo")
    def actualizar_masivo(self, request):
        """Cambia UN campo a VARIAS filas a la vez -- para cuando, con la
        tabla ya filtrada del lado del navegador (ej. una sola ruta), hay
        que corregir ese campo en todas las filas visibles de un jalon (ej.
        renombrar la ruta). El navegador ya resolvio que filas son -- aqui
        solo se valida que de verdad le pertenezcan a este usuario (nunca se
        confia en los ids que manda el cliente) y se aplica todo en una sola
        sentencia SQL (atomica por si misma, no hace falta transaction.atomic
        para un solo UPDATE)."""
        ids = request.data.get("ids")
        campo = request.data.get("campo")
        valor = request.data.get("valor")

        if not isinstance(ids, list) or not ids:
            return Response({"ids": ["Debe mandar al menos un id."]}, status=400)

        campos_permitidos = set(_CAMPOS_TEXTO_MASIVO) | _CAMPOS_ENTERO_MASIVO | {_CAMPO_FECHA_MASIVO}
        if campo not in campos_permitidos:
            return Response({"campo": ["Ese campo no se puede editar de forma masiva."]}, status=400)

        # get_queryset() ya filtra por rol (usuario_entidad solo ve lo de su
        # propia entidad) -- id__in sobre ESE queryset es lo que garantiza
        # que nadie edite filas de otra entidad mandando ids a mano.
        qs = self.get_queryset().filter(id__in=ids)
        jornadas_afectadas = set(qs.values_list("jornada_id", flat=True))
        if not jornadas_afectadas:
            return Response({"detail": "Ninguno de los ids es válido para tu usuario."}, status=400)

        if campo == _CAMPO_FECHA_MASIVO:
            valor_final = parse_date(valor) if valor else None
            if valor and valor_final is None:
                return Response({"valor": ["Fecha inválida."]}, status=400)
            if valor_final is not None:
                for jornada in Jornada.objects.filter(id__in=jornadas_afectadas):
                    if not (jornada.fecha_inicio <= valor_final <= jornada.fecha_fin):
                        return Response({
                            "valor": [
                                f"Debe estar entre {jornada.fecha_inicio} y {jornada.fecha_fin} "
                                f"(periodo de «{jornada.nombre}»)."
                            ],
                        }, status=400)
        elif campo in _CAMPOS_ENTERO_MASIVO:
            try:
                valor_final = int(valor)
            except (TypeError, ValueError):
                return Response({"valor": ["Debe ser un número entero."]}, status=400)
            if valor_final < 0:
                return Response({"valor": ["No puede ser negativo."]}, status=400)
        else:
            valor_final = (valor or "").strip()
            maximo = _CAMPOS_TEXTO_MASIVO[campo]
            if len(valor_final) > maximo:
                return Response({"valor": [f"Máximo {maximo} caracteres."]}, status=400)

        actualizados = qs.update(**{campo: valor_final})
        return Response({"actualizados": actualizados, "solicitados": len(ids)})
