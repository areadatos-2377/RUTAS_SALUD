import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    # Solo cambios de esquema, sin datos -- ver 0004_precargar_unidades_datos.py
    # para por que el RunPython del bulk_create/save masivo vive en una
    # migracion aparte (Django difiere la creacion del indice del FK "jornada"
    # hasta el final del bloque de la migracion completa; si el RunPython
    # comparte migracion con este AddField, ese CREATE INDEX termina
    # ejecutandose despues del bulk_create en la MISMA transaccion, y Postgres
    # lo rechaza: "cannot CREATE INDEX ... because it has pending trigger
    # events". No aparece en SQLite (desarrollo local).
    dependencies = [
        ("catalogos", "0003_alter_unidadmedica_tipo_unidad_medica"),
        ("programacion", "0002_jornada_categoria"),
    ]

    operations = [
        migrations.AddField(
            model_name="programacionvisita",
            name="jornada",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="visitas",
                to="programacion.jornada",
            ),
        ),
        migrations.AddField(
            model_name="programacionvisita",
            name="ruta_numero",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AlterField(
            model_name="programacionvisita",
            name="fecha_distribucion_programada",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="programacionvisita",
            name="ruta",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="visitas",
                to="programacion.ruta",
            ),
        ),
        migrations.AlterField(
            model_name="programacionvisita",
            name="tipo_unidad_medica",
            field=models.CharField(blank=True, max_length=100),
        ),
    ]