"""Agrupacion fija de entidades en regiones, para la presentacion de
evidencia (docs/Formato_rutas.pptx trae una diapositiva divisoria por
region). Definida a mano con el usuario -- no viene de un catalogo ni
cambia por temporada.
"""

REGIONES = {
    "Región Centro": ["CIUDAD DE MÉXICO", "ESTADO DE MÉXICO", "HIDALGO"],
    "Región Noreste": ["SAN LUIS POTOSÍ", "TAMAULIPAS", "VERACRUZ", "ZACATECAS"],
    "Región Noroeste": [
        "BAJA CALIFORNIA", "BAJA CALIFORNIA SUR", "COLIMA", "NAYARIT", "SINALOA", "SONORA",
    ],
    # Yucatan no existe en el catalogo de entidades (IMSS-Bienestar no opera
    # ahi) -- se deja en la lista tal como la dio el usuario, simplemente
    # nunca hace match.
    "Región Sureste": [
        "CAMPECHE", "CHIAPAS", "OAXACA", "QUINTANA ROO", "TABASCO", "YUCATÁN",
    ],
    "Región Suroeste": ["GUERRERO", "MICHOACÁN", "MORELOS", "PUEBLA", "TLAXCALA"],
}

# Entidad -> region, para agrupar rapido. Cualquier entidad que no aparezca
# aqui (no deberia pasar con el catalogo actual) cae en "Otras" en vez de
# perderse en silencio.
_ENTIDAD_A_REGION = {
    entidad: region for region, entidades in REGIONES.items() for entidad in entidades
}

OTRAS = "Otras"


def region_de(nombre_entidad: str) -> str:
    return _ENTIDAD_A_REGION.get(nombre_entidad.upper(), OTRAS)


def orden_regiones() -> list[str]:
    return [*REGIONES.keys(), OTRAS]
