"""
Carga/actualiza el catalogo de Entidad y UnidadMedica en la base de datos
real desde data/raw/CLUES_IMB.xlsx y data/raw/ejemplo_6ta_distribucion_BC.xlsx
(este ultimo solo para el catalogo de entidades/coordinadores, hoja Hoja1).

Reusa la misma logica de lectura/mapeo que scripts/generar_catalogo_clues.py
(ese genera el JSON que consume la sub-herramienta estatica; este comando
escribe directo en la base de datos del backend -- son consumidores
distintos de la misma fuente, por eso no comparten codigo entre un
entorno Python global y el venv de Django).

Seguro de re-ejecutar cada vez que se reemplace el Excel (actualizacion
mensual, segun el area): hace upsert por CLUES -- agrega los nuevos,
actualiza los que cambiaron de nombre/tipo/municipio, y NUNCA toca ni
borra las unidades con origen=manual (las que alguien capturo a mano
porque su CLUES no estaba en el catalogo oficial). Tampoco borra CLUES
que hayan desaparecido del nuevo Excel -- si algun dia hace falta dar de
baja unidades formalmente, es una decision de negocio aparte, no algo
que este comando deba hacer solo.
"""

import re
import unicodedata
from datetime import date, datetime
from pathlib import Path

import openpyxl
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from catalogos.models import Entidad, UnidadMedica

BACKEND_DIR = Path(__file__).resolve().parents[3]
DATA_DIR = BACKEND_DIR / "data" / "raw"
if not DATA_DIR.exists():
    # Compatibilidad con clones anteriores, donde las fuentes solo vivían en
    # data/raw en la raíz del monorepo. Railway despliega backend/ de forma
    # aislada, por lo que producción usa la copia incluida dentro del backend.
    DATA_DIR = BACKEND_DIR.parent / "data" / "raw"
CLUES_XLSX = DATA_DIR / "CLUES_IMB.xlsx"
ENTIDADES_XLSX = DATA_DIR / "ejemplo_6ta_distribucion_BC.xlsx"

# Decision 2026-08-24: se amplia de solo primer nivel (blueprint-v00) a los
# 3 niveles reales de la fuente -- excluye "NO APLICA", que en CLUES_IMB.xlsx
# corresponde a registros administrativos, no unidades de atencion.
NIVELES_ATENCION_ESPERADOS = {
    UnidadMedica.NIVEL_PRIMER,
    UnidadMedica.NIVEL_SEGUNDO,
    UnidadMedica.NIVEL_TERCER,
}
ESTATUS_ESPERADO = "EN OPERACION"

COLUMNAS_CONTACTO = {
    "quien_recibe": "¿QUIÉN RECIBE EN UNIDAD?",
    "telefono": "TELÉFONO",
    "correo": "CORREO",
}

FORMATOS_FECHA_PROGRAMACION = (
    "%A, %B %d, %Y",
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%m/%d/%Y",
)

ALIAS_ENTIDAD = {
    "MEXICO": "ESTADO DE MEXICO",
    "MICHOACAN DE OCAMPO": "MICHOACAN",
    "VERACRUZ DE IGNACIO DE LA LLAVE": "VERACRUZ",
}


def normalizar(texto):
    if texto is None:
        return ""
    texto = str(texto).strip().upper()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", texto)


def mapear_tipo_unidad_medica(nombre_tipologia):
    t = normalizar(nombre_tipologia)
    if "UNEME" in t or "UNIDAD DE ESPECIALIDADES MEDICAS" in t:
        return "UNEME"
    if "UNIDAD MOVIL" in t:
        return "UNIDAD MOVIL"
    match = re.search(r"(\d{2})\s*NUCLEO", t)
    if match:
        n = int(match.group(1))
        if n <= 2:
            return "1-2 NUCLEOS"
        if n <= 5:
            return "3-5 NUCLEOS"
        return "6-12 NUCLEOS"
    if "01 NUCLEO" in t:
        return "1-2 NUCLEOS"
    return nombre_tipologia


def texto_celda(valor):
    return "" if valor is None else str(valor).strip()


def fecha_programacion_celda(valor):
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if not isinstance(valor, str):
        return None

    texto = valor.strip()
    for formato in FORMATOS_FECHA_PROGRAMACION:
        try:
            return datetime.strptime(texto, formato).date()
        except ValueError:
            continue
    return None


class DryRunRollback(Exception):
    pass


class Command(BaseCommand):
    help = (
        "Carga/actualiza Entidad y UnidadMedica desde data/raw/CLUES_IMB.xlsx. "
        "Re-ejecutar cada vez que se reemplace ese Excel (actualizacion mensual)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Muestra que haria sin escribir en la base de datos.",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=0,
            help=(
                "Si es > 0, confirma cada N unidades en vez de todo en una sola "
                "transaccion (util sobre conexiones lentas/tuneladas, ej. cargar "
                "produccion desde fuera de la red de Railway). Cada upsert ya es "
                "idempotente, asi que perder atomicidad global es seguro: si se "
                "corta a la mitad, volver a correr el comando retoma donde quedo. "
                "Ignorado en --dry-run (ese siempre corre en una sola transaccion "
                "para poder revertirla completa)."
            ),
        )
        parser.add_argument(
            "--rellenar-visitas-sin-contacto",
            action="store_true",
            help=(
                "Copia los contactos del catálogo a los campos vacíos de visitas ya existentes. "
                "No sobrescribe valores capturados y no es necesario en cargas mensuales posteriores."
            ),
        )

    def handle(self, *args, **options):
        if not CLUES_XLSX.exists():
            raise CommandError(f"No se encontro {CLUES_XLSX}")
        if not ENTIDADES_XLSX.exists():
            raise CommandError(f"No se encontro {ENTIDADES_XLSX}")

        dry_run = options["dry_run"]
        batch_size = options["batch_size"] if not dry_run else 0
        rellenar_visitas = options["rellenar_visitas_sin_contacto"]

        if dry_run:
            try:
                with transaction.atomic():
                    self._cargar(dry_run, batch_size, rellenar_visitas)
                    raise DryRunRollback()
            except DryRunRollback:
                self.stdout.write(self.style.WARNING("\n--dry-run: no se escribio nada en la base de datos."))
        else:
            self._cargar(dry_run, batch_size, rellenar_visitas)

    def _cargar(self, dry_run, batch_size, rellenar_visitas):
        coordinadores, orden_entidades = self._leer_coordinadores()

        mapa_entidad = {}
        entidades_creadas = entidades_actualizadas = 0
        for nombre in orden_entidades:
            coordinador = coordinadores[normalizar(nombre)]
            entidad, creada = Entidad.objects.update_or_create(
                nombre=nombre, defaults={"coordinador": coordinador}
            )
            mapa_entidad[normalizar(nombre)] = entidad
            entidades_creadas += creada
            entidades_actualizadas += not creada

        self.stdout.write(
            f"Entidades: {entidades_creadas} creadas, {entidades_actualizadas} actualizadas "
            f"(de {len(orden_entidades)} en el catalogo)."
        )

        creadas = actualizadas = sin_cambios = 0
        omitidas_entidad_no_reconocida = 0

        wb = openpyxl.load_workbook(CLUES_XLSX, data_only=True)
        ws = wb["BD_IMB"]
        headers = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
        idx = {h: i for i, h in enumerate(headers)}
        columnas_requeridas = {
            "NIVEL ATENCION",
            "ESTATUS DE OPERACION",
            "ENTIDAD",
            "CLUES",
            "NOMBRE DE TIPOLOGIA",
            "NOMBRE DE LA UNIDAD",
            "MUNICIPIO",
            *COLUMNAS_CONTACTO.values(),
            "RUTA",
            "FECHA PROG",
        }
        columnas_faltantes = sorted(columnas_requeridas - idx.keys())
        if columnas_faltantes:
            raise CommandError(
                "Faltan columnas requeridas en BD_IMB: "
                + ", ".join(columnas_faltantes)
            )

        # Una sola consulta para traer TODAS las unidades existentes (en vez
        # de una consulta por fila) -- con ~10,500 filas del Excel, hacer
        # update_or_create() fila por fila significa decenas de miles de
        # idas y vueltas a la base de datos, y contra Postgres remoto sobre
        # un tunel SSH eso es tan lento que la conexion se cae antes de
        # terminar. bulk_create/bulk_update mandan cientos de filas por cada
        # ida y vuelta.
        existentes = {u.clues: u for u in UnidadMedica.objects.all()}

        campos_comparables = [
            "nombre",
            "tipo_unidad_medica",
            "municipio",
            "quien_recibe",
            "telefono",
            "correo",
            "ruta_programacion",
            "fecha_programacion_referencia",
            "origen",
            "nivel_atencion",
        ]
        # dict, no lista: si el mismo CLUES aparece dos veces en el Excel (pasa),
        # bulk_create tronaria con un IntegrityError de PK duplicada al insertar
        # dos objetos nuevos con el mismo clues -- la segunda ocurrencia debe
        # reemplazar a la primera en vez de sumarse.
        nuevos_por_clues = {}
        por_actualizar = []

        def procesar_fila(row):
            nonlocal creadas, actualizadas, sin_cambios, omitidas_entidad_no_reconocida
            nivel_atencion = row[idx["NIVEL ATENCION"]]
            if nivel_atencion not in NIVELES_ATENCION_ESPERADOS:
                return
            if row[idx["ESTATUS DE OPERACION"]] != ESTATUS_ESPERADO:
                return

            entidad_norm = normalizar(row[idx["ENTIDAD"]])
            entidad_norm = normalizar(ALIAS_ENTIDAD.get(entidad_norm, entidad_norm))
            entidad_obj = mapa_entidad.get(entidad_norm)
            if entidad_obj is None:
                omitidas_entidad_no_reconocida += 1
                return

            clues = (row[idx["CLUES"]] or "").strip()
            if not clues:
                return

            tipologia = row[idx["NOMBRE DE TIPOLOGIA"]]
            defaults = {
                "nombre": (row[idx["NOMBRE DE LA UNIDAD"]] or "").strip(),
                "entidad": entidad_obj,
                "tipo_unidad_medica": mapear_tipo_unidad_medica(tipologia),
                "municipio": row[idx["MUNICIPIO"]] or "",
                "quien_recibe": texto_celda(row[idx[COLUMNAS_CONTACTO["quien_recibe"]]]),
                "telefono": texto_celda(row[idx[COLUMNAS_CONTACTO["telefono"]]]),
                "correo": texto_celda(row[idx[COLUMNAS_CONTACTO["correo"]]]),
                "ruta_programacion": texto_celda(row[idx["RUTA"]]),
                "fecha_programacion_referencia": fecha_programacion_celda(
                    row[idx["FECHA PROG"]]
                ),
                "origen": UnidadMedica.ORIGEN_CATALOGO_MENSUAL,
                "nivel_atencion": nivel_atencion,
            }

            anterior = existentes.get(clues)
            if anterior is None:
                if clues not in nuevos_por_clues:
                    creadas += 1
                nuevos_por_clues[clues] = UnidadMedica(clues=clues, **defaults)
                return

            if anterior.origen == UnidadMedica.ORIGEN_MANUAL:
                sin_cambios += 1
                return

            cambio = anterior.entidad_id != entidad_obj.id or any(
                getattr(anterior, k) != v for k, v in defaults.items() if k != "entidad"
            )
            if not cambio:
                sin_cambios += 1
                return
            for k, v in defaults.items():
                setattr(anterior, k, v)
            por_actualizar.append(anterior)
            actualizadas += 1

        filas = list(ws.iter_rows(min_row=2, values_only=True))
        total_leidas = len(filas)

        for row in filas:
            procesar_fila(row)

        tamano_lote = batch_size if batch_size > 0 else 500

        def guardar_en_lotes(objetos, accion):
            for inicio in range(0, len(objetos), tamano_lote):
                lote = objetos[inicio : inicio + tamano_lote]
                with transaction.atomic():
                    if accion == "crear":
                        UnidadMedica.objects.bulk_create(lote)
                    else:
                        UnidadMedica.objects.bulk_update(lote, campos_comparables + ["entidad"])
                self.stdout.write(
                    f"  ...{accion}: {min(inicio + tamano_lote, len(objetos))}/{len(objetos)}"
                )

        por_crear = list(nuevos_por_clues.values())
        if por_crear:
            guardar_en_lotes(por_crear, "crear")
        if por_actualizar:
            guardar_en_lotes(por_actualizar, "actualizar")

        self.stdout.write(
            f"Unidades medicas: {creadas} creadas, {actualizadas} actualizadas, "
            f"{sin_cambios} sin cambios (de {total_leidas} filas leidas en el Excel)."
        )
        if omitidas_entidad_no_reconocida:
            self.stdout.write(
                self.style.WARNING(
                    f"{omitidas_entidad_no_reconocida} filas omitidas: entidad no reconocida "
                    "(fuera de las 23 entidades del catalogo, ej. Guanajuato/Yucatan)."
                )
            )
        if rellenar_visitas:
            self._rellenar_visitas_sin_contacto()
        self.stdout.write(
            self.style.SUCCESS(
                f"Total en catalogo tras la carga: {UnidadMedica.objects.filter(origen=UnidadMedica.ORIGEN_CATALOGO_MENSUAL).count()} "
                f"unidades de catalogo mensual + {UnidadMedica.objects.filter(origen=UnidadMedica.ORIGEN_MANUAL).count()} capturadas manualmente."
            )
        )

    def _rellenar_visitas_sin_contacto(self):
        from django.db.models import OuterRef, Subquery

        from programacion.models import ProgramacionVisita

        unidad = UnidadMedica.objects.filter(pk=OuterRef("unidad_medica_id"))
        actualizaciones = 0
        for campo in COLUMNAS_CONTACTO:
            visitas_sin_dato = ProgramacionVisita.objects.filter(**{campo: ""}).exclude(
                **{f"unidad_medica__{campo}": ""}
            )
            actualizaciones += visitas_sin_dato.update(
                **{campo: Subquery(unidad.values(campo)[:1])}
            )
        self.stdout.write(
            f"Contactos precargados en visitas existentes: {actualizaciones} campos vacíos."
        )

    def _leer_coordinadores(self):
        wb = openpyxl.load_workbook(ENTIDADES_XLSX, data_only=True)
        ws = wb["Hoja1"]
        coordinadores = {}
        orden = []
        for row in ws.iter_rows(min_row=4, values_only=True):
            entidad, titular = row[0], row[1]
            if not entidad:
                continue
            entidad = str(entidad).strip()
            coordinadores[normalizar(entidad)] = (titular or "").strip()
            orden.append(entidad)
        return coordinadores, orden
