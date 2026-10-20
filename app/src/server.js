import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { consultarGrilla, exportarXlsx, LIMITE_PANTALLA } from './grillas.js';
import { leerCsvPadron, procesarPadron } from './rrhh.js';
import {
  ErrorNegocio, RECURSOS, altaRecurso, asignar, bajaRecurso, cambioManualEstado, devolver,
  modificarObservacion, modificarRecurso, obtenerRecurso, validarIngreso,
} from './servicios.js';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const TIPOS = { celulares: 'Celular', lineas: 'Linea' };

export function crearApp(db) {
  const app = express();
  const sesiones = new Map();

  app.use(express.json());
  app.use(express.static(join(raiz, 'public')));

  const tokenDe = (req) => (req.headers.cookie ?? '').match(/(?:^|;\s*)sesion=([\w-]+)/)?.[1];

  app.post('/api/login', (req, res) => {
    const empleado = validarIngreso(db, req.body?.sigla);
    if (!empleado) {
      return res.status(401).json({ error: 'Sigla no habilitada: debe ser un empleado activo del area Sistemas' });
    }
    const token = randomUUID();
    sesiones.set(token, empleado.sigla);
    res.setHeader('Set-Cookie', `sesion=${token}; HttpOnly; SameSite=Strict; Path=/`);
    res.json({ sigla: empleado.sigla, nombre: empleado.nombre });
  });

  app.post('/api/logout', (req, res) => {
    sesiones.delete(tokenDe(req));
    res.setHeader('Set-Cookie', 'sesion=; Max-Age=0; Path=/');
    res.json({ ok: true });
  });

  // Toda la API exige sesion; se revalida contra el padron en cada pedido
  app.use('/api', (req, res, next) => {
    const sigla = sesiones.get(tokenDe(req));
    const empleado = sigla && validarIngreso(db, sigla);
    if (!empleado) {
      sesiones.delete(tokenDe(req));
      return res.status(401).json({ error: 'Sesion vencida o usuario no habilitado' });
    }
    req.usuario = empleado.sigla;
    req.empleado = empleado;
    next();
  });

  const tipoDe = (req) => {
    const tipo = TIPOS[req.params.tipo];
    if (!tipo) throw new ErrorNegocio('Recurso inexistente', 404);
    return tipo;
  };

  app.get('/api/sesion', (req, res) => res.json({ sigla: req.usuario, nombre: req.empleado.nombre }));

  app.get('/api/opciones', (req, res) => {
    res.json(Object.fromEntries(Object.entries(RECURSOS).map(([tipo, cfg]) => [tipo, {
      motivosBaja: cfg.motivosBaja, estadosManuales: cfg.estadosManuales, estadosDevolucion: cfg.estadosDevolucion,
    }])));
  });

  app.get('/api/grillas/:nombre', (req, res) => {
    const resultado = consultarGrilla(db, req.params.nombre, req.query, { limite: LIMITE_PANTALLA });
    if (!resultado) throw new ErrorNegocio('Grilla inexistente', 404);
    res.json(resultado);
  });

  app.get('/api/grillas/:nombre/xlsx', (req, res, next) => {
    const resultado = consultarGrilla(db, req.params.nombre, req.query);
    if (!resultado) throw new ErrorNegocio('Grilla inexistente', 404);
    exportarXlsx(resultado).then((buffer) => {
      const archivo = `${req.params.nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
      res.send(Buffer.from(buffer));
    }).catch(next);
  });

  app.get('/api/empleados/activos', (req, res) => {
    res.json(db.prepare(`SELECT id_empleado, legajo, nombre, sigla FROM empleados
      WHERE fecha_baja IS NULL ORDER BY nombre`).all());
  });

  app.get('/api/empleados/:id/vigentes', (req, res) => {
    res.json(db.prepare(`SELECT * FROM v_asignaciones WHERE id_empleado = ? AND situacion = 'Vigente'
      ORDER BY tipo`).all(req.params.id));
  });

  app.get('/api/recursos/:tipo/disponibles', (req, res) => {
    const tipo = tipoDe(req);
    const descripcion = tipo === 'Celular'
      ? "marca || ' ' || modelo || ' - IMEI ' || imei" : "numero || ' - ' || prestador || ' - ' || plan";
    res.json(db.prepare(`SELECT id, ${descripcion} AS descripcion, fecha_compra, fecha_estado
      FROM ${RECURSOS[tipo].tabla} WHERE estado = 'Disponible' ORDER BY id`).all());
  });

  app.get('/api/recursos/:tipo/:id', (req, res) => res.json(obtenerRecurso(db, tipoDe(req), req.params.id)));
  app.post('/api/recursos/:tipo', (req, res) => res.status(201).json(altaRecurso(db, req.usuario, tipoDe(req), req.body)));
  app.put('/api/recursos/:tipo/:id', (req, res) => res.json(modificarRecurso(db, req.usuario, tipoDe(req), req.params.id, req.body)));
  app.post('/api/recursos/:tipo/:id/baja', (req, res) => res.json(bajaRecurso(db, req.usuario, tipoDe(req), req.params.id, req.body)));
  app.post('/api/recursos/:tipo/:id/estado', (req, res) => res.json(cambioManualEstado(db, req.usuario, tipoDe(req), req.params.id, req.body?.estado)));

  app.post('/api/asignaciones', (req, res) => res.status(201).json(asignar(db, req.usuario, req.body)));
  app.put('/api/asignaciones/:id/observacion', (req, res) => res.json(modificarObservacion(db, req.usuario, req.params.id, req.body?.observacion)));
  app.post('/api/devoluciones', (req, res) => res.json(devolver(db, req.usuario, req.body)));

  app.post('/api/interfaz/rrhh', express.text({ type: '*/*', limit: '20mb' }), (req, res) => {
    let filas;
    try {
      filas = leerCsvPadron(req.body ?? '');
    } catch (e) {
      throw new ErrorNegocio(e.message);
    }
    res.json(procesarPadron(db, filas));
  });

  app.use((err, req, res, next) => {
    if (err instanceof ErrorNegocio) return res.status(err.status).json({ error: err.message });
    if (/UNIQUE constraint failed: asignaciones/.test(err.message)) {
      return res.status(409).json({ error: 'El celular o la linea ya fue asignado por otro operador' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error interno: ' + err.message });
  });

  return app;
}

