from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("programacion", "0006_alter_jornada_options"),
    ]

    operations = [
        migrations.AlterField(
            model_name="programacionvisita",
            name="correo",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AlterField(
            model_name="programacionvisita",
            name="telefono",
            field=models.CharField(blank=True, max_length=100),
        ),
    ]