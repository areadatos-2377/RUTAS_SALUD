import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth, ROLES } from '../auth/AuthContext';
import { CATEGORIA_LABEL } from '../utils/categoriaNiveles';
import { exportarProgramacionExcel } from '../utils/exportarProgramacionExcel';
import EvidenciaPanel from './EvidenciaPanel';
import EvidenciaVistaRapida from './EvidenciaVistaRapida';
import FiltroColumna from './FiltroColumna';
import '../styles/table.css';
import './JornadaDetallePage.css';

const TIPO_LABEL = { ordinaria: 'Ordinaria', extraordinaria: 'Extraordinaria', emergencia: 'Emergencia' };

// Una sola fuente de verdad para las 11 columnas de la tabla -- de aqui
// salen el encabezado, el filtro por columna, la edicion en linea (doble
// clic) y las opciones del selector de "editar en masa". `editable` marca
// las 7 columnas capturables que se muestran en esta vista.
const COLUMNAS = [
  { key: 'unidad_medica', label: 'CLUES', editable: false },
  { key: 'unidad_medica_nombre', label: 'Nombre de la unidad', editable: false, clase: 'nombre' },
  { key: 'unidad_medica_municipio', label: 'Municipio', editable: false, vacio: '—' },
  { key: 'tipo_unidad_medica', label: 'Tipo de unidad', editable: false, vacio: '—' },
  { key: 'fecha_distribucion_programada', label: 'Fecha programada', editable: true, tipo: 'fecha', vacio: 'Pendiente' },
  { key: 'claves_a_desplazar', label: 'Claves', editable: true, tipo: 'numero' },
  { key: 'piezas_medicamento', label: 'Pzas. medicamento', editable: true, tipo: 'numero' },
  { key: 'piezas_material_curacion', label: 'Pzas. material', editable: true, tipo: 'numero' },
  { key: 'quien_recibe', label: 'Recibe', editable: true, tipo: 'texto', vacio: '—', maxLength: 150 },
  { key: 'telefono', label: 'Teléfono', editable: true, tipo: 'texto', vacio: '—', maxLength: 100 },
  { key: 'correo', label: 'Correo', editable: true, tipo: 'texto', vacio: '—', maxLength: 150 },
];
const COLUMNAS_EDITABLES = COLUMNAS.filter((c) => c.editable);

// Mismo texto que ya se ve en la celda (con su "Pendiente"/"—" cuando esta
// vacio) -- se usa tanto para pintar la tabla como para armar la lista de
// valores unicos de cada filtro, para que lo que se ve y lo que se filtra
// sea exactamente lo mismo.
function valorMostrado(visita, columna) {
  const crudo = visita[columna.key];
  if (crudo === null || crudo === undefined || crudo === '') return columna.vacio ?? '';
  return String(crudo);
}

function valorCrudoParaEditar(visita, columna) {
  const crudo = visita[columna.key];
  if (crudo === null || crudo === undefined) return columna.tipo === 'numero' ? '0' : '';
  return String(crudo);
}

function tieneEvidencia(visita) {
  return visita.tiene_evidencia_imagen
    || visita.tiene_evidencia_documento
    || visita.tiene_evidencia_video;
}

function capturaCompleta(visita) {
  return COLUMNAS_EDITABLES.every((columna) => {
    const valor = visita[columna.key];
    if (columna.tipo === 'numero') return Number(valor) > 0;
    return valor !== null && valor !== undefined && String(valor).trim() !== '';
  });
}

function claseEstadoFila(visita) {
  if (tieneEvidencia(visita) && visita.entregado) return 'jornada-fila--completa';
  if (!tieneEvidencia(visita) && capturaCompleta(visita)) return 'jornada-fila--sin-evidencia';
  return undefined;
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
  const [error, setError] = useState(null);
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

  // Filtros por columna estilo Excel: { [campo]: Set<valorMostrado> }. Un
  // campo ausente = sin filtro (se muestran todos los valores de esa
  // columna). Se combinan entre si con AND ("anidados").
  const [filtrosColumna, setFiltrosColumna] = useState({});
  const [filtroAbierto, setFiltroAbierto] = useState(null);
  const [filtroEvidencia, setFiltroEvidencia] = useState('todas');

  // Edicion en linea (doble clic) -- reemplaza al viejo boton "Editar" +
  // formulario aparte. Solo una celda a la vez.
  const [celdaEditando, setCeldaEditando] = useState(null); // { visitaId, campo } | null
  const [valorEdicion, setValorEdicion] = useState('');

  // Edicion masiva: cambia un campo a TODAS las filas que el filtro actual
  // deja visibles en ese momento (no hay una seleccion aparte por
  // checkbox -- el filtro ya filtrado ES la seleccion).
  const [masivoCampo, setMasivoCampo] = useState(COLUMNAS_EDITABLES[0].key);
  const [masivoValor, setMasivoValor] = useState('');
  const [aplicandoMasivo, setAplicandoMasivo] = useState(false);

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
    setFiltrosColumna({});
    setFiltroEvidencia('todas');
    api.getAll(`/api/programacion-visitas/?jornada=${id}&entidad=${entidadId}`)
      .then(setVisitas)
      .catch(() => setError('No se pudieron cargar las unidades de la distribución.'));
  }, [id, entidadId]);

  async function onEliminar(visita) {
    if (!confirm(`¿Eliminar ${visita.unidad_medica} de esta distribución?`)) return;
    try {
      await api.del(`/api/programacion-visitas/${visita.id}/`);
      setVisitas((actuales) => actuales.filter((fila) => fila.id !== visita.id));
    } catch {
      setError('No se pudo eliminar la unidad de la distribución.');
    }
  }

  async function onExportar() {
    setExportando(true);
    try {
      const entidad = await api.get(`/api/entidades/${entidadId}/`);
      await exportarProgramacionExcel({ jornada, entidad, visitas: filasVisibles });
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

  // Edicion en linea -----------------------------------------------------

  function iniciarEdicion(visita, columna) {
    if (!columna.editable || !puedeEscribir) return;
    setCeldaEditando({ visitaId: visita.id, campo: columna.key });
    setValorEdicion(valorCrudoParaEditar(visita, columna));
  }

  function cancelarEdicionCelda() {
    setCeldaEditando(null);
  }

  async function confirmarEdicionCelda(visita, columna) {
    setCeldaEditando(null);
    const valorFinal = columna.tipo === 'numero'
      ? (Number(valorEdicion) || 0)
      : columna.tipo === 'fecha'
        ? (valorEdicion || null)
        : valorEdicion;
    try {
      const actualizada = await api.patch(`/api/programacion-visitas/${visita.id}/`, { [columna.key]: valorFinal });
      setVisitas((actuales) => actuales.map((v) => (v.id === actualizada.id ? actualizada : v)));
    } catch (err) {
      const detalle = err instanceof ApiError && err.data
        ? err.data[columna.key]?.[0] || err.data.non_field_errors?.[0] || err.data.detail
        : null;
      setError(detalle || 'No se pudo guardar el cambio.');
    }
  }

  function onTeclaCelda(e) {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') cancelarEdicionCelda();
  }

  // Filtros por columna ----------------------------------------------------

  const valoresUnicosPorColumna = useMemo(() => {
    const mapa = {};
    for (const columna of COLUMNAS) {
      const set = new Set();
      for (const visita of visitas || []) set.add(valorMostrado(visita, columna));
      mapa[columna.key] = Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    }
    return mapa;
  }, [visitas]);

  function onAplicarFiltroColumna(campo, nuevoSet) {
    setFiltrosColumna((actual) => {
      const copia = { ...actual };
      if (nuevoSet) copia[campo] = nuevoSet;
      else delete copia[campo];
      return copia;
    });
  }

  const filasVisibles = visitas?.filter((visita) => {
    if (filtroEvidencia === 'con' && !tieneEvidencia(visita)) return false;
    if (filtroEvidencia === 'sin' && tieneEvidencia(visita)) return false;
    return COLUMNAS.every((columna) => {
      const set = filtrosColumna[columna.key];
      if (!set) return true;
      return set.has(valorMostrado(visita, columna));
    });
  });

  // Edicion masiva -----------------------------------------------------

  const columnaMasiva = COLUMNAS_EDITABLES.find((c) => c.key === masivoCampo);

  async function onAplicarMasivo() {
    const ids = (filasVisibles || []).map((v) => v.id);
    if (ids.length === 0) return;
    const valorFinal = columnaMasiva.tipo === 'numero'
      ? (Number(masivoValor) || 0)
      : columnaMasiva.tipo === 'fecha'
        ? (masivoValor || null)
        : masivoValor;
    const etiquetaValor = masivoValor || '(vacío)';
    if (!confirm(
      `¿Cambiar "${columnaMasiva.label}" a "${etiquetaValor}" en ${ids.length} unidad${ids.length === 1 ? '' : 'es'}? `
      + 'No se puede deshacer.',
    )) return;

    setAplicandoMasivo(true);
    setError(null);
    try {
      const resp = await api.post('/api/programacion-visitas/actualizar-masivo/', {
        ids, campo: masivoCampo, valor: valorFinal,
      });
      const idsSet = new Set(ids);
      setVisitas((actuales) => actuales.map((v) => (idsSet.has(v.id) ? { ...v, [masivoCampo]: valorFinal } : v)));
      if (resp.actualizados < ids.length) {
        setError(`Se actualizaron ${resp.actualizados} de ${ids.length} unidades (las demás no te pertenecen).`);
      }
    } catch (err) {
      const detalle = err instanceof ApiError && err.data ? err.data.valor?.[0] || err.data.detail : null;
      setError(detalle || 'No se pudo aplicar el cambio masivo.');
    } finally {
      setAplicandoMasivo(false);
    }
  }

  const entidadSeleccionada = entidades.find((entidad) => String(entidad.id) === entidadId);
  const nombreEntidad = usuario?.rol === ROLES.USUARIO_ENTIDAD
    ? visitas?.[0]?.unidad_medica_entidad_nombre
    : entidadSeleccionada?.nombre;
  const cantidadFiltrosActivos = Object.keys(filtrosColumna).length
    + (filtroEvidencia === 'todas' ? 0 : 1);

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
        {visitas && (
          <button
            type="button"
            className="btn-ghost jornada-descargar"
            onClick={onExportar}
            disabled={exportando || filasVisibles.length === 0}
          >
            {exportando ? 'Generando…' : 'Descargar Excel'}
          </button>
        )}
        {visitas && (
          <div className="field jornada-filtro-evidencia">
            <label htmlFor="filtro-evidencia">Evidencia</label>
            <select id="filtro-evidencia" value={filtroEvidencia} onChange={(e) => setFiltroEvidencia(e.target.value)}>
              <option value="todas">Todas las CLUES</option>
              <option value="con">Con evidencia</option>
              <option value="sin">Sin evidencia</option>
            </select>
          </div>
        )}
        {cantidadFiltrosActivos > 0 && (
          <button
            className="btn-ghost jornada-limpiar-filtros"
            onClick={() => { setFiltrosColumna({}); setFiltroEvidencia('todas'); }}
          >
            Limpiar filtros ({cantidadFiltrosActivos})
          </button>
        )}
        <p className="jornada-conteo">
          {filasVisibles?.length ?? 0} de {visitas?.length ?? 0} unidades
          {nombreEntidad ? ` · ${nombreEntidad}` : ''}
        </p>
      </div>

      {error && <p className="login-error" style={{ maxWidth: 520 }}>{error}</p>}
      {visitas === null && !error && <p className="tabla-cargando">Cargando unidades…</p>}

      {puedeEscribir && visitas && (
        <div className="jornada-masivo">
          <span className="jornada-masivo__etiqueta">Editar en masa las filas visibles:</span>
          <select value={masivoCampo} onChange={(e) => { setMasivoCampo(e.target.value); setMasivoValor(''); }}>
            {COLUMNAS_EDITABLES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          {columnaMasiva.tipo === 'fecha' ? (
            <input type="date" min={jornada?.fecha_inicio} max={jornada?.fecha_fin} value={masivoValor} onChange={(e) => setMasivoValor(e.target.value)} />
          ) : columnaMasiva.tipo === 'numero' ? (
            <input type="number" min="0" value={masivoValor} onChange={(e) => setMasivoValor(e.target.value)} />
          ) : (
            <input type="text" maxLength={columnaMasiva.maxLength} placeholder="Valor nuevo" value={masivoValor} onChange={(e) => setMasivoValor(e.target.value)} />
          )}
          <button
            className="btn-primary"
            onClick={onAplicarMasivo}
            disabled={aplicandoMasivo || !filasVisibles || filasVisibles.length === 0}
          >
            {aplicandoMasivo ? 'Aplicando…' : `Aplicar a las ${filasVisibles?.length ?? 0} visibles`}
          </button>
        </div>
      )}

      {filasVisibles && (
        <div className="tablewrap jornada-tabla">
          <table>
            <thead>
              <tr>
                {COLUMNAS.map((columna) => (
                  <th key={columna.key}>
                    <div className="th-contenido">
                      {columna.label}
                      <FiltroColumna
                        label={columna.label}
                        valores={valoresUnicosPorColumna[columna.key] || []}
                        seleccionActiva={filtrosColumna[columna.key]}
                        abierto={filtroAbierto === columna.key}
                        onAbrir={() => setFiltroAbierto(columna.key)}
                        onCerrar={() => setFiltroAbierto((actual) => (actual === columna.key ? null : actual))}
                        onAplicar={(nuevoSet) => onAplicarFiltroColumna(columna.key, nuevoSet)}
                      />
                    </div>
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.length === 0 && (
                <tr><td colSpan={COLUMNAS.length + 1} className="tabla-vacia">No hay unidades que coincidan.</td></tr>
              )}
              {filasVisibles.map((visita) => (
                <tr key={visita.id} className={claseEstadoFila(visita)}>
                  {COLUMNAS.map((columna) => {
                    const editandoEstaCelda = celdaEditando?.visitaId === visita.id && celdaEditando.campo === columna.key;
                    return (
                      <td
                        key={columna.key}
                        className={columna.clase}
                        data-editable={columna.editable && puedeEscribir ? 'true' : undefined}
                        onDoubleClick={() => iniciarEdicion(visita, columna)}
                      >
                        {editandoEstaCelda ? (
                          columna.tipo === 'fecha' ? (
                            <input
                              type="date" autoFocus
                              min={jornada?.fecha_inicio} max={jornada?.fecha_fin}
                              value={valorEdicion}
                              onChange={(e) => setValorEdicion(e.target.value)}
                              onBlur={() => confirmarEdicionCelda(visita, columna)}
                              onKeyDown={onTeclaCelda}
                            />
                          ) : columna.tipo === 'numero' ? (
                            <input
                              type="number" min="0" autoFocus
                              value={valorEdicion}
                              onChange={(e) => setValorEdicion(e.target.value)}
                              onBlur={() => confirmarEdicionCelda(visita, columna)}
                              onKeyDown={onTeclaCelda}
                            />
                          ) : (
                            <input
                              type="text" autoFocus
                              maxLength={columna.maxLength}
                              value={valorEdicion}
                              onChange={(e) => setValorEdicion(e.target.value)}
                              onBlur={() => confirmarEdicionCelda(visita, columna)}
                              onKeyDown={onTeclaCelda}
                            />
                          )
                        ) : (
                          valorMostrado(visita, columna)
                        )}
                      </td>
                    );
                  })}
                  <td className="jornada-acciones">
                    {/* Marcadores: visibles para cualquiera que llegue a esta tabla
                        (incluye admin_nacional, que no puede editar pero si elegir
                        fotos para la presentacion) -- Evidencia/Eliminar siguen
                        abajo, solo para quien puede escribir. */}
                    {visita.fecha_distribucion_programada && (
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
                        {visita.fecha_distribucion_programada && (
                          <button className="btn-ghost" onClick={() => setVisitaEvidencia(visita)}>Evidencia</button>
                        )}
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
