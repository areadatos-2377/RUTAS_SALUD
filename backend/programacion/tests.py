from datetime import date

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.test import APITestCase

from catalogos.management.commands.cargar_clues import Command as CargarCluesCommand
from catalogos.models import Entidad, UnidadMedica
from entregas.models import Entrega, EvidenciaArchivo
from picking_packing.models import Evidencia as EvidenciaPicking
from usuarios.models import Usuario

from .models import Jornada, ProgramacionVisita


class PrecargaJornadaTests(APITestCase):
	def setUp(self):
		self.colima = Entidad.objects.create(nombre="Colima")
		self.jalisco = Entidad.objects.create(nombre="Jalisco")
		self.unidad_colima = UnidadMedica.objects.create(
			clues="CMSSA000001",
			nombre="Centro de Salud Colima",
			entidad=self.colima,
			tipo_unidad_medica="CENTRO DE SALUD",
			municipio="Colima",
			quien_recibe="Contacto del catálogo",
			telefono="312 123 4567 EXT 8",
			correo="farmacia@ejemplo.test - almacen@ejemplo.test",
			ruta_programacion="1",
			fecha_programacion_referencia=date(2026, 8, 20),
			nivel_atencion=UnidadMedica.NIVEL_PRIMER,
		)
		self.unidad_jalisco = UnidadMedica.objects.create(
			clues="JCSSA000001",
			nombre="Centro de Salud Jalisco",
			entidad=self.jalisco,
			tipo_unidad_medica="CENTRO DE SALUD",
			municipio="Guadalajara",
			ruta_programacion="2",
			fecha_programacion_referencia=date(2026, 8, 22),
			nivel_atencion=UnidadMedica.NIVEL_PRIMER,
		)
		self.unidad_tardia = UnidadMedica.objects.create(
			clues="JCSSA000002",
			nombre="Centro de Salud Jalisco tardío",
			entidad=self.jalisco,
			tipo_unidad_medica="CENTRO DE SALUD",
			municipio="Zapopan",
			ruta_programacion="9",
			fecha_programacion_referencia=date(2026, 9, 10),
			nivel_atencion=UnidadMedica.NIVEL_PRIMER,
		)
		self.unidad_sin_fecha = UnidadMedica.objects.create(
			clues="JCSSA000003",
			nombre="Centro de Salud sin fecha",
			entidad=self.jalisco,
			tipo_unidad_medica="CENTRO DE SALUD",
			ruta_programacion="11",
			nivel_atencion=UnidadMedica.NIVEL_PRIMER,
		)
		self.hospital = UnidadMedica.objects.create(
			clues="CMSSA000002",
			nombre="Hospital no elegible",
			entidad=self.colima,
			tipo_unidad_medica="HOSPITAL",
			ruta_programacion="20",
			fecha_programacion_referencia=date(2026, 9, 1),
			nivel_atencion=UnidadMedica.NIVEL_SEGUNDO,
		)
		self.hospital_tercer_nivel = UnidadMedica.objects.create(
			clues="CMSSA000003",
			nombre="Hospital de tercer nivel",
			entidad=self.colima,
			tipo_unidad_medica="HOSPITAL",
			ruta_programacion="21",
			fecha_programacion_referencia=date(2026, 9, 3),
			nivel_atencion=UnidadMedica.NIVEL_TERCER,
		)
		self.super_admin = Usuario.objects.create_user(
			username="super",
			password="prueba",
			rol=Usuario.ROL_SUPER_ADMIN,
		)
		self.usuario_colima = Usuario.objects.create_user(
			username="colima",
			password="prueba",
			rol=Usuario.ROL_USUARIO_ENTIDAD,
			entidad=self.colima,
		)

	def crear_jornada(self):
		self.client.force_authenticate(self.super_admin)
		return self.client.post(
			"/api/jornadas/",
			{
				"nombre": "Jornada de prueba",
				"tipo": Jornada.TIPO_ORDINARIA,
				"categoria": Jornada.CATEGORIA_PRIMER_NIVEL,
				"fecha_inicio": "2026-09-09",
				"fecha_fin": "2026-09-25",
			},
			format="json",
		)

	def test_crear_jornada_precarga_unidades_de_la_categoria(self):
		respuesta = self.crear_jornada()

		self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
		jornada = Jornada.objects.get(pk=respuesta.data["id"])
		visitas = ProgramacionVisita.objects.filter(jornada=jornada)
		self.assertEqual(visitas.count(), 4)
		self.assertFalse(visitas.filter(unidad_medica=self.hospital).exists())
		fila = visitas.get(unidad_medica=self.unidad_colima)
		self.assertEqual(fila.fecha_distribucion_programada, date(2026, 9, 9))
		self.assertEqual(fila.ruta_numero, "1")
		self.assertEqual(fila.tipo_unidad_medica, "CENTRO DE SALUD")
		self.assertEqual(fila.quien_recibe, "Contacto del catálogo")
		self.assertEqual(fila.telefono, "312 123 4567 EXT 8")
		self.assertEqual(fila.correo, "farmacia@ejemplo.test - almacen@ejemplo.test")
		self.assertEqual(
			visitas.get(unidad_medica=self.unidad_jalisco).fecha_distribucion_programada,
			date(2026, 9, 11),
		)
		self.assertEqual(
			visitas.get(unidad_medica=self.unidad_tardia).fecha_distribucion_programada,
			date(2026, 9, 25),
		)
		self.assertIsNone(
			visitas.get(unidad_medica=self.unidad_sin_fecha).fecha_distribucion_programada
		)

	def test_precarga_deja_fechas_vacias_si_no_hay_referencias(self):
		UnidadMedica.objects.filter(nivel_atencion=UnidadMedica.NIVEL_PRIMER).update(
			fecha_programacion_referencia=None
		)

		respuesta = self.crear_jornada()

		self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
		self.assertFalse(
			ProgramacionVisita.objects.filter(
				jornada_id=respuesta.data["id"],
				fecha_distribucion_programada__isnull=False,
			).exists()
		)

	def test_segundo_tercer_nivel_usa_su_propio_dia_cero(self):
		self.client.force_authenticate(self.super_admin)
		respuesta = self.client.post(
			"/api/jornadas/",
			{
				"nombre": "Jornada hospitalaria",
				"tipo": Jornada.TIPO_ORDINARIA,
				"categoria": Jornada.CATEGORIA_SEGUNDO_TERCER_NIVEL,
				"fecha_inicio": "2026-09-09",
				"fecha_fin": "2026-09-25",
			},
			format="json",
		)

		self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
		visitas = ProgramacionVisita.objects.filter(jornada_id=respuesta.data["id"])
		self.assertEqual(visitas.count(), 2)
		self.assertEqual(
			visitas.get(unidad_medica=self.hospital).fecha_distribucion_programada,
			date(2026, 9, 9),
		)
		self.assertEqual(
			visitas.get(unidad_medica=self.hospital_tercer_nivel).fecha_distribucion_programada,
			date(2026, 9, 11),
		)

	def test_restriccion_impide_duplicar_clues_en_jornada(self):
		respuesta = self.crear_jornada()
		jornada = Jornada.objects.get(pk=respuesta.data["id"])

		with self.assertRaises(IntegrityError), transaction.atomic():
			ProgramacionVisita.objects.create(
				jornada=jornada,
				unidad_medica=self.unidad_colima,
			)

	def test_usuario_entidad_solo_ve_sus_unidades(self):
		respuesta = self.crear_jornada()
		self.client.force_authenticate(self.usuario_colima)

		listado = self.client.get(
			f"/api/programacion-visitas/?jornada={respuesta.data['id']}"
		)

		self.assertEqual(listado.status_code, status.HTTP_200_OK)
		self.assertEqual(listado.data["count"], 1)
		self.assertEqual(listado.data["results"][0]["unidad_medica"], self.unidad_colima.clues)

	def test_listado_indica_si_la_unidad_esta_entregada(self):
		respuesta = self.crear_jornada()
		fila = ProgramacionVisita.objects.get(
			jornada_id=respuesta.data["id"],
			unidad_medica=self.unidad_colima,
		)
		self.client.force_authenticate(self.usuario_colima)

		sin_entrega = self.client.get(
			f"/api/programacion-visitas/?jornada={respuesta.data['id']}"
		)
		self.assertIs(sin_entrega.data["results"][0]["entregado"], False)

		Entrega.objects.create(
			programacion_visita=fila,
			entregado=True,
			fecha_entrega=date(2026, 9, 9),
			usuario=self.usuario_colima,
		)
		con_entrega = self.client.get(
			f"/api/programacion-visitas/?jornada={respuesta.data['id']}"
		)
		self.assertIs(con_entrega.data["results"][0]["entregado"], True)

	def test_monitoreo_agrega_datos_y_restringe_usuario_entidad(self):
		respuesta = self.crear_jornada()
		jornada_id = respuesta.data["id"]
		fila_colima = ProgramacionVisita.objects.get(
			jornada_id=jornada_id,
			unidad_medica=self.unidad_colima,
		)
		fila_colima.claves_a_desplazar = 12
		fila_colima.piezas_medicamento = 120
		fila_colima.piezas_material_curacion = 40
		fila_colima.save()
		fila_parcial = ProgramacionVisita.objects.get(
			jornada_id=jornada_id,
			unidad_medica=self.unidad_jalisco,
		)
		fila_parcial.claves_a_desplazar = 8
		fila_parcial.piezas_medicamento = 60
		fila_parcial.piezas_material_curacion = 0
		fila_parcial.fecha_distribucion_programada = date(2026, 9, 9)
		fila_parcial.ruta_numero = fila_colima.ruta_numero
		fila_parcial.save()
		entrega = Entrega.objects.create(
			programacion_visita=fila_colima,
			entregado=True,
			fecha_entrega=date(2026, 9, 9),
			usuario=self.usuario_colima,
		)
		EvidenciaArchivo.objects.create(
			entrega=entrega,
			tipo=EvidenciaArchivo.TIPO_FOTO,
			ruta_almacen="pruebas/foto.jpg",
			nombre_original="foto.jpg",
			subido_por=self.usuario_colima,
		)
		EvidenciaPicking.objects.create(
			jornada_id=jornada_id,
			entidad=self.colima,
			fecha=date(2026, 9, 9),
			tipo=EvidenciaPicking.TIPO_FOTO,
			ruta_almacen="pruebas/picking.jpg",
			nombre_original="picking.jpg",
			subido_por=self.usuario_colima,
		)
		EvidenciaPicking.objects.create(
			jornada_id=jornada_id,
			entidad=self.jalisco,
			fecha=date(2026, 9, 10),
			tipo=EvidenciaPicking.TIPO_FOTO,
			ruta_almacen="pruebas/picking-jalisco.jpg",
			nombre_original="picking-jalisco.jpg",
			subido_por=self.super_admin,
		)

		self.client.force_authenticate(self.super_admin)
		nacional = self.client.get(f"/api/jornadas/{jornada_id}/monitoreo/")

		self.assertEqual(nacional.status_code, status.HTTP_200_OK)
		self.assertEqual(nacional.data["resumen"]["programadas"], 3)
		self.assertEqual(nacional.data["resumen"]["registros"], 4)
		self.assertEqual(nacional.data["resumen"]["capturadas"], 1)
		self.assertEqual(nacional.data["resumen"]["pendientes_captura"], 3)
		self.assertEqual(nacional.data["resumen"]["captura_porcentaje"], 25.0)
		self.assertEqual(nacional.data["resumen"]["por_programar"], 1)
		self.assertEqual(nacional.data["resumen"]["atendidas"], 1)
		self.assertEqual(nacional.data["resumen"]["pendientes"], 3)
		self.assertEqual(nacional.data["resumen"]["avance_porcentaje"], 25.0)
		self.assertEqual(nacional.data["resumen"]["entidades"], 2)
		self.assertEqual(nacional.data["resumen"]["evidencia_foto"], 1)
		fila_evidencia = next(
			fila for fila in nacional.data["lista_clues"] if fila["clues"] == self.unidad_colima.clues
		)
		self.assertIs(fila_evidencia["evidencia_foto"], True)
		self.assertIs(fila_evidencia["evidencia_video"], False)
		self.assertIs(fila_evidencia["evidencia_nota"], False)
		self.assertIs(fila_evidencia["evidencia_completa"], False)
		self.assertEqual(fila_evidencia["evidencia_avance"], 33.3)
		self.assertEqual(fila_evidencia["tipo_unidad_medica"], "CENTRO DE SALUD")
		self.assertEqual(fila_evidencia["quien_recibe"], "Contacto del catálogo")
		self.assertEqual(fila_evidencia["telefono"], "312 123 4567 EXT 8")
		self.assertEqual(
			fila_evidencia["correo"],
			"farmacia@ejemplo.test - almacen@ejemplo.test",
		)
		self.assertEqual(nacional.data["picking"]["fotos"], 2)
		self.assertEqual(nacional.data["picking"]["dias_evidencia"], 2)
		self.assertEqual(nacional.data["picking"]["avance_porcentaje"], 11.8)
		self.assertEqual(len(nacional.data["lista_clues"]), 4)
		self.assertEqual(len(nacional.data["filtros"]["entidades"]), 2)
		jalisco = next(
			fila for fila in nacional.data["entidades"] if fila["entidad"] == "Jalisco"
		)
		self.assertEqual(jalisco["capturadas"], 0)
		self.assertEqual(jalisco["pendientes_captura"], 3)
		self.assertEqual(jalisco["pendiente_captura_porcentaje"], 100.0)
		self.assertEqual(jalisco["picking_dias_evidencia"], 1)
		self.assertEqual(jalisco["picking_avance_porcentaje"], 5.9)
		colima = next(
			fila for fila in nacional.data["entidades"] if fila["entidad"] == "Colima"
		)
		self.assertEqual(
			colima["picking_por_dia"],
			[{"fecha": "2026-09-09", "foto": True, "video": False}],
		)
		fecha_compartida = next(
			fila for fila in nacional.data["fechas"] if fila["fecha"] == "2026-09-09"
		)
		self.assertEqual(fecha_compartida["clues"], 2)
		self.assertEqual(fecha_compartida["rutas"], 1)
		self.assertEqual(fecha_compartida["claves"], 20)
		self.assertEqual(fecha_compartida["piezas_medicamento"], 180)
		self.assertEqual(fecha_compartida["piezas_material_curacion"], 40)

		colima_filtrada = self.client.get(
			f"/api/jornadas/{jornada_id}/monitoreo/?entidad={self.colima.id}"
		)
		self.assertEqual(colima_filtrada.data["resumen"]["registros"], 1)
		self.assertEqual(colima_filtrada.data["resumen"]["capturadas"], 1)
		self.assertEqual(colima_filtrada.data["resumen"]["captura_porcentaje"], 100.0)
		self.assertEqual(colima_filtrada.data["resumen"]["atendidas"], 1)
		self.assertEqual(colima_filtrada.data["entidades"][0]["entidad"], "Colima")
		self.assertEqual(colima_filtrada.data["picking"]["fotos"], 1)

		self.client.force_authenticate(self.usuario_colima)
		entidad = self.client.get(f"/api/jornadas/{jornada_id}/monitoreo/")

		self.assertEqual(entidad.status_code, status.HTTP_200_OK)
		self.assertEqual(entidad.data["resumen"]["programadas"], 1)
		self.assertEqual(entidad.data["resumen"]["atendidas"], 1)
		self.assertEqual(entidad.data["resumen"]["entidades"], 1)
		self.assertEqual(entidad.data["entidades"][0]["entidad"], "Colima")

	def test_fila_precargada_se_puede_editar_y_eliminar(self):
		respuesta = self.crear_jornada()
		fila = ProgramacionVisita.objects.get(
			jornada_id=respuesta.data["id"],
			unidad_medica=self.unidad_colima,
		)
		self.client.force_authenticate(self.usuario_colima)

		editada = self.client.patch(
			f"/api/programacion-visitas/{fila.id}/",
			{
				"ruta_numero": "Ruta 3",
				"fecha_distribucion_programada": "2026-09-10",
				"claves_a_desplazar": 12,
				"quien_recibe": "Responsable de unidad",
				"telefono": "312 765 4321 EXT 20",
				"correo": "contacto actualizado",
			},
			format="json",
		)

		self.assertEqual(editada.status_code, status.HTTP_200_OK)
		fila.refresh_from_db()
		self.assertEqual(fila.ruta_numero, "Ruta 3")
		self.assertEqual(fila.fecha_distribucion_programada, date(2026, 9, 10))
		self.assertEqual(fila.claves_a_desplazar, 12)
		self.assertEqual(fila.quien_recibe, "Responsable de unidad")
		self.assertEqual(fila.telefono, "312 765 4321 EXT 20")
		self.assertEqual(fila.correo, "contacto actualizado")

		fuera_de_periodo = self.client.patch(
			f"/api/programacion-visitas/{fila.id}/",
			{"fecha_distribucion_programada": "2026-09-26"},
			format="json",
		)
		self.assertEqual(fuera_de_periodo.status_code, status.HTTP_400_BAD_REQUEST)
		fila.refresh_from_db()
		self.assertEqual(fila.fecha_distribucion_programada, date(2026, 9, 10))

		eliminada = self.client.delete(f"/api/programacion-visitas/{fila.id}/")
		self.assertEqual(eliminada.status_code, status.HTTP_204_NO_CONTENT)
		self.assertFalse(ProgramacionVisita.objects.filter(pk=fila.id).exists())

	def test_rellenar_contactos_existentes_solo_completa_campos_vacios(self):
		respuesta = self.crear_jornada()
		fila = ProgramacionVisita.objects.get(
			jornada_id=respuesta.data["id"],
			unidad_medica=self.unidad_colima,
		)
		fila.quien_recibe = "Contacto capturado"
		fila.telefono = ""
		fila.correo = ""
		fila.save(update_fields=["quien_recibe", "telefono", "correo"])

		CargarCluesCommand()._rellenar_visitas_sin_contacto()

		fila.refresh_from_db()
		self.assertEqual(fila.quien_recibe, "Contacto capturado")
		self.assertEqual(fila.telefono, self.unidad_colima.telefono)
		self.assertEqual(fila.correo, self.unidad_colima.correo)
