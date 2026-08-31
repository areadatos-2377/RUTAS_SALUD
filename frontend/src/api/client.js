// Cliente HTTP minimo hacia el backend Django/DRF.
// SessionAuthentication vive en una cookie httpOnly=false -- credentials:
// 'include' en todo para que el navegador la mande. El token CSRF viaja
// aparte, en el body de /auth/csrf/ y /auth/login/ (ver mas abajo), no en
// la cookie -- header X-CSRFToken en cualquier metodo que no sea
// GET/HEAD/OPTIONS.

// En produccion vacio a proposito: el navegador le habla al mismo origen
// (frontend-production-*.up.railway.app) y el servidor Node del frontend
// (ver frontend/server.js) reenvia /api/* al backend por la red privada de
// Railway. up.railway.app esta en la Public Suffix List -- frontend y
// backend en subdominios *.up.railway.app son "sitios" distintos para el
// navegador, asi que una cookie de sesion puesta por el backend cruzando
// esos dominios es de tercero, y navegadores con bloqueo de cookies de
// terceros (Safari, Chrome/Edge/Firefox con esa opcion activada) nunca la
// guardan -- eso causaba "tu sesion expiro" en el login para algunos
// usuarios aunque las credenciales fueran correctas. Con el proxy de mismo
// origen ya no hay cruce de dominios y el problema desaparece de raiz.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// El token CSRF viaja aparte, en el body de /auth/csrf/ y /auth/login/
// (este ultimo porque Django lo rota al hacer login) en vez de leerse de
// la cookie -- se dejo asi porque en desarrollo local (localhost:5183 ->
// :8010) frontend y backend siguen siendo hostnames distintos y
// document.cookie no puede leer la cookie del otro. Ver usuarios/views.py.
let csrfTokenActual = null;

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiError extends Error {
  constructor(status, data) {
    super(typeof data === 'string' ? data : JSON.stringify(data));
    this.status = status;
    this.data = data;
  }
}

async function peticion(path, { method = 'GET', body } = {}) {
  // FormData (subida de archivos): el navegador arma su propio Content-Type
  // con el boundary correcto -- si lo ponemos nosotros a mano, el multipart
  // queda mal formado. Tampoco se serializa a JSON.
  const esFormData = body instanceof FormData;

  const headers = { Accept: 'application/json' };
  if (body !== undefined && !esFormData) headers['Content-Type'] = 'application/json';
  if (!METODOS_SEGUROS.has(method)) {
    if (csrfTokenActual) headers['X-CSRFToken'] = csrfTokenActual;
  }

  // next/previous de DRF vienen como URL absoluta; el resto de las llamadas
  // usan ruta relativa.
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

  const resp = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : esFormData ? body : JSON.stringify(body),
  });

  if (resp.status === 204) return null;

  const contentType = resp.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await resp.json() : await resp.text();

  if (!resp.ok) {
    // 401 = la sesion ya no es valida del lado del servidor (expiro, o el
    // usuario se deslogueo en otra pestana) -- se lo hacemos saber a
    // AuthContext para que limpie el estado y mande a /login, en vez de que
    // cada pantalla tenga que manejar esto por su cuenta. 403 es distinto
    // (autenticado pero sin permiso) y no debe cerrar la sesion.
    //
    // /api/auth/me/ tambien se excluye ademas de login: AuthProvider lo
    // llama al montar para saber si ya hay sesion activa, y un 401 ahi es
    // el resultado normal de "todavia no has iniciado sesion", no evidencia
    // de que una sesion valida haya expirado. Sin esta exclusion habia una
    // carrera real: esa llamada inicial (disparada en el mount, antes de
    // que el usuario llene el formulario) podia resolver DESPUES de un
    // login exitoso -- y como para entonces `usuario` ya estaba puesto,
    // el 401 tardio de esa peticion vieja se interpretaba como "tu sesion
    // recien iniciada ya expiro", deslogueando al usuario en el acto.
    if (resp.status === 401 && !path.includes('/api/auth/login/') && !path.includes('/api/auth/me/')) {
      window.dispatchEvent(new CustomEvent('sesion-expirada'));
    }
    throw new ApiError(resp.status, data);
  }
  return data;
}

export const api = {
  primarCsrf: async () => {
    const datos = await peticion('/api/auth/csrf/');
    csrfTokenActual = datos.csrftoken;
    return datos;
  },
  login: async (username, password) => {
    const { csrftoken, ...usuario } = await peticion('/api/auth/login/', {
      method: 'POST',
      body: { username, password },
    });
    csrfTokenActual = csrftoken;
    return usuario;
  },
  logout: () => peticion('/api/auth/logout/', { method: 'POST' }),
  yo: () => peticion('/api/auth/me/'),

  get: (path) => peticion(path),
  post: (path, body) => peticion(path, { method: 'POST', body }),
  patch: (path, body) => peticion(path, { method: 'PATCH', body }),
  del: (path) => peticion(path, { method: 'DELETE' }),

  // Sigue next/next/next hasta traer TODAS las paginas. Usar solo para listas
  // que de verdad necesitan estar completas (selects, autocompletado,
  // catalogos pequenos) -- para listas que pueden crecer mucho (ej. el
  // catalogo completo de unidades medicas sin filtrar) usa paginacion real
  // en la pantalla en vez de esto.
  async getAll(path) {
    let siguiente = path;
    let resultados = [];
    while (siguiente) {
      const data = await peticion(siguiente);
      if (Array.isArray(data)) return data; // endpoint sin paginar
      resultados = resultados.concat(data.results);
      siguiente = data.next;
    }
    return resultados;
  },
};
