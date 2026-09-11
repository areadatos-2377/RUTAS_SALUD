import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, ROLES } from './auth/AuthContext';
import Shell from './components/Shell';
import LoginPage from './pages/LoginPage';
import ActivarCuentaPage from './pages/ActivarCuentaPage';
import JornadasPage from './pages/JornadasPage';
import JornadaDetallePage from './pages/JornadaDetallePage';
import CoordinadoresPage from './pages/CoordinadoresPage';
import UnidadesMedicasPage from './pages/UnidadesMedicasPage';
import UsuariosPage from './pages/UsuariosPage';
import EvidenciaListaPage from './pages/EvidenciaListaPage';
import PickingPackingPage from './pages/PickingPackingPage';
import PickingPackingJornadaPage from './pages/PickingPackingJornadaPage';
import MonitoreoPage from './pages/MonitoreoPage';

// Todos los roles menos visor -- visor solo tiene acceso a /monitoreo (ver
// InicioRedirect y RequireRole mas abajo). Aparte en su propia constante
// para no repetir el arreglo 5 veces en las rutas de Programación.
const ROLES_NO_VISOR = [ROLES.USUARIO_ENTIDAD, ROLES.ADMIN_NACIONAL, ROLES.SUPER_ADMIN];

function RequireAuth({ children }) {
  const { usuario, cargando } = useAuth();
  const location = useLocation();

  if (cargando) return null;
  if (!usuario) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

// Ocultar el link del nav no basta -- sin esto, alguien que llegue por URL
// directa (o por el redirect "volver a donde estabas" tras un logout/login)
// podia VER paginas de otro rol, aunque el backend ya bloqueara escribir.
// Redirige a "/" (no a una ruta fija como "/jornadas") porque esa ruta en
// si misma podria estar restringida para el rol actual (ej. visor) -- "/"
// pasa por InicioRedirect, que ya sabe a donde puede ir cada rol.
function RequireRole({ roles, children }) {
  const { usuario } = useAuth();
  if (!roles.includes(usuario?.rol)) return <Navigate to="/" replace />;
  return children;
}

// visor solo puede aterrizar en /monitoreo -- todo lo demas lo rebotaria
// RequireRole de vuelta para aca, entrando en bucle si este redirect
// siguiera mandando a /jornadas sin importar el rol.
function InicioRedirect() {
  const { usuario } = useAuth();
  const destino = usuario?.rol === ROLES.VISOR ? '/monitoreo' : '/jornadas';
  return <Navigate to={destino} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activar-cuenta/:uidb64/:token" element={<ActivarCuentaPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route index element={<InicioRedirect />} />
          <Route path="monitoreo" element={<MonitoreoPage />} />
          <Route
            path="jornadas"
            element={
              <RequireRole roles={ROLES_NO_VISOR}>
                <JornadasPage />
              </RequireRole>
            }
          />
          <Route
            path="jornadas/:id"
            element={
              <RequireRole roles={ROLES_NO_VISOR}>
                <JornadaDetallePage />
              </RequireRole>
            }
          />
          <Route
            path="evidencia"
            element={
              <RequireRole roles={ROLES_NO_VISOR}>
                <EvidenciaListaPage />
              </RequireRole>
            }
          />
          <Route
            path="picking-packing"
            element={
              <RequireRole roles={ROLES_NO_VISOR}>
                <PickingPackingPage />
              </RequireRole>
            }
          />
          <Route
            path="picking-packing/:id"
            element={
              <RequireRole roles={ROLES_NO_VISOR}>
                <PickingPackingJornadaPage />
              </RequireRole>
            }
          />
          <Route
            path="catalogos/coordinadores"
            element={
              <RequireRole roles={[ROLES.ADMIN_NACIONAL, ROLES.SUPER_ADMIN]}>
                <CoordinadoresPage />
              </RequireRole>
            }
          />
          <Route
            path="catalogos/unidades"
            element={
              <RequireRole roles={[ROLES.SUPER_ADMIN]}>
                <UnidadesMedicasPage />
              </RequireRole>
            }
          />
          <Route
            path="catalogos/usuarios"
            element={
              <RequireRole roles={[ROLES.SUPER_ADMIN]}>
                <UsuariosPage />
              </RequireRole>
            }
          />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
