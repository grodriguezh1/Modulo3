import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { abrirDb } from './db.js';
import { crearApp } from './server.js';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const db = abrirDb(process.env.DB_PATH ?? join(raiz, 'data', 'celulares.db'));
const puerto = Number(process.env.PORT ?? 3000);
crearApp(db).listen(puerto, () => console.log(`Aplicacion disponible en http://localhost:${puerto}`));
