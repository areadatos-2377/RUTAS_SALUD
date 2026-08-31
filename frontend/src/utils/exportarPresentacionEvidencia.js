// Genera un .pptx con las fotos de evidencia que el usuario marco, en
// cuadricula de 2x4 por diapositiva, una diapositiva (o varias, si hay mas
// de 8) por entidad -- nunca se mezclan fotos de dos entidades distintas
// en la misma hoja. Mismo patron que exportarProgramacionExcel.js: todo
// se arma en el navegador (fetch + base64), sin tocar el backend.
import pptxgen from 'pptxgenjs';

const COLUMNAS = 4;
const FILAS = 2;
const POR_DIAPOSITIVA = COLUMNAS * FILAS;

const MARGEN = 0.3;
const GAP = 0.15;
const ANCHO_COL = (13.33 - MARGEN * 2 - GAP * (COLUMNAS - 1)) / COLUMNAS;
const ALTO_IMAGEN = 2.6;
const ALTO_LEYENDA = 0.5;
const ALTO_FILA = ALTO_IMAGEN + ALTO_LEYENDA + 0.1;
const Y_INICIO_CUADRICULA = 0.9;

// Las fotos que ya se comprimieron al subirlas (ver comprimirImagen.js)
// quedan en JPEG, pero las que no llegaron al umbral de compresion (o
// vinieron de un formato que el navegador no pudo decodificar, como HEIC)
// se guardan tal cual -- pueden ser PNG, WEBP, etc. Si se le miente a
// pptxgenjs sobre el tipo (ej. decir "jpeg" cuando en realidad es PNG), la
// diapositiva queda con un espacio en blanco en vez de la foto.
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Reintenta una vez -- la descarga cruza a un dominio aparte (R2, fuera del
// proxy de la app) y de vez en cuando una peticion individual falla por
// razones transitorias de red/CDN que no tienen que ver con el archivo en
// si. Sin esto, una sola foto fallando dejaba esa diapositiva sin imagen.
//
// cache:'reload' es necesario, no opcional: la miniatura de esta misma foto
// ya se mostro antes en <img> (modo no-cors, respuesta "opaca"), y el
// navegador guarda esa respuesta en su cache HTTP para esa URL exacta. Si
// fetch() reutiliza esa entrada cacheada, la respuesta sigue siendo opaca y
// el navegador la bloquea como si no tuviera CORS -- aunque el servidor si
// lo tenga configurado. Forzar una peticion nueva evita reusar esa copia.
async function cargarImagenBase64(url, intentos = 2) {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const resp = await fetch(url, { cache: 'reload' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const tipo = resp.headers.get('content-type') || 'image/jpeg';
      const buffer = await resp.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binario = '';
      for (let i = 0; i < bytes.byteLength; i++) binario += String.fromCharCode(bytes[i]);
      return { base64: btoa(binario), tipo };
    } catch (err) {
      if (intento === intentos) throw err;
      await esperar(500);
    }
  }
}

function agruparPorEntidad(fotos) {
  const grupos = new Map();
  for (const foto of fotos) {
    const lista = grupos.get(foto.entidadNombre) || [];
    lista.push(foto);
    grupos.set(foto.entidadNombre, lista);
  }
  return grupos;
}

function enGruposDe(lista, tamano) {
  const grupos = [];
  for (let i = 0; i < lista.length; i += tamano) grupos.push(lista.slice(i, i + tamano));
  return grupos;
}

export async function exportarPresentacionEvidencia({ jornada, fotos }) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';

  const porEntidad = agruparPorEntidad(fotos);

  for (const [entidadNombre, fotosEntidad] of porEntidad) {
    for (const grupo of enGruposDe(fotosEntidad, POR_DIAPOSITIVA)) {
      const slide = pptx.addSlide();
      slide.addText(`${entidadNombre} — ${jornada.nombre}`, {
        x: MARGEN, y: 0.15, w: 13.33 - MARGEN * 2, h: 0.55,
        fontSize: 20, bold: true, fontFace: 'Arial',
      });

      for (const [i, foto] of grupo.entries()) {
        const col = i % COLUMNAS;
        const fila = Math.floor(i / COLUMNAS);
        const x = MARGEN + col * (ANCHO_COL + GAP);
        const y = Y_INICIO_CUADRICULA + fila * ALTO_FILA;

        try {
          const { base64, tipo } = await cargarImagenBase64(foto.urlDescarga);
          slide.addImage({
            data: `data:${tipo};base64,${base64}`,
            x, y, w: ANCHO_COL, h: ALTO_IMAGEN,
            sizing: { type: 'contain', w: ANCHO_COL, h: ALTO_IMAGEN },
          });
        } catch (err) {
          // Una foto que no se pudo descargar no debe tronar toda la
          // presentacion -- se deja la leyenda igual, sin imagen.
          console.warn(`No se pudo cargar la foto de ${foto.clues}:`, err);
        }

        slide.addText(`${foto.clues}\n${foto.nombreUnidad}`, {
          x, y: y + ALTO_IMAGEN + 0.05, w: ANCHO_COL, h: ALTO_LEYENDA,
          fontSize: 9, align: 'center', fontFace: 'Arial',
        });
      }
    }
  }

  const nombreArchivo = `${jornada.nombre.replace(/\s+/g, '_')}_evidencia_fotografica.pptx`;
  await pptx.writeFile({ fileName: nombreArchivo });
}
