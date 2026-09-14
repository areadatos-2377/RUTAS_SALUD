from datetime import date
from io import BytesIO
from unittest.mock import patch

from rest_framework import status
from rest_framework.test import APITestCase

from catalogos.models import Entidad, UnidadMedica
from programacion.models import Jornada, ProgramacionVisita
from usuarios.models import Usuario


class GenerarChecklistPermisosTests(APITestCase):
	def setUp(self):
		self.entidad = Entidad.objects.create(nombre="Entidad de prueba")
		unidad = UnidadMedica.objects.create(
			clues="TSSSA000001",
			nombre="Unidad de prueba",
			entidad=self.entidad,
		)
		self.jornada = Jornada.objects.create(
			nombre="Distribucion de prueba",
			tipo=Jornada.TIPO_ORDINARIA,
			categoria=Jornada.CATEGORIA_PRIMER_NIVEL,
			fecha_inicio=date(2026, 9, 1),
			fecha_fin=date(2026, 9, 2),
		)
		ProgramacionVisita.objects.create(jornada=self.jornada, unidad_medica=unidad)
		self.visor = Usuario.objects.create_user(
			username="visor",
			password="prueba",
			rol=Usuario.ROL_VISOR,
		)
		self.capturista = Usuario.objects.create_user(
			username="capturista",
			password="prueba",
			rol=Usuario.ROL_USUARIO_ENTIDAD,
			entidad=self.entidad,
		)

	@patch("picking_packing.views.checklist.construir_checklist", return_value=BytesIO(b"xlsx"))
	def test_visor_puede_descargar_checklist(self, construir_checklist):
		self.client.force_authenticate(self.visor)

		respuesta = self.client.post(
			"/api/picking-packing/generar-checklist/",
			{"jornada_id": self.jornada.id},
			format="json",
		)

		self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
		self.assertEqual(
			respuesta["Content-Type"],
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		)
		construir_checklist.assert_called_once()

	def test_capturista_no_puede_descargar_checklist(self):
		self.client.force_authenticate(self.capturista)

		respuesta = self.client.post(
			"/api/picking-packing/generar-checklist/",
			{"jornada_id": self.jornada.id},
			format="json",
		)

		self.assertEqual(respuesta.status_code, status.HTTP_403_FORBIDDEN)
