import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import './LoginPage.css';

const ICONOS = {
  usuario: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  ),
  candado: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  ),
};

export default function LoginPage() {
  const { iniciarSesion, sesionExpirada } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await iniciarSesion(username, password);
      const destino = location.state?.from?.pathname || '/jornadas';
      navigate(destino, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Usuario o contraseña incorrectos.');
      } else {
        setError('No se pudo conectar con el servidor.');
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <header className="login-header">
          <img
            className="login-logo"
            src="/logos/logohorizontal1.png"
            alt="IMSS Bienestar, Servicios Públicos de Salud"
          />
          <h1>Rutas de la salud</h1>
          <p className="login-sub">Acceso con usuario autorizado</p>
        </header>

        {sesionExpirada && (
          <p className="login-error">Tu sesión expiró. Vuelve a iniciar sesión para continuar.</p>
        )}

        <div className="login-field">
          <label htmlFor="username">Correo electrónico o usuario</label>
          <div className="login-input">
            {ICONOS.usuario}
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="correo@imssbienestar.gob.mx o usuario"
              required
            />
          </div>
        </div>
        <div className="login-field">
          <label htmlFor="password">Contraseña</label>
          <div className="login-input">
            {ICONOS.candado}
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Ingresa tu contraseña"
              required
            />
          </div>
        </div>

        {error && <p className="login-error">{error}</p>}

        <button className="btn-primary login-submit" type="submit" disabled={enviando}>
          {enviando ? 'Iniciando sesión…' : 'Iniciar sesión'}
        </button>
      </form>
    </div>
  );
}
