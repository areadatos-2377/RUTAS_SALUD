import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './FiltroColumna.css';

// Filtro tipo Excel: combobox con checkboxes de seleccion multiple. El
// panel se monta con un portal a document.body (no como hijo normal del
// <th>) porque la tabla que lo contiene tiene overflow:auto para el
// scroll horizontal/vertical -- un position:absolute normal quedaria
// recortado por ese contenedor en vez de flotar libre encima de todo.
export default function FiltroColumna({ label, valores, seleccionActiva, abierto, onAbrir, onCerrar, onAplicar }) {
  const [busqueda, setBusqueda] = useState('');
  const [borrador, setBorrador] = useState(() => new Set(seleccionActiva || valores));
  const [posicion, setPosicion] = useState(null);
  const botonRef = useRef(null);
  const panelRef = useRef(null);

  // Se reinicia el borrador cada vez que se abre -- para que "Cancelar" de
  // verdad descarte cualquier cambio a medio hacer de la vez anterior.
  useEffect(() => {
    if (!abierto) return;
    setBorrador(new Set(seleccionActiva || valores));
    setBusqueda('');
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!abierto) return;
    function recalcularPosicion() {
      if (!botonRef.current) return;
      const rect = botonRef.current.getBoundingClientRect();
      setPosicion({ top: rect.bottom + 4, left: rect.left });
    }
    recalcularPosicion();
    // capture:true -- el scroll de .jornada-tabla (el contenedor de la
    // tabla) no burbujea como evento normal, pero si se propaga en fase de
    // captura hacia arriba; sin esto el panel se quedaria pegado en su
    // posicion original al scrollear la tabla.
    window.addEventListener('scroll', recalcularPosicion, true);
    window.addEventListener('resize', recalcularPosicion);
    return () => {
      window.removeEventListener('scroll', recalcularPosicion, true);
      window.removeEventListener('resize', recalcularPosicion);
    };
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    function onClicFuera(e) {
      if (panelRef.current?.contains(e.target) || botonRef.current?.contains(e.target)) return;
      onCerrar();
    }
    document.addEventListener('mousedown', onClicFuera);
    return () => document.removeEventListener('mousedown', onClicFuera);
  }, [abierto, onCerrar]);

  const valoresFiltrados = valores.filter((v) =>
    v.toLocaleLowerCase('es').includes(busqueda.toLocaleLowerCase('es')),
  );
  const activo = seleccionActiva && seleccionActiva.size < valores.length;

  function alternar(valor) {
    setBorrador((actual) => {
      const copia = new Set(actual);
      if (copia.has(valor)) copia.delete(valor);
      else copia.add(valor);
      return copia;
    });
  }

  function aplicar() {
    onAplicar(borrador.size === valores.length ? null : borrador);
    onCerrar();
  }

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        className={`filtro-columna__boton${activo ? ' filtro-columna__boton--activo' : ''}`}
        onClick={() => (abierto ? onCerrar() : onAbrir())}
        title={`Filtrar ${label}`}
        aria-label={`Filtrar ${label}`}
      >
        ▾
      </button>
      {abierto && posicion && createPortal(
        <div
          ref={panelRef}
          className="filtro-columna__panel"
          style={{ top: posicion.top, left: posicion.left }}
        >
          <input
            type="search"
            className="filtro-columna__buscar"
            placeholder="Buscar…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            autoFocus
          />
          <div className="filtro-columna__acciones-rapidas">
            <button type="button" className="btn-ghost" onClick={() => setBorrador((actual) => new Set([...actual, ...valoresFiltrados]))}>
              Seleccionar todo
            </button>
            <button type="button" className="btn-ghost" onClick={() => setBorrador((actual) => {
              const copia = new Set(actual);
              for (const v of valoresFiltrados) copia.delete(v);
              return copia;
            })}>
              Limpiar
            </button>
          </div>
          <div className="filtro-columna__lista">
            {valoresFiltrados.length === 0 && <p className="filtro-columna__vacio">Sin coincidencias.</p>}
            {valoresFiltrados.map((valor) => (
              <label key={valor} className="filtro-columna__opcion">
                <input type="checkbox" checked={borrador.has(valor)} onChange={() => alternar(valor)} />
                <span>{valor}</span>
              </label>
            ))}
          </div>
          <div className="filtro-columna__footer">
            <button type="button" className="btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={aplicar}>Aplicar</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
