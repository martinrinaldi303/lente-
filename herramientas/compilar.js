// compilar.js — compila cpp/entrenar.cpp.   npm run compilar
//
// Busca g++ en el PATH y, si no está, en las carpetas de MSYS2 (que es donde está
// en esta PC: C:\msys64). Enlaza estático, así el .exe corre desde cualquier
// consola sin depender de las DLL de MSYS2.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const EXE  = process.platform === 'win32' ? '.exe' : '';
export const BINARIO = join(RAIZ, 'cpp', 'entrenar' + EXE);

const CANDIDATOS = [
  'g++',
  'C:\\msys64\\ucrt64\\bin\\g++.exe',
  'C:\\msys64\\mingw64\\bin\\g++.exe',
  'C:\\mingw64\\bin\\g++.exe',
];

function buscarCompilador() {
  for (const c of CANDIDATOS) {
    if (c !== 'g++' && !existsSync(c)) continue;
    // g++ de MSYS2 necesita su propia carpeta en el PATH para encontrar cc1plus.
    const env = c === 'g++' ? process.env : { ...process.env, PATH: dirname(c) + delimiter + process.env.PATH };
    const r = spawnSync(c, ['--version'], { env, encoding: 'utf8' });
    if (r.status === 0) return { comando: c, env, version: r.stdout.split('\n')[0] };
  }
  return null;
}

export function compilar() {
  const cc = buscarCompilador();
  if (!cc) {
    console.error('❌ No encontré g++. Instalá MSYS2 (https://www.msys2.org) y, en su consola:');
    console.error('   pacman -S mingw-w64-ucrt-x86_64-gcc');
    return false;
  }
  console.log(`Compilando con ${cc.version}`);
  const r = spawnSync(cc.comando,
    ['-std=c++17', '-O2', '-Wall', '-Wextra', '-static', '-o', BINARIO, join(RAIZ, 'cpp', 'entrenar.cpp')],
    { env: cc.env, stdio: 'inherit' });
  if (r.status !== 0) { console.error('❌ La compilación falló.'); return false; }
  console.log(`✅ ${BINARIO}`);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(compilar() ? 0 : 1);
