import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth, ROLES } from '../auth/AuthContext';
import { CATEGORIA_LABEL } from '../utils/categoriaNiveles';
import '../styles/table.css';

const TIPO_LABEL = { ordinaria: 'Ordinaria', extraordinaria: 'Extraordinaria', emergencia: 'Emergencia' };
const ESTATUS_LABEL = { planeada: 'Planeada', en_curso: 'En curso', cerrada: 'Cerrada', cancelada: 'Cancelada' };
const ESTATUS_BADGE = {
  planeada: 'gris',
  en_curso: 'verde',
  cerrada: 'dorado',
  cancelada: 'guinda',
};

const FORM_VACIO = {
  nombre: '', tipo: 'ordinaria', categoria: 'primer_nivel', fecha_inicio: '', fecha_fin: '', estatus: 'planeada',
};

export default function JornadasPage() {
  const { usuario } = useAuth();
  const puedeCrear = usuario?.rol === ROLES.ADMIN_NACIONAL || usuario?.rol === ROLES.SUPER_ADMIN;

  const [jornadas, setJornadas] = useState(null);
  const [error, setError] = useState(null);
  const [formulario, setFormulario] = useState(FORM_VACIO);
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);

  async function cargar() {
    try {
      setJornadas(await api.getAll('/api/jornadas/'));
    } catch {
      setError('No se pudieron cargar las distribuciones.');
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  function onEditar(j) {
    setEditandoId(j.id);
    setFormulario({
      nombre: j.nombre,
      tipo: j.tipo,
      categoria: j.categoria,
      fecha_inicio: j.fecha_inicio,
      fecha_fin: j.fecha_fin,
      estatus: j.estatus,
    });
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onCancelarEdicion() {
    setEditandoId(null);
    setFormulario(FORM_VACIO);
    setError(null);
  }

  async function onGuardar(e) {
    e.preventDefault();
    setCreando(true);
    setError(null);
    try {
      if (editandoId) {
        await api.patch(`/api/jornadas/${editandoId}/`, formulario);
        setEditandoId(null);
      } else {
        await api.post('/api/jornadas/', formulario);
      }
      setFormulario(FORM_VACIO);
      await cargar();
    } catch (err) {
      if (err instanceof ApiError && err.data) {
        setError(err.data.non_field_errors?.[0] || err.data.detail || 'No se pudo guardar. Revisa los datos.');
      } else {
        setError('No se pudo guardar. Revisa los datos.');
      }
    } finally {
      setCreando(false);
    }
  }

  async function onEliminar(j) {
    // rutas_count/visitas_count cuentan solo datos ya capturados de verdad
    // (no las miles de filas precargadas vacias que trae toda jornada) --
    // ver JornadaSerializer.get_visitas_count.
    const partes = [];
    if (j.rutas_count > 0) partes.push(`${j.rutas_count} ${j.rutas_count === 1 ? 'ruta' : 'rutas'}`);
    if (j.visitas_count > 0) {
      partes.push(`${j.visitas_count} ${j.visitas_count === 1 ? 'unidad capturada' : 'unidades capturadas'}`);
    }
    const advertencia = partes.length
      ? `"${j.nombre}" tiene ${partes.join(' y ')}. Eliminarla borra TODO lo capturado en esta distribución, ` +
        'sin poder deshacerlo. ¿Continuar?'
      : `¿Eliminar la distribución "${j.nombre}"?`;
    if (!confirm(advertencia)) return;
    try {
      await api.del(`/api/jornadas/${j.id}/`);
      if (editandoId === j.id) onCancelarEdicion();
      await cargar();
    } catch {
      setError('No se pudo eliminar la distribución.');
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <p className="crumb">Programación</p>
          <h2>Distribuciones</h2>
        </div>
      </div>

      {puedeCrear && (
        <form className="panel-form" onSubmit={onGuardar}>
          <div className="field">
            <label htmlFor="nombre">Nombre</label>
            <input
              id="nombre"
              placeholder="p. ej. sexta distribución"
              value={formulario.nombre}
              onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="tipo">Tipo</label>
            <select
              id="tipo"
              value={formulario.tipo}
              onChange={(e) => setFormulario({ ...formulario, tipo: e.target.value })}
            >
              <option value="ordinaria">Ordinaria</option>
              <option value="extraordinaria">Extraordinaria</option>
              <option value="emergencia">Emergencia</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="categoria">Categoría</label>
            <select
              id="categoria"
              value={formulario.categoria}
              onChange={(e) => setFormulario({ ...formulario, categoria: e.target.value })}
            >
              <option value="primer_nivel">Primer nivel</option>
              <option value="segundo_tercer_nivel">Segundo y tercer nivel</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="fecha_inicio">Fecha inicio</label>
            <input
              id="fecha_inicio"
              type="date"
              value={formulario.fecha_inicio}
              onChange={(e) => setFormulario({ ...formulario, fecha_inicio: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="fecha_fin">Fecha fin</label>
            <input
              id="fecha_fin"
              type="date"
              value={formulario.fecha_fin}
              onChange={(e) => setFormulario({ ...formulario, fecha_fin: e.target.value })}
              required
            />
          </div>
          {editandoId && (
            <div className="field">
              <label htmlFor="estatus">Estatus</label>
              <select
                id="estatus"
                value={formulario.estatus}
                onChange={(e) => setFormulario({ ...formulario, estatus: e.target.value })}
              >
                {Object.entries(ESTATUS_LABEL).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>{etiqueta}</option>
                ))}
              </select>
            </div>
          )}
          <button className="btn-primary" type="submit" disabled={creando}>
            {creando ? 'Guardando…' : editandoId ? 'Guardar cambios' : '+ Agregar distribución'}
          </button>
          {editandoId && (
            <button className="btn-ghost" type="button" onClick={onCancelarEdicion}>
              Cancelar
            </button>
          )}
        </form>
      )}

      {error && <p className="login-error" style={{ maxWidth: 400 }}>{error}</p>}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Categoría</th>
              <th>Fecha inicio</th>
              <th>Fecha fin</th>
              <th>Estatus</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jornadas === null && (
              <tr><td colSpan={7} className="tabla-vacia">Cargando…</td></tr>
            )}
            {jornadas?.length === 0 && (
              <tr><td colSpan={7} className="tabla-vacia">Todavía no hay distribuciones.</td></tr>
            )}
            {jornadas?.map((j) => (
              <tr key={j.id}>
                <td className="nombre">{j.nombre}</td>
                <td>{TIPO_LABEL[j.tipo] || j.tipo}</td>
                <td>{CATEGORIA_LABEL[j.categoria] || j.categoria}</td>
                <td>{j.fecha_inicio}</td>
                <td>{j.fecha_fin}</td>
                <td>
                  <span className={`badge ${ESTATUS_BADGE[j.estatus] || 'gris'}`}>{ESTATUS_LABEL[j.estatus] || j.estatus}</span>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {puedeCrear && (
                    <>
                      <button className="btn-ghost" onClick={() => onEditar(j)} style={{ marginRight: 6 }}>
                        Editar
                      </button>
                      <button className="btn-ghost" onClick={() => onEliminar(j)} style={{ marginRight: 6 }}>
                        Eliminar
                      </button>
                    </>
                  )}
                  <Link className="btn-ghost" to={`/jornadas/${j.id}`}>
                    Ver unidades
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
