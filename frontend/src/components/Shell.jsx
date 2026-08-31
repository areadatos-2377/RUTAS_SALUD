import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, ROLES } from '../auth/AuthContext';
import './Shell.css';

const ICONOS = {
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
  salir: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
};

const ROL_LABEL = {
  [ROLES.SUPER_ADMIN]: 'Super administrador',
  [ROLES.ADMIN_NACIONAL]: 'Administrador nacional',
  [ROLES.USUARIO_ENTIDAD]: 'Usuario de entidad',
};

export default function Shell() {
  const { usuario, cerrarSesion } = useAuth();
  const navigate = useNavigate();

  async function salir() {
    await cerrarSesion();
    navigate('/login', { replace: true });
  }

  const iniciales = (usuario?.username || '?').slice(0, 2).toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">R</div>
          <h1>Rutas de la salud</h1>
          <p>IMSS-Bienestar</p>
        </div>
        <nav className="nav">
          <div className="nav-section">Programación</div>
          <NavLink to="/jornadas" className="nav-item">
            {ICONOS.jornadas} Distribuciones
          </NavLink>
          <NavLink to="/evidencia" className="nav-item">
            {ICONOS.evidencia} Evidencia
          </NavLink>
          {(usuario?.rol === ROLES.ADMIN_NACIONAL || usuario?.rol === ROLES.SUPER_ADMIN) && (
            <>
              <div className="nav-section">Administración</div>
              <NavLink to="/catalogos/coordinadores" className="nav-item">
                {ICONOS.catalogos} Coordinadores
              </NavLink>
              {usuario.rol === ROLES.SUPER_ADMIN && (
                <>
                  <NavLink to="/catalogos/entidades" className="nav-item">
                    {ICONOS.catalogos} Entidades
                  </NavLink>
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
