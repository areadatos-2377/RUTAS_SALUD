import re

from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models

from catalogos.models import Entidad

USERNAME_INSTITUCIONAL = re.compile(r"^[^@\s]+@imssbienestar\.gob\.mx$", re.IGNORECASE)


class Usuario(AbstractUser):
    ROL_SUPER_ADMIN = "super_admin"
    ROL_ADMIN_NACIONAL = "admin_nacional"
    ROL_USUARIO_ENTIDAD = "usuario_entidad"
    ROL_CHOICES = [
        (ROL_SUPER_ADMIN, "Super administrador"),
        (ROL_ADMIN_NACIONAL, "Administrador nacional"),
        (ROL_USUARIO_ENTIDAD, "Usuario de entidad"),
    ]

    rol = models.CharField(max_length=20, choices=ROL_CHOICES)
    # Requerida solo para usuario_entidad; super_admin y admin_nacional no tienen entidad.
    entidad = models.ForeignKey(
        Entidad, on_delete=models.PROTECT, null=True, blank=True, related_name="usuarios"
    )

    class Meta:
        verbose_name = "usuario"
        verbose_name_plural = "usuarios"

    def clean(self):
        super().clean()
        if self.rol == self.ROL_USUARIO_ENTIDAD and self.entidad_id is None:
            raise ValidationError("Un usuario_entidad debe tener una entidad asignada.")
        if self.rol != self.ROL_USUARIO_ENTIDAD and self.entidad_id is not None:
            raise ValidationError("Solo un usuario_entidad puede tener entidad asignada.")
        # Las cuentas se identifican con el correo institucional, no un alias
        # libre -- mas facil de recordar/verificar que quien entra es quien
        # dice ser, y evita choques de nombre entre personas.
        if self.username and not USERNAME_INSTITUCIONAL.match(self.username):
            raise ValidationError(
                {"username": "El usuario debe ser tu correo institucional (...@imssbienestar.gob.mx)."}
            )

    def __str__(self):
        return self.get_full_name() or self.username
