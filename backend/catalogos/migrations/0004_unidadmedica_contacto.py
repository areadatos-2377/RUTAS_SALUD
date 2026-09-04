from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalogos", "0003_alter_unidadmedica_tipo_unidad_medica"),
    ]

    operations = [
        migrations.AddField(
            model_name="unidadmedica",
            name="correo",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="unidadmedica",
            name="quien_recibe",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="unidadmedica",
            name="telefono",
            field=models.CharField(blank=True, max_length=100),
        ),
    ]