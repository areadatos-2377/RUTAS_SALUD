from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import Usuario


class EsSuperAdmin(BasePermission):
    """Solo super_admin. Para funciones exclusivas (blueprint-v01.md sección 3)."""

    def has_permission(self, request, view):
        usuario = request.user
        return bool(usuario and usuario.is_authenticated and usuario.rol == Usuario.ROL_SUPER_ADMIN)


class SoloLecturaOSuperAdmin(BasePermission):
    """Catálogos: cualquier autenticado lee, solo super_admin escribe (blueprint-v01.md sección 4)."""

    def has_permission(self, request, view):
        usuario = request.user
        if not (usuario and usuario.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return usuario.rol == Usuario.ROL_SUPER_ADMIN


class PuedeGestionarJornadas(BasePermission):
    """Todos leen; solo admin_nacional/super_admin abren/editan jornadas (blueprint-v01.md sección 2.1)."""

    def has_permission(self, request, view):
        usuario = request.user
        if not (usuario and usuario.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return usuario.rol in (Usuario.ROL_ADMIN_NACIONAL, Usuario.ROL_SUPER_ADMIN)


class PuedeDescargarChecklistPicking(BasePermission):
    """Visores y administradores pueden descargar el checklist de picking."""

    def has_permission(self, request, view):
        usuario = request.user
        return bool(
            usuario
            and usuario.is_authenticated
            and usuario.rol
            in (Usuario.ROL_VISOR, Usuario.ROL_ADMIN_NACIONAL, Usuario.ROL_SUPER_ADMIN)
        )


class PuedeVerMonitoreo(BasePermission):
    """Visores y administradores pueden consultar Monitoreo y Seguimiento."""

    def has_permission(self, request, view):
        usuario = request.user
        return bool(
            usuario
            and usuario.is_authenticated
            and usuario.rol
            in (Usuario.ROL_VISOR, Usuario.ROL_ADMIN_NACIONAL, Usuario.ROL_SUPER_ADMIN)
        )


class PuedeEditarCoordinador(BasePermission):
    """Actualizar el coordinador estatal de una entidad: admin_nacional o
    super_admin. Los coordinadores cambian cada cierto tiempo y admin_nacional
    necesita poder actualizarlos sin volverse dueño de todo el catálogo de
    entidades (crear/borrar entidades sigue siendo exclusivo de super_admin,
    vía SoloLecturaOSuperAdmin)."""

    def has_permission(self, request, view):
        usuario = request.user
        return bool(
            usuario
            and usuario.is_authenticated
            and usuario.rol in (Usuario.ROL_ADMIN_NACIONAL, Usuario.ROL_SUPER_ADMIN)
        )


class PuedeGestionarProgramacion(BasePermission):
    """usuario_entidad y super_admin leen/escriben; admin_nacional solo lee
    (blueprint-v01.md secciones 2.5 y 3: "el administrador nacional solo puede
    ver las programaciones que hacen los usuarios")."""

    def has_permission(self, request, view):
        usuario = request.user
        if not (usuario and usuario.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return usuario.rol in (Usuario.ROL_USUARIO_ENTIDAD, Usuario.ROL_SUPER_ADMIN)


class PuedeAbrirEntrega(BasePermission):
    """EntregaViewSet.create() es en realidad un "abrir/consultar la
    Entrega de esta visita" (get_or_create perezoso, ver la vista) -- no un
    alta real. admin_nacional no puede subir/borrar evidencia ni marcar
    entregado (eso lo sigue bloqueando PuedeGestionarProgramacion en el
    resto del ViewSet), pero si necesita poder ABRIR el panel para marcar
    una evidencia con problema (ver NotificacionEvidencia). Cualquier rol
    que llegue a Distribuciones (todos menos visor) puede usar esto."""

    def has_permission(self, request, view):
        usuario = request.user
        return bool(usuario and usuario.is_authenticated and usuario.rol != Usuario.ROL_VISOR)


class PuedeGestionarNotificaciones(BasePermission):
    """Notificaciones de evidencia con problema: todos los no-visor leen
    (el get_queryset de la vista ya filtra que le toca ver a cada quien);
    crear una notificacion es solo admin_nacional/super_admin; marcarla
    como corregida es solo usuario_entidad (la vista valida ademas que sea
    de la entidad correcta); marcarla lista es solo admin_nacional/
    super_admin (la vista valida ademas que sea quien la creo, o
    super_admin)."""

    def has_permission(self, request, view):
        usuario = request.user
        if not (usuario and usuario.is_authenticated) or usuario.rol == Usuario.ROL_VISOR:
            return False
        if request.method in SAFE_METHODS:
            return True
        if view.action == "create":
            return usuario.rol in (Usuario.ROL_ADMIN_NACIONAL, Usuario.ROL_SUPER_ADMIN)
        if view.action == "marcar_corregida":
            return usuario.rol == Usuario.ROL_USUARIO_ENTIDAD
        if view.action == "marcar_listo":
            return usuario.rol in (Usuario.ROL_ADMIN_NACIONAL, Usuario.ROL_SUPER_ADMIN)
        return False
