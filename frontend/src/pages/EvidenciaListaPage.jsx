import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth, ROLES } from '../auth/AuthContext';
import '../styles/table.css';

const TIPO_ICONO = { foto: '🖼️', video: '🎞️', pdf: '📄', documento: '📎' };

export default function EvidenciaListaPage() {
  const { usuario } = useAuth();
  const puedeFiltrarEntidad = usuario?.rol !== ROLES.USUARIO_ENTIDAD;

  const [jornadas, setJornadas] = useState([]);
  const [entidades, setEntidades] = useState([]);
  const [filtroJornada, setFiltroJornada] = useState('');
  const [filtroEntidad, setFiltroEntidad] = useState('');
  const [pagina, setPagina] = useState(1);
  const [resultado, setResultado] = useState(null); // {count, next, previous, results}
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getAll('/api/jornadas/').then(setJornadas);
    if (puedeFiltrarEntidad) api.getAll('/api/entidades/').then(setEntidades);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar(paginaObjetivo) {
    setResultado(null);
    setError(null);
    const params = new URLSearchParams({ page: String(paginaObjetivo) });
    if (filtroJornada) params.set('jornada', filtroJornada);
    if (filtroEntidad) params.set('entidad', filtroEntidad);
    try {
      setResultado(await api.get(`/api/evidencias/?${params}`));
    } catch {
      setError('No se pudo cargar la evidencia.');
    }
  }

  useEffect(() => {
    setPagina(1);
    cargar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroJornada, filtroEntidad]);

  function irAPagina(n) {
    setPagina(n);
    cargar(n);
  }

  const totalPaginas = resultado ? Math.max(1, Math.ceil(resultado.count / 50)) : 1;

  return (
    <div>
      <div className="topbar">
        <div>
          <p className="crumb">Programación</p>
          <h2>Evidencia</h2>
        </div>
      </div>

      <div className="panel-form">
        <div className="field">
          <label htmlFor="filtroJornada">Distribución</label>
          <select id="filtroJornada" value={filtroJornada} onChange={(e) => setFiltroJornada(e.target.value)}>
            <option value="">Todas</option>
            {jornadas.map((j) => (
              <option key={j.id} value={j.id}>{j.nombre}</option>
            ))}
          </select>
        </div>
        {puedeFiltrarEntidad && (
          <div className="field">
            <label htmlFor="filtroEntidad">Entidad</label>
            <select id="filtroEntidad" value={filtroEntidad} onChange={(e) => setFiltroEntidad(e.target.value)}>
              <option value="">Todas</option>
              {entidades.map((ent) => (
                <option key={ent.id} value={ent.id}>{ent.nombre}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && <p className="login-error" style={{ maxWidth: 400 }}>{error}</p>}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Distribución</th>
              {puedeFiltrarEntidad && <th>Entidad</th>}
              <th>Unidad</th>
              <th>Día de entrega</th>
              <th>Archivo</th>
              <th>Subido por</th>
              <th>Subido el</th>
            </tr>
          </thead>
          <tbody>
            {resultado === null && !error && (
              <tr><td colSpan={puedeFiltrarEntidad ? 7 : 6} className="tabla-vacia">Cargando…</td></tr>
            )}
            {resultado?.results.length === 0 && (
              <tr><td colSpan={puedeFiltrarEntidad ? 7 : 6} className="tabla-vacia">Todavía no hay evidencia subida.</td></tr>
            )}
            {resultado?.results.map((ev) => (
              <tr key={ev.id}>
                <td>{ev.jornada_nombre}</td>
                {puedeFiltrarEntidad && <td>{ev.entidad_nombre}</td>}
                <td>
                  <span className="nombre">{ev.unidad_medica_clues}</span> — {ev.unidad_medica_nombre}
                </td>
                <td>{ev.fecha_entrega || '—'}</td>
                <td>
                  <a href={ev.url_descarga} target="_blank" rel="noreferrer">
                    {TIPO_ICONO[ev.tipo] || '📎'} {ev.nombre_original}
                  </a>
                </td>
                <td>{ev.subido_por_nombre}</td>
                <td>{new Date(ev.creado_en).toLocaleString('es-MX')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {resultado && resultado.count > 0 && (
          <div className="tfoot">
            <span>
              {resultado.count} {resultado.count === 1 ? 'archivo' : 'archivos'} · página {pagina} de {totalPaginas}
            </span>
            <div className="pages">
              <button className="btn-ghost" disabled={!resultado.previous} onClick={() => irAPagina(pagina - 1)}>
                ← Anterior
              </button>
              <button className="btn-ghost" disabled={!resultado.next} onClick={() => irAPagina(pagina + 1)}>
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
