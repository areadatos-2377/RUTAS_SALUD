import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
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

// Mismo listado de distribuciones que /jornadas, pero de solo lectura --
// aqui no se crean/editan/eliminan distribuciones, solo se elige una para
// entrar a cargar evidencia de picking & packing.
export default function PickingPackingPage() {
  const [jornadas, setJornadas] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getAll('/api/jornadas/')
      .then(setJornadas)
      .catch(() => setError('No se pudieron cargar las distribuciones.'));
  }, []);

  return (
    <div>
      <div className="topbar">
        <div>
          <p className="crumb">Picking & Packing</p>
          <h2>Distribuciones</h2>
        </div>
      </div>

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
                  <Link className="btn-ghost" to={`/picking-packing/${j.id}`}>
                    Cargar evidencia
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
