from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalogos", "0004_unidadmedica_contacto"),
    ]

    operations = [
        migrations.AddField(
            model_name="unidadmedica",
            name="fecha_programacion_referencia",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="unidadmedica",
            name="ruta_programacion",
            field=models.CharField(blank=True, max_length=50),
        ),
    ]