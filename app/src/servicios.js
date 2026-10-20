import { enTransaccion, siguienteId } from './db.js';

const ZONA = 'America/Argentina/Buenos_Aires';

export class ErrorNegocio extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.status = status;
  }
}

export function hoy() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: ZONA }).format(new Date());
}

function ahora() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: ZONA, dateStyle: 'short', timeStyle: 'medium',
  }).format(new Date());
}

export function esFecha(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(valor + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

function exigirFecha(valor, nombre) {
  if (!esFecha(valor)) throw new ErrorNegocio(`La ${nombre} es obligatoria y debe tener formato AAAA-MM-DD`);
  return valor;
}

function texto(valor) {
  if (valor === undefined || valor === null) return null;
  const t = String(valor).trim();
  return t === '' ? null : t;
}

const mayorFecha = (...fechas) => fechas.filter(Boolean).sort().at(-1) ?? null;

// RF-16: registra cada campo que cambia con usuario, fecha y hora, valor anterior y nuevo
function auditar(db, usuario, entidad, idRegistro, operacion, antes, despues) {
  const insertar = db.prepare(`INSERT INTO auditoria
    (fecha_hora, usuario, entidad, id_registro, operacion, campo, valor_anterior, valor_nuevo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const fechaHora = ahora();
  const campos = new Set([...Object.keys(antes ?? {}), ...Object.keys(despues ?? {})]);
  for (const campo of campos) {
    const anterior = antes?.[campo] ?? null;
    const nuevo = despues?.[campo] ?? null;
    if (anterior === nuevo) continue;
    insertar.run(fechaHora, usuario, entidad, idRegistro, operacion, campo,
      anterior === null ? null : String(anterior), nuevo === null ? null : String(nuevo));
  }
}

function actualizar(db, tabla, clave, id, cambios) {
  const campos = Object.keys(cambios);
  db.prepare(`UPDATE ${tabla} SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE ${clave} = ?`)
    .run(...campos.map((c) => cambios[c]), id);
}

// ---------------------------------------------------------------------------
// Celulares y lineas (RF-01, RF-02, RF-04, RF-05, RF-13, RF-15)
// ---------------------------------------------------------------------------

export const RECURSOS = {
  Celular: {
    tabla: 'celulares',
    prefijo: 'C',
    articulo: 'el celular',
    campos: ['marca', 'modelo', 'imei', 'fecha_compra', 'proveedor', 'observacion'],
    obligatorios: { marca: 'marca', modelo: 'modelo', imei: 'IMEI', fecha_compra: 'fecha de compra', proveedor: 'proveedor' },
    unico: { campo: 'imei', nombre: 'IMEI' },
    motivosBaja: ['Rotura', 'Robo', 'Perdida', 'Obsolescencia', 'Cesion'],
    estadosManuales: ['Disponible', 'A Recuperar', 'En Reparacion'],
    estadosDevolucion: ['Disponible', 'A Recuperar', 'En Reparacion'],
  },
  Linea: {
    tabla: 'lineas',
    prefijo: 'L',
    articulo: 'la linea',
    campos: ['numero', 'prestador', 'nro_cuenta', 'plan', 'fecha_compra', 'nro_sim', 'observacion'],
    obligatorios: { numero: 'numero de linea', prestador: 'prestador', nro_cuenta: 'nro. de cuenta', plan: 'plan', fecha_compra: 'fecha de compra', nro_sim: 'nro. de SIM' },
    unico: { campo: 'numero', nombre: 'numero de linea' },
    motivosBaja: ['Cesion', 'No necesaria'],
    estadosManuales: ['Disponible', 'A Recuperar'],
    estadosDevolucion: ['Disponible', 'A Recuperar'],
  },
};

function config(tipo) {
  const cfg = RECURSOS[tipo];
  if (!cfg) throw new ErrorNegocio(`Tipo de recurso invalido: ${tipo}`);
  return cfg;
}

export function obtenerRecurso(db, tipo, id) {
  const recurso = db.prepare(`SELECT * FROM ${config(tipo).tabla} WHERE id = ?`).get(id);
  if (!recurso) throw new ErrorNegocio(`No existe ${config(tipo).articulo} ${id}`, 404);
  return { ...recurso };
}

function validarDatosRecurso(db, tipo, datos, idActual = null) {
  const cfg = config(tipo);
  const limpio = {};
  for (const campo of cfg.campos) limpio[campo] = texto(datos[campo]);
  for (const [campo, nombre] of Object.entries(cfg.obligatorios)) {
    if (!limpio[campo]) throw new ErrorNegocio(`El campo ${nombre} es obligatorio`);
  }
  exigirFecha(limpio.fecha_compra, 'fecha de compra');
  if (tipo === 'Celular' && !/^\d{15}$/.test(limpio.imei)) {
    throw new ErrorNegocio('El IMEI debe tener 15 digitos');
  }
  const { campo, nombre } = cfg.unico;
  const duplicado = db.prepare(`SELECT id FROM ${cfg.tabla} WHERE ${campo} = ? AND id IS NOT ?`)
    .get(limpio[campo], idActual);
  if (duplicado) throw new ErrorNegocio(`Ya existe ${cfg.articulo} ${duplicado.id} con el mismo ${nombre}`);
  return limpio;
}

export function altaRecurso(db, usuario, tipo, datos) {
  const cfg = config(tipo);
  return enTransaccion(db, () => {
    const limpio = validarDatosRecurso(db, tipo, datos);
    const nuevo = {
      id: siguienteId(db, cfg.tabla, cfg.prefijo),
      ...limpio,
      // RF-15: todo alta queda Disponible; la fecha de estado es la de compra
      estado: 'Disponible',
      fecha_estado: limpio.fecha_compra,
    };
    const campos = Object.keys(nuevo);
    db.prepare(`INSERT INTO ${cfg.tabla} (${campos.join(', ')}) VALUES (${campos.map(() => '?').join(', ')})`)
      .run(...campos.map((c) => nuevo[c]));
    auditar(db, usuario, tipo, nuevo.id, 'Alta', null, nuevo);
    return nuevo;
  });
}

export function modificarRecurso(db, usuario, tipo, id, datos) {
  const cfg = config(tipo);
  return enTransaccion(db, () => {
    const actual = obtenerRecurso(db, tipo, id);
    const limpio = validarDatosRecurso(db, tipo, datos, id);
    const { primera } = db.prepare(
      'SELECT MIN(fecha_asignacion) AS primera FROM asignaciones WHERE tipo = ? AND id_recurso = ?',
    ).get(tipo, id);
    if (primera && limpio.fecha_compra > primera) {
      throw new ErrorNegocio(`La fecha de compra no puede ser posterior a la primera asignacion (${primera})`);
    }
    const antes = Object.fromEntries(cfg.campos.map((c) => [c, actual[c]]));
    actualizar(db, cfg.tabla, 'id', id, limpio);
    auditar(db, usuario, tipo, id, 'Modificacion', antes, limpio);
    return { ...actual, ...limpio };
  });
}

function ultimaFechaMovimiento(db, tipo, id) {
  const { ultima } = db.prepare(`SELECT MAX(MAX(fecha_asignacion), COALESCE(MAX(fecha_devolucion), ''))
    AS ultima FROM asignaciones WHERE tipo = ? AND id_recurso = ?`).get(tipo, id);
  return ultima || null;
}

function cerrarAsignacion(db, usuario, asignacion, fechaDevolucion) {
  actualizar(db, 'asignaciones', 'id', asignacion.id, { fecha_devolucion: fechaDevolucion });
  auditar(db, usuario, 'Asignacion', asignacion.id, 'Devolucion',
    { fecha_devolucion: null }, { fecha_devolucion: fechaDevolucion });
}

function cambiarEstadoRecurso(db, usuario, tipo, recurso, estado, fecha, operacion) {
  const cambios = { estado, fecha_estado: fecha };
  actualizar(db, config(tipo).tabla, 'id', recurso.id, cambios);
  auditar(db, usuario, tipo, recurso.id, operacion,
    { estado: recurso.estado, fecha_estado: recurso.fecha_estado }, cambios);
}

// RF-04 / RF-05: baja logica con motivo de la lista
export function bajaRecurso(db, usuario, tipo, id, { fecha_baja, motivo_baja }) {
  const cfg = config(tipo);
  return enTransaccion(db, () => {
    const recurso = obtenerRecurso(db, tipo, id);
    if (recurso.estado === 'Baja') throw new ErrorNegocio(`${cap(cfg.articulo)} ${id} ya esta dado de baja`);
    if (!cfg.motivosBaja.includes(motivo_baja)) {
      throw new ErrorNegocio(`Debe elegir un motivo de baja: ${cfg.motivosBaja.join(', ')}`);
    }
    exigirFecha(fecha_baja, 'fecha de baja');
    const minima = mayorFecha(recurso.fecha_compra, ultimaFechaMovimiento(db, tipo, id));
    if (fecha_baja < minima) {
      throw new ErrorNegocio(`La fecha de baja no puede ser anterior a ${minima} (compra o ultima asignacion/devolucion)`);
    }
    // RF-04.2 / RF-05.2: si esta En Uso se cierra la asignacion vigente
    const vigente = db.prepare(
      'SELECT * FROM asignaciones WHERE tipo = ? AND id_recurso = ? AND fecha_devolucion IS NULL',
    ).get(tipo, id);
    if (vigente) cerrarAsignacion(db, usuario, vigente, fecha_baja);

    const cambios = { estado: 'Baja', fecha_estado: fecha_baja, fecha_baja, motivo_baja };
    actualizar(db, cfg.tabla, 'id', id, cambios);
    auditar(db, usuario, tipo, id, 'Baja',
      Object.fromEntries(Object.keys(cambios).map((c) => [c, recurso[c]])), cambios);
    return { ...recurso, ...cambios };
  });
}

// RF-13 / RF-13.1: cambio manual de estado entre los estados permitidos
export function cambioManualEstado(db, usuario, tipo, id, estado) {
  const cfg = config(tipo);
  return enTransaccion(db, () => {
    const recurso = obtenerRecurso(db, tipo, id);
    if (!cfg.estadosManuales.includes(recurso.estado)) {
      throw new ErrorNegocio(`No se puede cambiar manualmente el estado "${recurso.estado}"`);
    }
    if (!cfg.estadosManuales.includes(estado)) {
      throw new ErrorNegocio(`Estado invalido. Opciones: ${cfg.estadosManuales.join(', ')}`);
    }
    if (estado === recurso.estado) throw new ErrorNegocio(`${cap(cfg.articulo)} ya esta en estado "${estado}"`);
    const fecha = mayorFecha(hoy(), recurso.fecha_estado);
    cambiarEstadoRecurso(db, usuario, tipo, recurso, estado, fecha, 'Cambio de estado');
    return { ...recurso, estado, fecha_estado: fecha };
  });
}

// ---------------------------------------------------------------------------
// Asignaciones y devoluciones (RF-03, RF-07, RF-08, RF-12)
// ---------------------------------------------------------------------------

function obtenerEmpleado(db, idEmpleado) {
  const empleado = db.prepare('SELECT * FROM empleados WHERE id_empleado = ?').get(idEmpleado);
  if (!empleado) throw new ErrorNegocio(`No existe el empleado ${idEmpleado}`, 404);
  return empleado;
}

export function asignar(db, usuario, { id_empleado, id_celular, id_linea, fecha_asignacion, observacion }) {
  const pedidos = [['Celular', texto(id_celular)], ['Linea', texto(id_linea)]].filter(([, id]) => id);
  if (pedidos.length === 0) throw new ErrorNegocio('Debe elegir un celular y/o una linea');
  exigirFecha(fecha_asignacion, 'fecha de asignacion');

  return enTransaccion(db, () => {
    const empleado = obtenerEmpleado(db, texto(id_empleado));
    // RF-03 / AC-03a
    if (empleado.fecha_baja) {
      throw new ErrorNegocio(`No se puede asignar a ${empleado.nombre}: tiene fecha de baja ${empleado.fecha_baja}`);
    }
    const creadas = [];
    // RF-03.1: cada recurso genera su propia asignacion
    for (const [tipo, idRecurso] of pedidos) {
      const cfg = config(tipo);
      const recurso = obtenerRecurso(db, tipo, idRecurso);
      // RF-08 / RF-03.7: si otro operador lo asigno antes, ya no esta Disponible
      if (recurso.estado !== 'Disponible') {
        throw new ErrorNegocio(`${cap(cfg.articulo)} ${idRecurso} ya no esta "Disponible" (estado actual: ${recurso.estado})`, 409);
      }
      // RF-03.6
      const previa = db.prepare(
        'SELECT id, id_recurso FROM asignaciones WHERE id_empleado = ? AND tipo = ? AND fecha_devolucion IS NULL',
      ).get(empleado.id_empleado, tipo);
      if (previa) {
        throw new ErrorNegocio(`${empleado.nombre} ya tiene asignado ${cfg.articulo} ${previa.id_recurso} (asignacion ${previa.id})`);
      }
      // RF-03.5
      const minima = mayorFecha(recurso.fecha_compra, recurso.fecha_estado);
      if (fecha_asignacion < minima) {
        throw new ErrorNegocio(`La fecha de asignacion de ${cfg.articulo} ${idRecurso} no puede ser anterior a ${minima} (compra o ultimo cambio de estado)`);
      }
      const nueva = {
        id: siguienteId(db, 'asignaciones', 'A'),
        id_empleado: empleado.id_empleado,
        tipo,
        id_recurso: idRecurso,
        fecha_asignacion,
        fecha_devolucion: null,
        observacion: texto(observacion),
      };
      db.prepare(`INSERT INTO asignaciones (id, id_empleado, tipo, id_recurso, fecha_asignacion, fecha_devolucion, observacion)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(nueva));
      auditar(db, usuario, 'Asignacion', nueva.id, 'Asignacion', null, nueva);
      // RF-03.4
      cambiarEstadoRecurso(db, usuario, tipo, recurso, 'En Uso', fecha_asignacion, 'Asignacion');
      creadas.push(nueva);
    }
    return creadas;
  });
}

// RF-12: devolucion de un celular y/o una linea, con el estado elegido por el operador
export function devolver(db, usuario, { fecha_devolucion, items }) {
  exigirFecha(fecha_devolucion, 'fecha de devolucion');
  if (!Array.isArray(items) || items.length === 0) throw new ErrorNegocio('Debe elegir al menos una asignacion a devolver');

  return enTransaccion(db, () => items.map(({ id_asignacion, estado }) => {
    const asignacion = db.prepare('SELECT * FROM asignaciones WHERE id = ?').get(id_asignacion);
    if (!asignacion) throw new ErrorNegocio(`No existe la asignacion ${id_asignacion}`, 404);
    if (asignacion.fecha_devolucion) {
      throw new ErrorNegocio(`La asignacion ${id_asignacion} ya fue devuelta el ${asignacion.fecha_devolucion}`);
    }
    const cfg = config(asignacion.tipo);
    if (!cfg.estadosDevolucion.includes(estado)) {
      throw new ErrorNegocio(`Debe elegir el estado de ${cfg.articulo}: ${cfg.estadosDevolucion.join(', ')}`);
    }
    // RF-12.1
    if (fecha_devolucion < asignacion.fecha_asignacion) {
      throw new ErrorNegocio(`La fecha de devolucion no puede ser anterior a la de asignacion (${asignacion.fecha_asignacion})`);
    }
    cerrarAsignacion(db, usuario, asignacion, fecha_devolucion);
    const recurso = obtenerRecurso(db, asignacion.tipo, asignacion.id_recurso);
    cambiarEstadoRecurso(db, usuario, asignacion.tipo, recurso, estado, fecha_devolucion, 'Devolucion');
    return { ...asignacion, fecha_devolucion };
  }));
}

// AC-07a: de una asignacion solo se completa la devolucion o se modifica la observacion
export function modificarObservacion(db, usuario, idAsignacion, observacion) {
  return enTransaccion(db, () => {
    const asignacion = db.prepare('SELECT * FROM asignaciones WHERE id = ?').get(idAsignacion);
    if (!asignacion) throw new ErrorNegocio(`No existe la asignacion ${idAsignacion}`, 404);
    const nueva = texto(observacion);
    actualizar(db, 'asignaciones', 'id', idAsignacion, { observacion: nueva });
    auditar(db, usuario, 'Asignacion', idAsignacion, 'Modificacion',
      { observacion: asignacion.observacion }, { observacion: nueva });
    return { ...asignacion, observacion: nueva };
  });
}

// RF-06.1: devolucion automatica por baja del empleado
export function devolverPorBajaEmpleado(db, usuario, idEmpleado, fechaBaja) {
  const vigentes = db.prepare(
    'SELECT * FROM asignaciones WHERE id_empleado = ? AND fecha_devolucion IS NULL ORDER BY tipo',
  ).all(idEmpleado);
  for (const asignacion of vigentes) {
    const fecha = mayorFecha(fechaBaja, asignacion.fecha_asignacion);
    cerrarAsignacion(db, usuario, asignacion, fecha);
    const recurso = obtenerRecurso(db, asignacion.tipo, asignacion.id_recurso);
    cambiarEstadoRecurso(db, usuario, asignacion.tipo, recurso, 'A Recuperar', fecha, 'Baja de empleado');
  }
  return vigentes.length;
}

// RF-00 / RNF-02: ingreso con la sigla de un empleado activo del area Sistemas
export function validarIngreso(db, sigla) {
  const valor = texto(sigla)?.toUpperCase();
  if (!valor) return null;
  return db.prepare(`SELECT * FROM empleados
    WHERE UPPER(sigla) = ? AND area = 'Sistemas' AND fecha_baja IS NULL`).get(valor) ?? null;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
