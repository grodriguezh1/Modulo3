import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS empleados (
  id_empleado    TEXT PRIMARY KEY,
  legajo         TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  sector         TEXT,
  area           TEXT,
  gerencia       TEXT,
  sigla          TEXT,
  centro_costo   TEXT,
  fecha_alta     TEXT,
  fecha_baja     TEXT,
  -- RF-20: solo la primera fecha de baja recibida genera devoluciones
  baja_procesada INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_empleados_sigla ON empleados(sigla);

CREATE TABLE IF NOT EXISTS celulares (
  id           TEXT PRIMARY KEY,
  marca        TEXT NOT NULL,
  modelo       TEXT NOT NULL,
  imei         TEXT NOT NULL UNIQUE,
  fecha_compra TEXT NOT NULL,
  fecha_baja   TEXT,
  motivo_baja  TEXT CHECK (motivo_baja IN ('Rotura','Robo','Perdida','Obsolescencia','Cesion')),
  proveedor    TEXT NOT NULL,
  observacion  TEXT,
  estado       TEXT NOT NULL CHECK (estado IN ('En Uso','Disponible','En Reparacion','A Recuperar','Baja')),
  fecha_estado TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lineas (
  id           TEXT PRIMARY KEY,
  numero       TEXT NOT NULL UNIQUE,
  prestador    TEXT NOT NULL,
  nro_cuenta   TEXT NOT NULL,
  plan         TEXT NOT NULL,
  fecha_compra TEXT NOT NULL,
  fecha_baja   TEXT,
  motivo_baja  TEXT CHECK (motivo_baja IN ('Cesion','No necesaria')),
  nro_sim      TEXT NOT NULL,
  observacion  TEXT,
  estado       TEXT NOT NULL CHECK (estado IN ('En Uso','Disponible','A Recuperar','Baja')),
  fecha_estado TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asignaciones (
  id               TEXT PRIMARY KEY,
  id_empleado      TEXT NOT NULL REFERENCES empleados(id_empleado),
  tipo             TEXT NOT NULL CHECK (tipo IN ('Celular','Linea')),
  id_recurso       TEXT NOT NULL,
  fecha_asignacion TEXT NOT NULL,
  fecha_devolucion TEXT,
  observacion      TEXT,
  CHECK (fecha_devolucion IS NULL OR fecha_devolucion >= fecha_asignacion)
);
CREATE INDEX IF NOT EXISTS ix_asig_empleado ON asignaciones(id_empleado);
CREATE INDEX IF NOT EXISTS ix_asig_recurso ON asignaciones(tipo, id_recurso);
-- RF-03.7: un celular o linea no puede tener dos asignaciones vigentes
CREATE UNIQUE INDEX IF NOT EXISTS ux_asig_recurso_vigente ON asignaciones(tipo, id_recurso) WHERE fecha_devolucion IS NULL;
-- RF-03.6: un empleado tiene como maximo un celular y una linea vigentes
CREATE UNIQUE INDEX IF NOT EXISTS ux_asig_empleado_vigente ON asignaciones(id_empleado, tipo) WHERE fecha_devolucion IS NULL;

CREATE TABLE IF NOT EXISTS auditoria (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha_hora     TEXT NOT NULL,
  usuario        TEXT NOT NULL,
  entidad        TEXT NOT NULL,
  id_registro    TEXT NOT NULL,
  operacion      TEXT NOT NULL,
  campo          TEXT NOT NULL,
  valor_anterior TEXT,
  valor_nuevo    TEXT
);
CREATE INDEX IF NOT EXISTS ix_auditoria_registro ON auditoria(entidad, id_registro);

-- AC-16: nadie puede modificar ni borrar el historial de cambios
CREATE TRIGGER IF NOT EXISTS auditoria_sin_update BEFORE UPDATE ON auditoria
BEGIN SELECT RAISE(ABORT, 'El historial de cambios no puede modificarse'); END;
CREATE TRIGGER IF NOT EXISTS auditoria_sin_delete BEFORE DELETE ON auditoria
BEGIN SELECT RAISE(ABORT, 'El historial de cambios no puede borrarse'); END;
-- RF-03.3 / AC-07a: las bajas son logicas y las asignaciones no se borran
CREATE TRIGGER IF NOT EXISTS celulares_sin_delete BEFORE DELETE ON celulares
BEGIN SELECT RAISE(ABORT, 'Los celulares no pueden borrarse'); END;
CREATE TRIGGER IF NOT EXISTS lineas_sin_delete BEFORE DELETE ON lineas
BEGIN SELECT RAISE(ABORT, 'Las lineas no pueden borrarse'); END;
CREATE TRIGGER IF NOT EXISTS asignaciones_sin_delete BEFORE DELETE ON asignaciones
BEGIN SELECT RAISE(ABORT, 'Las asignaciones no pueden borrarse'); END;
`;

const VISTAS = `
DROP VIEW IF EXISTS v_asignaciones;
CREATE VIEW v_asignaciones AS
SELECT a.id, a.tipo, a.id_recurso,
       e.id_empleado, e.legajo, e.nombre, e.sigla, e.sector, e.area, e.centro_costo,
       e.fecha_baja AS fecha_baja_empleado,
       c.marca, c.modelo, c.imei,
       l.numero AS numero_linea, l.prestador, l.plan,
       a.fecha_asignacion, a.fecha_devolucion,
       CASE WHEN a.fecha_devolucion IS NULL THEN 'Vigente' ELSE 'Devuelta' END AS situacion,
       a.observacion
FROM asignaciones a
JOIN empleados e ON e.id_empleado = a.id_empleado
LEFT JOIN celulares c ON a.tipo = 'Celular' AND c.id = a.id_recurso
LEFT JOIN lineas l ON a.tipo = 'Linea' AND l.id = a.id_recurso;
`;

export function abrirDb(ruta = ':memory:') {
  if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (ruta !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);
  db.exec(VISTAS);
  return db;
}

// RF-14: prefijo + 5 caracteres [0-9a-z] en orden ascii creciente
const ALFABETO = '0123456789abcdefghijklmnopqrstuvwxyz';
export const PATRON_ID = /^[CLA][0-9a-z]{5}$/;

export function incrementarId(id) {
  const prefijo = id[0];
  const cuerpo = id.slice(1).split('');
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    const pos = ALFABETO.indexOf(cuerpo[i]);
    if (pos < ALFABETO.length - 1) {
      cuerpo[i] = ALFABETO[pos + 1];
      return prefijo + cuerpo.join('');
    }
    cuerpo[i] = ALFABETO[0];
  }
  throw new Error(`Se agoto la secuencia de IDs con prefijo ${prefijo}`);
}

// RF-14.1: la secuencia sigue desde el mayor id existente (incluidos los migrados)
export function siguienteId(db, tabla, prefijo) {
  const { mayor } = db
    .prepare(`SELECT MAX(id) AS mayor FROM ${tabla} WHERE id GLOB ?`)
    .get(prefijo + '[0-9a-z][0-9a-z][0-9a-z][0-9a-z][0-9a-z]');
  return mayor ? incrementarId(mayor) : prefijo + '00001';
}

export function enTransaccion(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
