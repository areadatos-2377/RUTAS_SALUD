import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, ROLES } from './auth/AuthContext';
import Shell from './components/Shell';
import LoginPage from './pages/LoginPage';
import ActivarCuentaPage from './pages/ActivarCuentaPage';
import JornadasPage from './pages/JornadasPage';
import JornadaDetallePage from './pages/JornadaDetallePage';
import EntidadesPage from './pages/EntidadesPage';
import CoordinadoresPage from './pages/CoordinadoresPage';
import UnidadesMedicasPage from './pages/UnidadesMedicasPage';
import UsuariosPage from './pages/UsuariosPage';
import EvidenciaListaPage from './pages/EvidenciaListaPage';

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
function RequireRole({ roles, children }) {
  const { usuario } = useAuth();
  if (!roles.includes(usuario?.rol)) return <Navigate to="/jornadas" replace />;
  return children;
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
          <Route index element={<Navigate to="/jornadas" replace />} />
          <Route path="jornadas" element={<JornadasPage />} />
          <Route path="jornadas/:id" element={<JornadaDetallePage />} />
          <Route path="evidencia" element={<EvidenciaListaPage />} />
          <Route
            path="catalogos/coordinadores"
            element={
              <RequireRole roles={[ROLES.ADMIN_NACIONAL, ROLES.SUPER_ADMIN]}>
                <CoordinadoresPage />
              </RequireRole>
            }
          />
          <Route
            path="catalogos/entidades"
            element={
              <RequireRole roles={[ROLES.SUPER_ADMIN]}>
                <EntidadesPage />
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
