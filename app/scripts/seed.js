// Carga el padron de ejemplo (con el usuario GRH) y algunos celulares y lineas de prueba
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { abrirDb } from '../src/db.js';
import { leerCsvPadron, procesarPadron } from '../src/rrhh.js';
import { altaRecurso } from '../src/servicios.js';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const db = abrirDb(process.env.DB_PATH ?? join(raiz, 'data', 'celulares.db'));

const padron = leerCsvPadron(readFileSync(join(raiz, 'muestras', 'padron-inicial.csv'), 'utf8'));
console.log('Padron:', procesarPadron(db, padron));

const { cantidad } = db.prepare('SELECT COUNT(*) AS cantidad FROM celulares').get();
if (cantidad === 0) {
  const celulares = [
    { marca: 'Samsung', modelo: 'Galaxy A55', imei: '356789012345671', fecha_compra: '2026-01-15', proveedor: 'Distribuidora Sur' },
    { marca: 'Motorola', modelo: 'Moto G85', imei: '356789012345672', fecha_compra: '2026-02-10', proveedor: 'Distribuidora Sur' },
    { marca: 'Apple', modelo: 'iPhone 16', imei: '356789012345673', fecha_compra: '2026-03-05', proveedor: 'Tecno Import' },
  ];
  const lineas = [
    { numero: '1150001001', prestador: 'Personal', nro_cuenta: 'CTA-778', plan: 'Corporativo 20GB', fecha_compra: '2026-01-15', nro_sim: '8954000000000000001' },
    { numero: '1150001002', prestador: 'Personal', nro_cuenta: 'CTA-778', plan: 'Corporativo 20GB', fecha_compra: '2026-01-15', nro_sim: '8954000000000000002' },
    { numero: '1150001003', prestador: 'Claro', nro_cuenta: 'CL-1020', plan: 'Empresa 10GB', fecha_compra: '2026-04-01', nro_sim: '8954000000000000003' },
  ];
  for (const c of celulares) altaRecurso(db, 'GRH', 'Celular', c);
  for (const l of lineas) altaRecurso(db, 'GRH', 'Linea', l);
  console.log(`Se cargaron ${celulares.length} celulares y ${lineas.length} lineas de prueba`);
}
console.log('Listo. Ingresar con la sigla GRH.');
