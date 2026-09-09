// Exporta la programación de una entidad+jornada a .xlsx replicando el
// formato institucional real (mismo diseño que tools/captura-programacion/,
// pero aquí los datos -- jornada, entidad, coordinador, visitas -- vienen
// del backend real en vez de localStorage).
import ExcelJS from 'exceljs';

const COLUMNAS = [
  { key: 'fecha_distribucion_programada', label: 'FECHA DE DISTRIBUCIÓN PROGRAMADA', width: 31.14, align: 'center', type: 'date' },
  { key: 'unidad_medica', label: 'CLUES', width: 19.0, align: 'center' },
  { key: 'unidad_medica_nombre', label: 'NOMBRE DE LA UNIDAD', width: 49.0, align: 'left' },
  { key: 'claves_a_desplazar', label: 'CLAVES A DESPLAZAR', width: 23.29, align: 'center', type: 'number' },
  { key: 'piezas_medicamento', label: 'PIEZAS DE MEDICAMENTO', width: 23.57, align: 'center', type: 'number' },
  { key: 'piezas_material_curacion', label: 'PIEZAS DE MATERIAL DE CURACIÓN', width: 28.57, align: 'center', type: 'number' },
  { key: 'tipo_unidad_medica', label: 'TIPO DE UNIDAD MÉDICA', width: 24.71, align: 'center' },
  { key: 'quien_recibe', label: '¿QUIÉN RECIBE EN UNIDAD?', width: 42.0, align: 'left' },
  { key: 'telefono', label: 'TELÉFONO', width: 28.86, align: 'center' },
  { key: 'correo', label: 'CORREO', width: 34.57, align: 'left' },
];

const ESTILO = {
  tealBg: 'FF406E67',
  tealText: 'FFFFFFFF',
  tanBg: 'FFDDC9A3',
  valorText: 'FF00594C',
  bordeThin: { style: 'thin' },
};

// La cola del titulo depende de la categoria de la jornada -- antes estaba
// fija asumiendo "primer nivel" siempre, pero ya hay jornadas de "segundo y
// tercer nivel" tambien (blueprint 2026-08-24).
const TITULO_POR_CATEGORIA = {
  primer_nivel: 'A UNIDADES DE PRIMER NIVEL DE ATENCIÓN',
  segundo_tercer_nivel: 'A UNIDADES DE SEGUNDO Y TERCER NIVEL DE ATENCIÓN',
};

function tituloInstitucional(categoria) {
  const cola = TITULO_POR_CATEGORIA[categoria] || TITULO_POR_CATEGORIA.primer_nivel;
  return `PROGRAMACIÓN DE RUTAS DE LA SALUD PARA ABASTECER PIEZAS DE MEDICAMENTOS\nY MATERIAL DE CURACIÓN ${cola}`;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatearFecha(fechaISO) {
  const [, m, d] = fechaISO.split('-').map(Number);
  return `${String(d).padStart(2, '0')} DE ${MESES[m - 1].toUpperCase()}`;
}

function formatearRangoFechas(inicio, fin) {
  const anio = fin.split('-')[0];
  return `${formatearFecha(inicio)} AL ${formatearFecha(fin)} ${anio}`;
}

function aplicarBordeCompleto(cell) {
  cell.border = {
    top: ESTILO.bordeThin,
    bottom: ESTILO.bordeThin,
    left: ESTILO.bordeThin,
    right: ESTILO.bordeThin,
  };
}

async function cargarImagenBase64(ruta) {
  const resp = await fetch(ruta);
  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binario = '';
  for (let i = 0; i < bytes.byteLength; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario);
}

export async function exportarProgramacionExcel({ jornada, entidad, visitas }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reporte', { views: [{ showGridLines: false }] });

  ws.columns = COLUMNAS.map((c) => ({ width: c.width }));
  ws.getRow(2).height = 30;
  ws.getRow(3).height = 30;
  ws.getRow(4).height = 30;
  ws.getRow(6).height = 32.45;
  ws.getRow(7).height = 45.6;

  ws.mergeCells('D2:I4');
  const tituloCell = ws.getCell('D2');
  tituloCell.value = `${tituloInstitucional(jornada.categoria)}\n${formatearRangoFechas(jornada.fecha_inicio, jornada.fecha_fin)}`;
  tituloCell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  tituloCell.font = { bold: true, size: 16, name: 'Noto Sans', color: { argb: ESTILO.tealText } };
  tituloCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ESTILO.tealBg } };

  ws.mergeCells('A4:C4');
  const etiquetaCell = ws.getCell('A4');
  etiquetaCell.value = jornada.nombre;
  etiquetaCell.font = { size: 24, name: 'Aptos Narrow' };
  etiquetaCell.alignment = { vertical: 'middle', horizontal: 'center' };
  etiquetaCell.border = { bottom: ESTILO.bordeThin, left: ESTILO.bordeThin, right: ESTILO.bordeThin };

  ws.mergeCells('J2:J4');

  const etiquetaHeader = (coord, texto, align) => {
    const cell = ws.getCell(coord);
    cell.value = texto;
    cell.font = { bold: true, name: 'Noto Sans', color: { argb: ESTILO.tealText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ESTILO.tealBg } };
    cell.alignment = { vertical: 'middle', horizontal: align || 'center', wrapText: true };
    aplicarBordeCompleto(cell);
  };
  const valorHeader = (coord, texto) => {
    const cell = ws.getCell(coord);
    cell.value = texto;
    cell.font = { bold: true, size: 12, name: 'Noto Sans', color: { argb: ESTILO.valorText } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    aplicarBordeCompleto(cell);
  };

  etiquetaHeader('A6', 'ENTIDAD: ');
  ws.mergeCells('B6:C6');
  valorHeader('B6', entidad.nombre);
  aplicarBordeCompleto(ws.getCell('C6'));

  etiquetaHeader('E6', 'COORDINADOR: ', 'left');
  ws.mergeCells('F6:G6');
  valorHeader('F6', entidad.coordinador);
  aplicarBordeCompleto(ws.getCell('G6'));

  etiquetaHeader('I6', 'NÚMERO DE UNIDADES DE 1er NIVEL:', 'left');
  valorHeader('J6', visitas.length);

  const headerRow = ws.getRow(7);
  COLUMNAS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true, size: 10, name: 'Noto Sans' };
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ESTILO.tanBg } };
    aplicarBordeCompleto(cell);
  });
  headerRow.commit();

  visitas.forEach((v, idx) => {
    const row = ws.getRow(8 + idx);
    COLUMNAS.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      let value = v[col.key];
      if (col.type === 'date' && value) {
        const [y, m, d] = value.split('-').map(Number);
        value = new Date(Date.UTC(y, m - 1, d));
        cell.numFmt = 'dd/mm/yyyy';
      } else if (col.type === 'number') {
        value = Number(value) || 0;
      }
      cell.value = value === '' || value == null ? null : value;
      cell.font = { name: 'Aptos Narrow', size: 11 };
      cell.alignment = { horizontal: col.align, vertical: 'middle', wrapText: true };
      aplicarBordeCompleto(cell);
    });
    row.commit();
  });

  try {
    const [logoRutas, logoMaza] = await Promise.all([
      cargarImagenBase64('/logos/logo_rutas.png'),
      cargarImagenBase64('/logos/logo_maza.png'),
    ]);
    const idRutas = wb.addImage({ base64: `data:image/png;base64,${logoRutas}`, extension: 'png' });
    ws.addImage(idRutas, { tl: { col: 0, row: 1 }, br: { col: 3, row: 3 } });
    const idMaza = wb.addImage({ base64: `data:image/png;base64,${logoMaza}`, extension: 'png' });
    ws.addImage(idMaza, { tl: { col: 9, row: 1 }, br: { col: 10, row: 4 } });
  } catch (e) {
    console.warn('No se pudieron insertar los logos en el Excel:', e);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const nombreArchivo = `${entidad.nombre.replace(/\s+/g, '_')}_${jornada.nombre.replace(/\s+/g, '_')}_RUTAS_CLUES_PIEZAS.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
