"""Formato de fecha en espanol usado en el texto de las presentaciones
generadas (entregas y picking_packing) -- ej. "07 de septiembre de 2026"."""

_MESES_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def formato_fecha_es(fecha):
    return f"{fecha.day:02d} de {_MESES_ES[fecha.month - 1]} de {fecha.year}"
