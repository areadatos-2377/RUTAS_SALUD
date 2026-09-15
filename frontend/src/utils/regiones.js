// Espejo de backend/entregas/regiones.py -- agrupacion fija de entidades en
// regiones operativas, definida a mano con el usuario (no viene de un
// catalogo ni cambia por temporada). Si el mapeo cambia, hay que
// actualizar los 2 archivos: este y backend/entregas/regiones.py.
export const REGIONES = {
  'Región Centro': ['CIUDAD DE MÉXICO', 'ESTADO DE MÉXICO', 'HIDALGO'],
  'Región Noreste': ['SAN LUIS POTOSÍ', 'TAMAULIPAS', 'VERACRUZ', 'ZACATECAS'],
  'Región Noroeste': [
    'BAJA CALIFORNIA', 'BAJA CALIFORNIA SUR', 'COLIMA', 'NAYARIT', 'SINALOA', 'SONORA',
  ],
  'Región Sureste': ['CAMPECHE', 'CHIAPAS', 'OAXACA', 'QUINTANA ROO', 'TABASCO', 'YUCATÁN'],
  'Región Suroeste': ['GUERRERO', 'MICHOACÁN', 'MORELOS', 'PUEBLA', 'TLAXCALA'],
};

export const OTRAS = 'Otras';

const ENTIDAD_A_REGION = Object.fromEntries(
  Object.entries(REGIONES).flatMap(([region, entidades]) => entidades.map((e) => [e, region])),
);

export function regionDe(nombreEntidad) {
  return ENTIDAD_A_REGION[(nombreEntidad || '').toUpperCase()] || OTRAS;
}

export function ordenRegiones() {
  return [...Object.keys(REGIONES), OTRAS];
}
