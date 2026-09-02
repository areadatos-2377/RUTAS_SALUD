import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth, ROLES } from '../auth/AuthContext';
import { CATEGORIA_LABEL } from '../utils/categoriaNiveles';
import { exportarProgramacionExcel } from '../utils/exportarProgramacionExcel';
import EvidenciaPanel from './EvidenciaPanel';
import EvidenciaVistaRapida from './EvidenciaVistaRapida';
import '../styles/table.css';
import './JornadaDetallePage.css';

const TIPO_LABEL = { ordinaria: 'Ordinaria', extraordinaria: 'Extraordinaria', emergencia: 'Emergencia' };

function valoresEditables(visita) {
  return {
    ruta_numero: visita.ruta_numero || '',
    fecha_distribucion_programada: visita.fecha_distribucion_programada || '',
    claves_a_desplazar: visita.claves_a_desplazar ?? 0,
    piezas_medicamento: visita.piezas_medicamento ?? 0,
    piezas_material_curacion: visita.piezas_material_curacion ?? 0,
    tipo_unidad_medica: visita.tipo_unidad_medica || '',
    quien_recibe: visita.quien_recibe || '',
    telefono: visita.telefono || '',
    correo: visita.correo || '',
  };
}

export default function JornadaDetallePage() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const puedeEscribir = usuario?.rol === ROLES.USUARIO_ENTIDAD || usuario?.rol === ROLES.SUPER_ADMIN;
  const requiereSelectorEntidad = usuario?.rol !== ROLES.USUARIO_ENTIDAD;
  const puedeGenerarPresentacion = usuario?.rol === ROLES.ADMIN_NACIONAL || usuario?.rol === ROLES.SUPER_ADMIN;

  const [jornada, setJornada] = useState(null);
  const [entidades, setEntidades] = useState([]);
  const [entidadId, setEntidadId] = useState(
    usuario?.rol === ROLES.USUARIO_ENTIDAD ? String(usuario.entidad) : '',
  );
  const [visitas, setVisitas] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState(null);
  const [editandoId, setEditandoId] = useState(null);
  const [formulario, setFormulario] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [visitaEvidencia, setVisitaEvidencia] = useState(null);
  const [vistaRapida, setVistaRapida] = useState(null);
  const [modoSeleccion, setModoSeleccion] = useState(false);
  // { [visitaId]: { evidenciaId, urlDescarga, clues, nombreUnidad, entidadNombre } }
  // -- vive aqui (no en el selector de entidad) para que sobreviva al
  // cambiar de entidad en el dropdown: se puede ir marcando fotos de
  // varias entidades antes de generar una sola presentacion con todo.
  const [fotosSeleccionadas, setFotosSeleccionadas] = useState({});
  const [generandoPresentacion, setGenerandoPresentacion] = useState(false);
  const [autoSeleccionando, setAutoSeleccionando] = useState(false);

  useEffect(() => {
    api.get(`/api/jornadas/${id}/`)
      .then(setJornada)
      .catch(() => setError('No se pudo cargar la distribución.'));
  }, [id]);

  useEffect(() => {
    if (!requiereSelectorEntidad) return;
    api.getAll('/api/entidades/')
      .then((lista) => {
        setEntidades(lista);
        if (lista.length > 0) setEntidadId((actual) => actual || String(lista[0].id));
      })
      .catch(() => setError('No se pudieron cargar las entidades.'));
  }, [requiereSelectorEntidad]);

  useEffect(() => {
    if (!entidadId) return;
    setVisitas(null);
    setError(null);
    api.getAll(`/api/programacion-visitas/?jornada=${id}&entidad=${entidadId}`)
      .then(setVisitas)
      .catch(() => setError('No se pudieron cargar las unidades de la distribución.'));
  }, [id, entidadId]);

  function onEditar(visita) {
    setEditandoId(visita.id);
    setFormulario(valoresEditables(visita));
    setErrorEdicion(null);
  }

  function onCancelarEdicion() {
    setEditandoId(null);
    setFormulario(null);
    setErrorEdicion(null);
  }

  async function onGuardar(e) {
    e.preventDefault();
    setGuardando(true);
    setErrorEdicion(null);
    try {
      const cuerpo = {
        ...formulario,
        fecha_distribucion_programada: formulario.fecha_distribucion_programada || null,
        claves_a_desplazar: Number(formulario.claves_a_desplazar) || 0,
        piezas_medicamento: Number(formulario.piezas_medicamento) || 0,
        piezas_material_curacion: Number(formulario.piezas_material_curacion) || 0,
      };
      const actualizada = await api.patch(`/api/programacion-visitas/${editandoId}/`, cuerpo);
      setVisitas((actuales) => actuales.map((visita) => (
        visita.id === actualizada.id ? actualizada : visita
      )));
      onCancelarEdicion();
    } catch (err) {
      const detalle = err instanceof ApiError && err.data
        ? err.data.non_field_errors?.[0] || err.data.detail
        : null;
      setErrorEdicion(detalle || 'No se pudieron guardar los cambios.');
    } finally {
      setGuardando(false);
    }
  }

  async function onEliminar(visita) {
    if (!confirm(`¿Eliminar ${visita.unidad_medica} de esta distribución?`)) return;
    try {
      await api.del(`/api/programacion-visitas/${visita.id}/`);
      setVisitas((actuales) => actuales.filter((fila) => fila.id !== visita.id));
      if (editandoId === visita.id) onCancelarEdicion();
    } catch {
      setError('No se pudo eliminar la unidad de la distribución.');
    }
  }

  async function onExportar() {
    setExportando(true);
    try {
      const entidad = await api.get(`/api/entidades/${entidadId}/`);
      await exportarProgramacionExcel({ jornada, entidad, visitas });
    } catch {
      setError('No se pudo generar el Excel.');
    } finally {
      setExportando(false);
    }
  }

  function onSeleccionarFoto(visita, evidencia) {
    setFotosSeleccionadas((actuales) => {
      const yaEsEsta = actuales[visita.id]?.evidenciaId === evidencia.id;
      const copia = { ...actuales };
      if (yaEsEsta) {
        // Volver a dar clic en la misma foto la desmarca.
        delete copia[visita.id];
      } else {
        copia[visita.id] = {
          evidenciaId: evidencia.id,
          urlDescarga: evidencia.url_descarga,
          clues: visita.unidad_medica,
          nombreUnidad: visita.unidad_medica_nombre,
          entidadNombre: visita.unidad_medica_entidad_nombre,
        };
      }
      return copia;
    });
  }

  // Marcar foto por foto seria muy tedioso con muchas unidades -- al entrar
  // en modo seleccion se elige sola la primera imagen de cada unidad que ya
  // tenga fotos (la mas reciente, es la que ya se ve primero en cualquier
  // lista -- ver EvidenciaArchivo.Meta.ordering), EN TODA LA DISTRIBUCION,
  // no solo en la entidad que se este viendo -- de otro modo habria que
  // recorrer entidad por entidad para que las tomara en cuenta. Se pide
  // aparte de `visitas` (que solo trae la entidad actual, paginada) con
  // ?con_evidencia_imagen=1, que filtra en la base y evita traer las miles
  // de filas de precarga sin nada capturado. El usuario sigue pudiendo dar
  // clic en el marcador de una unidad puntual para cambiar cual foto se usa.
  useEffect(() => {
    if (!modoSeleccion || !jornada) return;
    let cancelado = false;
    setAutoSeleccionando(true);
    api.getAll(`/api/programacion-visitas/?jornada=${jornada.id}&con_evidencia_imagen=1`)
      .then((visitasConImagen) => {
        if (cancelado) return [];
        const pendientes = visitasConImagen.filter((v) => !fotosSeleccionadas[v.id]);
        return Promise.all(
          pendientes.map(async (visita) => {
            try {
              const entregas = await api.getAll(`/api/entregas/?programacion_visita=${visita.id}`);
              const primeraImagen = entregas[0]?.evidencias?.find((ev) => ev.tipo === 'foto');
              return primeraImagen ? { visita, evidencia: primeraImagen } : null;
            } catch {
              return null;
            }
          }),
        );
      })
      .then((resultados) => {
        if (cancelado) return;
        setFotosSeleccionadas((actuales) => {
          const copia = { ...actuales };
          for (const r of resultados) {
            if (!r || copia[r.visita.id]) continue; // no pisar una seleccion manual hecha mientras cargaba
            copia[r.visita.id] = {
              evidenciaId: r.evidencia.id,
              urlDescarga: r.evidencia.url_descarga,
              clues: r.visita.unidad_medica,
              nombreUnidad: r.visita.unidad_medica_nombre,
              entidadNombre: r.visita.unidad_medica_entidad_nombre,
            };
          }
          return copia;
        });
        setAutoSeleccionando(false);
      });

    return () => { cancelado = true; };
    // fotosSeleccionadas se lee pero NO debe disparar este effect de nuevo
    // (el propio efecto la actualiza -- entraria en loop). Solo debe correr
    // al entrar a modo seleccion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoSeleccion, jornada]);

  async function onGenerarPresentacion() {
    setGenerandoPresentacion(true);
    setError(null);
    try {
      const fotos = Object.entries(fotosSeleccionadas).map(([visitaId, foto]) => ({
        visita_id: Number(visitaId),
        evidencia_id: foto.evidenciaId,
      }));
      const { blob, nombreArchivo } = await api.postArchivo('/api/entregas/generar-presentacion/', {
        jornada_id: jornada.id,
        fotos,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFotosSeleccionadas({});
      setModoSeleccion(false);
    } catch {
      setError('No se pudo generar la presentación.');
    } finally {
      setGenerandoPresentacion(false);
    }
  }

  const termino = busqueda.trim().toLocaleLowerCase('es');
  const filasVisibles = visitas?.filter((visita) => {
    if (!termino) return true;
    return [
      visita.unidad_medica,
      visita.unidad_medica_nombre,
      visita.unidad_medica_municipio,
      visita.ruta_numero,
    ].some((valor) => String(valor || '').toLocaleLowerCase('es').includes(termino));
  });

  const entidadSeleccionada = entidades.find((entidad) => String(entidad.id) === entidadId);
  const nombreEntidad = usuario?.rol === ROLES.USUARIO_ENTIDAD
    ? visitas?.[0]?.unidad_medica_entidad_nombre
    : entidadSeleccionada?.nombre;

  return (
    <div>
      <div className="topbar jornada-topbar">
        <div>
          <p className="crumb">
            <Link to="/jornadas">Distribuciones</Link>
          </p>
          <h2>{jornada?.nombre || 'Cargando…'}</h2>
          {jornada && (
            <p className="jornada-meta">
              {TIPO_LABEL[jornada.tipo] || jornada.tipo} ·{' '}
              <span className={`badge ${jornada.categoria === 'primer_nivel' ? 'verde' : 'dorado'}`}>
                {CATEGORIA_LABEL[jornada.categoria] || jornada.categoria}
              </span>{' '}
              · {jornada.fecha_inicio} al {jornada.fecha_fin}
            </p>
          )}
        </div>
        {usuario?.rol === ROLES.USUARIO_ENTIDAD && visitas && (
          <button className="btn-ghost" onClick={onExportar} disabled={exportando}>
            {exportando ? 'Generando…' : 'Descargar Excel'}
          </button>
        )}
        {puedeGenerarPresentacion && visitas && (
          <div className="jornada-topbar__presentacion">
            {modoSeleccion && (
              <span className="jornada-topbar__contador">
                {autoSeleccionando && 'Eligiendo fotos… · '}
                {Object.keys(fotosSeleccionadas).length} foto{Object.keys(fotosSeleccionadas).length === 1 ? '' : 's'} elegida{Object.keys(fotosSeleccionadas).length === 1 ? '' : 's'}
              </span>
            )}
            {modoSeleccion && Object.keys(fotosSeleccionadas).length > 0 && (
              <button className="btn-primary" onClick={onGenerarPresentacion} disabled={generandoPresentacion}>
                {generandoPresentacion ? 'Generando…' : 'Generar presentación'}
              </button>
            )}
            <button className="btn-ghost" onClick={() => setModoSeleccion((actual) => !actual)}>
              {modoSeleccion ? 'Cancelar selección' : 'Generar presentación'}
            </button>
          </div>
        )}
      </div>

      <div className="jornada-controles">
        {requiereSelectorEntidad && (
          <div className="field">
            <label htmlFor="entidad">Entidad</label>
            <select id="entidad" value={entidadId} onChange={(e) => setEntidadId(e.target.value)}>
              {entidades.map((entidad) => (
                <option key={entidad.id} value={entidad.id}>{entidad.nombre}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field jornada-busqueda">
          <label htmlFor="busqueda">Buscar unidad</label>
          <input
            id="busqueda"
            type="search"
            placeholder="CLUES, nombre, municipio o ruta"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <p className="jornada-conteo">
          {filasVisibles?.length ?? 0} de {visitas?.length ?? 0} unidades
          {nombreEntidad ? ` · ${nombreEntidad}` : ''}
        </p>
      </div>

      {error && <p className="login-error" style={{ maxWidth: 520 }}>{error}</p>}
      {visitas === null && !error && <p className="tabla-cargando">Cargando unidades…</p>}

      {editandoId && formulario && (
        <form className="panel-form jornada-editor" onSubmit={onGuardar}>
          <div className="jornada-editor__unidad">
            <span>{visitas.find((visita) => visita.id === editandoId)?.unidad_medica}</span>
            <strong>{visitas.find((visita) => visita.id === editandoId)?.unidad_medica_nombre}</strong>
          </div>
          <div className="field">
            <label htmlFor="rutaNumero">Ruta</label>
            <input id="rutaNumero" value={formulario.ruta_numero} onChange={(e) => setFormulario({ ...formulario, ruta_numero: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="fechaProgramada">Fecha programada</label>
            <input id="fechaProgramada" type="date" min={jornada?.fecha_inicio} max={jornada?.fecha_fin} value={formulario.fecha_distribucion_programada} onChange={(e) => setFormulario({ ...formulario, fecha_distribucion_programada: e.target.value })} />
          </div>
          <div className="field field-numero">
            <label htmlFor="claves">Claves</label>
            <input id="claves" type="number" min="0" value={formulario.claves_a_desplazar} onChange={(e) => setFormulario({ ...formulario, claves_a_desplazar: e.target.value })} />
          </div>
          <div className="field field-numero">
            <label htmlFor="medicamento">Piezas medicamento</label>
            <input id="medicamento" type="number" min="0" value={formulario.piezas_medicamento} onChange={(e) => setFormulario({ ...formulario, piezas_medicamento: e.target.value })} />
          </div>
          <div className="field field-numero">
            <label htmlFor="material">Piezas material</label>
            <input id="material" type="number" min="0" value={formulario.piezas_material_curacion} onChange={(e) => setFormulario({ ...formulario, piezas_material_curacion: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="tipoUnidad">Tipo de unidad</label>
            <input id="tipoUnidad" value={formulario.tipo_unidad_medica} disabled title="Viene del catálogo de unidades médicas, no se puede editar aquí" />
          </div>
          <div className="field">
            <label htmlFor="recibe">¿Quién recibe?</label>
            <input id="recibe" value={formulario.quien_recibe} onChange={(e) => setFormulario({ ...formulario, quien_recibe: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="telefono">Teléfono</label>
            <input id="telefono" value={formulario.telefono} onChange={(e) => setFormulario({ ...formulario, telefono: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="correo">Correo</label>
            <input id="correo" type="email" value={formulario.correo} onChange={(e) => setFormulario({ ...formulario, correo: e.target.value })} />
          </div>
          <div className="jornada-editor__actions">
            <button className="btn-primary" type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
            <button className="btn-ghost" type="button" onClick={onCancelarEdicion}>Cancelar</button>
          </div>
          {errorEdicion && <p className="login-error">{errorEdicion}</p>}
        </form>
      )}

      {filasVisibles && (
        <div className="tablewrap jornada-tabla">
          <table>
            <thead>
              <tr>
                <th>CLUES</th>
                <th>Nombre de la unidad</th>
                <th>Municipio</th>
                <th>Tipo de unidad</th>
                <th>Ruta</th>
                <th>Fecha programada</th>
                <th>Claves</th>
                <th>Pzas. medicamento</th>
                <th>Pzas. material</th>
                <th>Recibe</th>
                <th>Teléfono</th>
                <th>Correo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.length === 0 && (
                <tr><td colSpan={13} className="tabla-vacia">No hay unidades que coincidan.</td></tr>
              )}
              {filasVisibles.map((visita) => (
                <tr key={visita.id} className={editandoId === visita.id ? 'fila-editando' : ''}>
                  <td>{visita.unidad_medica}</td>
                  <td className="nombre">{visita.unidad_medica_nombre}</td>
                  <td>{visita.unidad_medica_municipio || '—'}</td>
                  <td>{visita.tipo_unidad_medica || '—'}</td>
                  <td>{visita.ruta_numero || 'Pendiente'}</td>
                  <td>{visita.fecha_distribucion_programada || 'Pendiente'}</td>
                  <td>{visita.claves_a_desplazar}</td>
                  <td>{visita.piezas_medicamento}</td>
                  <td>{visita.piezas_material_curacion}</td>
                  <td>{visita.quien_recibe || '—'}</td>
                  <td>{visita.telefono || '—'}</td>
                  <td>{visita.correo || '—'}</td>
                  <td className="jornada-acciones">
                    {/* Marcadores: visibles para cualquiera que llegue a esta tabla
                        (incluye admin_nacional, que no puede editar pero si elegir
                        fotos para la presentacion) -- Evidencia/Editar/Eliminar
                        siguen abajo, solo para quien puede escribir. */}
                    {(visita.ruta_numero || visita.fecha_distribucion_programada) && (
                      <>
                        {visita.tiene_evidencia_imagen && (
                          <button
                            className={`jornada-marcador${fotosSeleccionadas[visita.id] ? ' jornada-marcador--seleccionada' : ''}`}
                            title={modoSeleccion ? 'Elegir foto para la presentación' : 'Ver imágenes subidas'}
                            onClick={() => setVistaRapida({ visita, categoria: 'imagen' })}
                          >
                            🖼️
                          </button>
                        )}
                        {visita.tiene_evidencia_documento && (
                          <button
                            className="jornada-marcador"
                            title="Ver documentos subidos"
                            onClick={() => setVistaRapida({ visita, categoria: 'documento' })}
                          >
                            📄
                          </button>
                        )}
                        {visita.tiene_evidencia_video && (
                          <button
                            className="jornada-marcador"
                            title="Ver video subido"
                            onClick={() => setVistaRapida({ visita, categoria: 'video' })}
                          >
                            🎞️
                          </button>
                        )}
                      </>
                    )}
                    {puedeEscribir && (
                      <>
                        {/* Evidencia solo tiene sentido si ya hay algo capturado -- no en
                            las miles de filas precargadas todavia vacias. */}
                        {(visita.ruta_numero || visita.fecha_distribucion_programada) && (
                          <button className="btn-ghost" onClick={() => setVisitaEvidencia(visita)}>Evidencia</button>
                        )}
                        <button className="btn-ghost" onClick={() => onEditar(visita)}>Editar</button>
                        <button className="btn-ghost" onClick={() => onEliminar(visita)}>Eliminar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visitaEvidencia && (
        <EvidenciaPanel
          visita={visitaEvidencia}
          onCerrar={(resumen) => {
            // Los marcadores de la fila (visitas del listado) vienen de una
            // carga que ya paso -- sin esto, subir evidencia y cerrar el
            // panel no los actualizaba hasta recargar toda la pagina.
            if (resumen) {
              setVisitas((actual) =>
                actual.map((v) => (v.id === visitaEvidencia.id ? { ...v, ...resumen } : v)),
              );
            }
            setVisitaEvidencia(null);
          }}
        />
      )}
      {vistaRapida && (
        <EvidenciaVistaRapida
          visita={vistaRapida.visita}
          categoria={vistaRapida.categoria}
          onCerrar={() => setVistaRapida(null)}
          seleccionable={modoSeleccion && vistaRapida.categoria === 'imagen'}
          seleccionActualId={fotosSeleccionadas[vistaRapida.visita.id]?.evidenciaId ?? null}
          onSeleccionar={(evidencia) => onSeleccionarFoto(vistaRapida.visita, evidencia)}
        />
      )}
    </div>
  );
}