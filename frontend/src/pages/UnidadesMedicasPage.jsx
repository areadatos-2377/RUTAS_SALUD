import { useEffect, useState } from 'react';
import { api } from '../api/client';
import '../styles/table.css';

const FORM_VACIO = {
  clues: '',
  nombre: '',
  entidad: '',
  tipo_unidad_medica: '',
  municipio: '',
  quien_recibe: '',
  telefono: '',
  correo: '',
};
const NIVELES = ['PRIMER NIVEL', 'SEGUNDO NIVEL', 'TERCER NIVEL'];
const NIVEL_BADGE = { 'PRIMER NIVEL': 'verde', 'SEGUNDO NIVEL': 'dorado', 'TERCER NIVEL': 'guinda' };

export default function UnidadesMedicasPage() {
  const [entidades, setEntidades] = useState([]);
  const [filtroEntidad, setFiltroEntidad] = useState('');
  const [filtroNivel, setFiltroNivel] = useState('');
  // El catálogo completo puede tener miles de filas (9,460 a la fecha) --
  // a diferencia del resto de las listas de la app, aquí sí hace falta
  // paginación real en vez de traer todo de un jalón.
  const [pagina, setPagina] = useState(1);
  const [resultado, setResultado] = useState(null); // {count, next, previous, results}
  const [form, setForm] = useState(FORM_VACIO);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.getAll('/api/entidades/').then(setEntidades);
  }, []);

  async function cargar(paginaObjetivo) {
    setResultado(null);
    const params = new URLSearchParams({ page: String(paginaObjetivo) });
    if (filtroEntidad) params.set('entidad', filtroEntidad);
    if (filtroNivel) params.set('nivel_atencion', filtroNivel);
    const data = await api.get(`/api/unidades-medicas/?${params}`);
    setResultado(data);
  }

  useEffect(() => {
    setPagina(1);
    cargar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroEntidad, filtroNivel]);

  function irAPagina(n) {
    setPagina(n);
    cargar(n);
  }

  async function onCrear(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.post('/api/unidades-medicas/', { ...form, entidad: Number(form.entidad), origen: 'manual' });
      setForm(FORM_VACIO);
      await cargar(pagina);
    } catch (err) {
      setError(err?.data?.clues?.[0] || 'No se pudo crear la unidad médica.');
    } finally {
      setGuardando(false);
    }
  }

  const totalPaginas = resultado ? Math.max(1, Math.ceil(resultado.count / 50)) : 1;

  return (
    <div>
      <div className="topbar">
        <div>
          <p className="crumb">Administración</p>
          <h2>Unidades médicas</h2>
        </div>
      </div>

      <div className="panel-form">
        <div className="field">
          <label htmlFor="filtro">Filtrar por entidad</label>
          <select id="filtro" value={filtroEntidad} onChange={(e) => setFiltroEntidad(e.target.value)}>
            <option value="">Todas</option>
            {entidades.map((ent) => (
              <option key={ent.id} value={ent.id}>{ent.nombre}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="filtroNivel">Nivel de atención</label>
          <select id="filtroNivel" value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value)}>
            <option value="">Todos</option>
            {NIVELES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      <form className="panel-form" onSubmit={onCrear} style={{ flexWrap: 'wrap' }}>
        <div className="field">
          <label htmlFor="clues">CLUES</label>
          <input
            id="clues"
            value={form.clues}
            onChange={(e) => setForm({ ...form, clues: e.target.value.toUpperCase() })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="nombreUnidad">Nombre</label>
          <input id="nombreUnidad" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="entidadUnidad">Entidad</label>
          <select
            id="entidadUnidad"
            value={form.entidad}
            onChange={(e) => setForm({ ...form, entidad: e.target.value })}
            required
          >
            <option value="">Selecciona…</option>
            {entidades.map((ent) => (
              <option key={ent.id} value={ent.id}>{ent.nombre}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tipo">Tipo de unidad médica</label>
          <input id="tipo" value={form.tipo_unidad_medica} onChange={(e) => setForm({ ...form, tipo_unidad_medica: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="municipio">Municipio</label>
          <input id="municipio" value={form.municipio} onChange={(e) => setForm({ ...form, municipio: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="quienRecibe">¿Quién recibe?</label>
          <input id="quienRecibe" maxLength={150} value={form.quien_recibe} onChange={(e) => setForm({ ...form, quien_recibe: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="telefonoContacto">Teléfono</label>
          <input id="telefonoContacto" maxLength={100} value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="correoContacto">Correo</label>
          <input id="correoContacto" maxLength={150} value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} />
        </div>
        <button className="btn-primary" type="submit" disabled={guardando}>
          {guardando ? 'Creando…' : '+ Nueva unidad'}
        </button>
      </form>

      {error && <p className="login-error" style={{ maxWidth: 400 }}>{error}</p>}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>CLUES</th>
              <th>Nombre</th>
              <th>Entidad</th>
              <th>Nivel de atención</th>
              <th>Tipo</th>
              <th>Origen</th>
            </tr>
          </thead>
          <tbody>
            {resultado === null && (
              <tr><td colSpan={6} className="tabla-vacia">Cargando…</td></tr>
            )}
            {resultado?.results.length === 0 && (
              <tr><td colSpan={6} className="tabla-vacia">No hay unidades médicas.</td></tr>
            )}
            {resultado?.results.map((u) => (
              <tr key={u.clues}>
                <td>{u.clues}</td>
                <td className="nombre">{u.nombre}</td>
                <td>{entidades.find((e) => e.id === u.entidad)?.nombre || u.entidad}</td>
                <td>
                  <span className={`badge ${NIVEL_BADGE[u.nivel_atencion] || 'gris'}`}>{u.nivel_atencion}</span>
                </td>
                <td>{u.tipo_unidad_medica}</td>
                <td>
                  <span className={`badge ${u.origen === 'manual' ? 'dorado' : 'verde'}`}>
                    {u.origen === 'manual' ? 'Manual' : 'Catálogo'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {resultado && resultado.count > 0 && (
          <div className="tfoot">
            <span>
              {resultado.count} unidades · página {pagina} de {totalPaginas}
            </span>
            <div className="pages">
              <button className="btn-ghost" disabled={!resultado.previous} onClick={() => irAPagina(pagina - 1)}>
                ← Anterior
              </button>
              <button className="btn-ghost" disabled={!resultado.next} onClick={() => irAPagina(pagina + 1)}>
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
