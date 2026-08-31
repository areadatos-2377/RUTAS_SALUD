import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    # Separada de 0003 a proposito: Postgres rechaza un ALTER TABLE sobre
    # programacion_programacionvisita en la MISMA transaccion que el
    # bulk_create/save masivo de la migracion de datos de 0003 ("cannot
    # ALTER TABLE ... because it has pending trigger events" -- los checks
    # de FK de esas filas siguen pendientes hasta que la transaccion de 0003
    # cierra). Cada migracion de Django corre en su propia transaccion, asi
    # que separarla en dos basta para evitarlo -- no hacia falta en SQLite
    # (desarrollo local) porque ahi ese error no existe.
    dependencies = [
        ("programacion", "0004_precargar_unidades_datos"),
    ]

    operations = [
        migrations.AlterField(
            model_name="programacionvisita",
            name="jornada",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="visitas",
                to="programacion.jornada",
            ),
        ),
        migrations.AlterModelOptions(
            name="programacionvisita",
            options={
                "ordering": ["jornada", "unidad_medica"],
                "verbose_name": "programación de visita",
                "verbose_name_plural": "programaciones de visita",
            },
        ),
        migrations.AddConstraint(
            model_name="programacionvisita",
            constraint=models.UniqueConstraint(
                fields=("jornada", "unidad_medica"),
                name="programacion_jornada_unidad_unica",
            ),
        ),
    ]
