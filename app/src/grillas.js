import ExcelJS from 'exceljs';

// RF-10, RF-11, RF-19 y AC-16: grillas de consulta con filtro por cada columna
export const GRILLAS = {
  celulares: {
    titulo: 'Celulares',
    origen: 'celulares',
    orden: 'id',
    columnas: [
      ['id', 'ID inventario'], ['marca', 'Marca'], ['modelo', 'Modelo'], ['imei', 'IMEI'],
      ['estado', 'Estado'], ['fecha_estado', 'Fecha estado'], ['fecha_compra', 'Fecha compra'],
      ['proveedor', 'Proveedor'], ['fecha_baja', 'Fecha baja'], ['motivo_baja', 'Motivo baja'],
      ['observacion', 'Observacion'],
    ],
  },
  lineas: {
    titulo: 'Lineas',
    origen: 'lineas',
    orden: 'id',
    columnas: [
      ['id', 'ID inventario'], ['numero', 'Numero de linea'], ['prestador', 'Prestador'],
      ['nro_cuenta', 'Nro. cuenta'], ['plan', 'Plan'], ['nro_sim', 'Nro. SIM'],
      ['estado', 'Estado'], ['fecha_estado', 'Fecha estado'], ['fecha_compra', 'Fecha compra'],
      ['fecha_baja', 'Fecha baja'], ['motivo_baja', 'Motivo baja'], ['observacion', 'Observacion'],
    ],
  },
  asignaciones: {
    titulo: 'Asignaciones',
    origen: 'v_asignaciones',
    orden: 'fecha_asignacion DESC, id DESC',
    columnas: [
      ['id', 'ID asignacion'], ['situacion', 'Situacion'], ['tipo', 'Tipo'], ['id_recurso', 'ID recurso'],
      ['id_empleado', 'ID empleado'], ['legajo', 'Legajo'], ['nombre', 'Empleado'], ['sigla', 'Sigla'],
      ['sector', 'Sector'], ['area', 'Area'], ['centro_costo', 'Centro de costo'],
      ['marca', 'Marca'], ['modelo', 'Modelo'], ['imei', 'IMEI'],
      ['numero_linea', 'Numero de linea'], ['prestador', 'Prestador'], ['plan', 'Plan'],
      ['fecha_asignacion', 'Fecha asignacion'], ['fecha_devolucion', 'Fecha devolucion'],
      ['observacion', 'Observacion'],
    ],
  },
  empleados: {
    titulo: 'Padron de empleados',
    origen: 'empleados',
    orden: 'nombre',
    columnas: [
      ['id_empleado', 'ID empleado'], ['legajo', 'Legajo'], ['nombre', 'Nombre'], ['sigla', 'Sigla'],
      ['sector', 'Sector'], ['area', 'Area'], ['gerencia', 'Gerencia'], ['centro_costo', 'Centro de costo'],
      ['fecha_alta', 'Fecha alta'], ['fecha_baja', 'Fecha baja'],
    ],
  },
  auditoria: {
    titulo: 'Historial de cambios',
    origen: 'auditoria',
    orden: 'id DESC',
    columnas: [
      ['fecha_hora', 'Fecha y hora'], ['usuario', 'Usuario'], ['entidad', 'Entidad'],
      ['id_registro', 'ID registro'], ['operacion', 'Operacion'], ['campo', 'Campo'],
      ['valor_anterior', 'Valor anterior'], ['valor_nuevo', 'Valor nuevo'],
    ],
  },
};

export const LIMITE_PANTALLA = 1000;

export function consultarGrilla(db, nombre, filtros, { limite = null } = {}) {
  const grilla = GRILLAS[nombre];
  if (!grilla) return null;
  const condiciones = [];
  const parametros = [];
  for (const [campo] of grilla.columnas) {
    const valor = filtros[campo];
    if (typeof valor === 'string' && valor.trim() !== '') {
      condiciones.push(`COALESCE(${campo}, '') LIKE ? ESCAPE '\\'`);
      parametros.push(`%${valor.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    }
  }
  const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const select = grilla.columnas.map(([c]) => c).join(', ');
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ${grilla.origen} ${donde}`).get(...parametros);
  const tope = limite ? `LIMIT ${Number(limite)}` : '';
  const filas = db.prepare(`SELECT ${select} FROM ${grilla.origen} ${donde} ORDER BY ${grilla.orden} ${tope}`)
    .all(...parametros);
  return { titulo: grilla.titulo, columnas: grilla.columnas, filas, total };
}

// RF-17 / AC-17: mismas columnas de la grilla y solo las filas filtradas
export async function exportarXlsx(resultado) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet(resultado.titulo.slice(0, 31));
  hoja.columns = resultado.columnas.map(([key, header]) => ({ key, header, width: Math.max(12, header.length + 2) }));
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  for (const fila of resultado.filas) hoja.addRow({ ...fila });
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: resultado.columnas.length } };
  return libro.xlsx.writeBuffer();
}
