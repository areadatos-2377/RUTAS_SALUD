import { useEffect, useState } from 'react';
import {
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  Download,
  Film,
  Image,
  ListChecks,
  PackageCheck,
  Search,
  X,
} from 'lucide-react';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { api, ApiError } from '../api/client';
import { ROLES, useAuth } from '../auth/AuthContext';
import { CATEGORIA_LABEL } from '../utils/categoriaNiveles';
import EvidenciaVistaRapida from './EvidenciaVistaRapida';
import '../styles/table.css';
import './MonitoreoPage.css';

const FORMATO_NUMERO = new Intl.NumberFormat('es-MX');
const METRICAS_FECHA = [
  { clave: 'clues', etiqueta: 'CLUES' },
  { clave: 'rutas', etiqueta: 'Rutas' },
  { clave: 'claves', etiqueta: 'Claves a desplazar' },
  { clave: 'piezas_medicamento', etiqueta: 'Piezas de medicamento' },
  { clave: 'piezas_material_curacion', etiqueta: 'Piezas de mat. curación' },
];
const NIVELES = [
  { valor: 'primer_nivel', etiqueta: 'Primer nivel' },
  { valor: 'segundo_tercer_nivel', etiqueta: 'Segundo y tercer nivel' },
];
const DIA_SEMANA_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

function numero(valor) {
  return FORMATO_NUMERO.format(valor || 0);
}

function fechaCorta(valor) {
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' })
    .format(new Date(`${valor}T12:00:00`));
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

function Apartado({ numeroOrden, titulo, detalle, abierto, onAlternar, children }) {
  return (
    <details className="monitor-apartado" open={abierto}>
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

function EstadoEntrega({ fila }) {
  if (fila.entregado) return <span className="monitor-estado monitor-estado--completo">Abastecida</span>;
  if (!fila.fecha_programada) return <span className="monitor-estado monitor-estado--pendiente">Por programar</span>;
  if (fila.tiene_evidencia) return <span className="monitor-estado monitor-estado--alerta">Evidencia sin entrega</span>;
  return <span className="monitor-estado monitor-estado--pendiente">Pendiente</span>;
}

function CantidadPorcentaje({ cantidad, porcentaje, tono }) {
  return (
    <span className={`monitor-cantidad monitor-cantidad--${tono}`}>
      <strong>{numero(cantidad)}</strong>
      <small>{porcentaje}%</small>
    </span>
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
  const [entidadId, setEntidadId] = useState('');
  const [datos, setDatos] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [busquedaEvidencia, setBusquedaEvidencia] = useState('');
  const [metricaFecha, setMetricaFecha] = useState('rutas');
  const [apartadoAbierto, setApartadoAbierto] = useState('01');
  const [generandoChecklist, setGenerandoChecklist] = useState(false);
  const [vistaRapida, setVistaRapida] = useState(null);
  const [error, setError] = useState(null);

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
    const params = entidadId ? `?entidad=${entidadId}` : '';
    api.get(`/api/jornadas/${jornadaId}/monitoreo/${params}`)
      .then((respuesta) => {
        if (!cancelado) setDatos(respuesta);
      })
      .catch(() => {
        if (!cancelado) setError('No se pudo cargar el monitoreo de esta distribución.');
      });
    return () => { cancelado = true; };
  }, [jornadaId, entidadId]);

  const jornadasDelNivel = (jornadas || []).filter((item) => item.categoria === nivel);

  function prepararRecarga() {
    setDatos(null);
    setError(null);
    setBusqueda('');
    setBusquedaEvidencia('');
  }

  function onCambiarNivel(nuevoNivel) {
    const primera = (jornadas || []).find((item) => item.categoria === nuevoNivel);
    prepararRecarga();
    setNivel(nuevoNivel);
    setEntidadId('');
    setJornadaId(primera ? String(primera.id) : '');
  }

  function onCambiarJornada(nuevoId) {
    prepararRecarga();
    setEntidadId('');
    setJornadaId(nuevoId);
  }

  function onCambiarEntidad(nuevoId) {
    prepararRecarga();
    setEntidadId(nuevoId);
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

  const listaFiltrada = (datos?.lista_clues || []).filter((fila) => {
    const texto = `${fila.clues} ${fila.unidad} ${fila.entidad} ${fila.municipio} ${fila.ruta} ${fila.tipo_unidad_medica} ${fila.quien_recibe} ${fila.telefono} ${fila.correo}`.toLocaleLowerCase('es');
    return texto.includes(busqueda.trim().toLocaleLowerCase('es'));
  });
  const evidenciaFiltrada = (datos?.lista_clues || []).filter((fila) => {
    const texto = `${fila.clues} ${fila.unidad}`.toLocaleLowerCase('es');
    return texto.includes(busquedaEvidencia.trim().toLocaleLowerCase('es'));
  });
  const resumen = datos?.resumen;
  const puedeDescargarChecklist = usuario?.rol === ROLES.ADMIN_NACIONAL || usuario?.rol === ROLES.SUPER_ADMIN;
  const diasPicking = datos ? rangoDias(datos.jornada.fecha_inicio, datos.jornada.fecha_fin) : [];
  const opcionMetrica = METRICAS_FECHA.find((opcion) => opcion.clave === metricaFecha);
  const datosGrafica = {
    labels: (datos?.fechas || []).map((fila) => fechaCorta(fila.fecha)),
    datasets: [{
      label: opcionMetrica.etiqueta,
      data: (datos?.fechas || []).map((fila) => fila[metricaFecha]),
      borderColor: '#1f5b4d',
      backgroundColor: 'rgba(31, 91, 77, 0.20)',
      borderWidth: 2.5,
      pointBackgroundColor: '#1f5b4d',
      pointBorderWidth: 0,
      pointRadius: 3,
      pointHoverRadius: 5,
      fill: true,
      tension: 0.28,
    }],
  };
  const opcionesGrafica = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      tooltip: {
        displayColors: false,
        callbacks: {
          label: (contexto) => `${opcionMetrica.etiqueta}: ${numero(contexto.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: 'Fecha', color: '#5f6562', font: { size: 11, weight: 600 } },
        grid: { color: 'rgba(32, 47, 43, 0.08)' },
        ticks: { color: '#666d69', maxRotation: 0, autoSkip: true, maxTicksLimit: 18, font: { size: 9 } },
      },
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Totales', color: '#5f6562', font: { size: 11, weight: 600 } },
        grid: { color: 'rgba(32, 47, 43, 0.10)' },
        ticks: { color: '#666d69', precision: 0, font: { size: 10 } },
      },
    },
  };

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

  return (
    <div className="monitor-page">
      <div className="topbar monitor-topbar">
        <h2>Monitoreo y Seguimiento</h2>
      </div>

      {datos && (
        <section className="monitor-kpis" aria-label="Indicadores generales">
          <Kpi icono={<CalendarDays />} etiqueta="CLUES programadas" valor={numero(resumen.registros)} detalle={`${numero(resumen.capturadas)} capturadas`} tono="neutral" />
          <Kpi icono={<CheckCircle2 />} etiqueta="CLUES atendidas" valor={numero(resumen.atendidas)} detalle={`${resumen.avance_porcentaje}% de avance`} tono="verde" />
          <Kpi icono={<ListChecks />} etiqueta="Pendientes" valor={numero(resumen.pendientes)} detalle="Por abastecer" tono="guinda" />
          <Kpi icono={<Boxes />} etiqueta="Claves" valor={numero(resumen.claves)} detalle="A desplazar" tono="dorado" />
          <Kpi icono={<PackageCheck />} etiqueta="Medicamento" valor={numero(resumen.piezas_medicamento)} detalle="Piezas programadas" tono="verde" />
          <Kpi icono={<PackageCheck />} etiqueta="Material de curación" valor={numero(resumen.piezas_material_curacion)} detalle="Piezas programadas" tono="dorado" />
        </section>
      )}

      <section className="monitor-filtros" aria-label="Filtros de monitoreo">
        <div className="field">
          <label htmlFor="monitor-nivel">Nivel</label>
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
        <div className="field">
          <label htmlFor="monitor-entidad">Estado</label>
          <select id="monitor-entidad" value={entidadId} onChange={(e) => onCambiarEntidad(e.target.value)} disabled={!datos}>
            <option value="">Todos los estados</option>
            {datos?.filtros.entidades.map((entidad) => (
              <option key={entidad.id} value={entidad.id}>{entidad.nombre}</option>
            ))}
          </select>
        </div>
        {datos && (
          <div className="monitor-filtros__contexto">
            <span className={`badge ${datos.jornada.categoria === 'primer_nivel' ? 'verde' : 'dorado'}`}>
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
            <Apartado numeroOrden="01" titulo="CLUES PROGRAMADAS" detalle={`${numero(resumen.registros)} CLUES`} abierto={apartadoAbierto === '01'} onAlternar={() => alternarApartado('01')}>
              <div className="tablewrap monitor-tabla-resumen"><table><thead><tr><th>Entidad</th><th>CLUES</th><th>CLUES capturadas</th><th>CLUES pendientes</th></tr></thead><tbody>
                {datos.entidades.map((fila) => <tr key={fila.id}><td className="nombre">{fila.entidad}</td><td>{numero(fila.registros)}</td><td><CantidadPorcentaje cantidad={fila.capturadas} porcentaje={fila.captura_porcentaje} tono="verde" /></td><td><CantidadPorcentaje cantidad={fila.pendientes_captura} porcentaje={fila.pendiente_captura_porcentaje} tono="rojo" /></td></tr>)}
              </tbody></table></div>
            </Apartado>

            <Apartado numeroOrden="02" titulo="DISTRIBUCIÓN PROGRAMADA VS ABASTECIDAS" detalle={`${resumen.avance_porcentaje}% de avance`} abierto={apartadoAbierto === '02'} onAlternar={() => alternarApartado('02')}>
              <div className="tablewrap monitor-tabla-resumen"><table><thead><tr><th>Entidad</th><th>Total de unidades médicas programadas</th><th>Total de unidades médicas abastecidas</th><th>Avance general</th></tr></thead><tbody>
                {datos.entidades.map((fila) => <tr key={fila.id}><td className="nombre">{fila.entidad}</td><td className="monitor-dato--verde">{numero(fila.registros)}</td><td>{fila.atendidas ? numero(fila.atendidas) : '—'}</td><td>{fila.atendidas ? <span className="monitor-porcentaje"><i style={{ width: `${fila.avance_porcentaje}%` }} />{fila.avance_porcentaje}%</span> : '—'}</td></tr>)}
              </tbody></table></div>
            </Apartado>

            <Apartado numeroOrden="03" titulo="CLUES QUE FALTAN POR ABASTECER" detalle={`${numero(resumen.pendientes)} pendientes`} abierto={apartadoAbierto === '03'} onAlternar={() => alternarApartado('03')}>
              <div className="tablewrap monitor-tabla-resumen"><table><thead><tr><th>Estado</th><th>CLUES que faltan por abastecer</th><th>CLUES por programar</th></tr></thead><tbody>
                {datos.entidades.map((fila) => <tr key={fila.id}><td className="nombre">{fila.entidad}</td><td className={fila.pendientes ? 'monitor-dato--rojo' : ''}>{fila.pendientes ? numero(fila.pendientes) : '—'}</td><td className={fila.por_programar ? 'monitor-dato--rojo' : ''}>{fila.por_programar ? numero(fila.por_programar) : '—'}</td></tr>)}
              </tbody></table></div>
            </Apartado>

            <Apartado numeroOrden="04" titulo="LISTA DE CLUES" detalle={`${numero(resumen.registros)} registros`} abierto={apartadoAbierto === '04'} onAlternar={() => alternarApartado('04')}>
              <label className="monitor-busqueda"><Search size={16} aria-hidden="true" /><input type="search" placeholder="Buscar CLUES, unidad, contacto, teléfono o correo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></label>
              <div className="tablewrap monitor-lista-clues"><table><thead><tr><th>CLUES</th><th>Unidad médica</th><th>Tipo de unidad</th><th>Estado</th><th>Municipio</th><th>Ruta</th><th>Fecha programada</th><th>Claves</th><th>Medicamento</th><th>Material curación</th><th>Quién recibe en unidad</th><th>Teléfono</th><th>Correo</th><th>Estatus</th></tr></thead><tbody>
                {listaFiltrada.map((fila) => <tr key={fila.id} className={!fila.entregado && fila.tiene_evidencia ? 'monitor-fila--alerta' : undefined}><td>{fila.clues}</td><td className="nombre">{fila.unidad}</td><td>{fila.tipo_unidad_medica || '—'}</td><td>{fila.entidad}</td><td>{fila.municipio || '—'}</td><td>{fila.ruta || '—'}</td><td>{fila.fecha_programada || 'Por programar'}</td><td>{numero(fila.claves)}</td><td>{numero(fila.piezas_medicamento)}</td><td>{numero(fila.piezas_material_curacion)}</td><td>{fila.quien_recibe || '—'}</td><td>{fila.telefono || '—'}</td><td>{fila.correo || '—'}</td><td><EstadoEntrega fila={fila} /></td></tr>)}
                {listaFiltrada.length === 0 && <tr><td colSpan={14} className="tabla-vacia">No hay CLUES que coincidan.</td></tr>}
              </tbody></table></div>
            </Apartado>

            <Apartado numeroOrden="05" titulo="AVANCE POR FECHA" detalle={`${datos.fechas.length} fechas`} abierto={apartadoAbierto === '05'} onAlternar={() => alternarApartado('05')}>
              <div className="monitor-grafica__modos" role="group" aria-label="Dato mostrado por fecha">
                {METRICAS_FECHA.map((opcion) => (
                  <button key={opcion.clave} type="button" className={metricaFecha === opcion.clave ? 'activo' : ''} aria-pressed={metricaFecha === opcion.clave} onClick={() => setMetricaFecha(opcion.clave)}>
                    {opcion.etiqueta}
                  </button>
                ))}
              </div>
              {datos.fechas.length > 0 ? (
                <div className="monitor-grafica" role="img" aria-label={`${opcionMetrica.etiqueta} por fecha`}>
                  <Line data={datosGrafica} options={opcionesGrafica} />
                </div>
              ) : <p className="tabla-vacia">No hay fechas programadas.</p>}
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
              </div>
              <div className="tablewrap monitor-tabla-evidencia"><table><thead><tr><th>CLUES</th><th>Nombre de la unidad</th><th>Entidad</th><th>Foto</th><th>Video</th><th>Nota</th><th>Evidencia completa</th><th>Avance</th></tr></thead><tbody>
                {evidenciaFiltrada.map((fila) => <tr key={fila.id}><td>{fila.clues}</td><td className="nombre">{fila.unidad}</td><td>{fila.entidad}</td><td><MarcaEvidencia presente={fila.evidencia_foto} etiqueta="Foto" onAbrir={() => abrirEvidencia(fila, 'imagen')} /></td><td><MarcaEvidencia presente={fila.evidencia_video} etiqueta="Video" onAbrir={() => abrirEvidencia(fila, 'video')} /></td><td><MarcaEvidencia presente={fila.evidencia_nota} etiqueta="Nota" onAbrir={() => abrirEvidencia(fila, 'documento')} /></td><td><MarcaEvidencia presente={fila.evidencia_completa} etiqueta="Evidencia completa" /></td><td><span className={`monitor-avance-evidencia ${fila.evidencia_completa ? 'completo' : ''}`}>{fila.evidencia_avance}%</span></td></tr>)}
                {evidenciaFiltrada.length === 0 && <tr><td colSpan={8} className="tabla-vacia">No hay unidades que coincidan.</td></tr>}
              </tbody></table></div>
            </Apartado>

            <Apartado numeroOrden="07" titulo="AVANCE DE PICKING Y PACKING" detalle={`${datos.picking.dias_evidencia} días con evidencia`} abierto={apartadoAbierto === '07'} onAlternar={() => alternarApartado('07')}>
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
                    return <td key={dia} className="monitor-picking__dia"><span className={`monitor-picking__indicador ${marcas.foto ? 'activo' : ''}`} title={marcas.foto ? 'Ya tiene foto' : 'Falta foto'}><Image size={14} aria-hidden="true" /><span className="sr-only">Foto</span></span><span className={`monitor-picking__indicador ${marcas.video ? 'activo' : ''}`} title={marcas.video ? 'Ya tiene video' : 'Falta video'}><Film size={14} aria-hidden="true" /><span className="sr-only">Video</span></span></td>;
                  })}<td className="monitor-picking__dias-total">{fila.picking_dias_evidencia || '—'}</td></tr>;
                })}
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
    </div>
  );
}