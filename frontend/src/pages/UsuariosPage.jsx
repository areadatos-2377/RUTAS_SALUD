import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth, ROLES } from '../auth/AuthContext';
import '../styles/table.css';

const ROL_LABEL = {
  [ROLES.SUPER_ADMIN]: 'Super administrador',
  [ROLES.ADMIN_NACIONAL]: 'Administrador nacional',
  [ROLES.USUARIO_ENTIDAD]: 'Usuario de entidad',
};

const FORM_VACIO = { username: '', first_name: '', last_name: '', rol: ROLES.USUARIO_ENTIDAD, entidad: '' };

export default function UsuariosPage() {
  const { usuario: yo } = useAuth();

  const [usuarios, setUsuarios] = useState(null);
  const [entidades, setEntidades] = useState([]);
  const [form, setForm] = useState(FORM_VACIO);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState(null);

  const [enlace, setEnlace] = useState(null);
  const [copiado, setCopiado] = useState(false);

  const [editandoId, setEditandoId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  const [errorFila, setErrorFila] = useState(null);

  async function cargar() {
    setUsuarios(await api.getAll('/api/usuarios/'));
  }

  useEffect(() => {
    cargar();
    api.getAll('/api/entidades/').then(setEntidades);
  }, []);

  async function onCrear(e) {
    e.preventDefault();
    setCreando(true);
    setError(null);
    setEnlace(null);
    try {
      const cuerpo = { username: form.username, first_name: form.first_name, last_name: form.last_name, rol: form.rol };
      if (form.rol === ROLES.USUARIO_ENTIDAD) cuerpo.entidad = Number(form.entidad);
      const creado = await api.post('/api/usuarios/', cuerpo);
      setForm(FORM_VACIO);
      setEnlace(creado.enlace_activacion);
      setCopiado(false);
      await cargar();
    } catch (err) {
      if (err instanceof ApiError && err.data) {
        const mensaje =
          err.data.username?.[0] || err.data.non_field_errors?.[0] || err.data.detail || 'No se pudo crear el usuario.';
        setError(mensaje);
      } else {
        setError('No se pudo crear el usuario.');
      }
    } finally {
      setCreando(false);
    }
  }

  function onCopiar() {
    navigator.clipboard.writeText(enlace);
    setCopiado(true);
  }

  async function onGenerarToken(u) {
    if (!confirm(`Esto invalida la contraseña actual de ${u.username} hasta que use el enlace nuevo. ¿Continuar?`)) return;
    setErrorFila(null);
    try {
      const resp = await api.post(`/api/usuarios/${u.id}/generar-token/`);
      setEnlace(resp.enlace_activacion);
      setCopiado(false);
      await cargar();
    } catch {
      setErrorFila('No se pudo generar el enlace.');
    }
  }

  async function onToggleActivo(u) {
    setErrorFila(null);
    try {
      await api.patch(`/api/usuarios/${u.id}/`, { is_active: !u.is_active });
      await cargar();
    } catch (err) {
      if (err instanceof ApiError && err.data?.detail) {
        setErrorFila(err.data.detail);
      } else {
        setErrorFila('No se pudo actualizar el usuario.');
      }
    }
  }

  function onEditar(u) {
    setEditandoId(u.id);
    setEditForm({ first_name: u.first_name, last_name: u.last_name, rol: u.rol, entidad: u.entidad || '' });
    setErrorFila(null);
  }

  async function onGuardarEdit(id) {
    setGuardandoEdit(true);
    setErrorFila(null);
    try {
      const cuerpo = {
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        rol: editForm.rol,
        entidad: editForm.rol === ROLES.USUARIO_ENTIDAD ? Number(editForm.entidad) : null,
      };
      await api.patch(`/api/usuarios/${id}/`, cuerpo);
      setEditandoId(null);
      await cargar();
    } catch (err) {
      if (err instanceof ApiError && err.data) {
        setErrorFila(err.data.non_field_errors?.[0] || err.data.detail || 'No se pudo guardar.');
      } else {
        setErrorFila('No se pudo guardar.');
      }
    } finally {
      setGuardandoEdit(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <p className="crumb">Administración</p>
          <h2>Usuarios</h2>
        </div>
      </div>

      <form className="panel-form" onSubmit={onCrear}>
        <div className="field">
          <label htmlFor="username">Correo institucional</label>
          <input
            id="username"
            type="email"
            placeholder="nombre.apellido@imssbienestar.gob.mx"
            pattern=".+@imssbienestar\.gob\.mx"
            title="Debe ser tu correo institucional (...@imssbienestar.gob.mx)"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="first_name">Nombre</label>
          <input id="first_name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="last_name">Apellido</label>
          <input id="last_name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="rol">Rol</label>
          <select id="rol" value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value, entidad: '' })}>
            {Object.entries(ROL_LABEL).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>{etiqueta}</option>
            ))}
          </select>
        </div>
        {form.rol === ROLES.USUARIO_ENTIDAD && (
          <div className="field">
            <label htmlFor="entidad">Entidad</label>
            <select id="entidad" value={form.entidad} onChange={(e) => setForm({ ...form, entidad: e.target.value })} required>
              <option value="">Selecciona…</option>
              {entidades.map((ent) => (
                <option key={ent.id} value={ent.id}>{ent.nombre}</option>
              ))}
            </select>
          </div>
        )}
        <button className="btn-primary" type="submit" disabled={creando}>
          {creando ? 'Creando…' : '+ Crear usuario'}
        </button>
      </form>

      {error && <p className="login-error" style={{ maxWidth: 500 }}>{error}</p>}
      {errorFila && <p className="login-error" style={{ maxWidth: 500 }}>{errorFila}</p>}

      {enlace && (
        <div className="panel-form" style={{ background: 'var(--verde-pale-bg)', border: 'none' }}>
          <div className="field" style={{ flex: 1, minWidth: 280 }}>
            <label>Enlace de activación — cópialo y compártelo con la persona</label>
            <input value={enlace} readOnly onFocus={(e) => e.target.select()} />
          </div>
          <button type="button" className="btn-primary" onClick={onCopiar}>
            {copiado ? '✓ Copiado' : 'Copiar'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setEnlace(null)}>
            Cerrar
          </button>
        </div>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Entidad</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {usuarios === null && (
              <tr><td colSpan={6} className="tabla-vacia">Cargando…</td></tr>
            )}
            {usuarios?.map((u) => (
              <tr key={u.id}>
                <td className="nombre">{u.username}</td>
                <td>
                  {editandoId === u.id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        value={editForm.first_name}
                        onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                        placeholder="Nombre"
                        style={{ width: 100 }}
                      />
                      <input
                        value={editForm.last_name}
                        onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                        placeholder="Apellido"
                        style={{ width: 100 }}
                      />
                    </div>
                  ) : (
                    `${u.first_name} ${u.last_name}`.trim() || <span style={{ color: 'var(--gray-tx)' }}>Sin nombre</span>
                  )}
                </td>
                <td>
                  {editandoId === u.id ? (
                    <select
                      value={editForm.rol}
                      onChange={(e) => setEditForm({ ...editForm, rol: e.target.value, entidad: '' })}
                    >
                      {Object.entries(ROL_LABEL).map(([valor, etiqueta]) => (
                        <option key={valor} value={valor}>{etiqueta}</option>
                      ))}
                    </select>
                  ) : (
                    ROL_LABEL[u.rol] || u.rol
                  )}
                </td>
                <td>
                  {editandoId === u.id ? (
                    editForm.rol === ROLES.USUARIO_ENTIDAD && (
                      <select value={editForm.entidad} onChange={(e) => setEditForm({ ...editForm, entidad: e.target.value })} required>
                        <option value="">Selecciona…</option>
                        {entidades.map((ent) => (
                          <option key={ent.id} value={ent.id}>{ent.nombre}</option>
                        ))}
                      </select>
                    )
                  ) : (
                    u.entidad_nombre || '—'
                  )}
                </td>
                <td>
                  <span className={`badge ${u.is_active ? (u.password_pendiente ? 'dorado' : 'verde') : 'guinda'}`}>
                    {!u.is_active ? 'Desactivada' : u.password_pendiente ? 'Pendiente de activar' : 'Activa'}
                  </span>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {editandoId === u.id ? (
                    <>
                      <button className="btn-primary" onClick={() => onGuardarEdit(u.id)} disabled={guardandoEdit} style={{ marginRight: 6 }}>
                        {guardandoEdit ? 'Guardando…' : 'Guardar'}
                      </button>
                      <button className="btn-ghost" onClick={() => setEditandoId(null)}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      <button className="btn-ghost" onClick={() => onEditar(u)} style={{ marginRight: 6 }}>Editar</button>
                      <button className="btn-ghost" onClick={() => onGenerarToken(u)} style={{ marginRight: 6 }}>
                        Generar nuevo enlace
                      </button>
                      {u.id !== yo?.id && (
                        <button className="btn-ghost" onClick={() => onToggleActivo(u)}>
                          {u.is_active ? 'Desactivar' : 'Reactivar'}
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
