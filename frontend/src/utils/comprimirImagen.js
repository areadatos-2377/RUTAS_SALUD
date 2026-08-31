// Redimensiona/comprime una foto en el navegador antes de subirla -- una
// foto de celular sin tocar pesa 3-8MB (pensada para imprimir), pero como
// evidencia en pantalla no hace falta esa resolucion. Se hace aqui, antes
// del fetch, para no tener que tocar el backend/almacenamiento: al
// servidor le sigue llegando un archivo normal, solo que mas chico.
const DIMENSION_MAXIMA = 1920;
const CALIDAD_JPEG = 0.8;
// Si ya pesa menos que esto no vale la pena recomprimir -- evita artefactos
// de una recompresion innecesaria en fotos que ya venian ligeras.
const UMBRAL_BYTES = 500 * 1024;

// HEIC/HEIF: los navegadores de escritorio (Chrome, Firefox) no pueden
// decodificarlas via <img>/canvas todavia, aunque la extension este en la
// lista de formatos aceptados (algunos iPhones las mandan asi). Se suben
// tal cual sin comprimir en vez de fallar.
const TIPOS_COMPRIMIBLES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function comprimirImagen(archivo) {
  if (!TIPOS_COMPRIMIBLES.has(archivo.type) || archivo.size <= UMBRAL_BYTES) {
    return Promise.resolve(archivo);
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      const escala = Math.min(1, DIMENSION_MAXIMA / Math.max(img.width, img.height));
      const ancho = Math.round(img.width * escala);
      const alto = Math.round(img.height * escala);

      const canvas = document.createElement('canvas');
      canvas.width = ancho;
      canvas.height = alto;
      canvas.getContext('2d').drawImage(img, 0, 0, ancho, alto);

      canvas.toBlob(
        (blob) => {
          // Si el canvas no logro producir el blob (raro, pero posible en
          // algunos navegadores/imagenes corruptas), mejor subir el
          // original que no subir nada.
          if (!blob) {
            resolve(archivo);
            return;
          }
          const nombreComprimido = archivo.name.replace(/\.[^.]+$/, '') + '.jpg';
          resolve(new File([blob], nombreComprimido, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        CALIDAD_JPEG,
      );
    };

    // Imagen que el navegador no pudo decodificar -- subir tal cual en vez
    // de bloquear la subida.
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(archivo);
    };

    img.src = url;
  });
}
