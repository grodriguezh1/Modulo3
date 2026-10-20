# Asignacion de celulares (PRD-001 V3)

Aplicacion web para el inventario de celulares y lineas y su asignacion a empleados.
Node.js 22.13+ con Express y SQLite (`node:sqlite`), sin compilacion.

## Uso

```bash
npm install
npm run seed    # padron de ejemplo (usuario GRH) y 3 celulares + 3 lineas de prueba
npm start       # http://localhost:3000
npm test        # pruebas de los criterios de aceptacion
```

Ingresar con la sigla **GRH**. Solo pueden ingresar empleados activos con area "Sistemas" (RF-00).
En el padron de ejemplo, JPE y MLO no son de Sistemas y CDI esta dado de baja.

La base queda en `data/celulares.db` (cambiar con `DB_PATH`); para empezar de cero, borrar `data/` y volver a correr `npm run seed`.

## Interfaz RRHH

En la pestana "Interfaz RRHH" se sube el padron completo en CSV (`;` o `,`) con el encabezado
`id_empleado;legajo;nombre;sector;area;gerencia;sigla;centro_costo;fecha_alta;fecha_baja`.
`muestras/padron-con-baja.csv` da de baja a JPE (dispara la devolucion automatica) e informa una baja a futuro para MLO (se descarta).

## Estructura

- `src/db.js`: esquema, triggers de inmutabilidad e IDs (RF-14).
- `src/servicios.js`: reglas de negocio (altas, bajas, asignaciones, devoluciones, estados, auditoria).
- `src/rrhh.js`: procesamiento de la interfaz de RRHH (RF-18, RF-20).
- `src/grillas.js`: consultas con filtro por columna y exportacion a Excel.
- `src/server.js`: API HTTP y sesion; `src/index.js` arranca el servidor.
- `public/`: interfaz web.
