import { useEffect, useState } from 'react';
import { api } from '../api/client';
import './EvidenciaVistaRapida.css';

const CATEGORIA_INFO = {
  imagen: { label: 'Imágenes', icono: '🖼️', tipos: ['foto'] },
  documento: { label: 'Documentos', icono: '📄', tipos: ['pdf', 'documento'] },
  video: { label: 'Video', icono: '🎞️', tipos: ['video'] },
};

// Vista de solo lectura para los marcadores de la tabla -- a diferencia de
// EvidenciaPanel (que sirve para subir/borrar todo), esta solo consulta lo
// que ya existe de una categoria. Reusa el mismo endpoint que ya usa el
// panel, filtrado por programacion_visita.
//
// Modo seleccionable (usado por "Generar presentacion"): en vez de que
// cada foto abra en pestaña nueva, el clic la marca/desmarca como la foto
// elegida para esa unidad. Solo aplica a la categoria "imagen".
export default function EvidenciaVistaRapida({
  visita,
  categoria,
  onCerrar,
  seleccionable = false,
  seleccionActualId = null,
  onSeleccionar,
}) {
  const [evidencias, setEvidencias] = useState(null);
  const [error, setError] = useState(null);
  const info = CATEGORIA_INFO[categoria];

  useEffect(() => {
    api.getAll(`/api/entregas/?programacion_visita=${visita.id}`)
      .then((entregas) => {
        const items = (entregas[0]?.evidencias || []).filter((ev) => info.tipos.includes(ev.tipo));
        setEvidencias(items);
      })
      .catch(() => setError('No se pudo cargar la evidencia.'));
  }, [visita.id, categoria, info.tipos]);

  return (
    <div className="evidencia-overlay" onClick={onCerrar}>
      <div className="evidencia-vista-rapida" onClick={(e) => e.stopPropagation()}>
        <div className="evidencia-panel__header">
          <div>
            <p className="crumb">{visita.unidad_medica}</p>
            <h3><span aria-hidden="true">{info.icono}</span> {info.label} — {visita.unidad_medica_nombre}</h3>
          </div>
          <button className="btn-ghost" onClick={onCerrar}>Cerrar</button>
        </div>

        {seleccionable && (
          <p className="evidencia-vista-rapida__ayuda">Da clic en una foto para elegirla para la presentación.</p>
        )}

        {error && <p className="login-error">{error}</p>}
        {evidencias === null && !error && <p className="tabla-cargando">Cargando…</p>}
        {evidencias && evidencias.length === 0 && (
          <p className="evidencia-panel__vacio">No hay {info.label.toLowerCase()} para esta unidad.</p>
        )}

        {evidencias && categoria === 'imagen' && evidencias.length > 0 && (
          <div className="evidencia-vista-rapida__grid">
            {evidencias.map((ev) => (
              seleccionable ? (
                <button
                  key={ev.id}
                  type="button"
                  className={`evidencia-vista-rapida__seleccionable${ev.id === seleccionActualId ? ' seleccionada' : ''}`}
                  onClick={() => onSeleccionar(ev)}
                  title={ev.nombre_original}
                >
                  <img src={ev.url_descarga} alt={ev.nombre_original} loading="lazy" />
                  {ev.id === seleccionActualId && <span className="evidencia-vista-rapida__check" aria-hidden="true">✓</span>}
                </button>
              ) : (
                <a key={ev.id} href={ev.url_descarga} target="_blank" rel="noreferrer" title={ev.nombre_original}>
                  <img src={ev.url_descarga} alt={ev.nombre_original} loading="lazy" />
                </a>
              )
            ))}
          </div>
        )}

        {evidencias && categoria === 'documento' && evidencias.length > 0 && (
          <div className="evidencia-panel__lista">
            {evidencias.map((ev) => (
              <div key={ev.id} className="evidencia-item">
                <div className="evidencia-item__info">
                  <a href={ev.url_descarga} target="_blank" rel="noreferrer">{ev.nombre_original}</a>
                  <span>{new Date(ev.creado_en).toLocaleString('es-MX')}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {evidencias && categoria === 'video' && evidencias.length > 0 && (
          <div className="evidencia-vista-rapida__videos">
            {evidencias.map((ev) => (
              <div key={ev.id} className="evidencia-vista-rapida__video">
                <video src={ev.url_descarga} controls preload="metadata" />
                <span>{ev.nombre_original}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
