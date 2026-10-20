import { enTransaccion } from './db.js';
import { devolverPorBajaEmpleado, esFecha, hoy } from './servicios.js';

export const USUARIO_INTERFAZ = 'INTERFACE';

export const COLUMNAS_PADRON = [
  'id_empleado', 'legajo', 'nombre', 'sector', 'area', 'gerencia',
  'sigla', 'centro_costo', 'fecha_alta', 'fecha_baja',
];

function normalizarFecha(valor) {
  const t = (valor ?? '').trim();
  if (t === '') return null;
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : t;
  if (!esFecha(iso)) throw new Error(`fecha invalida "${t}"`);
  return iso;
}

// Archivo de la interfaz: CSV con encabezado, separado por ";" o ","
export function leerCsvPadron(contenido) {
  const lineas = contenido.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lineas.length === 0) throw new Error('El archivo esta vacio');
  const separador = lineas[0].includes(';') ? ';' : ',';
  const encabezado = lineas[0].split(separador).map((c) => c.trim().toLowerCase());
  const faltantes = COLUMNAS_PADRON.filter((c) => !encabezado.includes(c));
  if (faltantes.length) throw new Error(`Faltan columnas en el encabezado: ${faltantes.join(', ')}`);
  return lineas.slice(1).map((linea, i) => {
    const valores = linea.split(separador);
    const fila = { _linea: i + 2 };
    encabezado.forEach((col, j) => { fila[col] = (valores[j] ?? '').trim(); });
    return fila;
  });
}

// RF-18 / RF-20: procesa el padron completo informado por RRHH
export function procesarPadron(db, filas, fechaProceso = hoy()) {
  const resumen = {
    fecha_proceso: fechaProceso, altas: 0, modificaciones: 0, bajas_procesadas: 0,
    bajas_futuras_descartadas: 0, devoluciones_generadas: 0, errores: [],
  };
  const buscar = db.prepare('SELECT * FROM empleados WHERE id_empleado = ?');

  for (const fila of filas) {
    try {
      enTransaccion(db, () => {
        const datos = {};
        for (const col of COLUMNAS_PADRON) datos[col] = fila[col] === '' ? null : fila[col] ?? null;
        if (!datos.id_empleado || !datos.legajo || !datos.nombre) {
          throw new Error('id_empleado, legajo y nombre son obligatorios');
        }
        datos.fecha_alta = normalizarFecha(datos.fecha_alta);
        datos.fecha_baja = normalizarFecha(datos.fecha_baja);
        if (datos.sigla) datos.sigla = datos.sigla.toUpperCase();

        const actual = buscar.get(datos.id_empleado);
        // No puede haber bajas a futuro: se descartan hasta una proxima iteracion
        if (datos.fecha_baja && datos.fecha_baja > fechaProceso) {
          resumen.bajas_futuras_descartadas++;
          datos.fecha_baja = actual?.fecha_baja ?? null;
        }

        if (actual) {
          const cambio = COLUMNAS_PADRON.some((c) => (actual[c] ?? null) !== datos[c]);
          if (cambio) {
            const campos = COLUMNAS_PADRON.filter((c) => c !== 'id_empleado');
            db.prepare(`UPDATE empleados SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id_empleado = ?`)
              .run(...campos.map((c) => datos[c]), datos.id_empleado);
            resumen.modificaciones++;
          }
        } else {
          // Un reingreso llega con nuevo legajo e id, y se procesa como alta
          db.prepare(`INSERT INTO empleados (${COLUMNAS_PADRON.join(', ')}) VALUES (${COLUMNAS_PADRON.map(() => '?').join(', ')})`)
            .run(...COLUMNAS_PADRON.map((c) => datos[c]));
          resumen.altas++;
        }

        // Solo la primera fecha de baja recibida dispara la RF-06.1; los ajustes
        // posteriores o la eliminacion de la baja no alteran las devoluciones
        const yaProcesada = actual?.baja_procesada === 1;
        if (datos.fecha_baja && !yaProcesada) {
          db.prepare('UPDATE empleados SET baja_procesada = 1 WHERE id_empleado = ?').run(datos.id_empleado);
          resumen.bajas_procesadas++;
          resumen.devoluciones_generadas += devolverPorBajaEmpleado(db, USUARIO_INTERFAZ, datos.id_empleado, datos.fecha_baja);
        } else if (!datos.fecha_baja && yaProcesada) {
          // Baja eliminada: puede volver a asignarse y una nueva baja se procesa otra vez
          db.prepare('UPDATE empleados SET baja_procesada = 0 WHERE id_empleado = ?').run(datos.id_empleado);
        }
      });
    } catch (e) {
      resumen.errores.push(`Linea ${fila._linea ?? '?'}: ${e.message}`);
    }
  }
  return resumen;
}
