from rest_framework import serializers

from .models import Entidad, UnidadMedica


class EntidadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Entidad
        fields = ["id", "nombre", "coordinador"]


class UnidadMedicaSerializer(serializers.ModelSerializer):
    class Meta:
        model = UnidadMedica
        fields = [
            "clues",
            "nombre",
            "entidad",
            "tipo_unidad_medica",
            "municipio",
            "quien_recibe",
            "telefono",
            "correo",
            "origen",
            "nivel_atencion",
        ]
