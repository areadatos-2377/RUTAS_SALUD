import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { comprimirImagen } from '../utils/comprimirImagen';
import './EvidenciaPanel.css';

// Adaptado de EvidenciaPanel.jsx (pestaña Distribución) -- misma mecanica de
// subida/borrado por categoria, pero aqui la evidencia es de la ENTIDAD
// completa (no de una unidad medica puntual). La fecha ya no se elige aqui
// dentro -- se abre directo desde la celda de la matriz (entidad x dia) que
// se haya clickeado, y este panel queda acotado a esa fecha unicamente
// (antes mostraba TODO lo subido de la entidad, de cualquier dia).
const CATEGORIAS = [
  { key: 'foto', label: 'Fotos', icono: '🖼️', accept: '.jpg,.jpeg,.png' },
  { key: 'video', label: 'Video', icono: '🎞️', accept: '.mp4,.mov' },
];

const DIA_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function fechaLegible(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${DIA_SEMANA[d.getUTCDay()]} ${dd}/${mm}/${d.getUTCFullYear()}`;
}

export default function PickingPackingEvidenciaPanel({ jornada, entidad, fecha, onCerrar }) {
  const [evidencias, setEvidencias] = useState(null);
  const [error, setError] = useState(null);
  const [subiendoCategoria, setSubiendoCategoria] = useState(null);

  useEffect(() => {
    api.getAll(`/api/picking-packing/evidencias/?jornada=${jornada.id}&entidad=${entidad.id}&fecha=${fecha}`)
      .then(setEvidencias)
      .catch(() => setError('No se pudo cargar la evidencia de este día.'));
  }, [jornada.id, entidad.id, fecha]);

  async function onSubirArchivos(categoria, e) {
    const archivos = Array.from(e.target.files || []);
    if (archivos.length === 0) return;
    setSubiendoCategoria(categoria.key);
    setError(null);
    try {
      for (const archivo of archivos) {
        // Solo las fotos se comprimen en el navegador -- el video se sube
        // tal cual (sin precedente de compresion de video en el codigo,
        // decision explicita: no vale la pena la complejidad/tamano extra
        // de una libreria de recompresion en el navegador para esto).
        const archivoFinal = categoria.key === 'foto' ? await comprimirImagen(archivo) : archivo;
        const formData = new FormData();
        formData.append('jornada', jornada.id);
        formData.append('entidad', entidad.id);
        formData.append('fecha', fecha);
        formData.append('file', archivoFinal);
        const evidencia = await api.post('/api/picking-packing/evidencias/', formData);
        setEvidencias((actuales) => [evidencia, ...actuales]);
      }
    } catch (err) {
      const detalle = err instanceof ApiError && err.data
        ? err.data.detail || err.data.fecha?.[0]
        : null;
      setError(detalle || 'No se pudo subir uno de los archivos.');
    } finally {
      setSubiendoCategoria(null);
      e.target.value = '';
    }
  }

  async function onEliminarEvidencia(evidenciaId) {
    if (!confirm('¿Eliminar esta evidencia? No se puede deshacer.')) return;
    setError(null);
    try {
      await api.del(`/api/picking-packing/evidencias/${evidenciaId}/`);
      setEvidencias((actuales) => actuales.filter((ev) => ev.id !== evidenciaId));
    } catch {
      setError('No se pudo eliminar la evidencia.');
    }
  }

  function cerrarConResumen() {
    if (!evidencias) {
      onCerrar();
      return;
    }
    const tipos = evidencias.map((ev) => ev.tipo);
    onCerrar({
      tiene_evidencia_foto: tipos.includes('foto'),
      tiene_evidencia_video: tipos.includes('video'),
    });
  }

  return (
    <div className="evidencia-overlay" onClick={cerrarConResumen}>
      <div className="evidencia-panel" onClick={(e) => e.stopPropagation()}>
        <div className="evidencia-panel__header">
          <div>
            <p className="crumb">{jornada.nombre} · {fechaLegible(fecha)}</p>
            <h3>{entidad.nombre}</h3>
          </div>
          <button className="btn-ghost" onClick={cerrarConResumen}>Cerrar</button>
        </div>

        {error && <p className="login-error">{error}</p>}

        {evidencias === null && !error && <p className="tabla-cargando">Cargando…</p>}

        {evidencias && CATEGORIAS.map((categoria) => {
          const evidenciasCategoria = evidencias.filter((ev) => ev.tipo === categoria.key);
          const subiendo = subiendoCategoria === categoria.key;
          return (
            <div key={categoria.key} className="evidencia-categoria">
              <h4 className="evidencia-categoria__titulo">
                <span aria-hidden="true">{categoria.icono}</span> {categoria.label}
              </h4>

              <div className="evidencia-panel__lista">
                {evidenciasCategoria.length === 0 && (
                  <p className="evidencia-panel__vacio">Todavía no hay {categoria.label.toLowerCase()} para este día.</p>
                )}
                {evidenciasCategoria.map((ev) => (
                  <div key={ev.id} className="evidencia-item">
                    <div className="evidencia-item__info">
                      <a href={ev.url_descarga} target="_blank" rel="noreferrer">{ev.nombre_original}</a>
                      <span>subido {new Date(ev.creado_en).toLocaleString('es-MX')}</span>
                    </div>
                    <button className="btn-ghost" onClick={() => onEliminarEvidencia(ev.id)}>Eliminar</button>
                  </div>
                ))}
              </div>

              <div className="evidencia-panel__subir">
                <input
                  type="file"
                  multiple
                  accept={categoria.accept}
                  disabled={subiendo}
                  onChange={(e) => onSubirArchivos(categoria, e)}
                />
                {subiendo && <span className="evidencia-panel__subiendo">Subiendo…</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
