import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth, ROLES } from '../auth/AuthContext';
import '../styles/table.css';
import './NotificacionesPage.css';

const TIPO_ICONO = { foto: '🖼️', video: '🎞️', pdf: '📄', documento: '📎' };
const TIPO_LABEL = { foto: 'Foto', video: 'Video', pdf: 'Documento', documento: 'Documento' };

export default function NotificacionesPage() {
  const { usuario } = useAuth();
  // El backend ya filtra que ve cada quien (ver
  // NotificacionEvidenciaViewSet.get_queryset) -- aqui solo cambia que
  // accion/mensaje se muestra segun el rol.
  const esCapturista = usuario?.rol === ROLES.USUARIO_ENTIDAD;

  const [notificaciones, setNotificaciones] = useState(null);
  const [error, setError] = useState(null);
  const [procesandoId, setProcesandoId] = useState(null);

  useEffect(() => {
    api.getAll('/api/notificaciones-evidencia/')
      .then(setNotificaciones)
      .catch(() => setError('No se pudieron cargar las notificaciones.'));
  }, []);

  async function onMarcarCorregida(id) {
    setProcesandoId(id);
    setError(null);
    try {
      await api.post(`/api/notificaciones-evidencia/${id}/marcar-corregida/`);
      setNotificaciones((actuales) => actuales.filter((n) => n.id !== id));
    } catch {
      setError('No se pudo marcar como corregida.');
    } finally {
      setProcesandoId(null);
    }
  }

  async function onMarcarListo(id) {
    setProcesandoId(id);
    setError(null);
    try {
      await api.post(`/api/notificaciones-evidencia/${id}/marcar-listo/`);
      setNotificaciones((actuales) => actuales.filter((n) => n.id !== id));
    } catch {
      setError('No se pudo marcar como lista.');
    } finally {
      setProcesandoId(null);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <p className="crumb">Notificaciones</p>
          <h2>{esCapturista ? 'Evidencia con observaciones' : 'Tus notificaciones'}</h2>
        </div>
      </div>

      {error && <p className="login-error" style={{ maxWidth: 400 }}>{error}</p>}

      {notificaciones === null && !error && <p className="notificaciones-estado">Cargando…</p>}
      {notificaciones?.length === 0 && (
        <p className="notificaciones-estado">No tienes notificaciones pendientes.</p>
      )}

      <div className="notificaciones-lista">
        {notificaciones?.map((n) => (
          <div key={n.id} className="notificacion-card">
            <div className="notificacion-card__encabezado">
              <span className="notificacion-card__tipo">
                {TIPO_ICONO[n.tipo_evidencia] || '📎'} {TIPO_LABEL[n.tipo_evidencia] || n.tipo_evidencia}
              </span>
              <Link to={`/jornadas/${n.jornada_id}`} className="notificacion-card__link">
                Ir a la distribución →
              </Link>
            </div>

            <p className="notificacion-card__unidad">
              <span className="nombre">{n.unidad_medica}</span> — {n.unidad_medica_nombre}
              {' · '}{n.entidad_nombre}
            </p>

            <p className="notificacion-card__archivo">
              {n.nombre_archivo_original}
              {n.evidencia_url_descarga && (
                <> · <a href={n.evidencia_url_descarga} target="_blank" rel="noreferrer">Ver archivo</a></>
              )}
            </p>

            <p className="notificacion-card__comentario">"{n.comentario}"</p>
            <p className="notificacion-card__meta">
              Marcada por {n.creado_por_nombre} el {new Date(n.creado_en).toLocaleString('es-MX')}
            </p>

            {esCapturista ? (
              <button
                className="btn-primary"
                onClick={() => onMarcarCorregida(n.id)}
                disabled={procesandoId === n.id}
              >
                {procesandoId === n.id ? 'Enviando…' : 'Ya corregí / eliminé esta evidencia'}
              </button>
            ) : n.corregido_en ? (
              <>
                <p className="notificacion-card__aviso notificacion-card__aviso--corregida">
                  El Capturista ({n.corregido_por_nombre}) indica que ya corrigió esto el{' '}
                  {new Date(n.corregido_en).toLocaleString('es-MX')} — revísala.
                </p>
                <button
                  className="btn-primary"
                  onClick={() => onMarcarListo(n.id)}
                  disabled={procesandoId === n.id}
                >
                  {procesandoId === n.id ? 'Enviando…' : 'Marcar listo'}
                </button>
              </>
            ) : (
              <p className="notificacion-card__aviso">Aún no la corrige el Capturista.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
