function valorCelda(fila, columna) {
  const valor = typeof columna.valor === 'function' ? columna.valor(fila) : fila[columna.valor];
  return valor ?? '';
}

const COLORES = {
  verde: 'FF245E50',
  verdeTexto: 'FF0B6555',
  beige: 'FFE1CBAA',
  borde: 'FFD8BF98',
  amarillo: 'FFFFFF00',
  rojo: 'FFC62828',
  blanco: 'FFFFFFFF',
  negro: 'FF1A1A1A',
  gris: 'FF8A8A8A',
};

let logoInstitucionalPromise;

function textoCorte() {
  const ahora = new Date();
  const opcionesFecha = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' };
  const opcionesHora = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' };
  const fecha = new Intl.DateTimeFormat('es-MX', opcionesFecha).format(ahora);
  const hora = new Intl.DateTimeFormat('es-MX', opcionesHora).format(ahora);
  return `Corte general al ${fecha} (${hora} horas)`;
}

async function cargarLogoInstitucional() {
  if (!logoInstitucionalPromise) {
    logoInstitucionalPromise = fetch('/logos/logo_rutas.png')
      .then(async (respuesta) => {
        if (!respuesta.ok) return null;
        const blob = await respuesta.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const lector = new FileReader();
          lector.onload = () => resolve(lector.result);
          lector.onerror = reject;
          lector.readAsDataURL(blob);
        });
        return { buffer: await blob.arrayBuffer(), dataUrl };
      })
      .catch(() => null);
  }
  return logoInstitucionalPromise;
}

function nombreSeguro(nombre) {
  const nombreSanitizado = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return nombreSanitizado
    ? nombreSanitizado.charAt(0).toUpperCase() + nombreSanitizado.slice(1)
    : nombreSanitizado;
}

function rangoPorcentaje(valor) {
  const porcentaje = Number.parseFloat(String(valor).replace(',', '.'));
  if (!Number.isFinite(porcentaje)) return null;
  if (porcentaje <= 70) return 'rojo';
  if (porcentaje <= 90) return 'amarillo';
  return 'verde';
}

function descargarBlob(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

function aplicarBorde(celda) {
  const borde = { style: 'thin', color: { argb: COLORES.borde } };
  celda.border = { top: borde, left: borde, bottom: borde, right: borde };
}

function estilizarCeldaExcel(celda, columna, esTotal = false, esPrimera = false) {
  celda.alignment = {
    horizontal: columna.alineacion || (columna.tipo === 'texto' ? 'left' : 'center'),
    vertical: 'middle',
    wrapText: true,
  };
  aplicarBorde(celda);

  const tieneValor = celda.value !== '' && celda.value !== '—' && celda.value !== '--';
  const rango = columna.tipo === 'porcentaje' && tieneValor ? rangoPorcentaje(celda.value) : null;
  if (rango) {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES[rango] } };
    celda.font = { bold: true, color: { argb: rango === 'amarillo' ? COLORES.negro : COLORES.blanco } };
    return;
  }

  if (esTotal) {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: esPrimera ? COLORES.beige : COLORES.verde } };
    celda.font = { bold: true, color: { argb: esPrimera ? COLORES.negro : COLORES.blanco } };
    return;
  }

  if (columna.tipo === 'numero' && tieneValor) {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.verde } };
    celda.font = { bold: true, color: { argb: COLORES.blanco } };
    if (typeof celda.value === 'number') celda.numFmt = '#,##0';
  } else if (columna.tipo === 'booleano' && celda.value === 'Sí') {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.verde } };
    celda.font = { bold: true, color: { argb: COLORES.blanco } };
  } else {
    celda.font = { color: { argb: tieneValor ? COLORES.negro : COLORES.gris } };
  }
}

export async function exportarTablaExcel({ titulo, subtitulo, nombreArchivo, columnas, filas, totales, orientacion = 'landscape' }) {
  const { default: ExcelJS } = await import('exceljs');
  const logo = await cargarLogoInstitucional();
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Rutas de la salud';
  libro.created = new Date();

  const hoja = libro.addWorksheet('Reporte', {
    views: [{ state: 'frozen', ySplit: 7 }],
    pageSetup: { orientation: orientacion, fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  hoja.columns = columnas.map((columna) => ({ width: columna.ancho || 18 }));
  hoja.properties.defaultRowHeight = 19;

  const finLogo = Math.max(1, Math.floor(columnas.length * 0.34));
  const inicioTitulo = Math.min(finLogo + 1, columnas.length);
  hoja.mergeCells(1, 1, 3, finLogo);
  hoja.mergeCells(1, inicioTitulo, 4, columnas.length);
  hoja.mergeCells(4, 1, 4, finLogo);

  if (logo) {
    const imagenId = libro.addImage({ buffer: logo.buffer, extension: 'png' });
    hoja.addImage(imagenId, { tl: { col: 0.12, row: 0.45 }, ext: { width: 205, height: 25 } });
  }

  const celdaDistribucion = hoja.getCell(4, 1);
  celdaDistribucion.value = subtitulo || 'DISTRIBUCIÓN ORDINARIA';
  celdaDistribucion.font = { bold: true, color: { argb: COLORES.verdeTexto }, size: 10 };
  celdaDistribucion.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  const celdaTitulo = hoja.getCell(1, inicioTitulo);
  celdaTitulo.value = titulo;
  celdaTitulo.font = { bold: true, color: { argb: COLORES.blanco }, size: 13 };
  celdaTitulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.verde } };
  celdaTitulo.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  [1, 2, 3, 4].forEach((fila) => { hoja.getRow(fila).height = 17; });

  hoja.mergeCells(6, 1, 6, columnas.length);
  const celdaCorte = hoja.getCell(6, 1);
  celdaCorte.value = textoCorte();
  celdaCorte.font = { bold: true, color: { argb: COLORES.negro }, size: 10 };
  celdaCorte.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.beige } };
  celdaCorte.alignment = { horizontal: 'center', vertical: 'middle' };
  hoja.getRow(6).height = 22;

  const encabezado = hoja.getRow(7);
  columnas.forEach((columna, indice) => {
    const celda = encabezado.getCell(indice + 1);
    celda.value = columna.etiqueta;
    celda.font = { bold: true, color: { argb: COLORES.verdeTexto }, size: 9 };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.beige } };
    celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    aplicarBorde(celda);
  });
  encabezado.height = 38;

  filas.forEach((fila) => {
    const filaExcel = hoja.addRow(columnas.map((columna) => valorCelda(fila, columna)));
    filaExcel.height = 19;
    columnas.forEach((columna, indice) => estilizarCeldaExcel(filaExcel.getCell(indice + 1), columna));
  });

  if (totales) {
    const filaTotales = hoja.addRow(columnas.map((columna, indice) => (
      indice === 0 ? 'Totales' : valorCelda(totales, columna)
    )));
    filaTotales.height = 21;
    columnas.forEach((columna, indice) => estilizarCeldaExcel(filaTotales.getCell(indice + 1), columna, true, indice === 0));
  }

  hoja.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7, column: columnas.length } };
  hoja.headerFooter.oddFooter = '&L Rutas de la salud&C&P de &N';

  const buffer = await libro.xlsx.writeBuffer();
  descargarBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${nombreSeguro(nombreArchivo)}.xlsx`,
  );
}

function dibujarCabeceraPdf(documento, logo, titulo, subtitulo, corte) {
  const anchoPagina = documento.internal.pageSize.getWidth();
  const inicioTitulo = anchoPagina * 0.34;
  if (logo) documento.addImage(logo.dataUrl, 'PNG', 14, 10, Math.min(82, inicioTitulo - 22), 10.1);

  documento.setFont('helvetica', 'bold');
  documento.setFontSize(8.5);
  documento.setTextColor(11, 101, 85);
  documento.text(subtitulo || 'DISTRIBUCIÓN ORDINARIA', 14 + ((inicioTitulo - 14) / 2), 29, { align: 'center', maxWidth: inicioTitulo - 20 });

  documento.setFillColor(36, 94, 80);
  documento.rect(inicioTitulo, 8, anchoPagina - inicioTitulo - 14, 26, 'F');
  documento.setTextColor(255, 255, 255);
  documento.setFontSize(11);
  const lineasTitulo = documento.splitTextToSize(titulo, anchoPagina - inicioTitulo - 22);
  const altoTexto = lineasTitulo.length * 4.3;
  documento.text(lineasTitulo, inicioTitulo + ((anchoPagina - inicioTitulo - 14) / 2), 21 - (altoTexto / 2) + 3, { align: 'center' });

  documento.setFillColor(225, 203, 170);
  documento.rect(14, 39, anchoPagina - 28, 9, 'F');
  documento.setTextColor(26, 26, 26);
  documento.setFontSize(8.5);
  documento.text(corte, anchoPagina / 2, 44.8, { align: 'center' });
}

export async function exportarTablaPdf({ titulo, subtitulo, nombreArchivo, columnas, filas, totales, orientacion = 'landscape' }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const logo = await cargarLogoInstitucional();
  const tablaAmplia = columnas.length > 8;
  const documento = new jsPDF({
    orientation: orientacion,
    unit: 'mm',
    format: tablaAmplia ? 'a3' : 'a4',
  });
  const corte = textoCorte();
  const cuerpo = filas.map((fila) => columnas.map((columna) => String(valorCelda(fila, columna))));
  if (totales) {
    cuerpo.push(columnas.map((columna, indice) => (
      indice === 0 ? 'Totales' : String(valorCelda(totales, columna))
    )));
  }

  autoTable(documento, {
    startY: 52,
    head: [columnas.map((columna) => columna.etiqueta)],
    body: cuerpo,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: tablaAmplia ? 5.8 : 7.5,
      cellPadding: 1.6,
      overflow: 'linebreak',
      lineColor: [216, 191, 152],
      lineWidth: 0.2,
      textColor: [26, 26, 26],
      valign: 'middle',
    },
    headStyles: { fillColor: [225, 203, 170], textColor: [11, 101, 85], fontStyle: 'bold', halign: 'center' },
    horizontalPageBreak: tablaAmplia,
    horizontalPageBreakRepeat: tablaAmplia ? [0, 1] : undefined,
    margin: { top: 52, right: 14, bottom: 12, left: 14 },
    willDrawPage: () => dibujarCabeceraPdf(documento, logo, titulo, subtitulo, corte),
    didParseCell: (dato) => {
      if (dato.section !== 'body') return;
      const esTotal = Boolean(totales) && dato.row.index === cuerpo.length - 1;
      const columna = columnas[dato.column.index];
      const valor = dato.cell.raw;
      const tieneValor = valor !== '' && valor !== '—' && valor !== '--';
      const rango = columna.tipo === 'porcentaje' && tieneValor ? rangoPorcentaje(valor) : null;
      dato.cell.styles.halign = columna.alineacion || (columna.tipo === 'texto' ? 'left' : 'center');

      if (rango) {
        dato.cell.styles.fillColor = rango === 'rojo'
          ? [198, 40, 40]
          : rango === 'amarillo' ? [255, 255, 0] : [36, 94, 80];
        dato.cell.styles.textColor = rango === 'amarillo' ? [0, 0, 0] : [255, 255, 255];
        dato.cell.styles.fontStyle = 'bold';
      } else if (esTotal) {
        dato.cell.styles.fillColor = dato.column.index === 0 ? [225, 203, 170] : [36, 94, 80];
        dato.cell.styles.textColor = dato.column.index === 0 ? [26, 26, 26] : [255, 255, 255];
        dato.cell.styles.fontStyle = 'bold';
      } else if (columna.tipo === 'numero' && tieneValor) {
        dato.cell.styles.fillColor = [36, 94, 80];
        dato.cell.styles.textColor = [255, 255, 255];
        dato.cell.styles.fontStyle = 'bold';
      } else if (columna.tipo === 'booleano' && valor === 'Sí') {
        dato.cell.styles.fillColor = [36, 94, 80];
        dato.cell.styles.textColor = [255, 255, 255];
        dato.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: ({ pageNumber }) => {
      documento.setFont('helvetica', 'normal');
      documento.setFontSize(7);
      documento.text(`Página ${pageNumber}`, documento.internal.pageSize.getWidth() - 24, documento.internal.pageSize.getHeight() - 6);
    },
  });

  documento.save(`${nombreSeguro(nombreArchivo)}.pdf`);
}