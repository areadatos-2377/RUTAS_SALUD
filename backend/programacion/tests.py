from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.test import APITestCase

from catalogos.models import Entidad, UnidadMedica
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
			nivel_atencion=UnidadMedica.NIVEL_PRIMER,
		)
		self.unidad_jalisco = UnidadMedica.objects.create(
			clues="JCSSA000001",
			nombre="Centro de Salud Jalisco",
			entidad=self.jalisco,
			tipo_unidad_medica="CENTRO DE SALUD",
			municipio="Guadalajara",
			nivel_atencion=UnidadMedica.NIVEL_PRIMER,
		)
		self.hospital = UnidadMedica.objects.create(
			clues="CMSSA000002",
			nombre="Hospital no elegible",
			entidad=self.colima,
			tipo_unidad_medica="HOSPITAL",
			nivel_atencion=UnidadMedica.NIVEL_SEGUNDO,
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
				"fecha_inicio": "2026-09-01",
				"fecha_fin": "2026-09-05",
			},
			format="json",
		)

	def test_crear_jornada_precarga_unidades_de_la_categoria(self):
		respuesta = self.crear_jornada()

		self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
		jornada = Jornada.objects.get(pk=respuesta.data["id"])
		visitas = ProgramacionVisita.objects.filter(jornada=jornada)
		self.assertEqual(visitas.count(), 2)
		self.assertFalse(visitas.filter(unidad_medica=self.hospital).exists())
		fila = visitas.get(unidad_medica=self.unidad_colima)
		self.assertIsNone(fila.fecha_distribucion_programada)
		self.assertEqual(fila.ruta_numero, "")
		self.assertEqual(fila.tipo_unidad_medica, "CENTRO DE SALUD")

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
				"fecha_distribucion_programada": "2026-09-02",
				"claves_a_desplazar": 12,
				"quien_recibe": "Responsable de unidad",
			},
			format="json",
		)

		self.assertEqual(editada.status_code, status.HTTP_200_OK)
		fila.refresh_from_db()
		self.assertEqual(fila.ruta_numero, "Ruta 3")
		self.assertEqual(fila.claves_a_desplazar, 12)

		eliminada = self.client.delete(f"/api/programacion-visitas/{fila.id}/")
		self.assertEqual(eliminada.status_code, status.HTTP_204_NO_CONTENT)
		self.assertFalse(ProgramacionVisita.objects.filter(pk=fila.id).exists())
