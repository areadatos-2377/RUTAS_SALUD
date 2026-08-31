import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

const AuthContext = createContext(null);

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN_NACIONAL: 'admin_nacional',
  USUARIO_ENTIDAD: 'usuario_entidad',
};

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [sesionExpirada, setSesionExpirada] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await api.primarCsrf();
        const datos = await api.yo();
        setUsuario(datos);
      } catch {
        // Carrera real: si el usuario ya lleno el formulario y logueo
        // exitosamente ANTES de que esta llamada (disparada al montar,
        // para saber si ya habia sesion) resolviera, no hay que pisar el
        // usuario que el login ya puso -- solo limpiar si de verdad seguia
        // sin sesion (actual es null).
        setUsuario((actual) => actual ?? null);
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  useEffect(() => {
    // client.js dispara esto cuando cualquier peticion recibe 401 -- la
    // sesion ya no es valida del lado del servidor (expiro, o el usuario
    // cerro sesion desde otra pestana). Se centraliza aqui en vez de que
    // cada pantalla tenga que detectarlo por su cuenta.
    function onSesionExpirada() {
      setUsuario((actual) => {
        if (actual) setSesionExpirada(true);
        return null;
      });
    }
    window.addEventListener('sesion-expirada', onSesionExpirada);
    return () => window.removeEventListener('sesion-expirada', onSesionExpirada);
  }, []);

  const iniciarSesion = useCallback(async (username, password) => {
    const datos = await api.login(username, password);
    setUsuario(datos);
    setSesionExpirada(false);
    return datos;
  }, []);

  const cerrarSesion = useCallback(async () => {
    try {
      await api.logout();
    } catch (err) {
      // si la sesion ya habia expirado del lado del servidor, no es un error real
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
    }
    setUsuario(null);
    setSesionExpirada(false);
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, cargando, sesionExpirada, iniciarSesion, cerrarSesion }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
