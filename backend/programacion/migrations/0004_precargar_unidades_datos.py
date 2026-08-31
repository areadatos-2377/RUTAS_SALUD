from django.db import migrations


NIVELES_POR_CATEGORIA = {
    "primer_nivel": ["PRIMER NIVEL"],
    "segundo_tercer_nivel": ["SEGUNDO NIVEL", "TERCER NIVEL"],
}


def preparar_programacion(apps, schema_editor):
    Jornada = apps.get_model("programacion", "Jornada")
    ProgramacionVisita = apps.get_model("programacion", "ProgramacionVisita")
    UnidadMedica = apps.get_model("catalogos", "UnidadMedica")

    for visita in ProgramacionVisita.objects.select_related("ruta").iterator():
        visita.jornada_id = visita.ruta.jornada_id
        visita.ruta_numero = visita.ruta.numero_o_nombre
        visita.save(update_fields=["jornada", "ruta_numero"])

    for jornada in Jornada.objects.iterator():
        existentes = set(
            ProgramacionVisita.objects.filter(jornada_id=jornada.id).values_list(
                "unidad_medica_id", flat=True
            )
        )
        niveles = NIVELES_POR_CATEGORIA[jornada.categoria]
        unidades = UnidadMedica.objects.filter(nivel_atencion__in=niveles).exclude(
            clues__in=existentes
        )
        ProgramacionVisita.objects.bulk_create(
            [
                ProgramacionVisita(
                    jornada_id=jornada.id,
                    unidad_medica_id=unidad.clues,
                    tipo_unidad_medica=unidad.tipo_unidad_medica,
                )
                for unidad in unidades.iterator()
            ],
            batch_size=500,
        )


class Migration(migrations.Migration):
    # Migracion de solo datos (sin operaciones de esquema) -- ver el
    # comentario en 0003_precargar_unidades_por_jornada.py.
    dependencies = [
        ("programacion", "0003_precargar_unidades_por_jornada"),
    ]

    operations = [
        migrations.RunPython(preparar_programacion, migrations.RunPython.noop),
    ]
