import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { abrirBase } from '../src/base.js';
import { Cuentas, rutasDeCuentas } from '../src/cuentas.js';
import { Memoria } from '../src/memoria.js';
import { filtrosDeHistorial, rutasDeApp } from '../src/rutas_app.js';

test('los filtros del historial: siempre el usuario primero, y el texto escapado', () => {
  assert.deepEqual(filtrosDeHistorial({}, 7), { donde: 'ev.usuario_id = ? AND 1 = 1', valores: [7] });
  const f = filtrosDeHistorial({ periodo: 'hoy', min: '0.95', q: '50%_off' }, 7);
  assert.match(f.donde, /^ev\.usuario_id = \? AND ev\.cuando >= CURDATE\(\) AND \(ev\.confianza IS NULL OR ev\.confianza >= \?\) AND ev\.nombre LIKE \?$/);
  assert.deepEqual(f.valores, [7, 0.95, '%50\\%\\_off%']);
  // Un período inventado no se cuela en el SQL.
  assert.equal(filtrosDeHistorial({ periodo: '1=1; DROP TABLE x' }, 7).donde, 'ev.usuario_id = ? AND 1 = 1');
  assert.equal(filtrosDeHistorial({ min: 'mucho' }, 7).valores.length, 1);
});

try { process.loadEnvFile('.env'); } catch { /* sin .env: se saltea */ }
const base = await abrirBase({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
}, () => {});
const saltear = base ? false : 'MySQL apagado o sin DB_* en .env';
const marca = randomBytes(4).toString('hex');

test('historial y objetos de punta a punta: cada uno ve sólo lo suyo', { skip: saltear }, async () => {
  const cuentas = new Cuentas(base.pool);
  const memorias = new Map();
  const memoriaDe = (id) => { if (!memorias.has(id)) memorias.set(id, new Memoria()); return memorias.get(id); };
  const app = express().use('/api', rutasDeApp({ cuentas, memoriaDe })).use('/api', rutasDeCuentas({ cuentas }));
  const servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const url = `http://127.0.0.1:${servidor.address().port}/api`;
  const entrar = async (quien) => {
    const r = await fetch(`${url}/registro`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: quien, correo: `${quien}-${marca}@prueba.invalid`, clave: 'clave-de-prueba' }) });
    const datos = await r.json();
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return { id: datos.usuario.id, pedir: async (ruta, metodo = 'GET') => { const x = await fetch(`${url}/${ruta}`, { method: metodo, headers: { Cookie: cookie } }); return { estado: x.status, datos: await x.json() }; } };
  };
  try {
    const ana = await entrar('ana'), beto = await entrar('beto');
    const n = (s) => `${s}_${marca}`;
    // Lo que anotaron los anteojos de Ana (y uno de Beto, que Ana no tiene que ver).
    const q = (sql, v) => base.pool.query(sql, v);
    await q('INSERT INTO reconocimientos (usuario_id, cuando, nombre, confianza, origen, color) VALUES (?, NOW(3) - INTERVAL 2 DAY, ?, 0.80, ?, NULL), (?, NOW(3) - INTERVAL 3 SECOND, ?, 0.97, ?, ?), (?, NOW(3), ?, 0.99, ?, NULL)',
            [ana.id, n('taza'), 'general', ana.id, n('celular'), 'ensenado', 'negro', beto.id, n('secreto'), 'general']);
    await q('INSERT INTO mediciones (usuario_id, cuando, objeto, distancia_m, velocidad_kmh, llegada_s, metodo) VALUES (?, NOW(3) - INTERVAL 2 SECOND, ?, 12.5, 20, 2.2, ?)', [ana.id, n('auto'), 'tamano_aparente']);
    await q("INSERT INTO identificaciones (usuario_id, cuando, tipo, marca, modelo, seguridad, respuesta) VALUES (?, NOW(3) - INTERVAL 1 SECOND, 'celular', 'Apple', ?, 'media', '{}')", [ana.id, n('iPhone')]);

    const todo = await ana.pedir('historial');
    assert.equal(todo.estado, 200);
    assert.equal(todo.datos.total, 4);
    assert.deepEqual(todo.datos.eventos.map(e => e.tipo), ['identificacion', 'medicion', 'reconocimiento', 'reconocimiento']);   // lo más nuevo primero
    assert.ok(!todo.datos.eventos.some(e => e.nombre === n('secreto')));                                                       // lo de Beto, no
    assert.ok(!('usuario_id' in todo.datos.eventos[0]));
    const med = todo.datos.eventos[1];
    assert.deepEqual([med.nombre, med.distancia_m, med.velocidad_kmh, med.llegada_s], [n('auto'), 12.5, 20, 2.2]);
    assert.equal(todo.datos.eventos[0].marca, 'Apple');

    assert.equal((await ana.pedir('historial?periodo=hora')).datos.total, 3);                 // sin la taza de hace dos días
    assert.equal((await ana.pedir('historial?min=0.9')).datos.total, 3);                      // la taza al 80 % no; lo que no tiene confianza, sí
    assert.deepEqual((await ana.pedir(`historial?q=${n('celu').slice(0, 4)}`)).datos.eventos.map(e => e.nombre).filter(x => x === n('celular')), [n('celular')]);
    const resumen = await ana.pedir('historial/resumen');
    assert.deepEqual(resumen.datos.hoy, { eventos: 3, objetos: 1, identificaciones: 1, mediciones: 1 });
    assert.equal((await beto.pedir('historial')).datos.total, 1);

    // Sin sesión, nada.
    assert.equal((await fetch(`${url}/historial`)).status, 401);
    // Borrar el historial de Ana no toca el de Beto.
    assert.equal((await ana.pedir('historial', 'DELETE')).datos.borrados, 4);
    assert.equal((await ana.pedir('historial')).datos.total, 0);
    assert.equal((await beto.pedir('historial')).datos.total, 1);

    // La memoria de objetos, también por usuario.
    memoriaDe(ana.id).marcarLugar('cocina');
    memoriaDe(ana.id).vi('llaves', 0.93);
    memoriaDe(ana.id).vi('persona', 0.99);                                                    // nunca se recuerda
    const objetos = await ana.pedir('objetos');
    assert.deepEqual(objetos.datos.objetos.map(o => [o.objeto, o.lugar, o.confianza]), [['llaves', 'cocina', 0.93]]);
    assert.equal(objetos.datos.lugar, 'cocina');
    assert.equal((await ana.pedir('objetos/donde?nombre=las%20llaves')).datos.frase, 'llaves: recién, en cocina');
    assert.deepEqual((await beto.pedir('objetos')).datos.objetos, []);
    assert.equal((await ana.pedir('objetos', 'DELETE')).estado, 200);
    assert.deepEqual((await ana.pedir('objetos')).datos.objetos, []);
  } finally {
    servidor.close();
    const [usuarios] = await base.pool.query('SELECT id FROM usuarios WHERE correo LIKE ?', [`%-${marca}@prueba.invalid`]);
    for (const { id } of usuarios) {
      for (const t of ['reconocimientos', 'identificaciones', 'mediciones']) await base.pool.query(`DELETE FROM ${t} WHERE usuario_id = ?`, [id]);
      await base.pool.query('DELETE FROM usuarios WHERE id = ?', [id]);
    }
  }
});

test('cerrar la base de las pruebas del panel', { skip: saltear }, async () => { await base.cerrar(); });
