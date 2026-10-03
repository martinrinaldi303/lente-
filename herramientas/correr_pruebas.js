// correr_pruebas.js — `npm test`: corre pruebas/*.test.js con el corredor de Node.
//
// Existe porque cada versión de Node entiende otra cosa: Node 20 no expande comodines
// («pruebas/*.test.js» no encuentra nada) y Node 22 ya no acepta una carpeta. Acá la
// lista de archivos se arma a mano y anda con las dos.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'pruebas');
const archivos = readdirSync(dir).filter(f => f.endsWith('.test.js')).sort().map(f => join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...archivos], { stdio: 'inherit' });
process.exit(r.status ?? 1);
