import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth, ROLES } from '../auth/AuthContext';
import './Shell.css';

const ICONOS = {
  panel: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  jornadas: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  catalogos: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 7l9-4 9 4-9 4-9-4Z" />
      <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
    </svg>
  ),
  evidencia: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <circle cx="12" cy="13" r="3.5" />
      <path d="M8 6l1.5-2.5h5L16 6" />
    </svg>
  ),
  notificaciones: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  pickingPacking: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8l9-5 9 5-9 5-9-5Z" />
      <path d="M3 8v8l9 5 9-5V8M12 13v8" />
    </svg>
  ),
  salir: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
};

const ROL_LABEL = {
  [ROLES.SUPER_ADMIN]: 'Administrador',
  [ROLES.ADMIN_NACIONAL]: 'Nacional',
  [ROLES.USUARIO_ENTIDAD]: 'Capturista',
  [ROLES.VISOR]: 'Visor',
};

export default function Shell() {
  const { usuario, cerrarSesion } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function salir() {
    await cerrarSesion();
    navigate('/login', { replace: true });
  }

  const iniciales = (usuario?.username || '?').slice(0, 2).toUpperCase();

  // Notificaciones: pendientes de corregir (Capturista) o de resolver
  // (Nacional/Administrador) -- el backend ya filtra cual le toca ver a
  // cada quien. El contador se refresca en 2 vias (sin websockets/push,
  // no hay esa infraestructura en el proyecto): al navegar entre
  // pestanas (gratis, cubre el uso normal) y con un intervalo de
  // respaldo que se pausa solo cuando la pestana del navegador no esta
  // visible, para no gastar nada de fondo si se deja abierta sin usarla.
  const puedeVerNotificaciones = usuario?.rol !== ROLES.VISOR;
  const [contadorNotificaciones, setContadorNotificaciones] = useState(0);

  useEffect(() => {
    if (!puedeVerNotificaciones) return;
    let cancelado = false;
    api.getAll('/api/notificaciones-evidencia/')
      .then((lista) => { if (!cancelado) setContadorNotificaciones(lista.length); })
      .catch(() => {}); // un badge que no cargo no debe tumbar el resto del shell
    return () => { cancelado = true; };
  }, [puedeVerNotificaciones, location.pathname]);

  useEffect(() => {
    if (!puedeVerNotificaciones) return;
    let intervalId = null;
    const refrescar = () => {
      api.getAll('/api/notificaciones-evidencia/')
        .then((lista) => setContadorNotificaciones(lista.length))
        .catch(() => {});
    };
    const iniciar = () => { if (!intervalId) intervalId = setInterval(refrescar, 90000); };
    const detener = () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } };
    const onVisibilidad = () => (document.visibilityState === 'visible' ? iniciar() : detener());
    if (document.visibilityState === 'visible') iniciar();
    document.addEventListener('visibilitychange', onVisibilidad);
    return () => {
      detener();
      document.removeEventListener('visibilitychange', onVisibilidad);
    };
  }, [puedeVerNotificaciones]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img
            className="brand-logo"
            src="/logos/logohorizontal1.png"
            alt="IMSS Bienestar, Servicios Públicos de Salud"
          />
          <h1>Rutas de la salud</h1>
        </div>
        <nav className="nav">
          {usuario?.rol !== ROLES.USUARIO_ENTIDAD && (
            <NavLink to="/monitoreo" className="nav-item">
              {ICONOS.panel} Monitoreo y Seguimiento
            </NavLink>
          )}
          {puedeVerNotificaciones && (
            <NavLink to="/notificaciones" className="nav-item">
              {ICONOS.notificaciones} Notificaciones
              {contadorNotificaciones > 0 && (
                <span className="nav-item__badge">{contadorNotificaciones}</span>
              )}
            </NavLink>
          )}
          {usuario?.rol !== ROLES.VISOR && (
            <>
              <div className="nav-section">Programación</div>
              <NavLink to="/picking-packing" className="nav-item">
                {ICONOS.pickingPacking} Picking & Packing
              </NavLink>
              <NavLink to="/jornadas" className="nav-item">
                {ICONOS.jornadas} Distribuciones
              </NavLink>
              {/* Pestana "Evidencia" oculta para todos los roles (a peticion
                  del usuario) -- la ruta /evidencia sigue registrada en
                  App.jsx pero bloqueada con RequireRole roles={[]}, para
                  poder reactivarla facil si hace falta mas adelante. */}
            </>
          )}
          {(usuario?.rol === ROLES.ADMIN_NACIONAL || usuario?.rol === ROLES.SUPER_ADMIN) && (
            <>
              <div className="nav-section">Administración</div>
              <NavLink to="/catalogos/coordinadores" className="nav-item">
                {ICONOS.catalogos} Coordinadores
              </NavLink>
              {usuario.rol === ROLES.SUPER_ADMIN && (
                <>
                  <NavLink to="/catalogos/unidades" className="nav-item">
                    {ICONOS.catalogos} Unidades médicas
                  </NavLink>
                  <NavLink to="/catalogos/usuarios" className="nav-item">
                    {ICONOS.catalogos} Usuarios
                  </NavLink>
                </>
              )}
            </>
          )}
        </nav>
        <div className="user-card">
          <div className="user-avatar">{iniciales}</div>
          <div className="user-meta">
            <p>{usuario?.username}</p>
            <span>{ROL_LABEL[usuario?.rol] || usuario?.rol}</span>
          </div>
          <button className="iconbtn" title="Cerrar sesión" onClick={salir}>
            {ICONOS.salir}
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
