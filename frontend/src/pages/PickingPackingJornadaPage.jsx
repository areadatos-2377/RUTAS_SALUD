import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth, ROLES } from '../auth/AuthContext';
import { CATEGORIA_LABEL } from '../utils/categoriaNiveles';
import PickingPackingEvidenciaPanel from './PickingPackingEvidenciaPanel';
import '../styles/table.css';
import './JornadaDetallePage.css';
import './PickingPackingJornadaPage.css';

const TIPO_LABEL = { ordinaria: 'Ordinaria', extraordinaria: 'Extraordinaria', emergencia: 'Emergencia' };
const DIA_SEMANA_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function hoyDentroDeRango(min, max) {
  const hoy = new Date().toISOString().slice(0, 10);
  if (hoy < min) return min;
  if (hoy > max) return max;
  return hoy;
}

// Un dia (string "AAAA-MM-DD") por cada fecha del periodo de la jornada,
// para pintar una columna por dia en la tabla. Se calcula en UTC (mediodia
// para evitar cualquier corrimiento de DST) porque estas fechas son
// puramente de calendario, sin hora ni zona asociada.
function rangoDias(inicio, fin) {
  const dias = [];
  const cursor = new Date(`${inicio}T12:00:00Z`);
  const limite = new Date(`${fin}T12:00:00Z`);
  while (cursor <= limite) {
    dias.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

function etiquetaDia(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  const diaSemana = DIA_SEMANA_CORTO[d.getUTCDay()];
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${diaSemana} ${dd}/${mm}`;
}

function descargarArchivo(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function PickingPackingJornadaPage() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const puedeCargar = usuario?.rol === ROLES.USUARIO_ENTIDAD || usuario?.rol === ROLES.SUPER_ADMIN;
  const puedeGenerarPresentacion = usuario?.rol === ROLES.ADMIN_NACIONAL || usuario?.rol === ROLES.SUPER_ADMIN;

  const [jornada, setJornada] = useState(null);
  const [entidades, setEntidades] = useState(null);
  // { [entidadId]: { [fecha]: { foto: bool, video: bool } } } -- una celda
  // por entidad y dia, para poder ver de un vistazo a que entidad le falta
  // evidencia en que dia especifico (no solo "le falta algo, en algun dia").
  const [resumenPorDia, setResumenPorDia] = useState({});
  const [error, setError] = useState(null);
  const [entidadPanel, setEntidadPanel] = useState(null);
  const [fechaPresentacion, setFechaPresentacion] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [generandoChecklist, setGenerandoChecklist] = useState(false);

  useEffect(() => {
    api.get(`/api/jornadas/${id}/`)
      .then((j) => {
        setJornada(j);
        setFechaPresentacion(hoyDentroDeRango(j.fecha_inicio, j.fecha_fin));
      })
      .catch(() => setError('No se pudo cargar la distribución.'));
  }, [id]);

  useEffect(() => {
    api.getAll(`/api/entidades/?jornada=${id}`)
      .then((lista) => {
        // usuario_entidad solo tiene sentido que vea/cargue su propia fila
        // -- el resto de roles ven a todas las entidades que participan en
        // esta distribucion (mismo criterio que JornadaDetallePage con el
        // selector de entidad).
        const filtrada = usuario?.rol === ROLES.USUARIO_ENTIDAD
          ? lista.filter((e) => e.id === usuario.entidad)
          : lista;
        setEntidades(filtrada);
      })
      .catch(() => setError('No se pudieron cargar las entidades de esta distribución.'));
  }, [id, usuario]);

  // Se recarga completo (no se parchea celda por celda) cada vez que se
  // cierra el panel de una entidad -- es un solo GET, y asi el borrado de
  // una evidencia especifica tambien se refleja bien en la matriz, no solo
  // las subidas nuevas.
  const cargarResumen = useCallback(() => {
    api.getAll(`/api/picking-packing/evidencias/?jornada=${id}`)
      .then((lista) => {
        const nuevoResumen = {};
        for (const ev of lista) {
          const porEntidad = nuevoResumen[ev.entidad] || {};
          const porDia = porEntidad[ev.fecha] || { foto: false, video: false };
          porDia[ev.tipo === 'foto' ? 'foto' : 'video'] = true;
          porEntidad[ev.fecha] = porDia;
          nuevoResumen[ev.entidad] = porEntidad;
        }
        setResumenPorDia(nuevoResumen);
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);

  function onCerrarPanel(resumenPanel) {
    if (resumenPanel) cargarResumen();
    setEntidadPanel(null);
  }

  async function onGenerarPresentacion() {
    setGenerando(true);
    setError(null);
    try {
      const { blob, nombreArchivo } = await api.postArchivo('/api/picking-packing/generar-presentacion/', {
        jornada_id: jornada.id,
        fecha: fechaPresentacion,
      });
      descargarArchivo(blob, nombreArchivo);
    } catch (err) {
      const detalle = err instanceof ApiError && err.data ? err.data.detail || err.data.fecha?.[0] : null;
      setError(detalle || 'No se pudo generar la presentación.');
    } finally {
      setGenerando(false);
    }
  }

  async function onGenerarChecklist() {
    setGenerandoChecklist(true);
    setError(null);
    try {
      const { blob, nombreArchivo } = await api.postArchivo('/api/picking-packing/generar-checklist/', {
        jornada_id: jornada.id,
      });
      descargarArchivo(blob, nombreArchivo);
    } catch (err) {
      const detalle = err instanceof ApiError && err.data ? err.data.detail : null;
      setError(detalle || 'No se pudo generar el checklist.');
    } finally {
      setGenerandoChecklist(false);
    }
  }

  const dias = jornada ? rangoDias(jornada.fecha_inicio, jornada.fecha_fin) : [];

  return (
    <div>
      <div className="topbar jornada-topbar">
        <div>
          <p className="crumb">
            <Link to="/picking-packing">Picking & Packing</Link>
          </p>
          <h2>{jornada?.nombre || 'Cargando…'}</h2>
          {jornada && (
            <p className="jornada-meta">
              {TIPO_LABEL[jornada.tipo] || jornada.tipo} ·{' '}
              <span className={`badge ${jornada.categoria === 'primer_nivel' ? 'verde' : 'dorado'}`}>
                {CATEGORIA_LABEL[jornada.categoria] || jornada.categoria}
              </span>{' '}
              · {jornada.fecha_inicio} al {jornada.fecha_fin}
            </p>
          )}
        </div>

        {puedeGenerarPresentacion && jornada && (
          <div className="jornada-topbar__presentacion">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="fechaPresentacion">Fecha a generar</label>
              <input
                id="fechaPresentacion"
                type="date"
                min={jornada.fecha_inicio}
                max={jornada.fecha_fin}
                value={fechaPresentacion || ''}
                onChange={(e) => setFechaPresentacion(e.target.value)}
              />
            </div>
            <button className="btn-primary" onClick={onGenerarPresentacion} disabled={generando || !fechaPresentacion}>
              {generando ? 'Generando…' : 'Generar presentación'}
            </button>
            <button className="btn-ghost" onClick={onGenerarChecklist} disabled={generandoChecklist}>
              {generandoChecklist ? 'Generando…' : 'Descargar checklist'}
            </button>
          </div>
        )}
      </div>

      {error && <p className="login-error" style={{ maxWidth: 520 }}>{error}</p>}
      {entidades === null && !error && <p className="tabla-cargando">Cargando entidades…</p>}

      {entidades && (
        <div className="tablewrap pp-tabla">
          <table>
            <thead>
              <tr>
                <th>Entidad</th>
                {dias.map((dia) => (
                  <th key={dia} className="pp-columna-dia">{etiquetaDia(dia)}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entidades.length === 0 && (
                <tr><td colSpan={dias.length + 2} className="tabla-vacia">No hay entidades participando en esta distribución.</td></tr>
              )}
              {entidades.map((entidad) => {
                const porDia = resumenPorDia[entidad.id] || {};
                return (
                  <tr key={entidad.id}>
                    <td className="nombre">{entidad.nombre}</td>
                    {dias.map((dia) => {
                      const flags = porDia[dia] || { foto: false, video: false };
                      return (
                        <td key={dia} className="pp-columna-dia">
                          <span className={`pp-indicador${flags.foto ? ' pp-indicador--ok' : ''}`} title={flags.foto ? 'Ya tiene foto' : 'Falta foto'}>🖼️</span>
                          <span className={`pp-indicador${flags.video ? ' pp-indicador--ok' : ''}`} title={flags.video ? 'Ya tiene video' : 'Falta video'}>🎞️</span>
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'right' }}>
                      {puedeCargar && (
                        <button className="btn-ghost" onClick={() => setEntidadPanel(entidad)}>
                          Cargar evidencia
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entidadPanel && jornada && (
        <PickingPackingEvidenciaPanel
          jornada={jornada}
          entidad={entidadPanel}
          onCerrar={onCerrarPanel}
        />
      )}
    </div>
  );
}
