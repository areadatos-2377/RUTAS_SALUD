from django.db import transaction
from collections import defaultdict

from django.db.models import Count, Exists, OuterRef, Q, Sum
from django.utils.dateparse import parse_date
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from catalogos.models import UnidadMedica
from entregas.models import Entrega, EvidenciaArchivo
from picking_packing.models import Evidencia as EvidenciaPicking
from usuarios.models import Usuario
from usuarios.permissions import (
    PuedeGestionarJornadas,
    PuedeGestionarProgramacion,
    PuedeVerMonitoreo,
)

from .models import Jornada, ProgramacionVisita, Ruta
from .serializers import (
    JornadaSerializer,
    ProgramacionVisitaSerializer,
    RutaSerializer,
    validar_ruta_numero,
    validar_telefono,
)

# Mismos 8 campos que ProgramacionVisitaSerializer deja editables (el resto
# son read_only_fields: jornada, ruta, unidad_medica, bloqueada,
# tipo_unidad_medica) -- ver actualizar_masivo() en el viewset, mas abajo.
_CAMPOS_TEXTO_MASIVO = {"ruta_numero": 50, "quien_recibe": 150, "telefono": 100, "correo": 150}
_CAMPOS_ENTERO_MASIVO = {"claves_a_desplazar", "piezas_medicamento", "piezas_material_curacion"}
_CAMPO_FECHA_MASIVO = "fecha_distribucion_programada"

# "Capturada" = los 3 campos numericos capturados a mano tienen algo > 0.
# Un solo Q reutilizado en monitoreo() y monitoreo_detalle() para que el
# criterio de "capturada" nunca se desincronice entre el resumen y el
# detalle.
_CAPTURADA_Q = Q(
    claves_a_desplazar__gt=0, piezas_medicamento__gt=0, piezas_material_curacion__gt=0
)


def _con_evidencia_anotada(queryset):
    """Mismos 4 nombres de anotacion que ProgramacionVisitaViewSet.queryset
    (tiene_evidencia_imagen/_documento/_video, entregado) -- via Exists(),
    para poder filtrar/contar/agrupar del lado de la base de datos sin
    traer ni un solo EvidenciaArchivo/Entrega a Python. Reutilizado por
    monitoreo() (resumen y desglose por entidad/fecha) y monitoreo_detalle()
    (lista paginada), para que las 3 vistas nunca puedan dar numeros
    distintos por calcular "tiene evidencia" de 2 formas diferentes."""
    return queryset.annotate(
        tiene_evidencia_imagen=Exists(
            EvidenciaArchivo.objects.filter(
                entrega__programacion_visita=OuterRef("pk"), tipo=EvidenciaArchivo.TIPO_FOTO
            )
        ),
        tiene_evidencia_documento=Exists(
            EvidenciaArchivo.objects.filter(
                entrega__programacion_visita=OuterRef("pk"),
                tipo__in=[EvidenciaArchivo.TIPO_PDF, EvidenciaArchivo.TIPO_DOCUMENTO],
            )
        ),
        tiene_evidencia_video=Exists(
            EvidenciaArchivo.objects.filter(
                entrega__programacion_visita=OuterRef("pk"), tipo=EvidenciaArchivo.TIPO_VIDEO
            )
        ),
        entregado=Exists(
            Entrega.objects.filter(programacion_visita=OuterRef("pk"), entregado=True)
        ),
    )


def _fila_monitoreo_detalle(visita):
    """Una fila de /monitoreo-detalle/ -- mismas llaves que traia cada
    elemento de lista_clues en la version vieja de monitoreo(), para que
    el frontend (MonitoreoPage.jsx) no tenga que cambiar como pinta cada
    fila, solo de donde las va pidiendo (paginadas)."""
    fecha = (
        visita.fecha_distribucion_programada.isoformat()
        if visita.fecha_distribucion_programada else None
    )
    tiene_foto = visita.tiene_evidencia_imagen
    tiene_nota = visita.tiene_evidencia_documento
    tiene_video = visita.tiene_evidencia_video
    return {
        "id": visita.id,
        "clues": visita.unidad_medica_id,
        "unidad": visita.unidad_medica.nombre,
        "entidad_id": visita.unidad_medica.entidad_id,
        "entidad": visita.unidad_medica.entidad.nombre,
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
        "entregado": visita.entregado,
        "tiene_evidencia": bool(tiene_foto or tiene_nota or tiene_video),
        "evidencia_foto": tiene_foto,
        "evidencia_video": tiene_video,
        "evidencia_nota": tiene_nota,
        "evidencia_completa": bool(tiene_foto and tiene_video and tiene_nota),
        "evidencia_avance": round(
            (int(tiene_foto) + int(tiene_video) + int(tiene_nota)) * 100 / 3, 1,
        ),
    }


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
                    ruta_numero=unidad.ruta_programacion,
                    fecha_distribucion_programada=None,
                    tipo_unidad_medica=unidad.tipo_unidad_medica,
                    quien_recibe=unidad.quien_recibe,
                    telefono=unidad.telefono,
                    correo=unidad.correo,
                )
                for unidad in unidades.iterator()
            ],
            batch_size=500,
        )

    @action(
        detail=True,
        methods=["get"],
        url_path="monitoreo",
        permission_classes=[permissions.IsAuthenticated, PuedeVerMonitoreo],
    )
    def monitoreo(self, request, pk=None):
        """Resumenes/graficas de la jornada -- ya NO trae lista_clues (esa
        se volvio /monitoreo-detalle/, paginada, ver mas abajo). Antes esta
        vista recorria cada ProgramacionVisita en Python para sumar a mano
        -- con una jornada de ~9,500 unidades eso significaba instanciar
        ~28,000 objetos de Django solo para sacar unos cuantos totales, y
        ademas mandaba esas 9,500 filas completas (5+ MB de JSON) en cada
        carga aunque el usuario nunca abriera las tablas de detalle. Ahora
        todo se calcula con agregacion de la base de datos (.aggregate()/
        .annotate()), igual que ya hacia mas abajo conteos_actuales/
        conteos_anteriores -- cero objetos de mas, cero filas de mas."""
        jornada = self.get_object()
        visitas_base = ProgramacionVisita.objects.filter(jornada=jornada)
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
        entidades_solicitadas = [
            entidad_id
            for entidad_id in request.query_params.getlist("entidad")
            if entidad_id
        ]
        visitas = visitas_base
        if entidades_solicitadas:
            if (
                request.user.rol == Usuario.ROL_USUARIO_ENTIDAD
                and any(
                    str(request.user.entidad_id) != entidad_id
                    for entidad_id in entidades_solicitadas
                )
            ):
                return Response({"detail": "No puedes consultar otra entidad."}, status=403)
            visitas = visitas.filter(unidad_medica__entidad_id__in=entidades_solicitadas)

        visitas_anotadas = _con_evidencia_anotada(visitas)
        programada_q = Q(fecha_distribucion_programada__isnull=False)
        atendida_q = Q(entregado=True)
        foto_q = Q(tiene_evidencia_imagen=True)
        nota_q = Q(tiene_evidencia_documento=True)
        video_q = Q(tiene_evidencia_video=True)

        agregados = visitas_anotadas.aggregate(
            registros=Count("id"),
            programadas=Count("id", filter=programada_q),
            capturadas=Count("id", filter=_CAPTURADA_Q),
            atendidas=Count("id", filter=atendida_q),
            total_entidades=Count("unidad_medica__entidad_id", distinct=True),
            claves=Sum("claves_a_desplazar"),
            piezas_medicamento=Sum("piezas_medicamento"),
            piezas_material_curacion=Sum("piezas_material_curacion"),
            evidencia_foto=Count("id", filter=foto_q),
            evidencia_nota=Count("id", filter=nota_q),
            evidencia_video=Count("id", filter=video_q),
        )
        registros = agregados["registros"]
        capturadas = agregados["capturadas"]
        atendidas = agregados["atendidas"]
        programadas = agregados["programadas"]
        pendientes_captura = registros - capturadas
        resumen = {
            "registros": registros,
            "programadas": programadas,
            "capturadas": capturadas,
            "pendientes_captura": pendientes_captura,
            "atendidas": atendidas,
            "pendientes": registros - atendidas,
            "por_programar": registros - programadas,
            "entidades": agregados["total_entidades"],
            "claves": agregados["claves"] or 0,
            "piezas_medicamento": agregados["piezas_medicamento"] or 0,
            "piezas_material_curacion": agregados["piezas_material_curacion"] or 0,
            "evidencia_foto": agregados["evidencia_foto"],
            "evidencia_nota": agregados["evidencia_nota"],
            "evidencia_video": agregados["evidencia_video"],
            "captura_porcentaje": round(capturadas * 100 / registros, 1) if registros else 0,
            "pendiente_captura_porcentaje": (
                round(pendientes_captura * 100 / registros, 1) if registros else 0
            ),
            "avance_porcentaje": round(atendidas * 100 / registros, 1) if registros else 0,
        }

        por_entidad_qs = (
            visitas_anotadas.values(
                "unidad_medica__entidad_id", "unidad_medica__entidad__nombre",
            )
            .annotate(
                registros=Count("id"),
                programadas=Count("id", filter=programada_q),
                capturadas=Count("id", filter=_CAPTURADA_Q),
                atendidas=Count("id", filter=atendida_q),
                claves=Sum("claves_a_desplazar"),
                piezas_medicamento=Sum("piezas_medicamento"),
                piezas_material_curacion=Sum("piezas_material_curacion"),
                evidencia_foto=Count("id", filter=foto_q),
                evidencia_nota=Count("id", filter=nota_q),
                evidencia_video=Count("id", filter=video_q),
            )
            .order_by("unidad_medica__entidad__nombre")
        )

        por_fecha_qs = (
            visitas_anotadas.filter(programada_q)
            .values("fecha_distribucion_programada")
            .annotate(
                programadas=Count("id"),
                atendidas=Count("id", filter=atendida_q),
                rutas=Count("ruta_numero", distinct=True, filter=~Q(ruta_numero="")),
                claves=Sum("claves_a_desplazar"),
                piezas_medicamento=Sum("piezas_medicamento"),
                piezas_material_curacion=Sum("piezas_material_curacion"),
            )
            .order_by("fecha_distribucion_programada")
        )

        evidencias_picking = EvidenciaPicking.objects.filter(jornada=jornada)
        if request.user.rol == Usuario.ROL_USUARIO_ENTIDAD:
            evidencias_picking = evidencias_picking.filter(entidad=request.user.entidad)
        if entidades_solicitadas:
            evidencias_picking = evidencias_picking.filter(entidad_id__in=entidades_solicitadas)
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
        for fila in por_entidad_qs:
            entidad_id = fila["unidad_medica__entidad_id"]
            nombre = fila["unidad_medica__entidad__nombre"]
            registros_ent = fila["registros"]
            capturadas_ent = fila["capturadas"]
            atendidas_ent = fila["atendidas"]
            programadas_ent = fila["programadas"]
            pendientes_captura_ent = registros_ent - capturadas_ent
            entidades.append({
                "id": entidad_id,
                "entidad": nombre,
                "registros": registros_ent,
                "programadas": programadas_ent,
                "capturadas": capturadas_ent,
                "pendientes_captura": pendientes_captura_ent,
                "atendidas": atendidas_ent,
                "por_programar": registros_ent - programadas_ent,
                "claves": fila["claves"] or 0,
                "piezas_medicamento": fila["piezas_medicamento"] or 0,
                "piezas_material_curacion": fila["piezas_material_curacion"] or 0,
                "evidencia_foto": fila["evidencia_foto"],
                "evidencia_nota": fila["evidencia_nota"],
                "evidencia_video": fila["evidencia_video"],
                "pendientes": registros_ent - atendidas_ent,
                "captura_porcentaje": (
                    round(capturadas_ent * 100 / registros_ent, 1) if registros_ent else 0
                ),
                "pendiente_captura_porcentaje": (
                    round(pendientes_captura_ent * 100 / registros_ent, 1) if registros_ent else 0
                ),
                "avance_porcentaje": (
                    round(atendidas_ent * 100 / registros_ent, 1) if registros_ent else 0
                ),
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
                "fecha": fila["fecha_distribucion_programada"].isoformat(),
                "clues": fila["programadas"],
                "rutas": fila["rutas"],
                "claves": fila["claves"] or 0,
                "piezas_medicamento": fila["piezas_medicamento"] or 0,
                "piezas_material_curacion": fila["piezas_material_curacion"] or 0,
                "programadas": fila["programadas"],
                "atendidas": fila["atendidas"],
                "avance_porcentaje": (
                    round(fila["atendidas"] * 100 / fila["programadas"], 1)
                    if fila["programadas"] else 0
                ),
            }
            for fila in por_fecha_qs
        ]

        jornada_anterior = (
            Jornada.objects.filter(categoria=jornada.categoria)
            .filter(
                Q(fecha_inicio__lt=jornada.fecha_inicio)
                | Q(fecha_inicio=jornada.fecha_inicio, id__lt=jornada.id)
            )
            .order_by("-fecha_inicio", "-id")
            .first()
        )
        conteos_actuales = {
            fila["unidad_medica__entidad_id"]: fila["total"]
            for fila in visitas.filter(fecha_distribucion_programada__isnull=False)
            .order_by()
            .values("unidad_medica__entidad_id")
            .annotate(total=Count("id"))
        }
        conteos_anteriores = {}
        if jornada_anterior:
            visitas_anteriores = ProgramacionVisita.objects.filter(
                jornada=jornada_anterior,
                fecha_distribucion_programada__isnull=False,
            )
            if request.user.rol == Usuario.ROL_USUARIO_ENTIDAD:
                visitas_anteriores = visitas_anteriores.filter(
                    unidad_medica__entidad=request.user.entidad
                )
            if entidades_solicitadas:
                visitas_anteriores = visitas_anteriores.filter(
                    unidad_medica__entidad_id__in=entidades_solicitadas
                )
            conteos_anteriores = {
                fila["unidad_medica__entidad_id"]: fila["total"]
                for fila in visitas_anteriores.values("unidad_medica__entidad_id")
                .annotate(total=Count("id"))
            }
        entidades_historico = [
            {
                "id": fila["id"],
                "entidad": fila["entidad"],
                "anterior": conteos_anteriores.get(fila["id"], 0),
                "actual": conteos_actuales.get(fila["id"], 0),
                "diferencia": (
                    conteos_actuales.get(fila["id"], 0)
                    - conteos_anteriores.get(fila["id"], 0)
                ),
            }
            for fila in entidades
        ]

        return Response({
            "jornada": JornadaSerializer(jornada).data,
            "filtros": {
                "entidades_seleccionadas": entidades_solicitadas,
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
            "historico_programacion": {
                "anterior": JornadaSerializer(jornada_anterior).data if jornada_anterior else None,
                "actual": JornadaSerializer(jornada).data,
                "entidades": entidades_historico,
            },
            "picking": {
                "fotos": sum(datos[EvidenciaPicking.TIPO_FOTO] for datos in picking_por_entidad.values()),
                "videos": sum(datos[EvidenciaPicking.TIPO_VIDEO] for datos in picking_por_entidad.values()),
                "dias_evidencia": len(fechas_picking),
                "avance_porcentaje": round(len(fechas_picking) * 100 / dias_jornada, 1)
                if dias_jornada else 0,
            },
        })

    @action(
        detail=True,
        methods=["get"],
        url_path="monitoreo-detalle",
        permission_classes=[permissions.IsAuthenticated, PuedeVerMonitoreo],
    )
    def monitoreo_detalle(self, request, pk=None):
        """Lo que antes era lista_clues dentro de monitoreo() -- separado
        aqui, paginado (PaginacionEstandar via self.paginate_queryset, 50
        por pagina por default) para que las tablas "LISTA DE CLUES" y
        "Evidencia" de MonitoreoPage.jsx dejen de cargar la jornada
        completa de un jalon. Misma forma de fila que antes
        (_fila_monitoreo_detalle), para que el frontend casi no tenga que
        cambiar como pinta cada una."""
        jornada = self.get_object()
        visitas = _con_evidencia_anotada(
            ProgramacionVisita.objects.filter(jornada=jornada)
            .select_related("unidad_medica__entidad")
        )
        if request.user.rol == Usuario.ROL_USUARIO_ENTIDAD:
            visitas = visitas.filter(unidad_medica__entidad=request.user.entidad)

        entidades_solicitadas = [
            entidad_id for entidad_id in request.query_params.getlist("entidad") if entidad_id
        ]
        if entidades_solicitadas:
            if (
                request.user.rol == Usuario.ROL_USUARIO_ENTIDAD
                and any(
                    str(request.user.entidad_id) != entidad_id
                    for entidad_id in entidades_solicitadas
                )
            ):
                return Response({"detail": "No puedes consultar otra entidad."}, status=403)
            visitas = visitas.filter(unidad_medica__entidad_id__in=entidades_solicitadas)

        tipo = request.query_params.get("tipo")
        if tipo == "abastecidas":
            visitas = visitas.filter(entregado=True)
        elif tipo == "pendientes":
            visitas = visitas.filter(entregado=False)
        elif tipo == "por_programar":
            visitas = visitas.filter(fecha_distribucion_programada__isnull=True)

        busqueda = (request.query_params.get("busqueda") or "").strip()
        if busqueda:
            # Mismos campos que antes se concatenaban en el navegador para
            # buscar sobre lista_clues ya cargada completa -- ahora la
            # traduccion a filtro de BD la hace el servidor.
            visitas = visitas.filter(
                # unidad_medica_id (el atributo Python del FK) no admite
                # __icontains directo -- hay que llegar al campo real
                # (clues, la PK de UnidadMedica) a traves de la relacion.
                Q(unidad_medica__clues__icontains=busqueda)
                | Q(unidad_medica__nombre__icontains=busqueda)
                | Q(unidad_medica__entidad__nombre__icontains=busqueda)
                | Q(unidad_medica__municipio__icontains=busqueda)
                | Q(ruta_numero__icontains=busqueda)
                | Q(tipo_unidad_medica__icontains=busqueda)
                | Q(quien_recibe__icontains=busqueda)
                | Q(telefono__icontains=busqueda)
                | Q(correo__icontains=busqueda)
            )

        visitas = visitas.order_by("fecha_distribucion_programada", "unidad_medica__nombre")

        pagina = self.paginate_queryset(visitas)
        filas = [_fila_monitoreo_detalle(visita) for visita in pagina]
        return self.get_paginated_response(filas)


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

    def perform_destroy(self, instance):
        if instance.jornada.esta_cerrada_para(self.request.user):
            raise PermissionDenied(
                "Esta distribución está cerrada; ya no se puede eliminar una unidad capturada."
            )
        instance.delete()

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

        jornadas_en_lote = list(Jornada.objects.filter(id__in=jornadas_afectadas))
        if any(jornada.esta_cerrada_para(request.user) for jornada in jornadas_en_lote):
            return Response({
                "detail": "Alguna de estas filas pertenece a una distribución cerrada; ya no se puede editar.",
            }, status=403)

        if campo == _CAMPO_FECHA_MASIVO:
            valor_final = parse_date(valor) if valor else None
            if valor and valor_final is None:
                return Response({"valor": ["Fecha inválida."]}, status=400)
            if valor_final is not None:
                for jornada in jornadas_en_lote:
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
            try:
                if campo == "ruta_numero":
                    valor_final = validar_ruta_numero(valor_final)
                elif campo == "telefono":
                    valor_final = validar_telefono(valor_final)
            except serializers.ValidationError as exc:
                return Response({"valor": exc.detail}, status=400)

        actualizados = qs.update(**{campo: valor_final})
        return Response({"actualizados": actualizados, "solicitados": len(ids)})
