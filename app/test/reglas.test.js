import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDb, incrementarId, PATRON_ID } from '../src/db.js';
import { procesarPadron } from '../src/rrhh.js';
import { consultarGrilla } from '../src/grillas.js';
import {
  altaRecurso, asignar, bajaRecurso, cambioManualEstado, devolver, modificarObservacion, validarIngreso,
} from '../src/servicios.js';

const PROCESO = '2026-10-20';
const empleado = (id, sigla, area, fecha_baja = '') => ({
  id_empleado: id, legajo: id.slice(1), nombre: `Empleado ${sigla}`, sector: 'S', area,
  gerencia: 'G', sigla, centro_costo: 'CC1', fecha_alta: '2020-01-01', fecha_baja,
});
let db;
let celular;
let linea;

beforeEach(() => {
  db = abrirDb();
  procesarPadron(db, [
    empleado('E1', 'GRH', 'Sistemas'),
    empleado('E2', 'JPE', 'Comercial'),
    empleado('E3', 'CDI', 'Sistemas', '2026-01-01'),
  ], PROCESO);
  celular = altaRecurso(db, 'GRH', 'Celular', { marca: 'Samsung', modelo: 'A55', imei: '356789012345671', fecha_compra: '2026-01-10', proveedor: 'Prov' });
  linea = altaRecurso(db, 'GRH', 'Linea', { numero: '1150001001', prestador: 'Personal', nro_cuenta: 'C1', plan: 'P', fecha_compra: '2026-01-10', nro_sim: '89540001' });
});

const estadoDe = (tabla, id) => db.prepare(`SELECT estado, fecha_estado FROM ${tabla} WHERE id = ?`).get(id);
const asignacionesDe = (idEmpleado) => db.prepare('SELECT * FROM asignaciones WHERE id_empleado = ? ORDER BY id').all(idEmpleado);

test('AC-00: solo ingresa un empleado activo del area Sistemas', () => {
  assert.equal(validarIngreso(db, 'grh')?.id_empleado, 'E1');
  assert.equal(validarIngreso(db, 'JPE'), null);
  assert.equal(validarIngreso(db, 'CDI'), null);
});

test('AC-01/02: obligatorios y unicidad de IMEI y numero de linea', () => {
  assert.throws(() => altaRecurso(db, 'GRH', 'Celular', { marca: 'X', modelo: 'Y', imei: '356789012345671', fecha_compra: '2026-01-01', proveedor: 'P' }), /mismo IMEI/);
  assert.throws(() => altaRecurso(db, 'GRH', 'Celular', { marca: 'X', imei: '356789012345679', fecha_compra: '2026-01-01', proveedor: 'P' }), /modelo es obligatorio/);
  assert.throws(() => altaRecurso(db, 'GRH', 'Linea', { numero: '1150001001', prestador: 'P', nro_cuenta: 'C', plan: 'P', fecha_compra: '2026-01-01', nro_sim: '1' }), /mismo numero de linea/);
});

test('AC-14 / AC-15: IDs generados con formato y estado inicial Disponible', () => {
  assert.equal(celular.id, 'C00001');
  assert.equal(linea.id, 'L00001');
  assert.equal(celular.estado, 'Disponible');
  assert.match(celular.id, PATRON_ID);
  assert.equal(incrementarId('C0000z'), 'C00010');
  assert.equal(incrementarId('A00009'), 'A0000a');
  db.prepare(`INSERT INTO celulares (id, marca, modelo, imei, fecha_compra, proveedor, estado, fecha_estado)
    VALUES ('C0cx1a', 'M', 'M', '356789012345600', '2025-01-01', 'P', 'Disponible', '2025-01-01')`).run();
  const siguiente = altaRecurso(db, 'GRH', 'Celular', { marca: 'X', modelo: 'Y', imei: '356789012345602', fecha_compra: '2026-01-01', proveedor: 'P' });
  assert.equal(siguiente.id, 'C0cx1b', 'RF-14.1: sigue desde el mayor id existente');
});

test('AC-03.1 / AC-03.4: asignar celular y linea juntos crea dos asignaciones y pasa a En Uso', () => {
  const creadas = asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', id_linea: 'L00001', fecha_asignacion: '2026-02-01' });
  assert.deepEqual(creadas.map((a) => a.id), ['A00001', 'A00002']);
  assert.equal(estadoDe('celulares', 'C00001').estado, 'En Uso');
  assert.equal(estadoDe('lineas', 'L00001').estado, 'En Uso');
});

test('AC-03a / AC-03.5 / AC-03.6 / AC-08: validaciones de asignacion', () => {
  assert.throws(() => asignar(db, 'GRH', { id_empleado: 'E3', id_celular: 'C00001', fecha_asignacion: '2026-02-01' }), /fecha de baja/);
  assert.throws(() => asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', fecha_asignacion: '2026-01-05' }), /no puede ser anterior/);
  asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', fecha_asignacion: '2026-02-01' });
  const otro = altaRecurso(db, 'GRH', 'Celular', { marca: 'X', modelo: 'Y', imei: '356789012345672', fecha_compra: '2026-01-01', proveedor: 'P' });
  assert.throws(() => asignar(db, 'GRH', { id_empleado: 'E2', id_celular: otro.id, fecha_asignacion: '2026-02-01' }), /ya tiene asignado/);
  assert.throws(() => asignar(db, 'GRH', { id_empleado: 'E1', id_celular: 'C00001', fecha_asignacion: '2026-02-01' }), /ya no esta "Disponible"/);
});

test('AC-03.7: el segundo operador que asigna el mismo celular recibe rechazo', () => {
  asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', fecha_asignacion: '2026-02-01' });
  assert.throws(() => asignar(db, 'AGO', { id_empleado: 'E1', id_celular: 'C00001', fecha_asignacion: '2026-02-01' }), /ya no esta "Disponible"/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM asignaciones WHERE id_recurso = 'C00001'").get().n, 1);
});

test('AC-04 / AC-04.2 / AC-04.3: baja de celular En Uso cierra la asignacion', () => {
  asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', fecha_asignacion: '2026-02-01' });
  assert.throws(() => bajaRecurso(db, 'GRH', 'Celular', 'C00001', { fecha_baja: '2026-03-01' }), /motivo/);
  assert.throws(() => bajaRecurso(db, 'GRH', 'Celular', 'C00001', { fecha_baja: '2026-01-20', motivo_baja: 'Rotura' }), /no puede ser anterior/);
  bajaRecurso(db, 'GRH', 'Celular', 'C00001', { fecha_baja: '2026-03-01', motivo_baja: 'Rotura' });
  assert.equal(estadoDe('celulares', 'C00001').estado, 'Baja');
  assert.equal(asignacionesDe('E2')[0].fecha_devolucion, '2026-03-01');
  assert.throws(() => bajaRecurso(db, 'GRH', 'Celular', 'C00001', { fecha_baja: '2026-03-02', motivo_baja: 'Robo' }), /ya esta dado de baja/);
  assert.throws(() => db.prepare("DELETE FROM celulares WHERE id = 'C00001'").run(), /no pueden borrarse/);
});

test('AC-05: motivos de baja de linea', () => {
  assert.throws(() => bajaRecurso(db, 'GRH', 'Linea', 'L00001', { fecha_baja: '2026-03-01', motivo_baja: 'Rotura' }), /Cesion, No necesaria/);
  bajaRecurso(db, 'GRH', 'Linea', 'L00001', { fecha_baja: '2026-03-01', motivo_baja: 'No necesaria' });
  assert.equal(estadoDe('lineas', 'L00001').estado, 'Baja');
});

test('AC-12 / AC-12.1: devolucion con estado elegido; En Reparacion solo para celulares', () => {
  const [ac, al] = asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', id_linea: 'L00001', fecha_asignacion: '2026-02-01' });
  assert.throws(() => devolver(db, 'GRH', { fecha_devolucion: '2026-01-31', items: [{ id_asignacion: ac.id, estado: 'Disponible' }] }), /anterior a la de asignacion/);
  assert.throws(() => devolver(db, 'GRH', { fecha_devolucion: '2026-03-01', items: [{ id_asignacion: al.id, estado: 'En Reparacion' }] }), /Disponible, A Recuperar$/);
  assert.throws(() => devolver(db, 'GRH', { fecha_devolucion: '2026-03-01', items: [{ id_asignacion: ac.id }] }), /Debe elegir el estado/);
  devolver(db, 'GRH', { fecha_devolucion: '2026-03-01', items: [
    { id_asignacion: ac.id, estado: 'En Reparacion' }, { id_asignacion: al.id, estado: 'Disponible' },
  ] });
  assert.equal(estadoDe('celulares', 'C00001').estado, 'En Reparacion');
  assert.equal(estadoDe('lineas', 'L00001').estado, 'Disponible');
});

test('AC-13 / AC-13.1: cambios manuales de estado permitidos', () => {
  cambioManualEstado(db, 'GRH', 'Celular', 'C00001', 'En Reparacion');
  assert.throws(() => cambioManualEstado(db, 'GRH', 'Linea', 'L00001', 'En Reparacion'), /Estado invalido/);
  asignar(db, 'GRH', { id_empleado: 'E2', id_linea: 'L00001', fecha_asignacion: '2026-02-01' });
  assert.throws(() => cambioManualEstado(db, 'GRH', 'Linea', 'L00001', 'Disponible'), /No se puede cambiar manualmente el estado "En Uso"/);
});

test('AC-07a / AC-16: historial inmutable con usuario y valores', () => {
  const [a] = asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', fecha_asignacion: '2026-02-01' });
  modificarObservacion(db, 'AGO', a.id, 'Con funda');
  const cambio = db.prepare("SELECT * FROM auditoria WHERE id_registro = ? AND campo = 'observacion' AND usuario = 'AGO'").get(a.id);
  assert.equal(cambio.valor_nuevo, 'Con funda');
  assert.throws(() => db.prepare('DELETE FROM auditoria').run(), /no puede borrarse/);
  assert.throws(() => db.prepare("UPDATE auditoria SET usuario = 'X'").run(), /no puede modificarse/);
  assert.throws(() => db.prepare('DELETE FROM asignaciones').run(), /no pueden borrarse/);
});

test('AC-06.1 / AC-20a: baja de empleado por interfaz devuelve con usuario INTERFACE', () => {
  asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', id_linea: 'L00001', fecha_asignacion: '2026-02-01' });
  const r = procesarPadron(db, [empleado('E2', 'JPE', 'Comercial', '2026-01-15')], PROCESO);
  assert.equal(r.devoluciones_generadas, 2);
  for (const a of asignacionesDe('E2')) assert.equal(a.fecha_devolucion, '2026-02-01', 'mayor entre baja y asignacion');
  assert.equal(estadoDe('celulares', 'C00001').estado, 'A Recuperar');
  assert.equal(estadoDe('lineas', 'L00001').estado, 'A Recuperar');
  const usuarios = db.prepare("SELECT DISTINCT usuario FROM auditoria WHERE operacion = 'Baja de empleado' OR operacion = 'Devolucion'").all();
  assert.deepEqual(usuarios.map((u) => u.usuario), ['INTERFACE']);
});

test('AC-20b: baja a futuro se descarta y se procesa cuando deja de ser futura', () => {
  asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', fecha_asignacion: '2026-02-01' });
  const r = procesarPadron(db, [empleado('E2', 'JPE', 'Comercial', '2026-12-31')], PROCESO);
  assert.equal(r.bajas_futuras_descartadas, 1);
  assert.equal(db.prepare("SELECT fecha_baja FROM empleados WHERE id_empleado = 'E2'").get().fecha_baja, null);
  assert.equal(asignacionesDe('E2')[0].fecha_devolucion, null);
  procesarPadron(db, [empleado('E2', 'JPE', 'Comercial', '2026-12-31')], '2026-12-31');
  assert.equal(asignacionesDe('E2')[0].fecha_devolucion, '2026-12-31');
});

test('AC-20c / AC-20d: ajustes y eliminacion de la baja no alteran las devoluciones', () => {
  asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', fecha_asignacion: '2026-02-01' });
  procesarPadron(db, [empleado('E2', 'JPE', 'Comercial', '2026-03-01')], PROCESO);
  const r = procesarPadron(db, [empleado('E2', 'JPE', 'Comercial', '2026-04-01')], PROCESO);
  assert.equal(r.devoluciones_generadas, 0);
  assert.equal(db.prepare("SELECT fecha_baja FROM empleados WHERE id_empleado = 'E2'").get().fecha_baja, '2026-04-01');
  assert.equal(asignacionesDe('E2')[0].fecha_devolucion, '2026-03-01');
  procesarPadron(db, [empleado('E2', 'JPE', 'Comercial', '')], PROCESO);
  assert.equal(asignacionesDe('E2')[0].fecha_devolucion, '2026-03-01');
  assert.equal(estadoDe('celulares', 'C00001').estado, 'A Recuperar');
  asignar(db, 'GRH', { id_empleado: 'E2', id_linea: 'L00001', fecha_asignacion: '2026-10-01' });
});

test('AC-20e / AC-20f: reingreso como alta nueva y baja sin asignaciones', () => {
  const r = procesarPadron(db, [empleado('E2', 'JPE', 'Comercial', '2026-03-01'), empleado('E9', 'JPE', 'Comercial')], PROCESO);
  assert.equal(r.altas, 1);
  assert.equal(r.devoluciones_generadas, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE usuario = 'INTERFACE'").get().n, 0);
});

test('AC-10 / AC-11 / AC-03.2: grillas filtran por columna y muestran datos actuales del padron', () => {
  asignar(db, 'GRH', { id_empleado: 'E2', id_celular: 'C00001', fecha_asignacion: '2026-02-01' });
  procesarPadron(db, [{ ...empleado('E2', 'JPE', 'Comercial'), nombre: 'Perez Juan', centro_costo: 'CC9' }], PROCESO);
  const r = consultarGrilla(db, 'asignaciones', { imei: '345671', centro_costo: 'cc9' });
  assert.equal(r.total, 1);
  assert.equal(r.filas[0].nombre, 'Perez Juan');
  assert.equal(consultarGrilla(db, 'celulares', { marca: 'motorola' }).total, 0);
  assert.equal(consultarGrilla(db, 'celulares', { marca: '50%' }).total, 0, 'el % del filtro no es comodin');
});
