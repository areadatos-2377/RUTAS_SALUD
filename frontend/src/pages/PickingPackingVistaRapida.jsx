import { useEffect, useState } from 'react';
import { api } from '../api/client';
import './EvidenciaVistaRapida.css';

const TIPO_INFO = {
  foto: { etiqueta: 'Fotos', icono: '🖼️' },
  video: { etiqueta: 'Videos', icono: '🎞️' },
};

export default function PickingPackingVistaRapida({ jornada, entidad, fecha, tipo, onCerrar }) {
  const [evidencias, setEvidencias] = useState(null);
  const [error, setError] = useState(null);
  const info = TIPO_INFO[tipo];

  useEffect(() => {
    api.getAll(`/api/picking-packing/evidencias/?jornada=${jornada.id}&entidad=${entidad.id}&fecha=${fecha}`)
      .then((lista) => setEvidencias(lista.filter((evidencia) => evidencia.tipo === tipo)))
      .catch(() => setError('No se pudo cargar la evidencia de picking y packing.'));
  }, [jornada.id, entidad.id, fecha, tipo]);

  return (
    <div className="evidencia-overlay" onClick={onCerrar}>
      <div className="evidencia-vista-rapida" onClick={(evento) => evento.stopPropagation()}>
        <div className="evidencia-panel__header">
          <div>
            <p className="crumb">{entidad.nombre} · {fecha}</p>
            <h3><span aria-hidden="true">{info.icono}</span> {info.etiqueta} de picking y packing</h3>
          </div>
          <button className="btn-ghost" onClick={onCerrar}>Cerrar</button>
        </div>

        {error && <p className="login-error">{error}</p>}
        {evidencias === null && !error && <p className="tabla-cargando">Cargando…</p>}
        {evidencias?.length === 0 && <p className="evidencia-panel__vacio">No hay archivos disponibles.</p>}

        {tipo === 'foto' && evidencias?.length > 0 && (
          <div className="evidencia-vista-rapida__grid">
            {evidencias.map((evidencia) => (
              <a key={evidencia.id} href={evidencia.url_descarga} target="_blank" rel="noreferrer" title={evidencia.nombre_original}>
                <img src={evidencia.url_descarga} alt={evidencia.nombre_original} loading="lazy" />
              </a>
            ))}
          </div>
        )}

        {tipo === 'video' && evidencias?.length > 0 && (
          <div className="evidencia-vista-rapida__videos">
            {evidencias.map((evidencia) => (
              <div key={evidencia.id} className="evidencia-vista-rapida__video">
                <video src={evidencia.url_descarga} controls preload="metadata" />
                <span>{evidencia.nombre_original}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
