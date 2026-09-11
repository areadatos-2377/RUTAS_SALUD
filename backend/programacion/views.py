from django.db import transaction
from collections import defaultdict

from django.db.models import Exists, Min, OuterRef
from django.utils.dateparse import parse_date
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from catalogos.models import UnidadMedica
from entregas.models import Entrega, EvidenciaArchivo
from picking_packing.models import Evidencia as EvidenciaPicking
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

    @action(detail=True, methods=["get"], url_path="monitoreo")
    def monitoreo(self, request, pk=None):
        jornada = self.get_object()
        visitas_base = (
            ProgramacionVisita.objects.filter(jornada=jornada)
            .select_related("unidad_medica__entidad", "entrega")
            .prefetch_related("entrega__evidencias")
            .order_by("fecha_distribucion_programada", "unidad_medica__nombre")
        )
        if request.user.rol == Usuario.ROL_USUARIO_ENTIDAD:
            visitas_base = visitas_base.filter(unidad_medica__entidad=request.user.entidad)

        entidades_disponibles = list(
            visitas_base.values(
                "unidad_medica__entidad_id",
                "unidad_medica__entidad__nombre",
            )
            .distinct()
            .order_by("unidad_medica__entidad__nombre")
        )
        entidad_solicitada = request.query_params.get("entidad")
        visitas = visitas_base
        if entidad_solicitada:
            if (
                request.user.rol == Usuario.ROL_USUARIO_ENTIDAD
                and str(request.user.entidad_id) != entidad_solicitada
            ):
                return Response({"detail": "No puedes consultar otra entidad."}, status=403)
            visitas = visitas.filter(unidad_medica__entidad_id=entidad_solicitada)

        resumen = {
            "registros": 0,
            "programadas": 0,
            "capturadas": 0,
            "pendientes_captura": 0,
            "atendidas": 0,
            "pendientes": 0,
            "por_programar": 0,
            "entidades": set(),
            "claves": 0,
            "piezas_medicamento": 0,
            "piezas_material_curacion": 0,
            "evidencia_foto": 0,
            "evidencia_nota": 0,
            "evidencia_video": 0,
        }
        por_entidad = defaultdict(lambda: {
            "registros": 0,
            "programadas": 0,
            "capturadas": 0,
            "pendientes_captura": 0,
            "atendidas": 0,
            "por_programar": 0,
            "claves": 0,
            "piezas_medicamento": 0,
            "piezas_material_curacion": 0,
            "evidencia_foto": 0,
            "evidencia_nota": 0,
            "evidencia_video": 0,
        })
        por_fecha = defaultdict(lambda: {
            "programadas": 0,
            "atendidas": 0,
            "rutas": set(),
            "claves": 0,
            "piezas_medicamento": 0,
            "piezas_material_curacion": 0,
        })
        lista_clues = []

        for visita in visitas:
            entidad = visita.unidad_medica.entidad
            entidad_datos = por_entidad[(entidad.id, entidad.nombre)]
            fecha = (
                visita.fecha_distribucion_programada.isoformat()
                if visita.fecha_distribucion_programada else None
            )
            try:
                entrega = visita.entrega
            except Entrega.DoesNotExist:
                entrega = None
            entregado = bool(entrega and entrega.entregado)
            tipos_evidencia = {evidencia.tipo for evidencia in entrega.evidencias.all()} if entrega else set()
            tiene_foto = EvidenciaArchivo.TIPO_FOTO in tipos_evidencia
            tiene_nota = bool({EvidenciaArchivo.TIPO_PDF, EvidenciaArchivo.TIPO_DOCUMENTO} & tipos_evidencia)
            tiene_video = EvidenciaArchivo.TIPO_VIDEO in tipos_evidencia
            programada = fecha is not None
            capturada = (
                visita.claves_a_desplazar > 0
                and visita.piezas_medicamento > 0
                and visita.piezas_material_curacion > 0
            )

            resumen["registros"] += 1
            resumen["programadas"] += int(programada)
            resumen["capturadas"] += int(capturada)
            resumen["pendientes_captura"] += int(not capturada)
            resumen["atendidas"] += int(entregado)
            resumen["por_programar"] += int(not programada)
            resumen["entidades"].add(entidad.id)
            resumen["claves"] += visita.claves_a_desplazar
            resumen["piezas_medicamento"] += visita.piezas_medicamento
            resumen["piezas_material_curacion"] += visita.piezas_material_curacion
            resumen["evidencia_foto"] += int(tiene_foto)
            resumen["evidencia_nota"] += int(tiene_nota)
            resumen["evidencia_video"] += int(tiene_video)

            entidad_datos["registros"] += 1
            entidad_datos["programadas"] += int(programada)
            entidad_datos["capturadas"] += int(capturada)
            entidad_datos["pendientes_captura"] += int(not capturada)
            entidad_datos["atendidas"] += int(entregado)
            entidad_datos["por_programar"] += int(not programada)
            entidad_datos["claves"] += visita.claves_a_desplazar
            entidad_datos["piezas_medicamento"] += visita.piezas_medicamento
            entidad_datos["piezas_material_curacion"] += visita.piezas_material_curacion
            entidad_datos["evidencia_foto"] += int(tiene_foto)
            entidad_datos["evidencia_nota"] += int(tiene_nota)
            entidad_datos["evidencia_video"] += int(tiene_video)

            if programada:
                por_fecha[fecha]["programadas"] += 1
                por_fecha[fecha]["atendidas"] += int(entregado)
                if visita.ruta_numero:
                    por_fecha[fecha]["rutas"].add(visita.ruta_numero)
                por_fecha[fecha]["claves"] += visita.claves_a_desplazar
                por_fecha[fecha]["piezas_medicamento"] += visita.piezas_medicamento
                por_fecha[fecha]["piezas_material_curacion"] += visita.piezas_material_curacion

            lista_clues.append({
                "id": visita.id,
                "clues": visita.unidad_medica_id,
                "unidad": visita.unidad_medica.nombre,
                "entidad": entidad.nombre,
                "municipio": visita.unidad_medica.municipio,
                "tipo_unidad_medica": visita.tipo_unidad_medica,
                "quien_recibe": visita.quien_recibe,
                "telefono": visita.telefono,
                "correo": visita.correo,
                "ruta": visita.ruta_numero,
                "fecha_programada": fecha,
                "claves": visita.claves_a_desplazar,
                "piezas_medicamento": visita.piezas_medicamento,
                "piezas_material_curacion": visita.piezas_material_curacion,
                "entregado": entregado,
                "tiene_evidencia": bool(tipos_evidencia),
                "evidencia_foto": tiene_foto,
                "evidencia_video": tiene_video,
                "evidencia_nota": tiene_nota,
                "evidencia_completa": tiene_foto and tiene_video and tiene_nota,
                "evidencia_avance": round(
                    (int(tiene_foto) + int(tiene_video) + int(tiene_nota)) * 100 / 3,
                    1,
                ),
            })

        resumen["pendientes"] = resumen["registros"] - resumen["atendidas"]
        total_entidades = len(resumen["entidades"])
        resumen["entidades"] = total_entidades
        resumen["captura_porcentaje"] = round(
            resumen["capturadas"] * 100 / resumen["registros"], 1
        ) if resumen["registros"] else 0
        resumen["pendiente_captura_porcentaje"] = round(
            resumen["pendientes_captura"] * 100 / resumen["registros"], 1
        ) if resumen["registros"] else 0
        resumen["avance_porcentaje"] = round(
            resumen["atendidas"] * 100 / resumen["registros"], 1
        ) if resumen["registros"] else 0

        evidencias_picking = EvidenciaPicking.objects.filter(jornada=jornada)
        if request.user.rol == Usuario.ROL_USUARIO_ENTIDAD:
            evidencias_picking = evidencias_picking.filter(entidad=request.user.entidad)
        if entidad_solicitada:
            evidencias_picking = evidencias_picking.filter(entidad_id=entidad_solicitada)
        picking_por_entidad = defaultdict(lambda: {"foto": 0, "video": 0, "fechas": set()})
        picking_por_dia = defaultdict(
            lambda: defaultdict(lambda: {"foto": False, "video": False})
        )
        fechas_picking = set()
        for evidencia in evidencias_picking.values("entidad_id", "tipo", "fecha").distinct():
            picking_por_entidad[evidencia["entidad_id"]][evidencia["tipo"]] += 1
            picking_por_entidad[evidencia["entidad_id"]]["fechas"].add(evidencia["fecha"])
            picking_por_dia[evidencia["entidad_id"]][evidencia["fecha"]][evidencia["tipo"]] = True
            fechas_picking.add(evidencia["fecha"])

        entidades = []
        dias_jornada = (jornada.fecha_fin - jornada.fecha_inicio).days + 1
        for (entidad_id, nombre), datos in sorted(por_entidad.items(), key=lambda item: item[0][1]):
            datos["pendientes"] = datos["registros"] - datos["atendidas"]
            datos["captura_porcentaje"] = round(
                datos["capturadas"] * 100 / datos["registros"], 1
            ) if datos["registros"] else 0
            datos["pendiente_captura_porcentaje"] = round(
                datos["pendientes_captura"] * 100 / datos["registros"], 1
            ) if datos["registros"] else 0
            datos["avance_porcentaje"] = round(
                datos["atendidas"] * 100 / datos["registros"], 1
            ) if datos["registros"] else 0
            entidades.append({
                "id": entidad_id,
                "entidad": nombre,
                **datos,
                "picking_foto": picking_por_entidad[entidad_id][EvidenciaPicking.TIPO_FOTO],
                "picking_video": picking_por_entidad[entidad_id][EvidenciaPicking.TIPO_VIDEO],
                "picking_dias_evidencia": len(picking_por_entidad[entidad_id]["fechas"]),
                "picking_avance_porcentaje": round(
                    len(picking_por_entidad[entidad_id]["fechas"]) * 100 / dias_jornada,
                    1,
                ) if dias_jornada else 0,
                "picking_por_dia": [
                    {
                        "fecha": fecha.isoformat(),
                        **marcas,
                    }
                    for fecha, marcas in sorted(picking_por_dia[entidad_id].items())
                ],
            })

        fechas = [
            {
                "fecha": fecha,
                "clues": datos["programadas"],
                "rutas": len(datos["rutas"]),
                "claves": datos["claves"],
                "piezas_medicamento": datos["piezas_medicamento"],
                "piezas_material_curacion": datos["piezas_material_curacion"],
                "programadas": datos["programadas"],
                "atendidas": datos["atendidas"],
                "avance_porcentaje": round(datos["atendidas"] * 100 / datos["programadas"], 1),
            }
            for fecha, datos in sorted(por_fecha.items())
        ]

        return Response({
            "jornada": JornadaSerializer(jornada).data,
            "filtros": {
                "entidad": entidad_solicitada or "",
                "entidades": [
                    {
                        "id": item["unidad_medica__entidad_id"],
                        "nombre": item["unidad_medica__entidad__nombre"],
                    }
                    for item in entidades_disponibles
                ],
            },
            "resumen": resumen,
            "entidades": entidades,
            "fechas": fechas,
            "picking": {
                "fotos": sum(datos[EvidenciaPicking.TIPO_FOTO] for datos in picking_por_entidad.values()),
                "videos": sum(datos[EvidenciaPicking.TIPO_VIDEO] for datos in picking_por_entidad.values()),
                "dias_evidencia": len(fechas_picking),
                "avance_porcentaje": round(len(fechas_picking) * 100 / dias_jornada, 1)
                if dias_jornada else 0,
            },
            "lista_clues": lista_clues,
        })


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
            entregado=Exists(
                Entrega.objects.filter(
                    programacion_visita=OuterRef("pk"), entregado=True
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
