// ============================================================
// PÁGINA DE PRODUCTO  (producto.html?t=<usuario>&p=<id>)
// Detalle de un producto de una tienda: fotos, variantes, precio, carrito y pedido.
// Reemplaza al modal de producto que antes se abría dentro de la tienda.
//
// Depende de supabase-client.js (cargado antes), que aporta:
//   supabase, formatoPrecio, nombreMedioPago, iconoMedioPago, textoMedioPago,
//   recargoMedioPago, precioConRecargo, suscribirTabla, debounce, mostrarToast...
//
// El carrito se guarda en localStorage con la MISMA clave que la tienda
// (ce_carrito_tienda:<usuario>), así que es el mismo carrito en las dos páginas.
// ============================================================

let emprendedorActual = null;
let productosTienda = [];
let catalogoCargado = false;
let categoriasTiendaPublica = [];
let firmaCatalogo = null;

let productoAbierto = null;          // producto que se ve en la página
let seleccionVariantes = {};         // { grupo: id de variante }
let variantePreferidaFoto = null;    // última variante tocada con foto
let imagenManual = null;             // foto elegida a mano desde las miniaturas
let destinoImagen = '';
let imgToken = 0;
let cantidadModal = 1;

const $ = (id) => document.getElementById(id);


function urlSegura(valor) {
    let v = String(valor || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try {
        const u = new URL(v);
        return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch {
        return '';
    }
}

function soloDigitos(valor) {
    return String(valor || '').replace(/\D/g, '');
}

function modoPedidos(e = emprendedorActual) {
    if (!e) return 'catalogo';
    if (['catalogo', 'whatsapp', 'dashboard'].includes(e.modo_pedidos)) return e.modo_pedidos;
    return e.recibe_pedidos === true ? 'whatsapp' : 'catalogo';
}

function pedidosEnPanel(e = emprendedorActual) {
    return modoPedidos(e) === 'dashboard';
}

function pedidosActivos(e = emprendedorActual) {
    if (!e) return false;
    const modo = modoPedidos(e);
    if (modo === 'dashboard') return true;
    return modo === 'whatsapp' && soloDigitos(e.whatsapp).length > 0;
}

function tiendaInactiva(e) {
    return !!e && calcularEstadoAcceso(e).bloqueado === true;
}

const TEMA_FUENTES = {
    actual:   { nombre: 'Actual',   titulo: "'Bricolage Grotesque'", cuerpo: "'Inter'",  css: null },
    moderna:  { nombre: 'Moderna',  titulo: "'Plus Jakarta Sans'",   cuerpo: "'Inter'",  css: 'family=Plus+Jakarta+Sans:wght@500..800' },
    elegante: { nombre: 'Elegante', titulo: "'Playfair Display'",    cuerpo: "'Inter'",  css: 'family=Playfair+Display:wght@500..800' },
    amigable: { nombre: 'Amigable', titulo: "'Poppins'",             cuerpo: "'Nunito'", css: 'family=Poppins:wght@500;600;700&family=Nunito:wght@400;500;600;700' },
    urbana:   { nombre: 'Urbana',   titulo: "'Space Grotesk'",       cuerpo: "'Inter'",  css: 'family=Space+Grotesk:wght@500..700' }
};


function temaHexValido(h) { return typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h); }

function temaLuminancia(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function temaMezclar(hex, con, f) {
    const c = [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - f) + con * f));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

function temaCalcular(hex) {
    if (!temaHexValido(hex)) return { acento: '#000000', texto: '#ffffff', hover: '#1e40af', cinta: '#1e40af' };
    const lum = temaLuminancia(hex);
    const h = hex.toLowerCase();
    return {
        acento: h,
        texto: lum > 0.4 ? '#111111' : '#ffffff',
        hover: lum < 0.08 ? temaMezclar(h, 255, 0.25) : temaMezclar(h, 0, 0.18),
        cinta: h
    };
}

function aplicarTemaTienda(e) {
    const t = temaCalcular(e && e.tema_color);
    const f = TEMA_FUENTES[e && e.tema_fuente] || TEMA_FUENTES.actual;
    const s = document.documentElement.style;
    s.setProperty('--t-acento', t.acento);
    s.setProperty('--t-acento-texto', t.texto);
    s.setProperty('--t-acento-hover', t.hover);
    s.setProperty('--t-cinta', t.cinta);
    s.setProperty('--f-titulo', f.titulo);
    s.setProperty('--f-cuerpo', f.cuerpo);
    if (f.css && !document.getElementById('tema-fuente-link')) {
        const l = document.createElement('link');
        l.id = 'tema-fuente-link';
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?' + f.css + '&display=swap';
        document.head.appendChild(l);
    }
}

const PALABRAS_MENORES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'con', 'sin', 'por', 'para', 'un', 'una']);
const SIGLAS = new Set(['usb', 'led', 'lcd', 'tv', 'pc', 'hd', 'dvd', 'cd', 'sd', 'gps', 'sa', 'srl', 'sas', 'xl', 'xxl', 'uv', 'ml', 'kg', 'cm', 'mm']);

function formatoNombre(texto) {
    const t = String(texto || '').trim();
    if (!t || t !== t.toLocaleUpperCase('es') || t === t.toLocaleLowerCase('es')) return t;
    return t.split(/(\s+)/).map((w, i) => {
        if (!w.trim() || /\d/.test(w)) return w;
        const bajo = w.toLocaleLowerCase('es');
        const letras = bajo.replace(/[^a-záéíóúüñ]/g, '');
        if (SIGLAS.has(letras)) return w;
        if (i > 0 && PALABRAS_MENORES.has(letras)) return bajo;
        return bajo.charAt(0).toLocaleUpperCase('es') + bajo.slice(1);
    }).join('');
}

function el(tag, clase, texto) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
}

function nombreCategoriaProducto(p) {
    if (p.categoria_tienda_id != null) {
        const c = categoriasTiendaPublica.find(x => String(x.id) === String(p.categoria_tienda_id));
        if (c) return c.nombre;
    }
    return p.categorias?.nombre || '';
}

function productoSinStock(p) {
    if (!p) return false;
    if (p.activo === false) return true;
    const v = p.variantes || [];
    return v.length > 0 && v.every(x => x.disponible === false);
}

function gruposDeVariantes(p) {
    const grupos = new Map();
    (p.variantes || []).forEach(v => {
        const g = (v.nombre || '').trim() || 'Opción';
        if (!grupos.has(g)) grupos.set(g, []);
        grupos.get(g).push(v);
    });
    return grupos;
}

function variantesElegidas() {
    if (!productoAbierto) return [];
    return (productoAbierto.variantes || []).filter(v => {
        const g = (v.nombre || '').trim() || 'Opción';
        return seleccionVariantes[g] === String(v.id);
    });
}

function seleccionCompleta() {
    if (!productoAbierto) return false;
    return [...gruposDeVariantes(productoAbierto).keys()].every(g => seleccionVariantes[g]);
}

function precioUnitario(p, elegidas) {
    const propios = elegidas.map(v => Number(v.precio_adicional) || 0).filter(n => n > 0);
    return propios.length ? Math.max(...propios) : Number(p.precio);
}

function textoVariantes(elegidas) {
    return elegidas.map(v => `${(v.nombre || '').trim() || 'Opción'}: ${(v.valor || '').trim()}`).join(' · ');
}

function mediosDelProducto(p) {
    const comercio = Array.isArray(emprendedorActual?.medios_pago) ? emprendedorActual.medios_pago : [];
    if (Array.isArray(p.medios_pago) && p.medios_pago.length) {
        const propios = p.medios_pago.filter(id => comercio.includes(id));
        if (propios.length) return propios;
    }
    return comercio;
}

function fotoDeVariante(v, p = productoAbierto) {
    if (v && v.usa_foto_producto && p) return { url: p.imagen_url || '', thumb: p.imagen_thumb_url || '' };
    return { url: v?.imagen_url || '', thumb: v?.imagen_thumb_url || '' };
}

function unidadesPorProducto() {
    const m = new Map();
    carrito.items.forEach(i => m.set(String(i.productoId), (m.get(String(i.productoId)) || 0) + i.cantidad));
    return m;
}

function abrirModalMediosPago() {
    if (!productoAbierto) return;
    const lista = $('modal-medios-pago-lista');
    lista.replaceChildren();
    mediosDelProducto(productoAbierto).forEach(id => {
        const chip = el('span', 'chip');
        const ic = el('span', 'inline-flex');
        ic.innerHTML = iconoMedioPago(id);
        chip.append(ic, el('span', null, textoMedioPago(id)));
        lista.appendChild(chip);
    });
    $('modal-medios-pago-modal').classList.remove('hidden');
}

function cerrarModalMediosPago() { $('modal-medios-pago-modal').classList.add('hidden'); }

function renderVariantesModal() {
    const cont = $('prod-variantes');
    cont.replaceChildren();
    if (!productoAbierto) return;

    gruposDeVariantes(productoAbierto).forEach((lista, grupo) => {
        const bloque = el('div');
        const elegida = lista.find(v => String(v.id) === seleccionVariantes[grupo]);

        // "Talle" o "Talle: M" cuando ya hay una opción elegida
        const titulo = el('p', 'text-[13px] font-medium text-zinc-500 mb-2', grupo);
        if (elegida) titulo.appendChild(el('span', 'text-zinc-900', ': ' + ((elegida.valor || '').trim() || '—')));
        bloque.appendChild(titulo);

        // Si alguna opción del grupo tiene foto, el grupo se muestra con miniaturas (estilo "tile")
        const conFotos = lista.some(v => urlSegura(fotoDeVariante(v).url));
        const opciones = el('div', conFotos ? 'flex flex-wrap gap-x-2.5 gap-y-3.5 pt-1 pl-1' : 'flex flex-wrap gap-2');
        lista.forEach(v => {
            const sinStock = v.disponible === false;
            const activa = seleccionVariantes[grupo] === String(v.id);

            if (conFotos) {
                const valor = (v.valor || '').trim() || '—';
                const tile = el('button',
                    'flex-shrink-0 flex flex-col items-center gap-1.5 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900 focus-visible:outline-offset-4 ' +
                    (sinStock ? 'cursor-not-allowed' : ''));
                tile.type = 'button';
                tile.disabled = sinStock;
                tile.title = valor + (sinStock ? ' (sin stock)' : '');
                tile.setAttribute('aria-label', `${grupo}: ${valor}` + (sinStock ? ' (sin stock)' : ''));
                tile.setAttribute('aria-pressed', activa ? 'true' : 'false');

                const marco = el('span', 'relative block w-[4.5rem] h-[4.5rem] rounded-xl overflow-hidden bg-zinc-100 border transition-all ' +
                    (activa ? 'border-zinc-900 ring-2 ring-zinc-900 ring-offset-2'
                        : sinStock ? 'border-zinc-200'
                        : 'border-zinc-200 hover:border-zinc-900'));
                const fotoV = fotoDeVariante(v);
                const src = urlSegura(miniaturaCloudinary(fotoV.thumb || fotoV.url, 180));
                if (src) {
                    const im = el('img', 'w-full h-full object-cover' + (sinStock ? ' opacity-40 grayscale' : ''));
                    im.src = src;
                    im.alt = '';
                    im.loading = 'lazy';
                    im.draggable = false;
                    im.onerror = () => { im.remove(); };
                    marco.appendChild(im);
                } else {
                    // Opción sin foto dentro de un grupo con fotos: inicial sobre fondo neutro
                    marco.appendChild(el('span', 'absolute inset-0 flex items-center justify-center text-lg font-semibold uppercase ' + (sinStock ? 'text-zinc-300' : 'text-zinc-400'), valor.slice(0, 2)));
                }
                tile.appendChild(marco);
                tile.appendChild(el('span',
                    'block w-[4.5rem] truncate text-center text-xs ' +
                    (sinStock ? 'text-zinc-300 line-through' : activa ? 'font-semibold text-zinc-900' : 'text-zinc-600'),
                    valor));

                tile.onclick = () => {
                    imagenManual = null; variantePreferidaFoto = activa ? null : v.id;
                    seleccionVariantes[grupo] = activa ? undefined : String(v.id);
                    if (activa) delete seleccionVariantes[grupo];
                    renderVariantesModal();
                    actualizarPrecio();
                    actualizarImagen();
                };
                opciones.appendChild(tile);
                return;
            }

            const b = el('button',
                'min-w-[2.75rem] px-3.5 py-2 rounded-lg border text-sm font-medium transition-colors ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 ' +
                (sinStock ? 'border-zinc-200 bg-zinc-50 text-zinc-300 line-through cursor-not-allowed'
                    : activa ? 't-acento border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-300 bg-white text-zinc-800 hover:border-zinc-900'),
                (v.valor || '').trim() || '—');
            b.type = 'button';
            b.disabled = sinStock;
            b.setAttribute('aria-pressed', activa ? 'true' : 'false');
            if (sinStock) b.title = 'Sin stock';
            b.onclick = () => {
                imagenManual = null; variantePreferidaFoto = activa ? null : v.id;
                seleccionVariantes[grupo] = activa ? undefined : String(v.id);
                if (activa) delete seleccionVariantes[grupo];
                renderVariantesModal();
                actualizarPrecio();
                actualizarImagen();
            };
            opciones.appendChild(b);
        });
        bloque.appendChild(opciones);
        cont.appendChild(bloque);
    });
}

function actualizarPrecioBase() {
    const p = productoAbierto;
    if (!p) return;
    const elegidas = variantesElegidas();
    const final = precioUnitario(p, elegidas);
    const conPrecioPropio = elegidas.some(v => (Number(v.precio_adicional) || 0) > 0);
    const pct = calcularDescuentoPorcentaje(p.precio_anterior, p.precio);
    const oferta = pct > 0 && !conPrecioPropio;

    $('prod-precio').textContent = formatoPrecio(final);
    $('prod-precio-anterior').textContent = oferta ? formatoPrecio(p.precio_anterior) : '';
    $('prod-precio-anterior').classList.toggle('hidden', !oferta);
    $('prod-badge-oferta').textContent = `-${pct}%`;
    $('prod-badge-oferta').classList.toggle('hidden', !oferta);

    // Comparativa visual según el medio de pago (solo si algún medio tiene recargo)
    const cont = $('prod-precios-medios');
    const wrapMedios = $('prod-medios-pago-wrap');
    const medios = mediosDelProducto(p);
    const sinRecargo = medios.filter(id => !(recargoMedioPago(id) > 0));
    const conRecargo = medios
        .map(id => ({ id, pct: recargoMedioPago(id) }))
        .filter(m => m.pct > 0);

    cont.replaceChildren();

    if (conRecargo.length > 0) {
        // 1) Bloque "Sin recargo". Es solo informativo: mismo formato de filas que
        //    "Con recargo" (sin chips, sin relleno verde ni bordes por medio) para que
        //    no parezca una opción a seleccionar. El único toque verde es el punto.
        if (sinRecargo.length > 0) {
            const boxSin = el('div', 'rounded-xl border border-zinc-200 bg-white p-3');
            const headSin = el('p', 'inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2');
            headSin.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Sin recargo';
            boxSin.appendChild(headSin);

            const listaSin = el('div', 'space-y-1.5');
            sinRecargo.forEach(id => {
                const fila = el('div', 'flex items-center justify-between gap-2 text-xs sm:text-[13px]');
                const izq = el('div', 'flex items-center gap-1.5 min-w-0 text-zinc-700');
                const ic = el('span', 'inline-flex flex-shrink-0 text-zinc-500');
                ic.innerHTML = iconoMedioPago(id);
                izq.append(ic, el('span', 'font-medium truncate', nombreMedioPago(id)));
                fila.append(izq, el('span', 'font-semibold text-zinc-900 tabular-nums flex-shrink-0', formatoPrecio(final)));
                listaSin.appendChild(fila);
            });
            boxSin.appendChild(listaSin);
            cont.appendChild(boxSin);
        }

        // 2) Bloque "Con recargo"
        const boxCon = el('div', 'rounded-xl border border-zinc-200 bg-zinc-50/70 p-3');
        boxCon.appendChild(el('p', 'text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2', 'Con recargo'));

        const listaCon = el('div', 'space-y-1.5');
        conRecargo.forEach(m => {
            const fila = el('div', 'flex items-center justify-between gap-2 text-xs sm:text-[13px]');
            const izq = el('div', 'flex items-center gap-1.5 min-w-0 text-zinc-700');
            const ic = el('span', 'inline-flex flex-shrink-0 text-zinc-500');
            ic.innerHTML = iconoMedioPago(m.id);
            const nom = el('span', 'font-medium truncate', nombreMedioPago(m.id));
            const pctTag = el('span', 'flex-shrink-0 px-1.5 py-0.5 rounded bg-zinc-200/80 text-[10px] font-semibold text-zinc-600 tabular-nums', `+${formatoPorcentaje(m.pct)}%`);
            izq.append(ic, nom, pctTag);

            const precioEl = el('span', 'font-semibold text-zinc-900 tabular-nums flex-shrink-0', formatoPrecio(precioConRecargo(final, m.pct)));
            fila.append(izq, precioEl);
            listaCon.appendChild(fila);
        });
        boxCon.appendChild(listaCon);
        cont.appendChild(boxCon);

        cont.classList.remove('hidden');
        // Como ya se muestran todos los medios en la comparativa, ocultamos el link redundante
        wrapMedios.classList.add('hidden');
        wrapMedios.classList.remove('inline-flex');
    } else {
        cont.classList.add('hidden');
        wrapMedios.classList.toggle('hidden', medios.length === 0);
        wrapMedios.classList.toggle('inline-flex', medios.length > 0);
    }

    // Aclaración: el medio de pago se elige recién en el carrito
    $('prod-medios-aviso').classList.toggle('hidden', !(medios.length > 0 && pedidosActivos() && !productoSinStock(p)));

    const completa = seleccionCompleta();
    $('prod-btn-agregar').disabled = !completa || productoSinStock(p);
    if (!$('prod-btn-agregar').classList.contains('btn-add-ok')) {
        $('prod-btn-agregar-texto').textContent = completa ? 'Agregar al carrito' : 'Elegí una opción';
    }
}

function actualizarAvisoEnCarritoModal() {
    const box = $('prod-en-carrito');
    if (!box) return;
    const p = productoAbierto;
    const items = (p && pedidosActivos()) ? carrito.items.filter(i => String(i.productoId) === String(p.id)) : [];
    const n = items.reduce((s, i) => s + i.cantidad, 0);
    box.classList.toggle('hidden', n === 0);
    if (!n) return;
    $('prod-en-carrito-texto').textContent = `Ya está en tu carrito · ${n} unidad${n === 1 ? '' : 'es'}`;
    // Con variantes distintas en el carrito, se detalla cuántas de cada una
    $('prod-en-carrito-detalle').textContent = items.some(i => i.detalle)
        ? items.map(i => `${i.detalle || 'Sin opciones'} ×${i.cantidad}`).join('\n') : '';
}

// ------------------------------------------------------------
// LIGHTBOX (zoom con botones, rueda y pellizco; arrastre; doble toque)
// ------------------------------------------------------------
const lb = { s: 1, x: 0, y: 0, punteros: new Map(), distIni: 0, sIni: 1, ultimoToque: 0, downT: 0, downX: 0, downY: 0 };

function lbAplicar() {
    $('lightbox-imagen-img').style.transform = `translate(${lb.x}px, ${lb.y}px) scale(${lb.s})`;
    const r = $('lightbox-zoom-reset');
    const zoom = lb.s > 1.001;
    r.textContent = Math.round(lb.s * 100) + '%';
    r.classList.toggle('opacity-40', !zoom);
    r.classList.toggle('pointer-events-none', !zoom);
}
function lbFijar(s, conTransicion) {
    const img = $('lightbox-imagen-img');
    if (conTransicion) { img.classList.add('lb-transicion'); setTimeout(() => img.classList.remove('lb-transicion'), 300); }
    lb.s = Math.min(5, Math.max(1, s));
    if (lb.s === 1) { lb.x = 0; lb.y = 0; }
    lbAplicar();
}
function lightboxZoomIn() { lbFijar(lb.s * 1.5, true); }
function lightboxZoomOut() { lbFijar(lb.s / 1.5, true); }
function lightboxZoomReset() { lbFijar(1, true); }

function abrirLightboxImagen() {
    if (!productoAbierto) return;
    const img = $('lightbox-imagen-img');
    img.src = urlImagenModal();
    img.alt = productoAbierto.nombre || '';
    $('lightbox-imagen-titulo').textContent = productoAbierto.nombre || '';
    lb.s = 1; lb.x = 0; lb.y = 0; lbAplicar();
    const box = $('lightbox-imagen');
    box.classList.remove('hidden');
    box.classList.add('flex');
    void box.offsetWidth;
    box.classList.add('abierto');
    img.classList.add('abierto');
    actualizarBloqueoScroll();
}
function cerrarLightboxImagen() {
    const box = $('lightbox-imagen');
    box.classList.remove('abierto');
    $('lightbox-imagen-img').classList.remove('abierto');
    setTimeout(() => {
        if (box.classList.contains('abierto')) return;
        box.classList.add('hidden');
        box.classList.remove('flex');
        actualizarBloqueoScroll();
    }, 300);
}

function iniciarLightbox() {
    const vp = $('lightbox-imagen-viewport');
    vp.addEventListener('wheel', (ev) => { ev.preventDefault(); lbFijar(lb.s * (ev.deltaY < 0 ? 1.15 : 0.87), false); }, { passive: false });
    vp.addEventListener('pointerdown', (ev) => {
        vp.setPointerCapture(ev.pointerId);
        lb.punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (lb.punteros.size === 2) {
            const [a, b] = [...lb.punteros.values()];
            lb.distIni = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            lb.sIni = lb.s;
        } else {
            lb.downT = Date.now(); lb.downX = ev.clientX; lb.downY = ev.clientY;
        }
    });
    vp.addEventListener('pointermove', (ev) => {
        const prev = lb.punteros.get(ev.pointerId);
        if (!prev) return;
        const dx = ev.clientX - prev.x, dy = ev.clientY - prev.y;
        lb.punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (lb.punteros.size === 2) {
            const [a, b] = [...lb.punteros.values()];
            lbFijar(lb.sIni * (Math.hypot(a.x - b.x, a.y - b.y) / lb.distIni), false);
        } else if (lb.s > 1) {
            lb.x += dx; lb.y += dy; lbAplicar();
        }
    });
    const soltar = (ev) => {
        const eraUno = lb.punteros.size === 1;
        lb.punteros.delete(ev.pointerId);
        if (eraUno && ev.type === 'pointerup') {
            const quieto = Math.hypot(ev.clientX - lb.downX, ev.clientY - lb.downY) < 8 && Date.now() - lb.downT < 250;
            if (quieto) {
                // Un toque en el fondo (fuera de la imagen) cierra el visor
                const r = $('lightbox-imagen-marco').getBoundingClientRect();
                const fuera = ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
                if (fuera && lb.s <= 1.001) return cerrarLightboxImagen();
                if (Date.now() - lb.ultimoToque < 300) { lbFijar(lb.s > 1 ? 1 : 2.5, true); lb.ultimoToque = 0; }
                else lb.ultimoToque = Date.now();
            }
        }
    };
    vp.addEventListener('pointerup', soltar);
    vp.addEventListener('pointercancel', soltar);
}

// ------------------------------------------------------------
// CARRITO (se guarda en el navegador; cada tienda tiene el suyo)
// ------------------------------------------------------------
// Clave antigua (un solo carrito para todas las tiendas): solo se usa para migrar.
const CLAVE_CARRITO_ANTIGUA = 'ce_carrito_tienda';
// Clave por tienda: ce_carrito_tienda:<usuario>
const CLAVE_CARRITO = CLAVE_CARRITO_ANTIGUA + ':' + (obtenerSlug() || '');
let carrito = leerCarrito();         // { emprendedorId, tienda, items: [...] } de ESTA tienda
let modalidadEnvio = null;           // null = sin elegir, true = envío, false = retiro
let conflictoPendiente = null;

function leerCarrito() {
    try {
        const c = JSON.parse(localStorage.getItem(CLAVE_CARRITO) || 'null');
        if (c && Array.isArray(c.items)) return c;
    } catch { /* noop */ }
    return { emprendedorId: null, tienda: '', items: [] };
}
function guardarCarrito() {
    try {
        if (carrito.items.length) localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito));
        else localStorage.removeItem(CLAVE_CARRITO);
    } catch { /* noop */ }
}

// Carrito viejo (compartido entre tiendas): si era de esta tienda, pasa a la clave propia;
// si era de otra, se deja para que esa tienda lo recupere al abrirse.
function migrarCarritoAntiguo(e) {
    try {
        const viejo = JSON.parse(localStorage.getItem(CLAVE_CARRITO_ANTIGUA) || 'null');
        if (!viejo || !Array.isArray(viejo.items)) { localStorage.removeItem(CLAVE_CARRITO_ANTIGUA); return; }
        if (String(viejo.emprendedorId) !== String(e.id)) return;
        if (!carrito.items.length) { carrito = viejo; guardarCarrito(); }
        localStorage.removeItem(CLAVE_CARRITO_ANTIGUA);
    } catch { /* noop */ }
}

// Si el carrito de esta tienda quedó con productos de otro comercio, se descarta.
function validarCarritoDeTienda(e) {
    if (carrito.items.length && carrito.emprendedorId != null && String(carrito.emprendedorId) !== String(e.id)) {
        carrito = { emprendedorId: null, tienda: '', items: [] };
        guardarCarrito();
    }
}

// Devuelve true si el producto quedó en el carrito
// Miniatura del ítem en el carrito: la foto de la variante elegida (si tiene) o la del producto
function imagenParaCarrito(p, elegidas) {
    const v = [...elegidas].reverse().find(x => fotoDeVariante(x, p).url);
    if (!v) return urlGrillaProducto(p, 160);
    const f = fotoDeVariante(v, p);
    return miniaturaCloudinary(f.thumb || f.url, 160);
}

function agregarItem(p, cantidad, elegidas) {
    const e = emprendedorActual;
    if (!e) return false;

    if (carrito.items.length && String(carrito.emprendedorId) !== String(e.id)) {
        conflictoPendiente = { p, cantidad, elegidas };
        $('conflicto-tienda-actual').textContent = carrito.tienda || 'otra tienda';
        $('modal-conflicto-carrito').classList.remove('hidden');
        actualizarBloqueoScroll();
        return false;
    }

    carrito.emprendedorId = e.id;
    carrito.tienda = (e.nombre_tienda || '').trim();

    const key = `${p.id}:${elegidas.map(v => v.id).sort().join(',')}`;
    const existente = carrito.items.find(i => i.key === key);
    if (existente) {
        existente.cantidad = Math.min(99, existente.cantidad + cantidad);
    } else {
        carrito.items.push({
            key,
            productoId: p.id,
            nombre: p.nombre || '',
            precio: precioUnitario(p, elegidas),
            cantidad,
            imagen: urlSegura(imagenParaCarrito(p, elegidas)) || '',
            detalle: textoVariantes(elegidas),
        });
    }
    guardarCarrito();
    actualizarCarritoUI();
    mostrarToastCarrito(existente ? 'Cantidad actualizada' : 'Agregado al carrito', {
        detalle: [p.nombre, textoVariantes(elegidas)].filter(Boolean).join(' · '),
        imagen: urlSegura(imagenParaCarrito(p, elegidas)) || '',
        verCarrito: true,
    });
    return true;
}

function confirmarReemplazoCarrito() {
    const c = conflictoPendiente;
    cerrarConflictoCarrito();
    if (!c) return;
    carrito = { emprendedorId: null, tienda: '', items: [] };
    if (agregarItem(c.p, c.cantidad, c.elegidas) && productoAbierto) confirmarAgregadoModal();
}
function cerrarConflictoCarrito() {
    conflictoPendiente = null;
    $('modal-conflicto-carrito').classList.add('hidden');
    actualizarBloqueoScroll();
}

function cambiarCantidadItem(key, delta) {
    const it = carrito.items.find(i => i.key === key);
    if (!it) return;
    if (delta > 0 && itemSinStock(it)) return;
    it.cantidad += delta;
    if (it.cantidad < 1) carrito.items = carrito.items.filter(i => i.key !== key);
    it.cantidad = Math.min(99, it.cantidad);
    guardarCarrito();
    actualizarCarritoUI();
}
function quitarItem(key) {
    carrito.items = carrito.items.filter(i => i.key !== key);
    guardarCarrito();
    actualizarCarritoUI();
}
async function vaciarCarrito() {
    if (!carrito.items.length) return;
    const ok = await confirmarAccion('Se van a quitar todos los productos del carrito.', { titulo: '¿Vaciar carrito?', textoConfirmar: 'Vaciar' });
    if (!ok) return;
    limpiarCarrito();
}
function limpiarCarrito() {
    carrito = { emprendedorId: null, tienda: '', items: [] };
    modalidadEnvio = null;
    guardarCarrito();
    mostrarPasoCarrito(1);
}

function costoEnvio() { return Number(emprendedorActual?.costo_envio) || 0; }
// ¿El ítem del carrito sigue teniendo stock? Se compara con el catálogo actual:
// producto en activo = false, eliminado, o con alguna de las variantes elegidas sin stock / eliminada.
// La key del ítem es "<productoId>:<idVariante>,<idVariante>".
function idsVariantesDeItem(it) {
    const prefijo = String(it.productoId) + ':';
    const key = String(it.key || '');
    return key.startsWith(prefijo) ? key.slice(prefijo.length).split(',').filter(Boolean) : [];
}
function itemSinStock(it) {
    if (!catalogoCargado) return false;   // todavía no hay datos para comparar
    const p = productosTienda.find(x => String(x.id) === String(it.productoId));
    if (!p) return true;                  // el producto ya no existe
    if (productoSinStock(p)) return true;
    return idsVariantesDeItem(it).some(id => {
        const v = (p.variantes || []).find(x => String(x.id) === String(id));
        return !v || v.disponible === false;
    });
}
function itemsSinStock() { return carrito.items.filter(itemSinStock); }
function hayItemsSinStock() { return carrito.items.some(itemSinStock); }

// Los productos sin stock quedan en el carrito pero no cuentan en el total
// El carrito guarda siempre el precio base. El recargo del medio de pago se suma recién en el paso 2,
// cuando el cliente elige cómo paga: cada precio unitario se recalcula y se redondea al peso
// (igual que crear_pedido en SQL, así el total de la web coincide con el del pedido).
function pctRecargoVigente() {
    if (pasoCarrito !== 2 || !medioPagoElegido) return 0;
    if (!mediosDelCarrito().includes(medioPagoElegido)) return 0;
    return recargoMedioPago(medioPagoElegido);
}
function itemsDisponiblesCarrito() { return carrito.items.filter(i => !itemSinStock(i)); }
function subtotalBase() { return itemsDisponiblesCarrito().reduce((s, i) => s + i.precio * i.cantidad, 0); }
function subtotalCarrito() {
    const pct = pctRecargoVigente();
    return itemsDisponiblesCarrito().reduce((s, i) => s + precioConRecargo(i.precio, pct) * i.cantidad, 0);
}
function recargoCarrito() { return subtotalCarrito() - subtotalBase(); }
function totalCarrito() { return subtotalCarrito() + (modalidadEnvio === true ? costoEnvio() : 0); }

function seleccionarModalidadEntrega(envio) {
    modalidadEnvio = envio;
    marcarErrorModalidad('');
    actualizarCarritoUI();
}

// Error dentro del carrito (no en toast): mensaje rojo + botones con borde rojo
function marcarErrorModalidad(msg) {
    const p = $('co-error-modalidad');
    const caja = $('carrito-modalidad-botones');
    if (p) { p.textContent = msg || ''; p.classList.toggle('hidden', !msg); }
    if (caja) {
        caja.classList.toggle('modalidad-error', !!msg);
        caja.setAttribute('aria-invalid', msg ? 'true' : 'false');
        if (msg) {
            caja.classList.remove('co-shake');
            void caja.offsetWidth; // reinicia la animación si vuelven a tocar "Continuar"
            caja.classList.add('co-shake');
        }
    }
}
function pedirModalidadEntrega() {
    if (pasoCarrito !== 1) mostrarPasoCarrito(1);
    marcarErrorModalidad('Elegí cómo querés recibir tu pedido.');
}

// El carrito guarda el precio con el que se agregó cada producto. Si el comercio lo cambió
// después, se compara con el catálogo actual y se actualiza el ítem. Guarda en
// `precioAnterior` el precio que el cliente vio primero, para avisárselo en el carrito.
// Los ítems sin stock se saltean (ya salen marcados como "Sin stock").
// Devuelve la lista de ítems cuyo precio cambió en esta pasada.
function sincronizarPreciosCarrito() {
    if (!catalogoCargado) return [];
    const cambiados = [];
    carrito.items.forEach(it => {
        if (itemSinStock(it)) return;
        const p = productosTienda.find(x => String(x.id) === String(it.productoId));
        if (!p) return;
        const ids = idsVariantesDeItem(it);
        const elegidas = (p.variantes || []).filter(v => ids.includes(String(v.id)));
        const nuevo = precioUnitario(p, elegidas);
        if (!Number.isFinite(nuevo) || nuevo === Number(it.precio)) return;
        const referencia = it.precioAnterior != null ? Number(it.precioAnterior) : Number(it.precio);
        cambiados.push({ nombre: it.nombre, antes: Number(it.precio), ahora: nuevo });
        it.precio = nuevo;
        if (referencia !== nuevo) it.precioAnterior = referencia;
        else delete it.precioAnterior;   // volvió al precio con el que lo agregó
    });
    return cambiados;
}

function actualizarCarritoUI() {
    // Precios al día respecto del catálogo antes de calcular totales o dibujar nada
    const preciosCambiados = sincronizarPreciosCarrito();
    if (preciosCambiados.length) {
        guardarCarrito();   // sin toast: el cambio se ve con la flecha junto al precio del ítem
        // Si estaba cargando sus datos, vuelve al carrito para revisar los importes nuevos
        if (pasoCarrito === 2) { mostrarPasoCarrito(1); return; }
    }

    const cant = carrito.items.reduce((s, i) => s + i.cantidad, 0);
    const badge = $('badge-carrito');
    badge.textContent = String(cant);
    badge.classList.toggle('hidden', cant === 0);
    actualizarMarcasCarrito();

    if (cant === 0 && pasoCarrito === 2) { mostrarPasoCarrito(1); return; }

    // Productos que se quedaron sin stock: siguen en el carrito, marcados, y bloquean el pedido
    const agotados = itemsSinStock();
    if (pasoCarrito === 2 && agotados.length) {
        mostrarPasoCarrito(1);   // vuelve a llamar a actualizarCarritoUI en el paso 1
        if (!$('carrito-drawer').classList.contains('translate-x-full')) {
            mostrarToastCarrito('Hay productos sin stock en tu carrito', { aviso: true });
        }
        return;
    }
    $('carrito-subtitulo').textContent = pasoCarrito === 2 ? 'Paso 2 de 2' : cant === 0 ? 'Vacío' : `${cant} producto${cant === 1 ? '' : 's'}${carrito.tienda ? ' · ' + carrito.tienda : ''}`;

    const cont = $('carrito-items');
    cont.replaceChildren();
    if (!carrito.items.length) {
        const vacio = el('div', 'flex flex-col items-center justify-center text-center py-20 px-6');
        const icono = el('span', 'w-12 h-12 rounded-full bg-zinc-100 text-zinc-400 flex items-center justify-center mb-4');
        icono.innerHTML = '<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h1.5l1.6 9.6a2 2 0 002 1.65h8.4a2 2 0 002-1.65L20 7.5H6"/><circle cx="9.5" cy="19.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="16.5" cy="19.5" r="1.4" fill="currentColor" stroke="none"/></svg>';
        vacio.append(icono, el('p', 'text-sm font-semibold text-zinc-900', 'Tu carrito está vacío'), el('p', 'text-xs text-zinc-500 mt-1', 'Los productos que agregues van a aparecer acá.'));
        cont.appendChild(vacio);
    }
    carrito.items.forEach(it => {
        const agotado = agotados.includes(it);
        const fila = el('div', 'flex gap-3.5 py-4');
        const img = el('img', 'w-[68px] h-[68px] rounded-xl object-contain p-1 bg-zinc-50 border border-zinc-100 flex-shrink-0' + (agotado ? ' grayscale opacity-50' : ''));
        img.alt = '';
        img.src = it.imagen || IMAGEN_PRODUCTO_DEFAULT;
        img.onerror = () => { img.onerror = null; img.src = IMAGEN_PRODUCTO_DEFAULT; };

        const centro = el('div', 'flex-1 min-w-0 flex flex-col');
        centro.appendChild(el('p', 'text-sm font-semibold leading-snug line-clamp-2 break-words ' + (agotado ? 'text-zinc-400' : 'text-zinc-900'), it.nombre));
        if (it.detalle) centro.appendChild(el('p', 'text-xs text-zinc-500 mt-0.5 break-words', it.detalle));
        if (agotado) centro.appendChild(el('p', 'text-xs font-semibold text-red-600 mt-1', 'Sin stock por el momento'));

        const pie = el('div', 'mt-auto pt-2.5 flex items-center justify-between gap-2');
        const stepper = el('div', 'inline-flex items-center rounded-lg border border-zinc-200 h-8 overflow-hidden');
        const botonStepper = 'w-8 h-full flex items-center justify-center text-base leading-none text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 transition-colors active:bg-zinc-100';
        const menos = el('button', botonStepper, '−');
        const mas = el('button', botonStepper, '+');
        menos.type = mas.type = 'button';
        menos.setAttribute('aria-label', 'Menos'); mas.setAttribute('aria-label', 'Más');
        menos.onclick = () => cambiarCantidadItem(it.key, -1);
        mas.onclick = () => cambiarCantidadItem(it.key, 1);
        if (agotado) { mas.disabled = true; mas.classList.add('opacity-30', 'cursor-not-allowed'); }
        stepper.append(menos, el('span', 'min-w-[1.75rem] text-center text-xs font-semibold tabular-nums text-zinc-900', String(it.cantidad)), mas);
        const precioFila = el('span', 'inline-flex items-center gap-1.5');
        // Flecha junto al precio si cambió desde que se agregó: verde hacia arriba si subió, roja hacia abajo si bajó
        if (!agotado && it.precioAnterior != null && Number(it.precioAnterior) !== Number(it.precio)) {
            const subio = Number(it.precio) > Number(it.precioAnterior);
            const flecha = el('span', 'inline-flex flex-shrink-0 ' + (subio ? 'text-emerald-600' : 'text-red-600'));
            flecha.setAttribute('role', 'img');
            flecha.setAttribute('aria-label', subio ? 'El precio subió' : 'El precio bajó');
            flecha.innerHTML = subio
                ? '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
                : '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
            precioFila.appendChild(flecha);
        }
        precioFila.appendChild(el('span', 'text-sm font-semibold tabular-nums ' + (agotado ? 'text-zinc-400 line-through' : 'text-zinc-900'), formatoPrecio(it.precio * it.cantidad)));
        pie.append(stepper, precioFila);
        centro.appendChild(pie);

        const quitar = el('button', 'self-start w-9 h-9 -mt-1.5 -mr-2 rounded-full text-zinc-500 hover:bg-red-50 hover:text-red-600 active:bg-red-100 flex items-center justify-center flex-shrink-0 transition-colors');
        quitar.innerHTML = '<svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>';
        quitar.type = 'button';
        quitar.setAttribute('aria-label', `Quitar ${it.nombre}`);
        quitar.onclick = () => quitarItem(it.key);

        fila.append(img, centro, quitar);
        cont.appendChild(fila);
    });

    // Entrega: solo si el comercio cargó un costo de envío
    const envio = costoEnvio();
    const hayEnvio = envio > 0;
    $('carrito-modalidad-envio').classList.toggle('hidden', !hayEnvio || !carrito.items.length);
    if (!hayEnvio) modalidadEnvio = null;
    if (!hayEnvio || modalidadEnvio !== null) marcarErrorModalidad('');   // el error ya no corresponde
    const estilo = (btn, activo) => {
        btn.classList.toggle('border-zinc-900', activo);
        btn.classList.toggle('bg-zinc-900', activo);
        btn.classList.toggle('text-white', activo);
        btn.classList.toggle('border-zinc-200', !activo);
        btn.classList.toggle('bg-white', !activo);
        btn.classList.toggle('text-zinc-600', !activo);
    };
    estilo($('btn-modalidad-envio'), modalidadEnvio === true);
    estilo($('btn-modalidad-retiro'), modalidadEnvio === false);

    const conEnvio = modalidadEnvio === true && hayEnvio;
    $('carrito-fila-subtotal').classList.toggle('hidden', !conEnvio);
    $('carrito-fila-envio').classList.toggle('hidden', !conEnvio);
    $('carrito-subtotal').textContent = formatoPrecio(subtotalBase());
    $('carrito-envio').textContent = formatoPrecio(envio);
    $('carrito-total').textContent = formatoPrecio(totalCarrito());

    // Si algún medio de pago del carrito tiene recargo, se avisa antes del checkout
    const notaRecargo = $('carrito-nota-recargo');
    if (notaRecargo) {
        const conRecargo = pasoCarrito === 1 && carrito.items.length
            ? mediosDelCarrito().filter(id => recargoMedioPago(id) > 0)
            : [];
        notaRecargo.textContent = conRecargo.length
            ? `Recargo según el medio de pago: ${conRecargo.map(id => textoMedioPago(id)).join(', ')}. Lo ves al elegir cómo pagás.`
            : '';
        notaRecargo.classList.toggle('hidden', !conRecargo.length);
    }

    // Aviso arriba del pie + botón "Continuar" bloqueado mientras haya productos sin stock
    let aviso = $('carrito-aviso-stock');
    if (!aviso) {
        aviso = el('p', 'mb-3 rounded-xl bg-red-50 text-red-700 text-xs font-semibold leading-snug px-3.5 py-2.5');
        aviso.id = 'carrito-aviso-stock';
        aviso.setAttribute('role', 'alert');
        $('carrito-footer-paso1').prepend(aviso);
    }
    aviso.textContent = agotados.length === 1
        ? 'Un producto de tu carrito se quedó sin stock. Quitalo para poder continuar con el pedido.'
        : `${agotados.length} productos de tu carrito se quedaron sin stock. Quitalos para poder continuar con el pedido.`;
    aviso.classList.toggle('hidden', agotados.length === 0);

    const bloqueado = !carrito.items.length || agotados.length > 0;
    $('carrito-whatsapp-btn').disabled = bloqueado;
    $('carrito-whatsapp-btn').classList.toggle('opacity-40', bloqueado);
    $('carrito-whatsapp-btn').classList.toggle('cursor-not-allowed', agotados.length > 0);
}

function abrirCarrito() {
    mostrarPasoCarrito(1);
    // Stock al día, pero después de la animación del drawer para no competir con ella
    if (emprendedorActual) setTimeout(() => cargarCatalogo(emprendedorActual.id), 350);
    $('carrito-overlay').classList.remove('hidden');
    void $('carrito-drawer').offsetWidth;
    $('carrito-drawer').classList.remove('translate-x-full');
    actualizarBloqueoScroll();
}
function cerrarCarrito() {
    // Los avisos de "precio actualizado" ya se mostraron: no se repiten la próxima vez que abra el carrito
    if (carrito.items.some(i => i.precioAnterior != null)) {
        carrito.items.forEach(i => { delete i.precioAnterior; });
        guardarCarrito();
    }
    $('carrito-drawer').classList.add('translate-x-full');
    $('carrito-overlay').classList.add('hidden');
    actualizarBloqueoScroll();
}

// ------------------------------------------------------------
// PASO 2 DEL CARRITO: DATOS DEL CLIENTE
// Los campos son fijos (no se configuran desde el dashboard): nombre siempre;
// calle y localidad solo con envío a domicilio; medio de pago si el comercio
// tiene alguno cargado; referencias y aclaraciones son opcionales.
// ------------------------------------------------------------
const CLAVE_DATOS_CLIENTE = 'ce_datos_cliente';   // global: es la misma persona en cualquier tienda
let pasoCarrito = 1;
let medioPagoElegido = '';
let checkoutPrecargado = false;

function limpiarTexto(v) {
    return String(v || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function leerDatosGuardados() {
    try {
        const d = JSON.parse(localStorage.getItem(CLAVE_DATOS_CLIENTE) || 'null');
        if (!d || typeof d !== 'object') return {};
        delete d.pago;   // el medio de pago no se recuerda: en cada compra puede ser distinto
        return d;
    } catch { return {}; }
}

function borrarDatosGuardados() {
    try { localStorage.removeItem(CLAVE_DATOS_CLIENTE); } catch { /* noop */ }
    ['co-nombre', 'co-telefono', 'co-calle', 'co-localidad', 'co-referencia', 'co-notas'].forEach(id => { $(id).value = ''; });
    medioPagoElegido = '';
    renderMediosPagoCheckout();
    renderResumenCheckout();
    $('co-borrar-datos').classList.add('hidden');
    mostrarToastCarrito('Datos borrados');
}

function conEnvioADomicilio() { return modalidadEnvio === true && costoEnvio() > 0; }

// Medios de pago aceptados por TODOS los productos del carrito
// (cada producto puede tener los suyos; si no, usa los del comercio).
function mediosDelCarrito() {
    const listas = carrito.items.map(i => {
        const p = productosTienda.find(x => String(x.id) === String(i.productoId));
        return p ? mediosDelProducto(p) : (Array.isArray(emprendedorActual?.medios_pago) ? emprendedorActual.medios_pago : []);
    });
    if (!listas.length) return [];
    return listas.reduce((a, b) => a.filter(m => b.includes(m)));
}

function datosCheckout() {
    return {
        nombre: limpiarTexto($('co-nombre').value),
        telefono: soloDigitos($('co-telefono').value),
        calle: limpiarTexto($('co-calle').value),
        localidad: limpiarTexto($('co-localidad').value),
        referencia: limpiarTexto($('co-referencia').value),
        notas: limpiarTexto($('co-notas').value),
        pago: medioPagoElegido,
        envio: conEnvioADomicilio(),
    };
}

function marcarErrorCheckout(campo, msg) {
    const p = $('co-error-' + campo);
    if (p) { p.textContent = msg || ''; p.classList.toggle('hidden', !msg); }
    const inp = $('co-' + campo);
    if (inp && inp.tagName !== 'DIV') {
        inp.classList.toggle('co-error', !!msg);
        inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
}

function validarCheckout() {
    const d = datosCheckout();
    const errores = [];
    if (d.nombre.length < 2) errores.push(['nombre', 'Ingresá tu nombre y apellido.']);
    if (pedidosEnPanel() && (d.telefono.length < 8 || d.telefono.length > 15)) {
        errores.push(['telefono', 'Ingresá un teléfono válido, con característica y sin 0 ni 15.']);
    }
    if (d.envio) {
        if (d.calle.length < 3) errores.push(['calle', 'Ingresá la calle y el número.']);
        if (d.localidad.length < 2) errores.push(['localidad', 'Ingresá tu localidad o barrio.']);
    }
    if (mediosDelCarrito().length && !d.pago) errores.push(['pago', 'Elegí cómo vas a pagar.']);

    ['nombre', 'telefono', 'calle', 'localidad', 'pago'].forEach(c => marcarErrorCheckout(c, ''));
    errores.forEach(([campo, msg]) => marcarErrorCheckout(campo, msg));
    if (errores.length) {
        const primero = errores[0][0];
        const destino = primero === 'pago' ? $('co-pago-opciones') : $('co-' + primero);
        destino.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (primero !== 'pago') destino.focus({ preventScroll: true });
    }
    return errores.length === 0;
}

function renderMediosPagoCheckout() {
    const medios = mediosDelCarrito();
    $('co-pago-wrap').classList.toggle('hidden', medios.length === 0);
    if (!medios.includes(medioPagoElegido)) medioPagoElegido = '';
    const cont = $('co-pago-opciones');
    cont.replaceChildren();
    medios.forEach(id => {
        const activo = medioPagoElegido === id;
        const b = el('button', 'flex items-center justify-center gap-2 rounded-xl border py-3 px-2 text-xs font-semibold transition-all [&>span>svg]:w-4 [&>span>svg]:h-4 ' +
            (activo ? 't-acento border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400'));
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', activo ? 'true' : 'false');
        const ic = el('span', 'inline-flex flex-shrink-0');
        ic.innerHTML = iconoMedioPago(id);
        b.append(ic, el('span', 'truncate', nombreMedioPago(id)));
        b.onclick = () => { medioPagoElegido = id; marcarErrorCheckout('pago', ''); renderMediosPagoCheckout(); renderResumenCheckout(); };
        cont.appendChild(b);
    });
}

function renderResumenCheckout() {
    const cont = $('co-resumen');
    cont.replaceChildren();
    const fila = (etiqueta, valor, fuerte) => {
        const f = el('div', 'flex items-center justify-between gap-3');
        f.append(
            el('span', fuerte ? 'text-sm font-medium text-zinc-900' : 'text-sm text-zinc-500', etiqueta),
            el('span', fuerte ? 'text-lg font-semibold tracking-tight text-zinc-900 tabular-nums' : 'text-sm font-medium text-zinc-700 text-right tabular-nums', valor)
        );
        cont.appendChild(f);
    };
    const cant = carrito.items.reduce((s, i) => s + i.cantidad, 0);
    if (costoEnvio() > 0) fila('Entrega', conEnvioADomicilio() ? 'Envío a domicilio' : 'Retiro en el local');
    const pctRecargo = pctRecargoVigente();
    const textoProductos = `${cant} producto${cant === 1 ? '' : 's'}`;
    fila(pctRecargo > 0 || conEnvioADomicilio() ? `Subtotal (${textoProductos})` : textoProductos, formatoPrecio(subtotalBase()));
    if (pctRecargo > 0) fila(`Recargo ${nombreMedioPago(medioPagoElegido)} (${formatoPorcentaje(pctRecargo)}% sobre ${formatoPrecio(subtotalBase())})`, formatoPrecio(recargoCarrito()));
    if (conEnvioADomicilio()) fila('Envío', formatoPrecio(costoEnvio()));
    fila('Total', formatoPrecio(totalCarrito()), true);
}

// Rellena el formulario con lo que el cliente guardó la vez anterior (una sola vez por visita)
function precargarCheckout() {
    const g = leerDatosGuardados();
    if (!checkoutPrecargado) {
        checkoutPrecargado = true;
        $('co-nombre').value = limpiarTexto(g.nombre);
        $('co-telefono').value = soloDigitos(g.telefono);
        $('co-calle').value = limpiarTexto(g.calle);
        $('co-localidad').value = limpiarTexto(g.localidad);
        $('co-referencia').value = limpiarTexto(g.referencia);
    }
    $('co-borrar-datos').classList.toggle('hidden', !Object.keys(g).length);
}

function mostrarPasoCarrito(n) {
    pasoCarrito = n;
    const p2 = n === 2;
    $('carrito-items').classList.toggle('hidden', p2);
    $('carrito-footer-paso1').classList.toggle('hidden', p2);
    $('carrito-checkout').classList.toggle('hidden', !p2);
    $('carrito-footer-paso2').classList.toggle('hidden', !p2);
    $('carrito-volver').classList.toggle('hidden', !p2);
    $('carrito-volver').classList.toggle('inline-flex', p2);
    $('carrito-icono').classList.toggle('hidden', p2);
    $('carrito-titulo').textContent = p2 ? 'Tus datos' : 'Tu carrito';
    if (p2) {
        precargarCheckout();
        $('co-bloque-envio').classList.toggle('hidden', !conEnvioADomicilio());
        $('co-bloque-telefono').classList.toggle('hidden', !pedidosEnPanel());
        actualizarTextoBotonEnviar();
        renderMediosPagoCheckout();
        renderResumenCheckout();
        $('carrito-checkout').scrollTop = 0;
    }
    actualizarCarritoUI();
}

function volverAlCarrito() { mostrarPasoCarrito(1); }

// Misma comprobación que antes se hacía al enviar: se adelanta al paso 1 para que
// nadie complete el formulario y recién después se entere de que no puede pedir.
function verificarPedidoPosible() {
    const e = emprendedorActual;
    const wsp = soloDigitos(e?.whatsapp);
    const sinContacto = !pedidosEnPanel(e) && !wsp;   // en modo panel no hace falta WhatsApp
    if (!pedidosActivos() || sinContacto || String(carrito.emprendedorId) !== String(e.id)) {
        $('sin-whatsapp-tienda').textContent = (e?.nombre_tienda || '').trim() || 'Este emprendedor';
        $('modal-sin-whatsapp').classList.remove('hidden');
        actualizarBloqueoScroll();
        return false;
    }
    return true;
}

// Barra de carga del botón "Continuar": se ve que algo está pasando mientras se relee el stock.
// Dura al menos CHECKOUT_BARRA_MIN_MS para que el cliente alcance a verla aunque la respuesta sea inmediata.
const CHECKOUT_BARRA_MIN_MS = 500;
let checkoutEnCurso = false;
const esperarMs = (ms) => new Promise(r => setTimeout(r, ms));

function iniciarCargaBoton(btn) {
    btn.classList.add('cargando');
    btn.setAttribute('aria-busy', 'true');
    btn.querySelector('.btn-texto').textContent = 'Verificando…';
}

async function finalizarCargaBoton(btn, inicio, exito) {
    const resto = CHECKOUT_BARRA_MIN_MS - (performance.now() - inicio);
    if (resto > 0) await esperarMs(resto);
    if (exito) {                       // la barra se completa antes de pasar al paso 2
        btn.classList.add('completo');
        await esperarMs(200);
    }
    btn.classList.remove('cargando', 'completo');
    btn.removeAttribute('aria-busy');
    btn.querySelector('.btn-texto').textContent = 'Continuar';
}

async function irACheckout() {
    if (!carrito.items.length || checkoutEnCurso) return;
    checkoutEnCurso = true;
    const btn = $('carrito-whatsapp-btn');
    iniciarCargaBoton(btn);
    const inicio = performance.now();
    let siguiente = null;   // qué hacer cuando la barra termina (null = nada, se queda en el carrito)
    try {
        // Relee el stock por si cambió y la conexión en vivo no llegó a avisar
        if (emprendedorActual) {
            try { await cargarCatalogo(emprendedorActual.id); } catch (err) { console.error('No se pudo revalidar el stock:', err); }
        }
        if (!carrito.items.length) return;
        if (hayItemsSinStock()) { actualizarCarritoUI(); return; }
        if (!verificarPedidoPosible()) return;
        if (costoEnvio() > 0 && modalidadEnvio === null) siguiente = pedirModalidadEntrega;
        else siguiente = () => mostrarPasoCarrito(2);
    } finally {
        await finalizarCargaBoton(btn, inicio, !!siguiente);
        checkoutEnCurso = false;
    }
    if (siguiente) siguiente();
}

// Los errores se limpian apenas el cliente corrige el campo
['nombre', 'telefono', 'calle', 'localidad'].forEach(c => {
    $('co-' + c).addEventListener('input', () => marcarErrorCheckout(c, ''));
});

function guardarDatosSiCorresponde() {
    try {
        if (!$('co-recordar').checked) { localStorage.removeItem(CLAVE_DATOS_CLIENTE); return; }
        const d = datosCheckout();
        localStorage.setItem(CLAVE_DATOS_CLIENTE, JSON.stringify({
            nombre: d.nombre, telefono: d.telefono, calle: d.calle, localidad: d.localidad, referencia: d.referencia,
        }));
    } catch { /* noop */ }
}

// ------------------------------------------------------------
// PEDIDO POR WHATSAPP
// ------------------------------------------------------------
let urlPedido = '';
let urlPedidoWeb = '';

// Link directo a un producto de esta tienda (?producto=<id>), el mismo que abre
// el modal. Parte de la URL actual para respetar tanto /tienda/<usuario> como
// el ?t=<usuario> de desarrollo, y descarta cualquier otro parámetro o #hash.


function armarMensajePedido() {
    const e = emprendedorActual;
    const nombre = (e.nombre_tienda || '').trim();
    const lineas = [`Hola ${nombre}! Quiero hacer este pedido:`, ''];
    carrito.items.forEach(i => {
        lineas.push(`• ${i.cantidad}x ${i.nombre}${i.detalle ? ` (${i.detalle})` : ''} — ${formatoPrecio(i.precio * i.cantidad)}`);
        const link = i.productoId != null ? urlProductoTienda(i.productoId) : '';
        if (link) lineas.push(`  ${link}`);
    });
    lineas.push('');
    if (costoEnvio() > 0) lineas.push(modalidadEnvio ? 'Entrega: envío a domicilio' : 'Entrega: retiro en el local');
    const pctRecargo = pctRecargoVigente();
    const conEnvio = costoEnvio() > 0 && modalidadEnvio;
    if (conEnvio || pctRecargo > 0) {
        lineas.push(`Subtotal: ${formatoPrecio(subtotalBase())}`);
        if (pctRecargo > 0) lineas.push(`Recargo ${nombreMedioPago(medioPagoElegido)} (${formatoPorcentaje(pctRecargo)}% sobre ${formatoPrecio(subtotalBase())}): ${formatoPrecio(recargoCarrito())}`);
        if (conEnvio) lineas.push(`Envío: ${formatoPrecio(costoEnvio())}`);
    }
    lineas.push(`Total: ${formatoPrecio(totalCarrito())}`);

    const d = datosCheckout();
    lineas.push('');
    lineas.push(`Cliente: ${d.nombre}`);
    if (d.envio) lineas.push(`Dirección: ${d.calle}, ${d.localidad}${d.referencia ? ` (${d.referencia})` : ''}`);
    if (d.pago) lineas.push(`Pago: ${nombreMedioPago(d.pago)}`);
    if (d.notas) lineas.push(`Aclaraciones: ${d.notas}`);
    return lineas.join('\n');
}

function actualizarTextoBotonEnviar() {
    const t = $('co-enviar-texto');
    if (t) t.textContent = pedidosEnPanel() ? 'Confirmar pedido' : 'Enviar pedido por WhatsApp';
    const ic = $('co-enviar-ico-wsp');
    if (ic) ic.classList.toggle('hidden', pedidosEnPanel());
    const nota = $('co-nota-privacidad');
    if (nota) nota.textContent = pedidosEnPanel()
        ? 'Tus datos se envían únicamente al comercio para que pueda gestionar y contactarte por tu pedido.'
        : 'Tus datos no se guardan en nuestros servidores: se envían únicamente al comercio dentro del mensaje de WhatsApp.';
}

// ------------------------------------------------------------
// PEDIDO EN EL PANEL (modo "dashboard"): se crea con la función crear_pedido()
// de la base, que revalida stock, variantes y precios en el servidor.
// ------------------------------------------------------------
const ERRORES_PEDIDO = {
    tienda_no_disponible: 'Esta tienda no está disponible para recibir pedidos en este momento.',
    modo_invalido: 'Esta tienda ya no recibe pedidos por este medio. Recargá la página.',
    datos_invalidos: 'Revisá tus datos: hay algún campo incompleto o inválido.',
    carrito_invalido: 'Hubo un problema con tu carrito. Probá quitar y volver a agregar los productos.',
    producto_no_disponible: 'Un producto de tu carrito ya no está disponible.',
    demasiados_pedidos: 'Hiciste varios pedidos seguidos. Esperá unos minutos antes de volver a intentar.',
};

let enviandoPedido = false;

async function crearPedidoEnPanel() {
    if (enviandoPedido) return;
    const e = emprendedorActual;
    const d = datosCheckout();
    const items = carrito.items.map(i => ({
        producto_id: Number(i.productoId),
        variante_ids: idsVariantesDeItem(i).map(Number),
        cantidad: i.cantidad,
    }));

    enviandoPedido = true;
    const btn = $('co-enviar-btn');
    const textoOriginal = $('co-enviar-texto').textContent;
    btn.disabled = true;
    btn.classList.add('opacity-60');
    $('co-enviar-texto').textContent = 'Enviando pedido…';

    try {
        const { data, error } = await supabase.rpc('crear_pedido', {
            p_emprendedor_id: e.id,
            p_nombre: d.nombre,
            p_telefono: d.telefono,
            p_modalidad: d.envio ? 'envio' : 'retiro',
            p_calle: d.envio ? d.calle : '',
            p_localidad: d.envio ? d.localidad : '',
            p_referencia: d.envio ? d.referencia : '',
            p_medio_pago: d.pago || '',
            p_notas: d.notas,
            p_items: items,
        });

        if (error) {
            console.error('Error creando el pedido:', error);
            const codigo = String(error.message || '').trim();
            let msg = ERRORES_PEDIDO[codigo] || 'No pudimos enviar tu pedido. Revisá tu conexión y probá de nuevo.';
            if (codigo === 'producto_no_disponible') {
                // El stock cambió: se refresca el catálogo y el carrito marca lo que falta
                await cargarCatalogo(e.id);
                if (error.details) msg = `"${String(error.details).replace(/^producto \d+$/, '').trim() || 'Un producto'}" ya no está disponible.`;
                else msg = ERRORES_PEDIDO.producto_no_disponible;
                mostrarPasoCarrito(1);
            }
            mostrarToastCarrito(msg, { aviso: true });
            return;
        }

        const pedido = data || {};
        guardarDatosSiCorresponde();
        mostrarPedidoConfirmado(pedido, d);
        limpiarCarrito();
        cerrarCarrito();
    } catch (err) {
        console.error('Error inesperado creando el pedido:', err);
        mostrarToastCarrito('No pudimos enviar tu pedido. Probá de nuevo.', { aviso: true });
    } finally {
        enviandoPedido = false;
        btn.disabled = false;
        btn.classList.remove('opacity-60');
        actualizarTextoBotonEnviar();
    }
}

function mostrarPedidoConfirmado(pedido, d) {
    $('pc-numero').textContent = pedido.numero != null ? `#${pedido.numero}` : '';
    $('pc-tienda').textContent = (emprendedorActual?.nombre_tienda || '').trim() || 'el comercio';
    $('pc-total').textContent = formatoPrecio(pedido.total ?? 0);
    $('pc-entrega').textContent = d.envio ? 'Envío a domicilio' : 'Retiro en el local';
    $('pc-telefono').textContent = d.telefono;
    $('modal-pedido-confirmado').classList.remove('hidden');
    actualizarBloqueoScroll();
}

function cerrarPedidoConfirmado() {
    $('modal-pedido-confirmado').classList.add('hidden');
    actualizarBloqueoScroll();
}

function enviarPedidoWhatsapp() {
    if (!carrito.items.length) return;
    // Si algún producto se quedó sin stock mientras completaban los datos, no se envía:
    // actualizarCarritoUI los devuelve al carrito con el aviso.
    if (hayItemsSinStock()) { actualizarCarritoUI(); return; }
    const e = emprendedorActual;
    const wsp = soloDigitos(e?.whatsapp);
    if (!verificarPedidoPosible()) return;
    if (costoEnvio() > 0 && modalidadEnvio === null) {
        pedirModalidadEntrega();
        return;
    }
    if (!validarCheckout()) return;

    // Modo panel: el pedido se guarda en la base y le llega al comercio en su dashboard
    if (pedidosEnPanel(e)) { crearPedidoEnPanel(); return; }

    guardarDatosSiCorresponde();

    const texto = encodeURIComponent(armarMensajePedido());
    urlPedido = `https://wa.me/${wsp}?text=${texto}`;
    urlPedidoWeb = `https://web.whatsapp.com/send?phone=${wsp}&text=${texto}`;

    const esMovil = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
    if (esMovil) {
        window.open(urlPedido, '_blank', 'noopener');
        return;
    }
    // En PC: QR para escanear con el celular
    const caja = $('qr-pedido-canvas');
    caja.replaceChildren();
    try {
        if (typeof QRCode === 'undefined') throw new Error('QRCode no disponible');
        // Con los links de los productos el mensaje es más largo y el QR queda más
        // denso: lo agrandamos un poco cuando hace falta para que siga escaneando bien.
        const tamQr = urlPedido.length > 900 ? 300 : 260;
        caja.style.width = caja.style.height = `${tamQr}px`;
        new QRCode(caja, { text: urlPedido, width: tamQr, height: tamQr, correctLevel: QRCode.CorrectLevel.L });
    } catch (err) {
        console.error('No se pudo generar el QR:', err);
        caja.appendChild(el('p', 'text-xs font-semibold text-gray-400 px-4', 'No pudimos generar el código. Usá el botón de WhatsApp Web.'));
    }
    cerrarCarrito();
    $('modal-qr-pedido').classList.remove('hidden');
    actualizarBloqueoScroll();
}

function abrirWhatsappWebPedido() { if (urlPedidoWeb) window.open(urlPedidoWeb, '_blank', 'noopener'); }
function intentarCerrarModalQr() { $('modal-qr-pedido').classList.add('hidden'); actualizarBloqueoScroll(); }
function volverAlCarritoDesdeQr() { intentarCerrarModalQr(); abrirCarrito(); }
function confirmarPedidoEnviadoDesdeQr() {
    intentarCerrarModalQr();
    limpiarCarrito();
    mostrarToastCarrito('¡Pedido enviado!');
}
function cerrarModalSinWhatsapp() { $('modal-sin-whatsapp').classList.add('hidden'); actualizarBloqueoScroll(); }

// ------------------------------------------------------------
// TOAST, SCROLL Y TECLADO
// ------------------------------------------------------------
let temporizadorToast = null, temporizadorSalidaToast = null;

function ocultarToastCarrito() {
    clearTimeout(temporizadorToast);
    const t = $('toast-carrito'), card = $('toast-card');
    card.classList.add('saliendo');
    temporizadorSalidaToast = setTimeout(() => {
        t.classList.add('hidden'); t.classList.remove('flex'); card.classList.remove('saliendo');
    }, 180);
}

// opts: { detalle, imagen, verCarrito, aviso }
function mostrarToastCarrito(texto, opts = {}) {
    const t = $('toast-carrito'), card = $('toast-card');
    clearTimeout(temporizadorSalidaToast);
    card.classList.remove('saliendo');
    $('toast-carrito-texto').textContent = texto;
    const det = $('toast-carrito-detalle');
    det.textContent = opts.detalle || '';
    det.classList.toggle('hidden', !opts.detalle);
    const foto = $('toast-foto');
    foto.classList.toggle('hidden', !opts.imagen);
    $('toast-ico').classList.toggle('hidden', !!opts.imagen);
    if (opts.imagen) {
        foto.onerror = () => { foto.onerror = null; foto.src = IMAGEN_PRODUCTO_DEFAULT; };
        foto.src = opts.imagen;
    }
    $('toast-ico').classList.toggle('aviso', !!opts.aviso);
    $('toast-ico-path').setAttribute('d', opts.aviso ? 'M12 8v5m0 3h.01' : 'M5 13l4 4L19 7');

    // Con el carrito abierto, el aviso se apoya arriba del pie (para no tapar el botón de pedir)
    const drawerAbierto = !$('carrito-drawer').classList.contains('translate-x-full');
    const pie = ['carrito-footer-paso1', 'carrito-footer-paso2'].map($).find(x => x && !x.classList.contains('hidden'));
    t.style.bottom = (drawerAbierto && pie) ? (pie.offsetHeight + 16) + 'px' : '';
    // En pantallas grandes el carrito es una columna a la derecha: el aviso se centra sobre ella
    const dr = $('carrito-drawer').getBoundingClientRect();
    t.style.left = (drawerAbierto && window.innerWidth >= 640) ? (dr.left + dr.width / 2) + 'px' : '';

    // "Ver carrito" solo tiene sentido si el carrito no está abierto
    const ms = opts.verCarrito && !drawerAbierto ? 4000 : 2200;
    $('toast-carrito-ver').classList.toggle('hidden', !(opts.verCarrito && !drawerAbierto));
    t.classList.remove('hidden');
    t.classList.add('flex');
    // Reinicia entrada y barra de tiempo (también si llegan varios avisos seguidos)
    const barra = card.querySelector('.tc-barra');
    card.style.animation = 'none'; barra.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = ''; barra.style.animation = '';
    barra.style.setProperty('--tc-ms', ms + 'ms');
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(ocultarToastCarrito, ms);
}
// Con el mouse encima no se esconde (para poder tocar el botón)
$('toast-card').addEventListener('mouseenter', () => clearTimeout(temporizadorToast));
$('toast-card').addEventListener('mouseleave', () => { temporizadorToast = setTimeout(ocultarToastCarrito, 1500); });

function verCarritoDesdeToast() {
    ocultarToastCarrito();
    abrirCarrito();
}

function actualizarBloqueoScroll() {
    const hayCapa =
        !$('carrito-drawer').classList.contains('translate-x-full') ||
        !$('lightbox-imagen').classList.contains('hidden') ||
        ['modal-medios-pago-modal', 'modal-qr-pedido', 'modal-conflicto-carrito', 'modal-sin-whatsapp', 'modal-pedido-confirmado']
            .some(id => !$(id).classList.contains('hidden'));
    // Hay que bloquear <html> Y <body>: el CSS tiene "html, body { overflow-x: hidden }",
    // y con eso el scroll de la página lo maneja <html>, no <body>.
    const html = document.documentElement;
    if (hayCapa) {
        // Compensa el ancho de la barra de scroll para que la página no "salte" en PC
        const anchoBarra = window.innerWidth - html.clientWidth;
        html.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        if (anchoBarra > 0) document.body.style.paddingRight = anchoBarra + 'px';
    } else {
        html.style.overflow = '';
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }
}
document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!$('lightbox-imagen').classList.contains('hidden')) return cerrarLightboxImagen();
    if (!$('modal-pedido-confirmado').classList.contains('hidden')) return cerrarPedidoConfirmado();
    if (!$('modal-sin-whatsapp').classList.contains('hidden')) return cerrarModalSinWhatsapp();
    if (!$('modal-conflicto-carrito').classList.contains('hidden')) return cerrarConflictoCarrito();
    if (!$('modal-qr-pedido').classList.contains('hidden')) return intentarCerrarModalQr();
    if (!$('modal-medios-pago-modal').classList.contains('hidden')) return cerrarModalMediosPago();
    if (!$('carrito-drawer').classList.contains('translate-x-full')) return cerrarCarrito();
});



// ------------------------------------------------------------
// URLS
// ------------------------------------------------------------
function obtenerSlug() {
    const t = new URLSearchParams(window.location.search).get('t');
    return t ? t.trim().toLowerCase() : null;
}
function obtenerIdProducto() {
    const q = new URLSearchParams(window.location.search);
    return q.get('p') || q.get('producto') || q.get('id');
}
function esLocal() {
    return location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
}
// Link a la tienda: /tienda/<usuario> en producción, tienda.html?t=<usuario> en local
function urlTienda() {
    const s = encodeURIComponent(obtenerSlug() || '');
    return esLocal() ? `tienda.html?t=${s}` : `/tienda/${s}`;
}
function urlPaginaProducto(id) {
    return `${location.pathname}?t=${encodeURIComponent(obtenerSlug() || '')}&p=${encodeURIComponent(id)}`;
}
// Link completo (para mensajes de WhatsApp y compartir)
function urlProductoTienda(id) {
    return location.origin + urlPaginaProducto(id);
}

// ------------------------------------------------------------
// ESTADOS DE LA PÁGINA
// ------------------------------------------------------------
function mostrarEstado(estado) {
    $('estado-cargando').classList.toggle('hidden', estado !== 'cargando');
    $('estado-error').classList.toggle('hidden', estado !== 'error');
    $('producto-contenido').classList.toggle('hidden', estado !== 'contenido');
    if (estado !== 'contenido') $('mobile-sticky-bar').classList.add('hidden');
}

function mostrarError(tipo) {
    const textos = {
        conexion: ['No pudimos cargar el producto', 'Revisá tu conexión y probá de nuevo en unos segundos.'],
        'no-encontrada': ['Esta tienda no existe', 'Revisá que el link esté bien escrito o pedile uno nuevo al comercio.'],
        inactiva: ['Esta tienda está inactiva', 'Por el momento este comercio no está disponible. Volvé a intentarlo más adelante.'],
        producto: ['Producto no disponible', 'Puede que se haya eliminado o que el enlace esté incompleto.'],
    };
    const [titulo, texto] = textos[tipo] || textos.producto;
    $('error-titulo').textContent = titulo;
    $('error-texto').textContent = texto;
    $('error-reintentar').classList.toggle('hidden', tipo !== 'conexion');
    const ir = $('error-ir-tienda');
    const conTienda = !!obtenerSlug() && tipo !== 'no-encontrada';
    ir.href = conTienda ? urlTienda() : 'index.html';
    ir.textContent = conTienda ? 'Volver a la tienda' : 'Ir al inicio';
    // Si la tienda no llegó a cargar, no dejar el skeleton del encabezado latiendo para siempre
    if (!emprendedorActual) { $('nav-tienda-skeleton').classList.add('hidden'); $('nav-tienda-marco').classList.add('hidden'); }
    document.body.classList.add('modo-catalogo');
    mostrarEstado('error');
}

// ------------------------------------------------------------
// CARGA
// ------------------------------------------------------------
function pedirPorSlug(slug) {
    return supabase
        .from('emprendedores')
        .select('*, usuarios!inner(usuario)')
        .eq('usuarios.usuario', slug)
        .eq('activo', true)
        .maybeSingle();
}
function pedirPorId(id) {
    return supabase
        .from('emprendedores')
        .select('*, usuarios(usuario)')
        .eq('id', id)
        .eq('activo', true)
        .maybeSingle();
}

async function cargarCatalogo(emprendedorId) {
    if (tiendaInactiva(emprendedorActual)) return;
    const { data, error } = await supabase
        .from('productos')
        .select('*, categorias(id, nombre)')
        .eq('emprendedor_id', emprendedorId)
        .order('destacado', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error cargando el producto:', error);
        if (!catalogoCargado) mostrarError('conexion');
        return;
    }

    const productos = data || [];
    let variantes = [];
    if (productos.length) {
        const r = await supabase.from('variantes').select('*').in('producto_id', productos.map(p => p.id));
        if (r.error) console.error('Error cargando variantes:', r.error);
        else variantes = r.data || [];
    }
    productos.forEach(p => {
        p.variantes = variantes.filter(v => String(v.producto_id) === String(p.id));
    });

    const rc = await supabase
        .from('categorias_tienda')
        .select('*')
        .eq('emprendedor_id', emprendedorId)
        .order('orden')
        .order('nombre');
    categoriasTiendaPublica = rc.error ? [] : (rc.data || []);

    const firma = JSON.stringify([productos, categoriasTiendaPublica]);
    if (catalogoCargado && productoAbierto && firma === firmaCatalogo) {
        actualizarCarritoUI();
        return;
    }
    firmaCatalogo = firma;
    productosTienda = productos;
    catalogoCargado = true;
    sincronizarProducto();
    actualizarCarritoUI();
}

// Pone en pantalla el producto de la URL con los datos más nuevos (primera carga o refresco en vivo)
function sincronizarProducto() {
    const nuevo = productosTienda.find(x => String(x.id) === String(obtenerIdProducto()));
    if (!nuevo) { productoAbierto = null; mostrarError('producto'); return; }

    const primera = !productoAbierto;
    productoAbierto = nuevo;

    if (primera) {
        seleccionVariantes = {};
        variantePreferidaFoto = null;
        imagenManual = null;
        cantidadModal = 1;
        $('prod-cantidad').textContent = '1';
        $('mobile-cantidad').textContent = '1';
        // Si un grupo tiene una sola opción disponible, queda elegida
        if (!productoSinStock(nuevo)) {
            gruposDeVariantes(nuevo).forEach((lista, g) => {
                const disp = lista.filter(v => v.disponible !== false);
                if (disp.length === 1) seleccionVariantes[g] = String(disp[0].id);
            });
        }
    } else {
        // El stock pudo cambiar: se sacan las opciones elegidas que ya no existen o se agotaron
        Object.keys(seleccionVariantes).forEach(g => {
            const v = (nuevo.variantes || []).find(x => String(x.id) === String(seleccionVariantes[g]));
            if (!v || v.disponible === false) delete seleccionVariantes[g];
        });
    }

    mostrarEstado('contenido');
    renderProductoEstatico();
    renderVariantesModal();
    actualizarPrecio();
    actualizarAvisoEnCarritoModal();
    actualizarImagen(primera);
}

async function refrescarTienda(id) {
    const { data, error } = await pedirPorId(id);
    if (error) { console.error('Error refrescando la tienda:', error); return; }
    if (!data) { emprendedorActual = null; mostrarError('no-encontrada'); return; }
    emprendedorActual = data;
    renderTienda(data);
    if (tiendaInactiva(data)) { mostrarError('inactiva'); return; }
    if (productoAbierto) {
        mostrarEstado('contenido');
        renderProductoEstatico();
        renderVariantesModal();
        actualizarPrecio();
    }
    actualizarCarritoUI();
}

function iniciarRealtime(id) {
    const recargar = debounce(() => cargarCatalogo(id), 350);
    suscribirTabla('emprendedores', debounce(() => refrescarTienda(id), 350), `id=eq.${id}`);

    // El dashboard guarda primero el producto y después sus variantes: una segunda lectura
    // un poco más tarde agarra las variantes ya actualizadas.
    let segundaLectura = null;
    suscribirTabla('productos', () => {
        recargar();
        clearTimeout(segundaLectura);
        segundaLectura = setTimeout(() => cargarCatalogo(id), 2500);
    }, `emprendedor_id=eq.${id}`);

    // Los DELETE no se pueden filtrar por tienda: se recarga solo si el producto era de esta tienda
    supabase.channel(`productos-eliminados-${id}`)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'productos' }, (payload) => {
            const borrado = payload.old && payload.old.id;
            if (borrado != null && productosTienda.some(p => String(p.id) === String(borrado))) recargar();
        })
        .subscribe();

    supabase.channel(`variantes-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'variantes' }, (payload) => {
            const fila = payload.new && payload.new.producto_id != null ? payload.new : payload.old;
            const pid = fila && fila.producto_id;
            if (pid == null || productosTienda.some(p => String(p.id) === String(pid))) recargar();
        })
        .subscribe();

    document.addEventListener('visibilitychange', () => { if (!document.hidden) recargar(); });
}

// ------------------------------------------------------------
// RENDER: cabecera de la tienda
// ------------------------------------------------------------
function renderTienda(e) {
    aplicarTemaTienda(e);
    const nombre = (e.nombre_tienda || '').trim() || 'Tienda';

    $('nav-tienda-nombre').textContent = formatoNombre(nombre);
    $('nav-tienda-nombre').classList.remove('hidden');
    $('nav-tienda-skeleton').classList.add('hidden');
    $('nav-tienda-marco').classList.remove('cp-skeleton');
    $('nav-tienda-marco').classList.add('bg-zinc-900');
    const inicial = $('nav-tienda-inicial');
    const logoImg = $('nav-tienda-logo');
    inicial.textContent = nombre.charAt(0).toUpperCase();
    const logo = urlSegura(e.logo_url);
    if (logo) {
        logoImg.alt = `Logo de ${nombre}`;
        logoImg.onload = () => { logoImg.classList.remove('hidden'); inicial.classList.add('hidden'); };
        logoImg.onerror = () => { logoImg.classList.add('hidden'); inicial.classList.remove('hidden'); };
        logoImg.src = logo;
    } else {
        logoImg.classList.add('hidden');
        logoImg.removeAttribute('src');
        inicial.classList.remove('hidden');
    }

    const u = urlTienda();
    $('link-volver-tienda').href = u;
    // "Ver todo" lleva directo a la grilla de productos (emprendedor.js lee el #productos)
    const sl = encodeURIComponent(obtenerSlug() || '');
    $('link-ver-todo-catalogo').href = (esLocal() ? `tienda.html?t=${sl}` : `/tienda?t=${sl}`) + '#productos';

    const anuncio = (e.anuncio || '').trim();
    $('perfil-anuncio-texto').textContent = anuncio;
    $('perfil-anuncio-wrap').classList.toggle('hidden', !anuncio);
}

// ------------------------------------------------------------
// RENDER: producto (todo lo que no depende de las variantes elegidas)
// ------------------------------------------------------------
function renderProductoEstatico() {
    const p = productoAbierto;
    const e = emprendedorActual;
    if (!p || !e) return;

    const pedidos = pedidosActivos();
    const sinStock = productoSinStock(p);
    const nombre = formatoNombre(p.nombre || '');
    const tienda = (e.nombre_tienda || '').trim() || 'Tienda';
    const desc = (p.descripcion || '').trim();
    const cat = nombreCategoriaProducto(p);

    document.body.classList.toggle('modo-catalogo', !pedidos);
    document.title = `${nombre} | ${tienda}`;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.content = desc ? desc.slice(0, 160) : `${nombre} en ${tienda}`;

    // Etiquetas
    $('prod-categoria').textContent = cat;
    $('prod-badge-nuevo').classList.toggle('hidden', sinStock || !esProductoNuevoVigente(p));
    const contBadges = $('prod-badges-custom');
    contBadges.replaceChildren();
    if (!sinStock) normalizarBadges(p.badges).forEach(b => contBadges.appendChild(crearElementoBadge(b, 'modal')));
    $('prod-badge-sin-stock').classList.toggle('hidden', !sinStock);
    const dest = $('prod-badge-destacado');
    dest.classList.toggle('hidden', !p.destacado || sinStock);
    dest.classList.toggle('inline-flex', !!p.destacado && !sinStock);

    $('prod-nombre').textContent = nombre;
    $('prod-desc').textContent = desc;
    $('prod-desc-wrap').classList.toggle('hidden', !desc);

    // Acciones: con pedidos = carrito + consulta; solo catálogo = consulta; sin stock = solo consulta
    const conCarrito = pedidos && !sinStock;
    const wsp = soloDigitos(e.whatsapp);
    $('prod-fila-carrito').classList.toggle('hidden', !conCarrito);
    $('mobile-sticky-bar').classList.toggle('hidden', !conCarrito);
    const aviso = $('prod-aviso-sin-stock');
    aviso.textContent = wsp
        ? 'Este producto está sin stock por el momento. Podés consultar si va a volver a estar disponible.'
        : 'Este producto está sin stock por el momento.';
    aviso.classList.toggle('hidden', !sinStock);

    const link = $('prod-whatsapp');
    if (wsp) {
        const msg = `Hola ${(e.nombre_tienda || '').trim()}, vi "${p.nombre}" en su catálogo online y quiero consultarles.\n${urlProductoTienda(p.id)}`;
        link.href = `https://wa.me/${wsp}?text=${encodeURIComponent(msg)}`;
        const icono = '<svg class="w-[18px] h-[18px] flex-shrink-0' + (conCarrito ? ' text-[#25D366]' : '') + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.48 1.32 4.99L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.005c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.13-2.9-7C17.17 3.03 14.69 2 12.04 2zm5.8 14.13c-.24.68-1.4 1.32-1.93 1.4-.5.08-1.11.11-1.79-.11-.41-.13-.94-.31-1.61-.6-2.83-1.22-4.67-4.06-4.81-4.25-.14-.19-1.15-1.53-1.15-2.92s.72-2.07.98-2.35c.26-.28.56-.35.75-.35h.53c.17 0 .4-.02.62.48.24.55.81 1.9.88 2.04.07.14.11.3.02.49-.09.19-.14.31-.28.48-.14.16-.29.36-.42.48-.14.14-.28.29-.13.57.16.28.7 1.16 1.51 1.88 1.04.93 1.92 1.22 2.2 1.36.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.19-.28.37-.23.62-.14.26.1 1.63.77 1.91.91.28.14.47.21.53.33.07.12.07.68-.17 1.36z"/></svg>';
        link.innerHTML = icono + '<span>' + (conCarrito ? '¿Dudas? Consultar por WhatsApp' : 'Consultar por WhatsApp') + '</span>';
        link.className = conCarrito
            ? 'inline-flex items-center justify-center gap-2 w-full h-11 rounded-xl border border-zinc-300 bg-white text-zinc-800 text-sm font-semibold hover:bg-zinc-50 transition-colors'
            : 't-acento inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-zinc-900 text-white text-sm font-semibold hover:bg-zinc-800 transition-colors';
    } else {
        link.removeAttribute('href');
        link.classList.add('hidden');
    }
    $('prod-acciones').classList.toggle('hidden', !conCarrito && !wsp && !sinStock);

    // Entrega y horario del comercio
    const envio = Number(e.costo_envio) || 0;
    const mostrarEnvio = pedidos && envio > 0;
    $('prod-info-envio').textContent = mostrarEnvio ? formatoPrecio(envio) : '';
    $('prod-info-envio-wrap').classList.toggle('hidden', !mostrarEnvio);
    const horario = (e.horario_atencion || '').trim();
    $('prod-info-horario').textContent = horario;
    $('prod-info-horario-wrap').classList.toggle('hidden', !horario);
    $('prod-info-local').classList.toggle('hidden', !mostrarEnvio && !horario);

    renderRelacionados();
}

function renderRelacionados() {
    const p = productoAbierto;
    const cont = $('prod-relacionados');
    cont.replaceChildren();
    if (!p) return;

    const otros = productosTienda.filter(x => String(x.id) !== String(p.id) && !productoSinStock(x));
    const misma = (x) =>
        (p.categoria_tienda_id != null && String(x.categoria_tienda_id) === String(p.categoria_tienda_id)) ||
        (p.categoria_id != null && String(x.categoria_id) === String(p.categoria_id));
    const lista = [...otros.filter(misma), ...otros.filter(x => !misma(x))].slice(0, 4);
    $('prod-relacionados-wrap').classList.toggle('hidden', lista.length === 0);

    lista.forEach(x => {
        const pct = calcularDescuentoPorcentaje(x.precio_anterior, x.precio);
        const card = el('a', 'prod-card group relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col');
        card.href = urlPaginaProducto(x.id);
        card.setAttribute('aria-label', `Ver ${x.nombre || 'producto'}`);

        const wrap = el('div', 'relative aspect-square bg-gray-50 overflow-hidden');
        const img = el('img', 'w-full h-full object-contain p-2 sm:p-3');
        img.loading = 'lazy';
        img.alt = x.nombre || 'Producto';
        img.src = urlSegura(urlGrillaProducto(x, 400)) || IMAGEN_PRODUCTO_DEFAULT;
        img.onerror = () => { img.onerror = null; img.src = IMAGEN_PRODUCTO_DEFAULT; };
        wrap.appendChild(img);
        if (pct > 0) wrap.appendChild(el('span', 'absolute top-2 left-2 bg-red-600 text-white text-[11px] sm:text-xs font-bold tabular-nums px-2 py-0.5 rounded-full shadow-sm', `-${pct}%`));

        const body = el('div', 'p-3 sm:p-4 flex flex-col gap-1 flex-1');
        body.appendChild(el('h3', 'f-display text-[15px] sm:text-[17px] font-semibold tracking-[-0.01em] leading-snug line-clamp-2 break-words text-zinc-900', formatoNombre(x.nombre || '')));
        const precios = el('div', 'mt-auto pt-2');
        if (pct > 0) precios.appendChild(el('p', 'text-xs font-medium text-gray-500 line-through tabular-nums leading-none', formatoPrecio(x.precio_anterior)));
        precios.appendChild(el('p', 'text-[17px] sm:text-xl font-bold tracking-tight tabular-nums leading-tight text-zinc-900', formatoPrecio(x.precio)));
        body.appendChild(precios);

        card.append(wrap, body);
        cont.appendChild(card);
    });
}

// ------------------------------------------------------------
// IMAGEN PRINCIPAL Y MINIATURAS
// ------------------------------------------------------------
// Foto que corresponde mostrar: la elegida a mano en las miniaturas, o la de la variante elegida
// (la última que tocó el cliente), o la del producto.
function urlImagenModal() {
    const p = productoAbierto;
    if (imagenManual) return imagenManual;
    const conFoto = variantesElegidas().filter(v => urlSegura(fotoDeVariante(v).url));
    const pref = conFoto.find(v => String(v.id) === String(variantePreferidaFoto));
    const v = pref || conFoto[conFoto.length - 1];
    return urlSegura(v ? fotoDeVariante(v).url : '') || urlSegura(p?.imagen_url) || IMAGEN_PRODUCTO_DEFAULT;
}

function galeriaProducto() {
    const p = productoAbierto;
    const items = [];
    const vistas = new Set();
    const agregar = (url, thumb, variante) => {
        const u = urlSegura(url);
        if (!u || vistas.has(u)) return;
        vistas.add(u);
        items.push({ url: u, thumb: urlSegura(miniaturaCloudinary(thumb || url, 160)) || u, variante });
    };
    const propia = urlSegura(p.imagen_url);
    if (propia && propia !== urlSegura(IMAGEN_PRODUCTO_DEFAULT)) agregar(p.imagen_url, p.imagen_thumb_url, null);
    (p.variantes || []).forEach(v => {
        if (v.usa_foto_producto) return;
        const f = fotoDeVariante(v);
        agregar(f.url, f.thumb, v);
    });
    return items;
}

function renderThumbs() {
    const cont = $('prod-thumbs');
    cont.replaceChildren();
    if (!productoAbierto) return;
    const galeria = galeriaProducto();
    if (galeria.length < 2) return;
    const actual = urlSegura(urlImagenModal());
    galeria.forEach((it, i) => {
        const activa = it.url === actual;
        const b = el('button', 'flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-zinc-50 border transition-all ' +
            (activa ? 'border-zinc-900 ring-2 ring-zinc-900 ring-offset-2' : 'border-zinc-200 hover:border-zinc-900') +
            (it.variante && it.variante.disponible === false ? ' opacity-50' : ''));
        b.type = 'button';
        b.setAttribute('aria-label', it.variante ? `Ver foto de ${(it.variante.valor || '').trim() || 'la opción'}` : `Ver foto ${i + 1}`);
        b.setAttribute('aria-pressed', activa ? 'true' : 'false');
        const im = el('img', 'w-full h-full object-cover');
        im.src = it.thumb;
        im.alt = '';
        im.loading = 'lazy';
        im.draggable = false;
        im.onerror = () => { im.remove(); };
        b.appendChild(im);
        b.onclick = () => elegirFoto(it);
        cont.appendChild(b);
    });
}

function elegirFoto(it) {
    if (it.variante && it.variante.disponible !== false) {
        const g = (it.variante.nombre || '').trim() || 'Opción';
        seleccionVariantes[g] = String(it.variante.id);
        variantePreferidaFoto = it.variante.id;
        imagenManual = null;
        renderVariantesModal();
        actualizarPrecio();
    } else {
        imagenManual = it.url;
    }
    actualizarImagen();
}

// Cambia la foto con un fundido corto. Precarga la nueva y solo muestra el loader si tarda.
function actualizarImagen(primera = false) {
    if (!productoAbierto) return;
    const url = urlImagenModal();
    const img = $('prod-img');
    const loader = $('prod-img-loader');
    const fallback = urlSegura(productoAbierto.imagen_url) || IMAGEN_PRODUCTO_DEFAULT;

    if (!primera && url === destinoImagen) { renderThumbs(); return; }
    destinoImagen = url;
    renderThumbs();
    const token = ++imgToken;

    if (primera) {
        const inicio = performance.now();
        img.alt = productoAbierto.nombre || '';
        img.classList.add('cargando');
        loader.classList.remove('oculto');
        const fin = () => {
            img.onload = null;
            const espera = Math.max(0, 500 - (performance.now() - inicio));
            setTimeout(() => {
                if (token !== imgToken) return;
                img.classList.remove('cargando');
                loader.classList.add('oculto');
            }, espera);
        };
        img.onload = fin;
        img.onerror = () => { img.onerror = fin; img.src = IMAGEN_PRODUCTO_DEFAULT; };
        img.src = url;
        return;
    }

    let listo = false;
    const timerLoader = setTimeout(() => {
        if (listo || token !== imgToken) return;
        img.classList.add('cargando');
        loader.classList.remove('oculto');
    }, 200);
    const aplicar = (src) => {
        if (token !== imgToken) return;
        listo = true;
        clearTimeout(timerLoader);
        img.onload = null;
        img.onerror = null;
        img.classList.add('cargando');
        setTimeout(() => {
            if (token !== imgToken) return;
            img.src = src;
            img.classList.remove('cargando');
            loader.classList.add('oculto');
        }, 160);
    };
    const pre = new Image();
    pre.onload = () => aplicar(url);
    pre.onerror = () => aplicar(fallback);
    pre.src = url;
}

// ------------------------------------------------------------
// PRECIO, CANTIDAD Y AGREGAR AL CARRITO
// ------------------------------------------------------------
function actualizarPrecio() {
    actualizarPrecioBase();
    const oferta = !$('prod-badge-oferta').classList.contains('hidden');
    $('prod-img-oferta').textContent = $('prod-badge-oferta').textContent;
    $('prod-img-oferta').classList.toggle('hidden', !oferta);

    // La barra de abajo (mobile) refleja el mismo estado que el botón principal
    const b = $('prod-btn-agregar');
    const m = $('mobile-btn-agregar');
    m.disabled = b.disabled;
    if (!b.classList.contains('btn-add-ok') && !m.classList.contains('btn-add-ok')) {
        $('mobile-btn-agregar-texto').textContent = $('prod-btn-agregar-texto').textContent;
    }
}

function modificarCantidad(delta) {
    cantidadModal = Math.min(99, Math.max(1, cantidadModal + delta));
    $('prod-cantidad').textContent = String(cantidadModal);
    $('mobile-cantidad').textContent = String(cantidadModal);
}

function agregarAlCarrito() {
    const p = productoAbierto;
    if (!p || !pedidosActivos() || productoSinStock(p) || !seleccionCompleta()) return;
    if (agregarItem(p, cantidadModal, variantesElegidas())) confirmarAgregadoModal();
}

// Los botones "Agregar al carrito" (principal y barra mobile) muestran un check + "¡Agregado!"
function confirmarAgregadoModal() {
    [['prod-btn-agregar', 'prod-btn-agregar-texto'], ['mobile-btn-agregar', 'mobile-btn-agregar-texto']].forEach(([idBtn, idTxt]) => {
        const btn = $(idBtn);
        const txt = $(idTxt);
        const svg = btn.querySelector('svg');
        if (btn._iconoHTML === undefined) btn._iconoHTML = svg.innerHTML;
        clearTimeout(btn._timerAgregado);
        btn.classList.remove('btn-add-ok');
        void btn.offsetWidth;
        svg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 12.5l4.5 4.5L19 7.5"/>';
        txt.textContent = '¡Agregado!';
        btn.classList.add('btn-add-ok');
        btn._timerAgregado = setTimeout(() => {
            btn.classList.remove('btn-add-ok');
            svg.innerHTML = btn._iconoHTML;
            txt.textContent = seleccionCompleta() ? 'Agregar al carrito' : 'Elegí una opción';
        }, 1400);
    });
}

// Se llama desde actualizarCarritoUI cada vez que cambia el carrito
function actualizarMarcasCarrito() {
    actualizarAvisoEnCarritoModal();
}

// ------------------------------------------------------------
// COMPARTIR
// ------------------------------------------------------------
async function compartirProducto() {
    const p = productoAbierto;
    if (!p) return;
    const url = urlProductoTienda(p.id);
    const nombre = formatoNombre(p.nombre || '') || 'Producto';
    const tienda = (emprendedorActual?.nombre_tienda || '').trim() || 'Tienda';
    if (navigator.share) {
        try {
            await navigator.share({ title: nombre, text: `Mirá ${nombre} en ${tienda}`, url });
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return;
        }
    }
    await copiarAlPortapapeles(url, 'Enlace copiado.');
    const btn = $('btn-compartir-producto');
    btn.querySelector('.icono-compartir').classList.add('hidden');
    btn.querySelector('.icono-ok').classList.remove('hidden');
    setTimeout(() => {
        btn.querySelector('.icono-compartir').classList.remove('hidden');
        btn.querySelector('.icono-ok').classList.add('hidden');
    }, 1500);
}

// ------------------------------------------------------------
// ARRANQUE
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    iniciarLightbox();
    actualizarCarritoUI();

    const slug = obtenerSlug();
    const pid = obtenerIdProducto();
    if (!slug) { mostrarError('no-encontrada'); return; }
    if (pid == null || pid === '') { mostrarError('producto'); return; }

    const { data, error } = await pedirPorSlug(slug);
    if (error) {
        console.error('Error cargando la tienda:', error);
        mostrarError('conexion');
        return;
    }
    if (!data) { mostrarError('no-encontrada'); return; }

    emprendedorActual = data;
    migrarCarritoAntiguo(data);
    validarCarritoDeTienda(data);
    iniciarRealtime(data.id);
    renderTienda(data);

    if (tiendaInactiva(data)) { mostrarError('inactiva'); return; }

    actualizarCarritoUI();
    await cargarCatalogo(data.id);
});