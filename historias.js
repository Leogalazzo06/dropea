// ============================================================
// HISTORIAS DE PRODUCTO (estilo Instagram)
// Módulo compartido: lo usan la web principal, la tienda pública y la
// vista previa del dashboard.
//
// Depende de supabase-client.js (supabase, formatoPrecio,
// calcularDescuentoPorcentaje, IMAGEN_PRODUCTO_DEFAULT, calcularEstadoAcceso).
// Cargar DESPUÉS de supabase-client.js.
//
// API:
//   Historias.montarBarra(contenedor, { emprendedorId?, titulo? })
//       Dibuja la fila de círculos (un círculo por comercio con historias activas).
//   Historias.enlazarAvatar(elemento, emprendedorId, { onProducto? })
//       Le pone un aro animado y una insignia "Historia" al avatar de una tienda y abre
//       sus historias al tocarlo. Con { insignia: false } se omite la insignia.
//   Historias.vistaPrevia(emprendedorId)
//       Abre el visor con las historias de un comercio (lo usa el dashboard).
//   Historias.cerrar()
// ============================================================
var Historias = (function () {
    'use strict';

    var DURACION_MS = 5500;                       // cuánto dura cada historia en pantalla
    var CLAVE_VISTAS = 'dropea_historias_vistas';
    var SELECT = 'id, emprendedor_id, producto_id, created_at, expira_en, ' +
        'productos(id, nombre, precio, precio_anterior, imagen_url, imagen_thumb_url, activo), ' +
        'emprendedores(id, nombre_tienda, logo_url, activo, suscripcion_estado, fecha_vencimiento_suscripcion, created_at, solo_beneficios, usuarios(usuario))';

    // ---------- utilidades ----------
    function h(tag, clase, texto) {
        var n = document.createElement(tag);
        if (clase) n.className = clase;
        if (texto !== undefined && texto !== null) n.textContent = texto;
        return n;
    }

    // Solo http/https (los links los carga el comercio)
    function seg(valor) {
        var v = String(valor || '').trim();
        if (!v) return '';
        try {
            var u = new URL(v, window.location.href);
            return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
        } catch (e) { return ''; }
    }

    function leerVistas() {
        try { return new Set(JSON.parse(localStorage.getItem(CLAVE_VISTAS) || '[]')); }
        catch (e) { return new Set(); }
    }
    function marcarVista(id) {
        try {
            var s = leerVistas();
            s.add(String(id));
            // se guardan solo las últimas 300 para que no crezca para siempre
            localStorage.setItem(CLAVE_VISTAS, JSON.stringify(Array.from(s).slice(-300)));
        } catch (e) { /* sin storage: no pasa nada */ }
    }

    function hace(iso) {
        var min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
        if (min < 1) return 'Ahora';
        if (min < 60) return 'Hace ' + min + ' min';
        return 'Hace ' + Math.floor(min / 60) + ' h';
    }

    function fotoProducto(p) {
        return seg(p && p.imagen_url) || (typeof IMAGEN_PRODUCTO_DEFAULT !== 'undefined' ? IMAGEN_PRODUCTO_DEFAULT : '');
    }

    function urlProducto(g, productoId) {
        return '/tienda/' + encodeURIComponent(g.usuario) + '?producto=' + encodeURIComponent(productoId);
    }

    // ---------- datos ----------
    // Devuelve [{ emprendedorId, nombre, logo, usuario, items: [historia...] }]
    async function traer(emprendedorId, opciones) {
        opciones = opciones || {};
        var q = supabase.from('historias').select(SELECT)
            .gt('expira_en', new Date().toISOString())
            .order('created_at', { ascending: true });
        if (emprendedorId) q = q.eq('emprendedor_id', emprendedorId);

        var res = await q;
        if (res.error) { console.error('Error cargando historias:', res.error); return []; }

        var mapa = new Map();
        (res.data || []).forEach(function (it) {
            var e = it.emprendedores, p = it.productos;
            if (!e || !p || p.activo === false) return;                        // producto oculto / sin stock
            if (!opciones.incluirBloqueadas && typeof calcularEstadoAcceso === 'function' && calcularEstadoAcceso(e).bloqueado) return;
            var usuario = e.usuarios && e.usuarios.usuario;
            if (!usuario) return;
            var clave = String(e.id);
            if (!mapa.has(clave)) {
                mapa.set(clave, {
                    emprendedorId: e.id,
                    nombre: (e.nombre_tienda || '').trim() || usuario,
                    logo: seg(e.logo_url),
                    usuario: usuario,
                    items: [],
                });
            }
            mapa.get(clave).items.push(it);
        });

        var grupos = Array.from(mapa.values());
        // Los comercios con la historia más reciente van primero
        grupos.sort(function (a, b) {
            return new Date(b.items[b.items.length - 1].created_at) - new Date(a.items[a.items.length - 1].created_at);
        });
        return grupos;
    }

    function grupoVisto(g, vistas) {
        return g.items.every(function (it) { return vistas.has(String(it.id)); });
    }
    function primerNoVisto(g) {
        var vistas = leerVistas();
        var i = g.items.findIndex(function (it) { return !vistas.has(String(it.id)); });
        return i === -1 ? 0 : i;
    }

    // ---------- estilos ----------
    function inyectarEstilos() {
        if (document.getElementById('hs-estilos')) return;
        var s = document.createElement('style');
        s.id = 'hs-estilos';
        s.textContent = [
            /* Barra de círculos */
            '.hs-lista{display:flex;gap:14px;overflow-x:auto;padding:4px 2px 8px;scrollbar-width:none;-ms-overflow-style:none}',
            '.hs-lista::-webkit-scrollbar{display:none}',
            '.hs-item{flex:0 0 auto;width:72px;display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}',
            '.hs-aro{width:68px;height:68px;border-radius:9999px;padding:3px;background:linear-gradient(135deg,#93c5fd,#2563eb 55%,#1e3a8a);transition:transform .15s ease}',
            '.hs-item:active .hs-aro{transform:scale(.93)}',
            '.hs-item.visto .hs-aro{background:#d4d4d8}',
            '.hs-aro-in{position:relative;width:100%;height:100%;border-radius:9999px;border:3px solid #fff;background:#09090b;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#60a5fa;font-weight:900;font-size:22px}',
            '.hs-aro-in img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
            '.hs-nombre{max-width:72px;font-size:11px;font-weight:700;color:#18181b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.hs-titulo{font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#71717a;margin:0 0 8px}',
            /* Aro sobre un avatar existente (tienda pública) */
            '.hs-anillo{cursor:pointer;transition:transform .15s ease}',
            '.hs-anillo:active{transform:scale(.97)}',
            '.hs-anillo::before{content:"";position:absolute;inset:-4px;padding:4px;border-radius:9999px;background:conic-gradient(#2563eb,#93c5fd,#2563eb,#1e3a8a,#2563eb);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);pointer-events:none;animation:hs-aro-giro 4s linear infinite}',
            '.hs-anillo.visto::before{background:#d4d4d8;animation:none}',
            '@keyframes hs-aro-giro{to{transform:rotate(360deg)}}',
            '.hs-anillo:focus-visible{outline:3px solid #000;outline-offset:8px}',
            /* Insignia "Historia" bajo el avatar */
            '.hs-insignia{position:absolute;left:50%;bottom:-14px;transform:translateX(-50%);z-index:2;display:inline-flex;align-items:center;gap:5px;padding:4px 10px 4px 8px;border-radius:9999px;border:3px solid #fff;background:linear-gradient(135deg,#2563eb,#1e3a8a);color:#fff;font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;line-height:1;white-space:nowrap;box-shadow:0 4px 10px -2px rgba(37,99,235,.45)}',
            '.hs-insignia svg{width:9px;height:9px;fill:currentColor}',
            '.hs-anillo:not(.visto) .hs-insignia{animation:hs-insignia-latido 2.2s ease-in-out infinite}',
            '@keyframes hs-insignia-latido{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.07)}}',
            '.hs-anillo.visto .hs-insignia{background:#a1a1aa;box-shadow:none}',
            '@media (prefers-reduced-motion:reduce){.hs-anillo::before,.hs-anillo .hs-insignia{animation:none !important}}',
            /* Visor */
            '.hs-visor{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(9,9,11,.94);opacity:0;visibility:hidden;transition:opacity .2s ease,visibility 0s linear .2s;font-family:inherit}',
            '.hs-visor.abierto{opacity:1;visibility:visible;transition:opacity .2s ease}',
            'html.hs-abierto{overflow:hidden}',
            '.hs-escenario{position:relative;overflow:hidden;background:#09090b;color:#fff;height:min(100dvh,880px);aspect-ratio:9/16;max-width:100vw;border-radius:22px;box-shadow:0 30px 80px -10px rgba(0,0,0,.6);user-select:none;-webkit-user-select:none;touch-action:pan-x;transform:scale(.97);transition:transform .25s cubic-bezier(.16,1,.3,1)}',
            '.hs-visor.abierto .hs-escenario{transform:scale(1)}',
            '@media (max-width:640px){.hs-escenario{width:100vw;height:100dvh;aspect-ratio:auto;border-radius:0}}',
            '.hs-fondo{position:absolute;inset:-10%;width:120%;height:120%;object-fit:cover;filter:blur(32px) brightness(.5) saturate(1.2);transform:scale(1.1)}',
            '.hs-velo{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.55) 0,rgba(0,0,0,0) 22%,rgba(0,0,0,0) 48%,rgba(0,0,0,.82) 100%);pointer-events:none}',
            '.hs-foto-wrap{position:absolute;left:20px;right:20px;top:104px;bottom:208px;display:flex;align-items:center;justify-content:center;transition:opacity .2s ease;pointer-events:none;outline:0;-webkit-tap-highlight-color:transparent}',
            '.hs-escenario.cargando .hs-foto-wrap{opacity:0}',
            '.hs-foto{max-width:100%;max-height:100%;object-fit:contain;border-radius:22px;background:#fff;box-shadow:0 22px 50px -12px rgba(0,0,0,.55);pointer-events:auto;cursor:pointer;transition:transform .2s ease}',
            '.hs-foto:active{transform:scale(.985)}',
            '.hs-foto-wrap:focus-visible .hs-foto{outline:3px solid #fff;outline-offset:4px}',
            '.hs-spinner{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:9999px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;animation:hs-giro .7s linear infinite;opacity:0;pointer-events:none}',
            '.hs-escenario.cargando .hs-spinner{opacity:1}',
            '@keyframes hs-giro{to{transform:rotate(360deg)}}',
            '.hs-top{position:absolute;left:0;right:0;top:0;padding:calc(12px + env(safe-area-inset-top)) 14px 0;z-index:3}',
            '.hs-barras{display:flex;gap:4px}',
            '.hs-barra{flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.3);overflow:hidden}',
            '.hs-barra-f{height:100%;background:#fff;transform:scaleX(0);transform-origin:left}',
            '.hs-barra.lleno .hs-barra-f{transform:scaleX(1)}',
            '@keyframes hs-llenar{to{transform:scaleX(1)}}',
            '.hs-visor.pausa .hs-barra-f{animation-play-state:paused !important}',
            '.hs-cab{display:flex;align-items:center;gap:10px;margin-top:12px}',
            '.hs-cab-logo{position:relative;width:38px;height:38px;border-radius:9999px;background:#000;border:2px solid #fff;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#60a5fa;font-weight:900;font-size:15px}',
            '.hs-cab-logo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
            '.hs-cab-txt{min-width:0;flex:1;text-decoration:none;color:#fff}',
            '.hs-cab-nombre{font-size:14px;font-weight:800;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.hs-cab-tiempo{font-size:11px;font-weight:600;color:rgba(255,255,255,.7);margin-top:2px}',
            '.hs-cerrar{width:36px;height:36px;border-radius:9999px;border:0;background:rgba(0,0,0,.35);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background .15s}',
            '.hs-cerrar:hover{background:rgba(0,0,0,.6)}',
            '.hs-pie{position:absolute;left:0;right:0;bottom:0;padding:0 14px calc(18px + env(safe-area-inset-bottom));z-index:3}',
            '.hs-card{display:flex;align-items:center;gap:14px;padding:14px 14px 14px 18px;border-radius:24px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);-webkit-backdrop-filter:blur(20px) saturate(1.5);backdrop-filter:blur(20px) saturate(1.5);box-shadow:0 18px 40px -16px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.18);color:#fff;text-decoration:none;cursor:pointer;transition:background .15s ease,transform .15s ease;-webkit-tap-highlight-color:transparent}',
            '.hs-card:hover{background:rgba(255,255,255,.2)}',
            '.hs-card:active{transform:scale(.985)}',
            '.hs-card:focus-visible{outline:3px solid #fff;outline-offset:3px}',
            '.hs-card-info{min-width:0;flex:1}',
            '.hs-nombre-prod{font-size:15px;font-weight:700;line-height:1.3;letter-spacing:-.005em;color:rgba(255,255,255,.92);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
            '.hs-precios{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;margin-top:7px}',
            '.hs-precio{font-size:24px;font-weight:900;letter-spacing:-.025em;line-height:1;font-variant-numeric:tabular-nums}',
            '.hs-precio-ant{font-size:13px;font-weight:600;color:rgba(255,255,255,.55);text-decoration:line-through}',
            '.hs-oferta{font-size:10.5px;font-weight:900;letter-spacing:.02em;background:#ef4444;border-radius:9999px;padding:3px 8px}',
            '.hs-card-ir{flex:0 0 auto;width:46px;height:46px;border-radius:9999px;background:#fff;color:#09090b;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px -4px rgba(0,0,0,.5);transition:transform .15s ease}',
            '.hs-card:hover .hs-card-ir{transform:translate(2px,-2px)}',
            '.hs-flecha{position:fixed;top:50%;margin-top:-24px;width:48px;height:48px;border-radius:9999px;border:0;background:rgba(255,255,255,.14);color:#fff;display:none;align-items:center;justify-content:center;cursor:pointer;z-index:301;transition:background .15s}',
            '.hs-flecha:hover{background:rgba(255,255,255,.28)}',
            '.hs-flecha.izq{left:24px}.hs-flecha.der{right:24px}',
            '@media (min-width:900px){.hs-visor.abierto .hs-flecha{display:flex}}',
            '@media (prefers-reduced-motion:reduce){.hs-visor,.hs-escenario,.hs-foto-wrap{transition:none}.hs-spinner{animation-duration:2s}}',
        ].join('\n');
        document.head.appendChild(s);
    }

    // ---------- visor ----------
    var ui = null;
    var grupos = [], gi = 0, si = 0;
    var abierto = false, opcionesVisor = {}, tokenCarga = 0;
    var bloquearClick = false;
    var timerHold = null, sostenido = false, y0 = 0, x0 = 0, presionado = false;

    var SVG_CERRAR = '<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';
    var SVG_IZQ = '<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>';
    var SVG_DER = '<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';
    var SVG_IR = '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M7 17L17 7M8 7h9v9"/></svg>';

    function construirVisor() {
        if (ui) return;
        inyectarEstilos();
        var visor = h('div', 'hs-visor');
        visor.setAttribute('role', 'dialog');
        visor.setAttribute('aria-modal', 'true');
        visor.setAttribute('aria-label', 'Historias');

        var esc = h('div', 'hs-escenario');
        var fondo = h('img', 'hs-fondo'); fondo.alt = ''; fondo.setAttribute('aria-hidden', 'true'); fondo.draggable = false;
        var velo = h('div', 'hs-velo');
        var fotoWrap = h('a', 'hs-foto-wrap'); fotoWrap.draggable = false;
        var foto = h('img', 'hs-foto'); foto.alt = ''; foto.draggable = false;
        fotoWrap.appendChild(foto);
        var spinner = h('div', 'hs-spinner');

        var top = h('div', 'hs-top');
        var barras = h('div', 'hs-barras');
        var cab = h('div', 'hs-cab');
        var logo = h('div', 'hs-cab-logo');
        var logoLetra = h('span');
        var logoImg = h('img'); logoImg.alt = ''; logoImg.draggable = false;
        logo.append(logoLetra, logoImg);
        var txt = h('a', 'hs-cab-txt');
        var nombre = h('div', 'hs-cab-nombre');
        var tiempo = h('div', 'hs-cab-tiempo');
        txt.append(nombre, tiempo);
        var cerrarBtn = h('button', 'hs-cerrar');
        cerrarBtn.type = 'button';
        cerrarBtn.setAttribute('aria-label', 'Cerrar historias');
        cerrarBtn.innerHTML = SVG_CERRAR;
        cab.append(logo, txt, cerrarBtn);
        top.append(barras, cab);

        var pie = h('div', 'hs-pie');
        var prodNombre = h('div', 'hs-nombre-prod');
        var precios = h('div', 'hs-precios');
        var card = h('a', 'hs-card'); card.draggable = false;
        var cardInfo = h('div', 'hs-card-info');
        cardInfo.append(prodNombre, precios);
        var cardIr = h('span', 'hs-card-ir'); cardIr.setAttribute('aria-hidden', 'true'); cardIr.innerHTML = SVG_IR;
        card.append(cardInfo, cardIr);
        pie.appendChild(card);

        esc.append(fondo, velo, fotoWrap, spinner, top, pie);

        var izq = h('button', 'hs-flecha izq'); izq.type = 'button'; izq.setAttribute('aria-label', 'Anterior'); izq.innerHTML = SVG_IZQ;
        var der = h('button', 'hs-flecha der'); der.type = 'button'; der.setAttribute('aria-label', 'Siguiente'); der.innerHTML = SVG_DER;

        visor.append(esc, izq, der);
        document.body.appendChild(visor);

        ui = { visor: visor, esc: esc, fondo: fondo, foto: foto, barras: barras, fill: null, logo: logo, logoLetra: logoLetra, logoImg: logoImg,
            txt: txt, nombre: nombre, tiempo: tiempo, prodNombre: prodNombre, precios: precios, link: fotoWrap, card: card };

        cerrarBtn.addEventListener('click', cerrar);
        izq.addEventListener('click', anterior);
        der.addEventListener('click', siguiente);
        // Fuera de la historia (zonas oscuras) cierra
        visor.addEventListener('click', function (e) { if (e.target === visor) cerrar(); });

        // La foto y la tarjeta abren el producto (en la tienda pública, el modal del producto)
        var irAlProducto = function (e) {
            if (bloquearClick) { e.preventDefault(); return; }
            var it = grupos[gi] && grupos[gi].items[si];
            if (opcionesVisor.onProducto && it) {
                e.preventDefault();
                var id = it.producto_id;
                var alProducto = opcionesVisor.onProducto; // cerrar() vacía opcionesVisor
                cerrar();
                alProducto(id);
            }
        };
        fotoWrap.addEventListener('click', irAlProducto);
        card.addEventListener('click', irAlProducto);

        // Toque izquierda = anterior, derecha = siguiente, mantener = pausa, deslizar abajo = cerrar
        esc.addEventListener('pointerdown', function (e) {
            if (e.target.closest('button, .hs-cab-txt, .hs-card')) return;
            presionado = true; sostenido = false; x0 = e.clientX; y0 = e.clientY;
            clearTimeout(timerHold);
            timerHold = setTimeout(function () { sostenido = true; pausar(true); }, 220);
        });
        esc.addEventListener('pointerup', function (e) {
            if (!presionado) return;
            presionado = false;
            clearTimeout(timerHold);
            pausar(false);
            var dy = e.clientY - y0, dx = e.clientX - x0;
            // Si fue mantener o arrastrar, el click que sigue no debe abrir el producto
            if (sostenido || Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                bloquearClick = true;
                setTimeout(function () { bloquearClick = false; }, 80);
            }
            if (dy > 90 && Math.abs(dx) < 80) { cerrar(); return; }
            if (sostenido) return;
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
                if (e.target.closest('.hs-foto-wrap')) return; // tocar la foto abre el producto (lo resuelve el click)
                var r = esc.getBoundingClientRect();
                if (e.clientX - r.left < r.width * 0.3) anterior(); else siguiente();
            }
        });
        var cancelar = function () { presionado = false; clearTimeout(timerHold); pausar(false); };
        esc.addEventListener('pointercancel', cancelar);
        esc.addEventListener('pointerleave', cancelar);
        esc.addEventListener('contextmenu', function (e) { e.preventDefault(); });

        document.addEventListener('keydown', function (e) {
            if (!abierto) return;
            if (e.key === 'Escape') { e.stopPropagation(); cerrar(); }
            else if (e.key === 'ArrowRight') siguiente();
            else if (e.key === 'ArrowLeft') anterior();
        }, true);

        // Con la pestaña en segundo plano la historia queda en pausa
        document.addEventListener('visibilitychange', function () { if (abierto) pausar(document.hidden); });
    }

    function pausar(si_) { if (ui) ui.visor.classList.toggle('pausa', !!si_); }

    function abrir(lista, indice, opciones) {
        if (!lista.length) return;
        construirVisor();
        grupos = lista; gi = indice || 0; opcionesVisor = opciones || {};
        si = primerNoVisto(grupos[gi]);
        abierto = true;
        document.documentElement.classList.add('hs-abierto');
        ui.visor.classList.remove('pausa');
        ui.visor.classList.add('abierto');
        mostrar();
    }

    function cerrar() {
        if (!abierto || !ui) return;
        abierto = false;
        tokenCarga++;
        ui.visor.classList.remove('abierto', 'pausa');
        document.documentElement.classList.remove('hs-abierto');
        if (ui.fill) ui.fill.style.animation = 'none';
        var cb = opcionesVisor.alCerrar;
        opcionesVisor = {};
        if (typeof cb === 'function') cb();
    }

    function irAGrupo(n) {
        gi = n;
        si = primerNoVisto(grupos[gi]);
        mostrar();
    }

    function siguiente() {
        if (!abierto) return;
        var g = grupos[gi];
        if (si < g.items.length - 1) { si++; mostrar(); }
        else if (gi < grupos.length - 1) irAGrupo(gi + 1);
        else cerrar();
    }

    function anterior() {
        if (!abierto) return;
        if (si > 0) { si--; mostrar(); }
        else if (gi > 0) irAGrupo(gi - 1);
        else mostrar();          // primera historia: se reinicia
    }

    function mostrar() {
        var g = grupos[gi], it = g.items[si], p = it.productos;
        var mio = ++tokenCarga;
        marcarVista(it.id);

        // Cabecera
        ui.nombre.textContent = g.nombre;
        ui.tiempo.textContent = hace(it.created_at);
        ui.txt.href = '/tienda/' + encodeURIComponent(g.usuario);
        ui.logoLetra.textContent = g.nombre.charAt(0).toUpperCase();
        if (g.logo) {
            ui.logoImg.onerror = function () { ui.logoImg.removeAttribute('src'); ui.logoImg.style.display = 'none'; };
            ui.logoImg.style.display = '';
            ui.logoImg.src = g.logo;
        } else {
            ui.logoImg.removeAttribute('src');
            ui.logoImg.style.display = 'none';
        }

        // Barras de progreso
        ui.barras.replaceChildren();
        ui.fill = null;
        g.items.forEach(function (_, i) {
            var b = h('div', 'hs-barra' + (i < si ? ' lleno' : ''));
            var f = h('div', 'hs-barra-f');
            b.appendChild(f);
            ui.barras.appendChild(b);
            if (i === si) ui.fill = f;
        });

        // Producto
        ui.prodNombre.textContent = p.nombre || '';
        ui.precios.replaceChildren();
        ui.precios.appendChild(h('span', 'hs-precio', formatoPrecio(p.precio)));
        var pct = calcularDescuentoPorcentaje(p.precio_anterior, p.precio);
        if (pct > 0) {
            ui.precios.appendChild(h('span', 'hs-precio-ant', formatoPrecio(p.precio_anterior)));
            ui.precios.appendChild(h('span', 'hs-oferta', '-' + pct + '%'));
        }
        var hrefProd = urlProducto(g, it.producto_id);
        ui.link.href = hrefProd;
        ui.card.href = hrefProd;
        ui.link.setAttribute('aria-label', 'Ver producto: ' + (p.nombre || ''));
        ui.card.setAttribute('aria-label', 'Ver producto: ' + (p.nombre || ''));
        ui.foto.alt = p.nombre || '';

        // La barra solo arranca cuando la foto ya cargó
        ui.esc.classList.add('cargando');
        var url = fotoProducto(p);
        var empezar = function () {
            if (mio !== tokenCarga || !abierto) return;
            ui.esc.classList.remove('cargando');
            iniciarBarra();
        };
        var pre = new Image();
        pre.onload = function () {
            if (mio !== tokenCarga) return;
            ui.foto.src = url;
            ui.fondo.src = url;
            empezar();
        };
        pre.onerror = function () {
            if (mio !== tokenCarga) return;
            var def = typeof IMAGEN_PRODUCTO_DEFAULT !== 'undefined' ? IMAGEN_PRODUCTO_DEFAULT : '';
            ui.foto.src = def; ui.fondo.src = def;
            empezar();
        };
        pre.src = url;
    }

    function iniciarBarra() {
        var f = ui.fill;
        if (!f) return;
        f.style.animation = 'none';
        void f.offsetWidth;                                   // reinicia la animación
        f.style.animation = 'hs-llenar ' + DURACION_MS + 'ms linear forwards';
        f.onanimationend = siguiente;
    }

    // ---------- API pública ----------
    async function montarBarra(contenedor, opciones) {
        opciones = opciones || {};
        var cont = typeof contenedor === 'string' ? document.getElementById(contenedor) : contenedor;
        if (!cont) return [];
        inyectarEstilos();

        var lista = await traer(opciones.emprendedorId);

        function dibujar() {
            cont.replaceChildren();
            if (!lista.length) { cont.classList.add('hidden'); cont.style.display = 'none'; return; }
            cont.classList.remove('hidden'); cont.style.display = '';

            if (opciones.titulo) cont.appendChild(h('p', 'hs-titulo', opciones.titulo));
            var vistas = leerVistas();
            // Primero los comercios con historias sin ver
            var orden = lista.map(function (g, i) { return { g: g, i: i, visto: grupoVisto(g, vistas) }; })
                .sort(function (a, b) { return (a.visto - b.visto) || (a.i - b.i); });

            var fila = h('div', 'hs-lista');
            orden.forEach(function (o, pos) {
                var b = h('button', 'hs-item' + (o.visto ? ' visto' : ''));
                b.type = 'button';
                b.setAttribute('aria-label', 'Ver historias de ' + o.g.nombre);
                var aro = h('div', 'hs-aro');
                var dentro = h('div', 'hs-aro-in');
                dentro.appendChild(h('span', null, o.g.nombre.charAt(0).toUpperCase()));
                if (o.g.logo) {
                    var img = h('img'); img.alt = ''; img.loading = 'lazy'; img.draggable = false;
                    img.onerror = function () { img.remove(); };
                    img.src = o.g.logo;
                    dentro.appendChild(img);
                }
                aro.appendChild(dentro);
                b.append(aro, h('span', 'hs-nombre', o.g.nombre));
                b.addEventListener('click', function () {
                    abrir(orden.map(function (x) { return x.g; }), pos, { alCerrar: dibujar, onProducto: opciones.onProducto });
                });
                fila.appendChild(b);
            });
            cont.appendChild(fila);
        }
        dibujar();
        return lista;
    }

    // Aro sobre el avatar de una tienda. Se puede llamar varias veces (idempotente).
    async function enlazarAvatar(el, emprendedorId, opciones) {
        if (!el) return;
        inyectarEstilos();
        el._hsOpciones = opciones || {};
        var lista = await traer(emprendedorId);
        el._hsLista = lista;

        if (!el._hsEnlazado) {
            el._hsEnlazado = true;
            var abrirDesdeAvatar = function () {
                if (!el._hsLista || !el._hsLista.length) return;
                abrir(el._hsLista, 0, {
                    onProducto: el._hsOpciones.onProducto,
                    alCerrar: function () { el.classList.toggle('visto', grupoVisto(el._hsLista[0], leerVistas())); },
                });
            };
            el.addEventListener('click', abrirDesdeAvatar);
            el.addEventListener('keydown', function (e) {
                if ((e.key === 'Enter' || e.key === ' ') && el.classList.contains('hs-anillo')) { e.preventDefault(); abrirDesdeAvatar(); }
            });
        }

        var hay = lista.length > 0;
        el.classList.toggle('hs-anillo', hay);

        // Insignia "Historia": chip bajo el avatar para que se note que hay algo para ver
        var conInsignia = hay && !(el._hsOpciones && el._hsOpciones.insignia === false);
        if (conInsignia && !el._hsInsignia) {
            var ins = h('span', 'hs-insignia');
            ins.setAttribute('aria-hidden', 'true');
            ins.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><span>Historia</span>';
            el.appendChild(ins);
            el._hsInsignia = ins;
        } else if (!conInsignia && el._hsInsignia) {
            el._hsInsignia.remove();
            el._hsInsignia = null;
        }
        el.classList.toggle('visto', hay && grupoVisto(lista[0], leerVistas()));
        if (hay) {
            el.setAttribute('role', 'button');
            el.tabIndex = 0;
            el.setAttribute('aria-label', 'Ver historias');
        } else {
            el.removeAttribute('role');
            el.removeAttribute('tabindex');
            el.removeAttribute('aria-label');
        }
    }

    // Vista previa para el dueño del comercio (incluye su tienda aunque esté bloqueada)
    async function vistaPrevia(emprendedorId) {
        var lista = await traer(emprendedorId, { incluirBloqueadas: true });
        if (!lista.length) return false;
        abrir(lista, 0, {});
        return true;
    }

    return { montarBarra: montarBarra, enlazarAvatar: enlazarAvatar, vistaPrevia: vistaPrevia, cerrar: cerrar };
})();