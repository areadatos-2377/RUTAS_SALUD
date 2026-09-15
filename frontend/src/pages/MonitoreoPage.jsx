import { useEffect, useRef, useState } from 'react';
import {
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Film,
  FileSpreadsheet,
  FileText,
  Image,
  ListChecks,
  PackageCheck,
  Search,
  X,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { ROLES, useAuth } from '../auth/AuthContext';
import { CATEGORIA_LABEL } from '../utils/categoriaNiveles';
import { exportarTablaExcel, exportarTablaPdf } from '../utils/exportarTabla';
import EvidenciaVistaRapida from './EvidenciaVistaRapida';
import PickingPackingVistaRapida from './PickingPackingVistaRapida';
import '../styles/table.css';
import './MonitoreoPage.css';

const FORMATO_NUMERO = new Intl.NumberFormat('es-MX');
const NIVELES = [
  { valor: 'primer_nivel', etiqueta: 'Primer nivel' },
  { valor: 'segundo_tercer_nivel', etiqueta: 'Segundo y tercer nivel' },
];
const DIA_SEMANA_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function numero(valor) {
  return FORMATO_NUMERO.format(valor || 0);
}

function sumar(filas, campo) {
  return filas.reduce((total, fila) => total + Number(fila[campo] || 0), 0);
}

function rangoDias(inicio, fin) {
  const dias = [];
  const cursor = new Date(`${inicio}T12:00:00Z`);
  const limite = new Date(`${fin}T12:00:00Z`);
  while (cursor <= limite) {
    dias.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

function etiquetaDia(fecha) {
  const dia = new Date(`${fecha}T12:00:00Z`);
  const dd = String(dia.getUTCDate()).padStart(2, '0');
  const mm = String(dia.getUTCMonth() + 1).padStart(2, '0');
  return `${DIA_SEMANA_CORTO[dia.getUTCDay()]} ${dd}/${mm}`;
}

function descargarArchivo(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

function Kpi({ icono, etiqueta, valor, detalle, tono }) {
  return (
    <article className={`monitor-kpi monitor-kpi--${tono}`}>
      <span className="monitor-kpi__icono" aria-hidden="true">{icono}</span>
      <div>
        <p>{etiqueta}</p>
        <strong>{valor}</strong>
        <span>{detalle}</span>
      </div>
    </article>
  );
}

function Apartado({ numeroOrden, titulo, detalle, abierto, onAlternar, apartadoRef, children }) {
  return (
    <details ref={apartadoRef} className="monitor-apartado" open={abierto}>
      <summary onClick={(evento) => { evento.preventDefault(); onAlternar(); }}>
        <span className="monitor-apartado__numero">{numeroOrden}</span>
        <span className="monitor-apartado__titulo">{titulo}</span>
        {detalle && <span className="monitor-apartado__detalle">{detalle}</span>}
        <span className="monitor-apartado__flecha" aria-hidden="true">⌄</span>
      </summary>
      <div className="monitor-apartado__contenido">{children}</div>
    </details>
  );
}

function DescargarTabla({ onDescargar }) {
  const [generando, setGenerando] = useState(null);

  async function descargar(formato, evento) {
    evento.currentTarget.closest('details').removeAttribute('open');
    setGenerando(formato);
    try {
      await onDescargar(formato);
    } finally {
      setGenerando(null);
    }
  }

  return (
    <details className="monitor-descarga">
      <summary aria-label="Descargar tabla">
        <Download size={15} aria-hidden="true" />
        {generando ? 'Generando…' : 'Descargar'}
      </summary>
      <div className="monitor-descarga__menu">
        <button type="button" onClick={(evento) => descargar('excel', evento)} disabled={Boolean(generando)}>
          <FileSpreadsheet size={15} aria-hidden="true" /> Excel
        </button>
        <button type="button" onClick={(evento) => descargar('pdf', evento)} disabled={Boolean(generando)}>
          <FileText size={15} aria-hidden="true" /> PDF
        </button>
      </div>
    </details>
  );
}

function FiltroEntidades({ opciones, seleccionadas, onAplicar, disabled }) {
  const detallesRef = useRef(null);
  const [borrador, setBorrador] = useState([]);
  const todosLosIds = opciones.map((opcion) => String(opcion.id));
  const seleccionEfectiva = seleccionadas.length > 0 ? seleccionadas : todosLosIds;
  const todosSeleccionados = opciones.length > 0 && borrador.length === opciones.length;
  const etiqueta = seleccionadas.length === 0
    ? 'Todos los estados'
    : `${seleccionadas.length} estado${seleccionadas.length === 1 ? '' : 's'}`;

  function alAlternar(evento) {
    if (evento.currentTarget.open) setBorrador(seleccionEfectiva);
  }

  function alternarEntidad(entidadId, seleccionada) {
    setBorrador((actual) => (
      seleccionada
        ? [...actual, entidadId]
        : actual.filter((id) => id !== entidadId)
    ));
  }

  function cerrar() {
    detallesRef.current?.removeAttribute('open');
  }

  function aplicar() {
    onAplicar(todosSeleccionados ? [] : borrador);
    cerrar();
  }

  return (
    <div className="field monitor-multiselect">
      <span className="monitor-multiselect__label">Estado</span>
      <details ref={detallesRef} onToggle={alAlternar}>
        <summary
          aria-label={`Filtrar por estado: ${etiqueta}`}
          onClick={(evento) => { if (disabled) evento.preventDefault(); }}
          aria-disabled={disabled}
        >
          <span>{etiqueta}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="monitor-multiselect__menu">
          <div className="monitor-multiselect__atajos">
            <button type="button" onClick={() => setBorrador(todosLosIds)}>Seleccionar todo</button>
            <button type="button" onClick={() => setBorrador([])}>Limpiar</button>
          </div>
          <div className="monitor-multiselect__opciones">
            {opciones.map((opcion) => {
              const entidadId = String(opcion.id);
              return (
                <label key={entidadId} className="monitor-multiselect__opcion">
                  <input
                    type="checkbox"
                    checked={borrador.includes(entidadId)}
                    onChange={(evento) => alternarEntidad(entidadId, evento.target.checked)}
                  />
                  <span>{opcion.nombre}</span>
                </label>
              );
            })}
          </div>
          <div className="monitor-multiselect__acciones">
            <button type="button" className="btn-ghost" onClick={cerrar}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={aplicar} disabled={borrador.length === 0}>Aplicar</button>
          </div>
        </div>
      </details>
    </div>
  );
}

function MarcaEvidencia({ presente, etiqueta, onAbrir }) {
  if (presente && onAbrir) {
    return (
      <button
        type="button"
        className="monitor-marca monitor-marca--si monitor-marca--boton"
        title={`Ver ${etiqueta.toLocaleLowerCase('es')}`}
        aria-label={`Ver ${etiqueta.toLocaleLowerCase('es')} de la unidad`}
        onClick={onAbrir}
      >
        <Check size={14} aria-hidden="true" />
      </button>
    );
  }
  return (
    <span className={`monitor-marca ${presente ? 'monitor-marca--si' : 'monitor-marca--no'}`} title={`${etiqueta}: ${presente ? 'Sí' : 'No'}`}>
      {presente ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
      <span className="sr-only">{presente ? 'Sí' : 'No'}</span>
    </span>
  );
}

export default function MonitoreoPage() {
  const { usuario } = useAuth();
  const [jornadas, setJornadas] = useState(null);
  const [nivel, setNivel] = useState('primer_nivel');
  const [jornadaId, setJornadaId] = useState('');
  const [entidadesSeleccionadas, setEntidadesSeleccionadas] = useState([]);
  const [entidadesDisponibles, setEntidadesDisponibles] = useState([]);
  const [datos, setDatos] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtroLista, setFiltroLista] = useState(null);
  const [busquedaEvidencia, setBusquedaEvidencia] = useState('');
  const [apartadoAbierto, setApartadoAbierto] = useState('01');
  const [generandoChecklist, setGenerandoChecklist] = useState(false);
  const [vistaRapida, setVistaRapida] = useState(null);
  const [vistaPicking, setVistaPicking] = useState(null);
  const [error, setError] = useState(null);
  const listaCluesRef = useRef(null);

  useEffect(() => {
    api.getAll('/api/jornadas/')
      .then((lista) => {
        setJornadas(lista);
        if (lista.length > 0) {
          setNivel(lista[0].categoria);
          setJornadaId(String(lista[0].id));
        }
      })
      .catch(() => setError('No se pudieron cargar las distribuciones.'));
  }, []);

  useEffect(() => {
    if (!jornadaId) return;
    let cancelado = false;
    const params = new URLSearchParams();
    entidadesSeleccionadas.forEach((entidadId) => params.append('entidad', entidadId));
    const consulta = params.size > 0 ? `?${params.toString()}` : '';
    api.get(`/api/jornadas/${jornadaId}/monitoreo/${consulta}`)
      .then((respuesta) => {
        if (!cancelado) {
          setDatos(respuesta);
          setEntidadesDisponibles(respuesta.filtros.entidades);
        }
      })
      .catch(() => {
        if (!cancelado) setError('No se pudo cargar el monitoreo de esta distribución.');
      });
    return () => { cancelado = true; };
  }, [jornadaId, entidadesSeleccionadas]);

  const jornadasDelNivel = (jornadas || []).filter((item) => item.categoria === nivel);

  function prepararRecarga() {
    setDatos(null);
    setError(null);
    setBusqueda('');
    setFiltroLista(null);
    setBusquedaEvidencia('');
  }

  function onCambiarNivel(nuevoNivel) {
    const primera = (jornadas || []).find((item) => item.categoria === nuevoNivel);
    prepararRecarga();
    setNivel(nuevoNivel);
    setEntidadesSeleccionadas([]);
    setEntidadesDisponibles([]);
    setJornadaId(primera ? String(primera.id) : '');
  }

  function onCambiarJornada(nuevoId) {
    prepararRecarga();
    setEntidadesSeleccionadas([]);
    setEntidadesDisponibles([]);
    setJornadaId(nuevoId);
  }

  function onCambiarEntidades(nuevosIds) {
    prepararRecarga();
    setEntidadesSeleccionadas(nuevosIds);
  }

  function abrirEvidencia(fila, categoria) {
    setVistaRapida({
      visita: {
        id: fila.id,
        unidad_medica: fila.clues,
        unidad_medica_nombre: fila.unidad,
      },
      categoria,
    });
  }

  function alternarApartado(numeroOrden) {
    setApartadoAbierto((actual) => (actual === numeroOrden ? null : numeroOrden));
  }

  function mostrarClues(filaEntidad, tipo, etiqueta) {
    setFiltroLista({
      entidadId: String(filaEntidad.id),
      tipo,
      etiqueta: `${etiqueta} · ${filaEntidad.entidad}`,
    });
    setBusqueda('');
    setApartadoAbierto('03');
    requestAnimationFrame(() => {
      listaCluesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const listaFiltrada = (datos?.lista_clues || []).filter((fila) => {
    if (filtroLista && String(fila.entidad_id) !== filtroLista.entidadId) return false;
    if (filtroLista?.tipo === 'abastecidas' && !fila.entregado) return false;
    if (filtroLista?.tipo === 'pendientes' && fila.entregado) return false;
    if (filtroLista?.tipo === 'por_programar' && fila.fecha_programada) return false;
    const texto = `${fila.clues} ${fila.unidad} ${fila.entidad} ${fila.municipio} ${fila.ruta} ${fila.tipo_unidad_medica} ${fila.quien_recibe} ${fila.telefono} ${fila.correo}`.toLocaleLowerCase('es');
    return texto.includes(busqueda.trim().toLocaleLowerCase('es'));
  });
  const evidenciaFiltrada = (datos?.lista_clues || []).filter((fila) => {
    const texto = `${fila.clues} ${fila.unidad}`.toLocaleLowerCase('es');
    return texto.includes(busquedaEvidencia.trim().toLocaleLowerCase('es'));
  });
  const resumen = datos?.resumen;
  const esVisor = usuario?.rol === ROLES.VISOR;
  const puedeDescargarChecklist = esVisor || usuario?.rol === ROLES.ADMIN_NACIONAL || usuario?.rol === ROLES.SUPER_ADMIN;
  const diasPicking = datos ? rangoDias(datos.jornada.fecha_inicio, datos.jornada.fecha_fin) : [];
  const historico = datos?.historico_programacion;

  async function onGenerarChecklist() {
    setGenerandoChecklist(true);
    setError(null);
    try {
      const { blob, nombreArchivo } = await api.postArchivo('/api/picking-packing/generar-checklist/', {
        jornada_id: datos.jornada.id,
      });
      descargarArchivo(blob, nombreArchivo);
    } catch (err) {
      const detalle = err instanceof ApiError && err.data ? err.data.detail : null;
      setError(detalle || 'No se pudo generar el checklist.');
    } finally {
      setGenerandoChecklist(false);
    }
  }

  async function onDescargarTabla(apartado, formato) {
    const contexto = entidadesSeleccionadas.length > 0
      ? entidadesDisponibles
        .filter((entidad) => entidadesSeleccionadas.includes(String(entidad.id)))
        .map((entidad) => entidad.nombre)
        .join(', ')
      : 'Todos los estados';
    const base = `${datos.jornada.nombre} - ${contexto}`;
    const subtitulo = `${datos.jornada.nombre} · ${contexto}`.toLocaleUpperCase('es');
    const nivelAtencion = (CATEGORIA_LABEL[datos.jornada.categoria] || datos.jornada.categoria)
      .toLocaleUpperCase('es');
    const configuraciones = {
      programada: {
        titulo: `ABASTECIMIENTO DE MEDICAMENTO Y MATERIAL DE CURACIÓN A UNIDADES MÉDICAS DE ${nivelAtencion} DE ATENCIÓN`,
        subtitulo,
        nombreArchivo: `distribucion_programada_vs_abastecida_${base}`,
        orientacion: 'portrait',
        filas: datos.entidades,
        columnas: [
          { etiqueta: 'ENTIDAD', valor: 'entidad', ancho: 30, tipo: 'texto' },
          { etiqueta: 'TOTAL DE UNIDADES MÉDICAS PROGRAMADAS', valor: 'registros', ancho: 24, tipo: 'numero' },
          { etiqueta: 'TOTAL DE UNIDADES MÉDICAS ABASTECIDAS', valor: (fila) => fila.atendidas || '--', ancho: 24, tipo: 'numero' },
          { etiqueta: 'AVANCE GENERAL', valor: (fila) => fila.atendidas ? `${fila.avance_porcentaje}%` : '--', ancho: 16, tipo: 'porcentaje' },
        ],
        totales: { registros: resumen.registros, atendidas: resumen.atendidas, avance_porcentaje: resumen.avance_porcentaje },
      },
      pendientes: {
        titulo: 'CLUES QUE FALTAN POR ABASTECER',
        subtitulo,
        nombreArchivo: `clues_faltantes_por_abastecer_${base}`,
        filas: datos.entidades,
        columnas: [
          { etiqueta: 'ESTADO', valor: 'entidad', ancho: 30, tipo: 'texto' },
          { etiqueta: 'CLUES QUE FALTAN POR ABASTECER', valor: (fila) => fila.pendientes || '--', ancho: 25, tipo: 'numero' },
          { etiqueta: 'CLUES POR PROGRAMAR', valor: (fila) => fila.por_programar || '--', ancho: 22, tipo: 'numero' },
        ],
        totales: { pendientes: resumen.pendientes, por_programar: sumar(datos.entidades, 'por_programar') },
      },
      lista: {
        titulo: 'LISTA DE CLUES',
        subtitulo,
        nombreArchivo: `lista_de_clues_${base}`,
        filas: listaFiltrada,
        columnas: [
          { etiqueta: 'CLUES', valor: 'clues', ancho: 18, tipo: 'texto' },
          { etiqueta: 'UNIDAD MÉDICA', valor: 'unidad', ancho: 42, tipo: 'texto' },
          { etiqueta: 'TIPO DE UNIDAD', valor: (fila) => fila.tipo_unidad_medica || '—', ancho: 24, tipo: 'texto' },
          { etiqueta: 'ESTADO', valor: 'entidad', ancho: 24, tipo: 'texto' },
          { etiqueta: 'MUNICIPIO', valor: (fila) => fila.municipio || '—', ancho: 24, tipo: 'texto' },
          { etiqueta: 'RUTA', valor: (fila) => fila.ruta || '—', ancho: 12, tipo: 'texto' },
          { etiqueta: 'FECHA PROGRAMADA', valor: (fila) => fila.fecha_programada || 'Por programar', ancho: 18, tipo: 'texto' },
          { etiqueta: 'CLAVES', valor: 'claves', ancho: 12, tipo: 'numero' },
          { etiqueta: 'MEDICAMENTO', valor: 'piezas_medicamento', ancho: 15, tipo: 'numero' },
          { etiqueta: 'MATERIAL CURACIÓN', valor: 'piezas_material_curacion', ancho: 17, tipo: 'numero' },
          { etiqueta: 'QUIÉN RECIBE EN UNIDAD', valor: (fila) => fila.quien_recibe || '—', ancho: 35, tipo: 'texto' },
          { etiqueta: 'TELÉFONO', valor: (fila) => fila.telefono || '—', ancho: 22, tipo: 'texto' },
          { etiqueta: 'CORREO', valor: (fila) => fila.correo || '—', ancho: 32, tipo: 'texto' },
        ],
        totales: {
          claves: sumar(listaFiltrada, 'claves'),
          piezas_medicamento: sumar(listaFiltrada, 'piezas_medicamento'),
          piezas_material_curacion: sumar(listaFiltrada, 'piezas_material_curacion'),
        },
      },
      evidencia: {
        titulo: 'EVIDENCIA POR UNIDAD MÉDICA',
        subtitulo,
        nombreArchivo: `evidencia_por_unidad_medica_${base}`,
        filas: evidenciaFiltrada.map((fila) => ({
          ...fila,
          foto: fila.evidencia_foto ? 'Sí' : 'No',
          video: fila.evidencia_video ? 'Sí' : 'No',
          nota: fila.evidencia_nota ? 'Sí' : 'No',
          completa: fila.evidencia_completa ? 'Sí' : 'No',
          avance: `${fila.evidencia_avance}%`,
        })),
        columnas: [
          { etiqueta: 'CLUES', valor: 'clues', ancho: 18, tipo: 'texto' },
          { etiqueta: 'NOMBRE DE LA UNIDAD', valor: 'unidad', ancho: 42, tipo: 'texto' },
          { etiqueta: 'ENTIDAD', valor: 'entidad', ancho: 26, tipo: 'texto' },
          { etiqueta: 'FOTO', valor: 'foto', ancho: 12, tipo: 'booleano' },
          { etiqueta: 'VIDEO', valor: 'video', ancho: 12, tipo: 'booleano' },
          { etiqueta: 'NOTA', valor: 'nota', ancho: 12, tipo: 'booleano' },
          { etiqueta: 'EVIDENCIA COMPLETA', valor: 'completa', ancho: 20, tipo: 'booleano' },
          { etiqueta: 'AVANCE', valor: 'avance', ancho: 14, tipo: 'porcentaje' },
        ],
        totales: {
          foto: evidenciaFiltrada.filter((fila) => fila.evidencia_foto).length,
          video: evidenciaFiltrada.filter((fila) => fila.evidencia_video).length,
          nota: evidenciaFiltrada.filter((fila) => fila.evidencia_nota).length,
          completa: evidenciaFiltrada.filter((fila) => fila.evidencia_completa).length,
          avance: evidenciaFiltrada.length
            ? `${Math.round(sumar(evidenciaFiltrada, 'evidencia_avance') / evidenciaFiltrada.length)}%`
            : '0%',
        },
      },
    };
    const configuracion = configuraciones[apartado];
    try {
      if (formato === 'excel') await exportarTablaExcel(configuracion);
      else await exportarTablaPdf(configuracion);
    } catch {
      setError(`No se pudo generar el archivo ${formato.toUpperCase()}.`);
    }
  }

  return (
    <div className={`monitor-page monitor-page--${nivel === 'primer_nivel' ? 'primer' : 'segundo'}`}>
      <div className="topbar monitor-topbar">
        <h2>Monitoreo y Seguimiento</h2>
      </div>

      {datos && (
        <section className={`monitor-kpis ${esVisor ? 'monitor-kpis--visor' : ''}`} aria-label="Indicadores generales">
          <Kpi icono={<CalendarDays />} etiqueta="CLUES programadas" valor={numero(resumen.registros)} detalle={`${numero(resumen.capturadas)} capturadas`} tono="neutral" />
          <Kpi icono={<CheckCircle2 />} etiqueta="CLUES atendidas" valor={numero(resumen.atendidas)} detalle={`${resumen.avance_porcentaje}% de avance`} tono="verde" />
          <Kpi icono={<ListChecks />} etiqueta="Pendientes" valor={numero(resumen.pendientes)} detalle="Por abastecer" tono="guinda" />
          {!esVisor && (
            <>
              <Kpi icono={<Boxes />} etiqueta="Claves" valor={numero(resumen.claves)} detalle="A desplazar" tono="dorado" />
              <Kpi icono={<PackageCheck />} etiqueta="Medicamento" valor={numero(resumen.piezas_medicamento)} detalle="Piezas programadas" tono="verde" />
              <Kpi icono={<PackageCheck />} etiqueta="Material de curación" valor={numero(resumen.piezas_material_curacion)} detalle="Piezas programadas" tono="dorado" />
            </>
          )}
        </section>
      )}

      <section className="monitor-filtros" aria-label="Filtros de monitoreo">
        <div className="field">
          <label htmlFor="monitor-nivel">Nivel de atención</label>
          <select id="monitor-nivel" value={nivel} onChange={(e) => onCambiarNivel(e.target.value)}>
            {NIVELES.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>
            ))}
          </select>
        </div>
        <div className="field monitor-filtro-distribucion">
          <label htmlFor="monitor-jornada">Distribución</label>
          <select id="monitor-jornada" value={jornadaId} onChange={(e) => onCambiarJornada(e.target.value)} disabled={jornadasDelNivel.length === 0}>
            {jornadasDelNivel.length === 0 && <option value="">Sin distribuciones</option>}
            {jornadasDelNivel.map((item) => (
              <option key={item.id} value={item.id}>{item.nombre}</option>
            ))}
          </select>
        </div>
        <FiltroEntidades
          opciones={entidadesDisponibles}
          seleccionadas={entidadesSeleccionadas}
          onAplicar={onCambiarEntidades}
          disabled={!datos}
        />
        {datos && (
          <div className="monitor-filtros__contexto">
            <span className={`badge ${datos.jornada.categoria === 'primer_nivel' ? 'verde' : 'guinda'}`}>
              {CATEGORIA_LABEL[datos.jornada.categoria] || datos.jornada.categoria}
            </span>
            <span>{datos.jornada.fecha_inicio} al {datos.jornada.fecha_fin}</span>
          </div>
        )}
      </section>

      {error && <p className="login-error">{error}</p>}
      {jornadas === null && !error && <p className="tabla-cargando">Cargando distribuciones…</p>}
      {jornadas?.length === 0 && <p className="tabla-cargando">Todavía no hay distribuciones.</p>}
      {jornadas && jornadaId && datos === null && !error && <p className="tabla-cargando">Calculando avance…</p>}

      {datos && (
          <div className="monitor-apartados">
            <Apartado numeroOrden="01" titulo="DISTRIBUCIÓN PROGRAMADA VS ABASTECIDA" detalle={`${resumen.avance_porcentaje}% de avance`} abierto={apartadoAbierto === '01'} onAlternar={() => alternarApartado('01')}>
              <div className="monitor-tabla-acciones"><DescargarTabla onDescargar={(formato) => onDescargarTabla('programada', formato)} /></div>
              <div className="tablewrap monitor-tabla-resumen"><table><thead><tr><th>Entidad</th><th>Total de unidades médicas programadas</th><th>Total de unidades médicas abastecidas</th><th>Avance general</th></tr></thead><tbody>
                {datos.entidades.map((fila) => (
                  <tr key={fila.id}>
                    <td className="nombre">{fila.entidad}</td>
                    <td className="monitor-dato--verde">
                      <button type="button" className="monitor-conteo-link" aria-label={`Ver ${fila.registros} CLUES programadas de ${fila.entidad}`} onClick={() => mostrarClues(fila, 'programadas', 'CLUES programadas')}>
                        {numero(fila.registros)}
                      </button>
                    </td>
                    <td>{fila.atendidas ? (
                      <button type="button" className="monitor-conteo-link" aria-label={`Ver ${fila.atendidas} CLUES abastecidas de ${fila.entidad}`} onClick={() => mostrarClues(fila, 'abastecidas', 'CLUES abastecidas')}>
                        {numero(fila.atendidas)}
                      </button>
                    ) : '—'}</td>
                    <td>{fila.atendidas ? (
                      <button type="button" className="monitor-conteo-link monitor-conteo-link--porcentaje" aria-label={`Ver las CLUES que conforman el ${fila.avance_porcentaje}% de avance de ${fila.entidad}`} onClick={() => mostrarClues(fila, 'abastecidas', 'CLUES abastecidas')}>
                        <span className="monitor-porcentaje"><i style={{ width: `${fila.avance_porcentaje}%` }} />{fila.avance_porcentaje}%</span>
                      </button>
                    ) : '—'}</td>
                  </tr>
                ))}
                <tr className="monitor-historico__total">
                  <td className="nombre">Total</td>
                  <td>{numero(resumen.registros)}</td>
                  <td>{numero(resumen.atendidas)}</td>
                  <td>{resumen.avance_porcentaje}%</td>
                </tr>
              </tbody></table></div>
            </Apartado>

            <Apartado numeroOrden="02" titulo="CLUES QUE FALTAN POR ABASTECER" detalle={`${numero(resumen.pendientes)} pendientes`} abierto={apartadoAbierto === '02'} onAlternar={() => alternarApartado('02')}>
              <div className="monitor-tabla-acciones"><DescargarTabla onDescargar={(formato) => onDescargarTabla('pendientes', formato)} /></div>
              <div className="tablewrap monitor-tabla-resumen"><table><thead><tr><th>Estado</th><th>CLUES que faltan por abastecer</th><th>CLUES por programar</th></tr></thead><tbody>
                {datos.entidades.map((fila) => (
                  <tr key={fila.id}>
                    <td className="nombre">{fila.entidad}</td>
                    <td className={fila.pendientes ? 'monitor-dato--rojo' : ''}>{fila.pendientes ? (
                      <button type="button" className="monitor-conteo-link" aria-label={`Ver ${fila.pendientes} CLUES pendientes de abastecer de ${fila.entidad}`} onClick={() => mostrarClues(fila, 'pendientes', 'CLUES pendientes de abastecer')}>
                        {numero(fila.pendientes)}
                      </button>
                    ) : '—'}</td>
                    <td className={fila.por_programar ? 'monitor-dato--rojo' : ''}>{fila.por_programar ? (
                      <button type="button" className="monitor-conteo-link" aria-label={`Ver ${fila.por_programar} CLUES por programar de ${fila.entidad}`} onClick={() => mostrarClues(fila, 'por_programar', 'CLUES por programar')}>
                        {numero(fila.por_programar)}
                      </button>
                    ) : '—'}</td>
                  </tr>
                ))}
              </tbody></table></div>
            </Apartado>

            <Apartado apartadoRef={listaCluesRef} numeroOrden="03" titulo="LISTA DE CLUES" detalle={filtroLista ? `${numero(listaFiltrada.length)} resultado${listaFiltrada.length === 1 ? '' : 's'}` : `${numero(resumen.registros)} registros`} abierto={apartadoAbierto === '03'} onAlternar={() => alternarApartado('03')}>
              <div className="monitor-tabla-herramientas">
                {filtroLista && (
                  <span className="monitor-lista-filtro">
                    {filtroLista.etiqueta}
                    <button type="button" aria-label="Quitar filtro de conteo" onClick={() => setFiltroLista(null)}><X size={14} aria-hidden="true" /></button>
                  </span>
                )}
                <label className="monitor-busqueda"><Search size={16} aria-hidden="true" /><input type="search" placeholder="Buscar CLUES, unidad, contacto, teléfono o correo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
                <DescargarTabla onDescargar={(formato) => onDescargarTabla('lista', formato)} />
              </div>
              <div className="tablewrap monitor-lista-clues"><table><thead><tr><th>CLUES</th><th>Unidad médica</th><th>Tipo de unidad</th><th>Estado</th><th>Municipio</th><th>Ruta</th><th>Fecha programada</th><th>Claves</th><th>Medicamento</th><th>Material curación</th><th>Quién recibe en unidad</th><th>Teléfono</th><th>Correo</th></tr></thead><tbody>
                {listaFiltrada.map((fila) => <tr key={fila.id} className={!fila.entregado && fila.tiene_evidencia ? 'monitor-fila--alerta' : undefined}><td>{fila.clues}</td><td className="nombre">{fila.unidad}</td><td>{fila.tipo_unidad_medica || '—'}</td><td>{fila.entidad}</td><td>{fila.municipio || '—'}</td><td>{fila.ruta || '—'}</td><td>{fila.fecha_programada || 'Por programar'}</td><td>{numero(fila.claves)}</td><td>{numero(fila.piezas_medicamento)}</td><td>{numero(fila.piezas_material_curacion)}</td><td>{fila.quien_recibe || '—'}</td><td>{fila.telefono || '—'}</td><td>{fila.correo || '—'}</td></tr>)}
                {listaFiltrada.length === 0 && <tr><td colSpan={13} className="tabla-vacia">No hay CLUES que coincidan.</td></tr>}
              </tbody></table></div>
            </Apartado>

            <Apartado numeroOrden="04" titulo="HISTÓRICO DE PROGRAMACIÓN" detalle={`${historico.entidades.length} estados`} abierto={apartadoAbierto === '04'} onAlternar={() => alternarApartado('04')}>
              <div className="tablewrap monitor-tabla-resumen monitor-tabla-historico">
                <table>
                  <thead><tr>
                    <th>Entidad</th>
                    <th>
                      {historico.anterior?.nombre || 'Sin distribución anterior'}
                      {historico.anterior && <small>{historico.anterior.fecha_inicio} al {historico.anterior.fecha_fin}</small>}
                    </th>
                    <th>
                      {historico.actual.nombre} (actual)
                      <small>{historico.actual.fecha_inicio} al {historico.actual.fecha_fin}</small>
                    </th>
                    <th>Diferencia (actual vs. anterior)</th>
                  </tr></thead>
                  <tbody>
                    {historico.entidades.map((fila) => (
                      <tr key={fila.id}>
                        <td className="nombre">{fila.entidad}</td>
                        <td>{historico.anterior ? numero(fila.anterior) : '—'}</td>
                        <td>{numero(fila.actual)}</td>
                        <td className={`monitor-historico__diferencia ${fila.diferencia < 0 ? 'negativa' : fila.diferencia > 0 ? 'positiva' : ''}`}>
                          {historico.anterior ? `${fila.diferencia > 0 ? '+' : ''}${numero(fila.diferencia)}` : '—'}
                        </td>
                      </tr>
                    ))}
                    {historico.entidades.length > 0 && (
                      <tr className="monitor-historico__total">
                        <td className="nombre">Total</td>
                        <td>{historico.anterior ? numero(sumar(historico.entidades, 'anterior')) : '—'}</td>
                        <td>{numero(sumar(historico.entidades, 'actual'))}</td>
                        <td>{historico.anterior ? numero(sumar(historico.entidades, 'diferencia')) : '—'}</td>
                      </tr>
                    )}
                    {historico.entidades.length === 0 && <tr><td colSpan={4} className="tabla-vacia">No hay estados para comparar.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Apartado>

            <Apartado numeroOrden="05" titulo="AVANCE PICKING Y PACKING" detalle={`${datos.picking.dias_evidencia} días con evidencia`} abierto={apartadoAbierto === '05'} onAlternar={() => alternarApartado('05')}>
              {puedeDescargarChecklist && (
                <div className="monitor-picking__acciones">
                  <button className="btn-ghost" type="button" onClick={onGenerarChecklist} disabled={generandoChecklist}>
                    <Download size={15} aria-hidden="true" />
                    {generandoChecklist ? 'Generando…' : 'Descargar checklist'}
                  </button>
                </div>
              )}
              <div className="tablewrap monitor-matriz-picking"><table><thead><tr><th>Entidad</th>{diasPicking.map((dia) => <th key={dia} className="monitor-picking__dia">{etiquetaDia(dia)}</th>)}<th>Días de evidencia</th></tr></thead><tbody>
                {datos.entidades.map((fila) => {
                  const porDia = Object.fromEntries(fila.picking_por_dia.map((dato) => [dato.fecha, dato]));
                  return <tr key={fila.id}><td className="nombre">{fila.entidad}</td>{diasPicking.map((dia) => {
                    const marcas = porDia[dia] || { foto: false, video: false };
                    return <td key={dia} className="monitor-picking__dia">{marcas.foto ? <button type="button" className="monitor-picking__indicador activo" title="Ver foto" aria-label={`Ver foto de ${fila.entidad} del ${dia}`} onClick={() => setVistaPicking({ entidad: { id: fila.id, nombre: fila.entidad }, fecha: dia, tipo: 'foto' })}><Image size={14} aria-hidden="true" /></button> : <span className="monitor-picking__indicador" title="Falta foto"><Image size={14} aria-hidden="true" /><span className="sr-only">Falta foto</span></span>}{marcas.video ? <button type="button" className="monitor-picking__indicador activo" title="Ver video" aria-label={`Ver video de ${fila.entidad} del ${dia}`} onClick={() => setVistaPicking({ entidad: { id: fila.id, nombre: fila.entidad }, fecha: dia, tipo: 'video' })}><Film size={14} aria-hidden="true" /></button> : <span className="monitor-picking__indicador" title="Falta video"><Film size={14} aria-hidden="true" /><span className="sr-only">Falta video</span></span>}</td>;
                  })}<td className="monitor-picking__dias-total">{fila.picking_dias_evidencia || '—'}</td></tr>;
                })}
              </tbody></table></div>
            </Apartado>

            <Apartado numeroOrden="06" titulo="EVIDENCIA POR UNIDAD MÉDICA" detalle={`${numero(resumen.registros)} unidades`} abierto={apartadoAbierto === '06'} onAlternar={() => alternarApartado('06')}>
              <div className="monitor-evidencia__filtros">
                <div className="field">
                  <label htmlFor="monitor-evidencia-clues">CLUES</label>
                  <label className="monitor-evidencia__busqueda">
                    <Search size={15} aria-hidden="true" />
                    <input id="monitor-evidencia-clues" type="search" placeholder="Buscar por CLUES o nombre de la unidad" value={busquedaEvidencia} onChange={(e) => setBusquedaEvidencia(e.target.value)} />
                  </label>
                </div>
                <DescargarTabla onDescargar={(formato) => onDescargarTabla('evidencia', formato)} />
              </div>
              <div className="tablewrap monitor-tabla-evidencia"><table><thead><tr><th>CLUES</th><th>Nombre de la unidad</th><th>Entidad</th><th>Foto</th><th>Video</th><th>Nota</th><th>Evidencia completa</th><th>Avance</th></tr></thead><tbody>
                {evidenciaFiltrada.map((fila) => <tr key={fila.id}><td>{fila.clues}</td><td className="nombre">{fila.unidad}</td><td>{fila.entidad}</td><td><MarcaEvidencia presente={fila.evidencia_foto} etiqueta="Foto" onAbrir={() => abrirEvidencia(fila, 'imagen')} /></td><td><MarcaEvidencia presente={fila.evidencia_video} etiqueta="Video" onAbrir={() => abrirEvidencia(fila, 'video')} /></td><td><MarcaEvidencia presente={fila.evidencia_nota} etiqueta="Nota" onAbrir={() => abrirEvidencia(fila, 'documento')} /></td><td><MarcaEvidencia presente={fila.evidencia_completa} etiqueta="Evidencia completa" /></td><td><span className={`monitor-avance-evidencia ${fila.evidencia_completa ? 'completo' : ''}`}>{fila.evidencia_avance}%</span></td></tr>)}
                {evidenciaFiltrada.length === 0 && <tr><td colSpan={8} className="tabla-vacia">No hay unidades que coincidan.</td></tr>}
              </tbody></table></div>
            </Apartado>

          </div>
      )}
      {vistaRapida && (
        <EvidenciaVistaRapida
          visita={vistaRapida.visita}
          categoria={vistaRapida.categoria}
          onCerrar={() => setVistaRapida(null)}
        />
      )}
      {vistaPicking && (
        <PickingPackingVistaRapida
          jornada={datos.jornada}
          entidad={vistaPicking.entidad}
          fecha={vistaPicking.fecha}
          tipo={vistaPicking.tipo}
          onCerrar={() => setVistaPicking(null)}
        />
      )}
    </div>
  );
}