from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from catalogos.views import EntidadViewSet, UnidadMedicaViewSet
from entregas.views import EntregaViewSet, EvidenciaArchivoViewSet
from programacion.views import JornadaViewSet, ProgramacionVisitaViewSet, RutaViewSet
from usuarios.views import (
    UsuarioViewSet,
    activar_cuenta,
    cerrar_sesion,
    csrf,
    iniciar_sesion,
    yo,
)

router = DefaultRouter()
router.register("entidades", EntidadViewSet)
router.register("unidades-medicas", UnidadMedicaViewSet)
router.register("jornadas", JornadaViewSet)
router.register("rutas", RutaViewSet)
router.register("programacion-visitas", ProgramacionVisitaViewSet)
router.register("usuarios", UsuarioViewSet)
router.register("entregas", EntregaViewSet)
router.register("evidencias", EvidenciaArchivoViewSet)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/csrf/", csrf),
    path("api/auth/login/", iniciar_sesion),
    path("api/auth/logout/", cerrar_sesion),
    path("api/auth/me/", yo),
    path("api/auth/activar/<str:uidb64>/<str:token>/", activar_cuenta),
    path("api/", include(router.urls)),
    # Login/logout navegables del browsable API de DRF, util en desarrollo.
    path("api-auth/", include("rest_framework.urls")),
]
