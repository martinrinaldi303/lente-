// shell.js — la barra lateral y la barra de arriba de todas las pantallas, como las
// diseñó Martín en Stitch (UI/). Cada página llama a App.montar('vision', …) y recibe
// el usuario y el estado del cerebro. Sin sesión, manda a /cuenta.html.
//
// Lo que se muestra es lo que el cerebro dice de verdad (/salud, /api/yo): nada de
// números de ejemplo.

(() => {
  const MODULOS = [
    { id: 'vision', ruta: '/vision.html', icono: 'visibility', nombre: 'Visión', cola: '<span class="w-1.5 h-1.5 rounded-full bg-outline-variant" data-pip-vision></span>' },
    { id: 'objetos', ruta: '/objetos.html', icono: 'view_in_ar', nombre: 'Objetos detectados', cola: '<span class="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant" data-cuenta-objetos hidden></span>' },
    { id: 'ensenar', ruta: '/ensenar.html', icono: 'model_training', nombre: 'Enseñar objeto', cola: '<span class="font-label-sm text-label-sm px-1 rounded bg-secondary-container/20 text-secondary-fixed text-[9px] font-bold">FEW-SHOT</span>' },
    { id: 'conocidos', ruta: '/conocidos.html', icono: 'group', nombre: 'Personas conocidas', cola: '<span class="font-label-sm text-label-sm px-1 rounded bg-tertiary/10 text-tertiary text-[9px] font-bold">CON PERMISO</span>' },
    { id: 'historial', ruta: '/historial.html', icono: 'timeline', nombre: 'Historial', cola: '<span class="font-label-sm text-label-sm text-outline font-data-mono">LOGS</span>' },
    { id: 'configuracion', ruta: '/panel.html', icono: 'tune', nombre: 'Configuración', cola: '' },
  ];

  const $ = (sel, raiz = document) => raiz.querySelector(sel);

  function lateral(activo) {
    const items = MODULOS.map(m => {
      const actual = m.id === activo;
      return `<a class="flex items-center justify-between px-space-sm py-space-sm rounded transition-colors ${actual ? 'bg-surface-container-high text-primary font-medium' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}" href="${m.ruta}" ${actual ? 'aria-current="page"' : ''}>
        <span class="flex items-center gap-space-sm"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">${m.icono}</span><span class="font-body-md text-body-md">${m.nombre}</span></span>${m.cola}</a>`;
    }).join('');
    return `<aside id="lateral" class="fixed left-0 top-0 h-full w-64 bg-surface-container-lowest z-50 flex flex-col justify-between select-none shadow-[0_1px_8px_rgba(0,0,0,0.4)] -translate-x-full lg:translate-x-0 transition-transform">
      <div class="flex flex-col">
        <a href="/vision.html" class="h-14 px-space-lg flex items-center gap-space-sm">
          <span class="w-7 h-7 rounded bg-surface-container-high flex items-center justify-center text-primary"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">videocam</span></span>
          <span class="flex flex-col"><span class="flex items-center gap-space-xs"><span class="font-headline-sm text-headline-sm font-semibold tracking-wider text-primary">MIIA</span><span class="font-label-sm px-1 rounded bg-surface-container-high text-outline text-[10px] uppercase font-bold tracking-widest">CORE</span></span><span class="font-label-sm text-outline-variant tracking-wider uppercase text-[9px]">GLASSES AI HUD</span></span>
        </a>
        <div class="px-space-md py-space-xs"><div class="font-label-sm text-outline uppercase px-space-sm py-space-xs tracking-wider text-[10px]">Módulos de Sistema</div></div>
        <nav class="flex flex-col gap-space-xxs px-space-md">${items}</nav>
      </div>
      <div class="p-space-md m-space-md rounded bg-surface-container-low flex flex-col gap-space-sm">
        <div class="flex items-center justify-between"><span class="font-label-sm uppercase text-outline text-[10px]">Hardware Link</span><span class="font-data-mono text-data-mono text-outline-variant" data-version></span></div>
        <div class="flex items-center gap-space-sm"><span class="relative flex h-2 w-2"><span class="relative inline-flex rounded-full h-2 w-2 bg-outline-variant" data-pip-enlace></span></span><span class="font-label-md text-label-md text-on-surface font-semibold" data-enlace>—</span></div>
        <div class="flex items-center justify-between font-data-mono text-data-mono text-on-surface-variant"><span data-enlace-detalle>—</span></div>
      </div>
    </aside>
    <div id="velo" class="fixed inset-0 bg-black/50 z-40 hidden lg:hidden"></div>`;
  }

  function arriba(subtitulo) {
    return `<header class="fixed top-0 left-0 lg:left-64 right-0 h-14 bg-surface-container-lowest/90 backdrop-blur-md z-30 px-space-lg flex items-center justify-between gap-space-sm shadow-[0_1px_8px_rgba(0,0,0,0.3)]">
      <div class="flex items-center gap-space-md min-w-0">
        <button type="button" id="abrirMenu" class="lg:hidden h-8 w-8 rounded bg-surface-container flex items-center justify-center text-on-surface-variant" aria-label="Abrir el menú"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">menu</span></button>
        <span class="font-headline-sm text-headline-sm font-semibold text-on-surface tracking-tight whitespace-nowrap">MIIA Glasses</span>
        <span class="text-outline-variant hidden sm:inline">·</span>
        <span class="font-body-sm text-body-sm text-on-surface-variant truncate hidden sm:inline">${subtitulo}</span>
      </div>
      <div class="flex items-center gap-space-md">
        <div class="hidden xl:flex items-center gap-space-xs">
          <div class="flex items-center gap-space-xs px-space-sm py-space-xxs rounded bg-surface-container font-data-mono text-data-mono"><span class="w-1.5 h-1.5 rounded-full bg-outline-variant" data-pip-ws></span><span class="text-outline">WS:</span><span data-ws>—</span></div>
          <div class="flex items-center gap-space-xs px-space-sm py-space-xxs rounded bg-surface-container font-data-mono text-data-mono"><span class="text-outline">ENG:</span><span class="text-primary-fixed" data-motor>—</span></div>
          <div class="flex items-center gap-space-xs px-space-sm py-space-xxs rounded bg-surface-container font-data-mono text-data-mono"><span class="text-outline">LLM:</span><span class="text-secondary" data-llm>—</span></div>
        </div>
        <span class="hidden md:inline font-label-md text-label-md text-on-surface-variant" data-nombre></span>
        <a href="/panel.html" class="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-on-primary font-semibold" data-avatar title="Configuración">·</a>
        <button type="button" id="salir" class="h-7 px-space-sm rounded bg-error-container/20 text-error hover:bg-error-container hover:text-on-error font-label-sm text-label-sm flex items-center gap-1 transition-colors"><span class="material-symbols-outlined text-[14px]" aria-hidden="true">logout</span><span class="hidden sm:inline">Salir</span></button>
      </div>
    </header>
    <div id="avisos" class="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-[60] flex flex-col gap-space-xs pointer-events-none" aria-live="polite"></div>`;
  }

  async function api(metodo, ruta, cuerpo) {
    const r = await fetch(`/api/${ruta}`, {
      method: metodo,
      headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    const datos = await r.json().catch(() => ({}));
    if (r.status === 401) { location.replace('/cuenta.html'); throw new Error('Tenés que entrar con tu cuenta'); }
    if (!r.ok) throw new Error(datos.motivo || `El cerebro contestó ${r.status}`);
    return datos;
  }

  // Un cartel abajo a la derecha, que se va solo. tipo: 'ok' | 'error' | 'aviso'.
  function avisar(texto, tipo = 'aviso') {
    const colores = { ok: 'border-tertiary/40 text-tertiary-fixed', error: 'border-error/50 text-error', aviso: 'border-secondary-container/40 text-on-surface' };
    const el = document.createElement('div');
    el.className = `pointer-events-auto rounded bg-surface-container-high border px-space-md py-space-sm font-body-sm text-body-sm shadow-lg ${colores[tipo] ?? colores.aviso}`;
    el.textContent = texto;
    $('#avisos').append(el);
    setTimeout(() => el.remove(), tipo === 'error' ? 9000 : 6000);
  }

  // El enlace de abajo de la barra lateral: lo actualiza la página que tiene la conexión.
  function enlace({ estado, texto, detalle }) {
    const color = { conectado: 'bg-tertiary', conectando: 'bg-secondary', desconectado: 'bg-error' }[estado] ?? 'bg-outline-variant';
    $('[data-pip-enlace]').className = `relative inline-flex rounded-full h-2 w-2 ${color}`;
    $('[data-enlace]').textContent = texto;
    $('[data-enlace-detalle]').textContent = detalle ?? '';
    const pipVision = $('[data-pip-vision]');
    if (pipVision) pipVision.className = `w-1.5 h-1.5 rounded-full ${color}`;
    $('[data-pip-ws]').className = `w-1.5 h-1.5 rounded-full ${color}`;
    $('[data-ws]').textContent = { conectado: 'Conectado', conectando: 'Conectando', desconectado: 'Desconectado' }[estado] ?? '—';
    $('[data-ws]').className = estado === 'conectado' ? 'text-tertiary' : estado === 'desconectado' ? 'text-error' : 'text-on-surface';
  }

  async function montar(activo, { subtitulo = 'Visión aumentada en tiempo real' } = {}) {
    document.body.insertAdjacentHTML('afterbegin', lateral(activo) + arriba(subtitulo));
    const abrir = (si) => { $('#lateral').classList.toggle('-translate-x-full', !si); $('#velo').classList.toggle('hidden', !si); };
    $('#abrirMenu').onclick = () => abrir(true);
    $('#velo').onclick = () => abrir(false);
    $('#salir').onclick = async () => { try { await api('POST', 'salir', {}); } catch { /* igual se va */ } location.replace('/cuenta.html'); };

    const [yo, salud] = await Promise.all([api('GET', 'yo'), fetch('/salud').then(r => r.json()).catch(() => ({}))]);
    const u = yo.usuario;
    $('[data-nombre]').textContent = u.nombre;
    $('[data-avatar]').textContent = (u.nombre.trim()[0] || '·').toUpperCase();
    $('[data-motor]').textContent = [salud.detector && (salud.detector_nombre ?? 'YOLOS-tiny'), salud.red_general && (salud.red_general.votantes.some(v => v.fuente.startsWith('dino')) ? 'DINOv2' : 'redes propias')].filter(Boolean).join(' + ') || 'sin detector';
    $('[data-llm]').textContent = salud.llm === 'gemini' ? 'Gemini Live' : salud.llm === 'deepseek' ? 'DeepSeek' : 'apagado';
    $('[data-version]').textContent = salud.base ? 'MySQL ON' : 'MySQL OFF';
    const conectados = yo.anteojos.filter(a => a.conectado).length;
    enlace({ estado: conectados ? 'conectado' : undefined, texto: conectados ? `${conectados} anteojo${conectados > 1 ? 's' : ''} conectado${conectados > 1 ? 's' : ''}` : 'Ningún anteojo conectado', detalle: `${yo.anteojos.length} vinculado${yo.anteojos.length === 1 ? '' : 's'}` });
    api('GET', 'objetos').then(({ objetos }) => {
      const b = $('[data-cuenta-objetos]');
      if (b && objetos.length) { b.textContent = objetos.length; b.hidden = false; }
    }).catch(() => {});
    return { yo, salud };
  }

  window.App = { montar, api, avisar, enlace };
})();
