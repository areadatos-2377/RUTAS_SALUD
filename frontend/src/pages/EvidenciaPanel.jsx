import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { comprimirImagen } from '../utils/comprimirImagen';
import './EvidenciaPanel.css';

// "documento" agrupa dos tipos del backend (pdf y documento, inferidos por
// extension en entregas/storage.py) bajo una sola categoria de UI -- al
// usuario le basta con "Documentos", no necesita saber que Word y PDF se
// guardan con tipo distinto.
const CATEGORIAS = [
  { key: 'imagen', label: 'Imágenes', icono: '🖼️', accept: '.jpg,.jpeg,.png,.heic,.heif,.webp', tipos: ['foto'] },
  { key: 'documento', label: 'Documentos', icono: '📄', accept: '.pdf,.doc,.docx', tipos: ['pdf', 'documento'] },
  { key: 'video', label: 'Video', icono: '🎞️', accept: '.mp4,.mov', tipos: ['video'] },
];

export default function EvidenciaPanel({ visita, onCerrar }) {
  const [entrega, setEntrega] = useState(null);
  const [error, setError] = useState(null);
  const [subiendoCategoria, setSubiendoCategoria] = useState(null);
  const [guardandoEntregado, setGuardandoEntregado] = useState(false);

  useEffect(() => {
    api.post('/api/entregas/', { programacion_visita: visita.id })
      .then(setEntrega)
      .catch(() => setError('No se pudo abrir la entrega de esta unidad.'));
  }, [visita.id]);

  async function onCambiarEntregado(e) {
    const entregado = e.target.checked;
    setGuardandoEntregado(true);
    setError(null);
    try {
      const actualizada = await api.patch(`/api/entregas/${entrega.id}/`, {
        entregado,
        fecha_entrega: entregado ? (entrega.fecha_entrega || new Date().toISOString().slice(0, 10)) : null,
      });
      setEntrega(actualizada);
    } catch {
      setError('No se pudo actualizar el estatus de entrega.');
    } finally {
      setGuardandoEntregado(false);
    }
  }

  async function onSubirArchivos(categoria, e) {
    const archivos = Array.from(e.target.files || []);
    if (archivos.length === 0) return;
    setSubiendoCategoria(categoria.key);
    setError(null);
    try {
      for (const archivo of archivos) {
        // Solo las fotos se comprimen -- documentos y video se suben tal
        // cual (comprimir un PDF o un video ya es otro problema, ver
        // conversacion sobre miniaturas si esto no basta).
        const archivoFinal = categoria.key === 'imagen' ? await comprimirImagen(archivo) : archivo;
        const formData = new FormData();
        formData.append('file', archivoFinal);
        const evidencia = await api.post(`/api/entregas/${entrega.id}/evidencias/`, formData);
        setEntrega((actual) => ({ ...actual, evidencias: [evidencia, ...actual.evidencias] }));
      }
    } catch (err) {
      const detalle = err instanceof ApiError && err.data ? err.data.detail : null;
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
      await api.del(`/api/evidencias/${evidenciaId}/`);
      setEntrega((actual) => ({
        ...actual,
        evidencias: actual.evidencias.filter((ev) => ev.id !== evidenciaId),
      }));
    } catch {
      setError('No se pudo eliminar la evidencia.');
    }
  }

  // Cada archivo ya se guarda al instante al subirlo (no hay "borrador" que
  // confirmar) -- lo que faltaba era avisarle a la tabla que hay evidencia
  // nueva sin que el usuario tuviera que recargar la pagina para verla.
  function cerrarConResumen() {
    if (!entrega) {
      onCerrar();
      return;
    }
    const tipos = entrega.evidencias.map((ev) => ev.tipo);
    onCerrar({
      tiene_evidencia_imagen: tipos.includes('foto'),
      tiene_evidencia_documento: tipos.includes('pdf') || tipos.includes('documento'),
      tiene_evidencia_video: tipos.includes('video'),
    });
  }

  return (
    <div className="evidencia-overlay" onClick={cerrarConResumen}>
      <div className="evidencia-panel" onClick={(e) => e.stopPropagation()}>
        <div className="evidencia-panel__header">
          <div>
            <p className="crumb">{visita.unidad_medica}</p>
            <h3>{visita.unidad_medica_nombre}</h3>
          </div>
          <button className="btn-ghost" onClick={cerrarConResumen}>Cerrar</button>
        </div>

        {error && <p className="login-error">{error}</p>}

        {!entrega && !error && <p className="tabla-cargando">Cargando…</p>}

        {entrega && (
          <>
            <label className="evidencia-panel__entregado">
              <input
                type="checkbox"
                checked={entrega.entregado}
                disabled={guardandoEntregado}
                onChange={onCambiarEntregado}
              />
              Entregado{entrega.fecha_entrega ? ` — ${entrega.fecha_entrega}` : ''}
            </label>

            {CATEGORIAS.map((categoria) => {
              const evidenciasCategoria = entrega.evidencias.filter((ev) => categoria.tipos.includes(ev.tipo));
              const subiendo = subiendoCategoria === categoria.key;
              return (
                <div key={categoria.key} className="evidencia-categoria">
                  <h4 className="evidencia-categoria__titulo">
                    <span aria-hidden="true">{categoria.icono}</span> {categoria.label}
                  </h4>

                  <div className="evidencia-panel__lista">
                    {evidenciasCategoria.length === 0 && (
                      <p className="evidencia-panel__vacio">Todavía no hay {categoria.label.toLowerCase()}.</p>
                    )}
                    {evidenciasCategoria.map((ev) => (
                      <div key={ev.id} className="evidencia-item">
                        <div className="evidencia-item__info">
                          <a href={ev.url_descarga} target="_blank" rel="noreferrer">{ev.nombre_original}</a>
                          <span>{new Date(ev.creado_en).toLocaleString('es-MX')}</span>
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
          </>
        )}
      </div>
    </div>
  );
}
