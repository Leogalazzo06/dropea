// ============================================================
// TIENDA PÚBLICA  (/tienda/<usuario>)
// Perfil del negocio, catálogo, modal de producto y carrito (pedidos por WhatsApp).
//
// Depende de supabase-client.js (cargado antes), que aporta:
//   supabase, formatoPrecio, nombreMedioPago, iconoMedioPago,
//   suscribirTabla, debounce, mostrarToast.
//
// Probar en local (sin la regla de Vercel):  tienda.html?t=<usuario>
// ============================================================

let emprendedorActual = null;

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------
// UTILIDADES
// ------------------------------------------------------------

// El slug viene de la ruta /tienda/<usuario>; en local, de ?t=<usuario>
function obtenerSlug() {
    const m = window.location.pathname.match(/^\/tienda\/([^/]+)/i);
    if (m) {
        try { return decodeURIComponent(m[1]).trim().toLowerCase() || null; }
        catch { return null; }
    }
    const t = new URLSearchParams(window.location.search).get('t');
    return t ? t.trim().toLowerCase() : null;
}

// Los comercios escriben sus propios links (redes, mapa, logo, portada):
// solo se aceptan http/https para que nadie pueda colar un "javascript:".
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

// ¿Esta tienda recibe pedidos por WhatsApp? (si no, funciona solo como catálogo)
function pedidosActivos(e = emprendedorActual) {
    return !!e && e.recibe_pedidos === true && soloDigitos(e.whatsapp).length > 0;
}

// ¿La tienda terminó su prueba gratis (o está bloqueada)? Usa la misma regla que el
// panel del comercio (calcularEstadoAcceso, en supabase-client.js).
function tiendaInactiva(e) {
    return !!e && calcularEstadoAcceso(e).bloqueado === true;
}

// Muestra la tienda como inactiva: sin catálogo, sin carrito.
function mostrarTiendaInactiva() {
    $('seccion-catalogo').classList.add('hidden');
    document.body.classList.add('modo-catalogo');
    mostrarError('inactiva');
}

function mostrarEstado(estado) {
    $('estado-cargando').classList.toggle('hidden', estado !== 'cargando');
    $('estado-error').classList.toggle('hidden', estado !== 'error');
    $('perfil-contenido').classList.toggle('hidden', estado !== 'contenido');
}

function mostrarError(tipo) {
    if (tipo === 'conexion') {
        $('error-titulo').textContent = 'No pudimos cargar la tienda';
        $('error-texto').textContent = 'Revisá tu conexión y probá de nuevo en unos segundos.';
        $('error-reintentar').classList.remove('hidden');
    } else if (tipo === 'inactiva') {
        $('error-titulo').textContent = 'Esta tienda está inactiva';
        $('error-texto').textContent = 'Por el momento este comercio no está disponible. Volvé a intentarlo más adelante.';
        $('error-reintentar').classList.add('hidden');
    } else {
        $('error-titulo').textContent = 'Esta tienda no existe';
        $('error-texto').textContent = 'Revisá que el link esté bien escrito o pedile uno nuevo al comercio.';
        $('error-reintentar').classList.add('hidden');
    }
    mostrarEstado('error');
}

// ------------------------------------------------------------
// CARGA
// ------------------------------------------------------------

// "!inner" hace que el filtro por usuarios.usuario descarte filas de
// emprendedores; con un join común no filtraría nada. El RLS ya oculta
// los comercios bloqueados, pero igual se filtra por "activo".
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

document.addEventListener('DOMContentLoaded', async () => {
    const slug = obtenerSlug();
    if (!slug) { mostrarError('no-encontrada'); return; }

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

    if (tiendaInactiva(data)) { mostrarTiendaInactiva(); return; }

    renderPerfil(data);
    mostrarEstado('contenido');

    cargarCatalogo(data.id);
});

// Si el comercio edita su perfil (o cambia el modo catálogo / pedidos)
// con la página abierta, se actualiza sola.
function iniciarRealtime(id) {
    suscribirTabla('emprendedores', debounce(() => refrescarPerfil(id), 350), `id=eq.${id}`);
    const recargar = debounce(() => cargarCatalogo(id), 350);
    suscribirTabla('productos', recargar, `emprendedor_id=eq.${id}`);

    // Los DELETE no se pueden filtrar por emprendedor_id en Supabase Realtime (el evento
    // solo trae la clave primaria), así que la suscripción de arriba nunca los recibe.
    // Escuchamos los DELETE sin filtro y recargamos solo si el producto era de esta tienda.
    supabase.channel(`productos-eliminados-${id}`)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'productos' }, (payload) => {
            const borrado = payload.old && payload.old.id;
            if (borrado != null && productosTienda.some(p => String(p.id) === String(borrado))) recargar();
        })
        .subscribe();
}

async function refrescarPerfil(id) {
    const { data, error } = await pedirPorId(id);
    if (error) { console.error('Error refrescando el perfil:', error); return; }
    if (!data) { emprendedorActual = null; $('seccion-catalogo').classList.add('hidden'); mostrarError('no-encontrada'); return; }
    emprendedorActual = data;
    if (tiendaInactiva(data)) { mostrarTiendaInactiva(); return; }
    renderPerfil(data);
    mostrarEstado('contenido');
}

// ------------------------------------------------------------
// RENDER DEL PERFIL
// (todo el texto del comercio entra con textContent: nada de innerHTML
// con datos que escribió otra persona)
// ------------------------------------------------------------
function renderPerfil(e) {
    const nombre = (e.nombre_tienda || '').trim() || 'Tienda';
    const bio = (e.bio || '').trim();
    const pedidos = pedidosActivos(e);

    // Pestaña y descripción
    document.title = `${nombre} | Catálogo`;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.content = bio ? bio.slice(0, 160) : `Catálogo online de ${nombre}`;

    // Modo: sin pedidos la tienda es solo catálogo (el carrito del paso 2
    // se oculta con la clase "modo-catalogo")
    document.body.classList.toggle('modo-catalogo', !pedidos);
    $('perfil-modo-texto').textContent = pedidos ? 'Este comercio recibe pedidos' : 'Catálogo online';
    $('perfil-modo-punto').classList.toggle('bg-green-500', pedidos);
    $('perfil-modo-punto').classList.toggle('bg-gray-300', !pedidos);

    // Anuncio
    const anuncio = (e.anuncio || '').trim();
    $('perfil-anuncio-texto').textContent = anuncio;
    $('perfil-anuncio-wrap').classList.toggle('hidden', !anuncio);

    // Portada (si no hay, se muestra el fondo por defecto de marca)
    const banner = urlSegura(e.banner_url);
    $('perfil-banner').style.backgroundImage = banner ? `url("${banner}")` : '';
    $('perfil-banner-patron').classList.toggle('hidden', !!banner);

    // Logo (si no hay o no carga, se muestra la inicial)
    const logoImg = $('perfil-logo');
    const inicial = $('perfil-logo-inicial');
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

    // Nombre y bio
    $('perfil-nombre').textContent = nombre;
    $('perfil-bio').textContent = bio;
    $('perfil-bio').classList.toggle('hidden', !bio);

    // WhatsApp (sin número cargado, el botón no se muestra)
    const wsp = soloDigitos(e.whatsapp);
    const btnWsp = $('perfil-whatsapp');
    if (wsp) {
        const msg = `Hola ${nombre}, vi su catálogo online y quiero hacerles una consulta.`;
        btnWsp.href = `https://wa.me/${wsp}?text=${encodeURIComponent(msg)}`;
        btnWsp.classList.remove('hidden');
    } else {
        btnWsp.removeAttribute('href');
        btnWsp.classList.add('hidden');
    }

    // Redes
    configurarRedSocial('perfil-instagram', e.instagram);
    configurarRedSocial('perfil-facebook', e.facebook);
    configurarRedSocial('perfil-tiktok', e.tiktok);

    renderInfoLocal(e, pedidos);
    if (typeof actualizarCarritoUI === 'function') actualizarCarritoUI();
}

function configurarRedSocial(elementId, valor) {
    const a = $(elementId);
    const url = urlSegura(valor);
    if (url) {
        a.href = url;
        a.classList.remove('hidden');
        a.classList.add('flex');
    } else {
        a.removeAttribute('href');
        a.classList.add('hidden');
        a.classList.remove('flex');
    }
}

function renderInfoLocal(e, pedidos) {
    // Ubicación (+ link al mapa)
    const ubicacion = (e.ubicacion || '').trim();
    const mapa = urlSegura(e.mapa_url);
    $('perfil-ubicacion').textContent = ubicacion || 'Ver ubicación';
    const aMapa = $('perfil-mapa');
    if (mapa) aMapa.href = mapa; else aMapa.removeAttribute('href');
    aMapa.classList.toggle('hidden', !mapa);
    $('perfil-ubicacion-wrap').classList.toggle('hidden', !ubicacion && !mapa);

    // Horario
    const horario = (e.horario_atencion || '').trim();
    $('perfil-horario').textContent = horario;
    $('perfil-horario-wrap').classList.toggle('hidden', !horario);

    // Medios de pago (el ícono es un SVG fijo de supabase-client.js; el nombre va como texto)
    const medios = Array.isArray(e.medios_pago) ? e.medios_pago : [];
    const contMedios = $('perfil-medios-pago');
    contMedios.replaceChildren();
    medios.forEach((id) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const icono = document.createElement('span');
        icono.className = 'inline-flex';
        icono.innerHTML = iconoMedioPago(id);
        const texto = document.createElement('span');
        texto.textContent = nombreMedioPago(id);
        chip.append(icono, texto);
        contMedios.appendChild(chip);
    });
    $('perfil-medios-pago-wrap').classList.toggle('hidden', medios.length === 0);

    // Envío: solo tiene sentido si la tienda recibe pedidos y cargó un costo
    const envio = Number(e.costo_envio) || 0;
    const mostrarEnvio = pedidos && envio > 0;
    $('perfil-envio').textContent = mostrarEnvio ? `${formatoPrecio(envio)}` : '';
    $('perfil-envio-wrap').classList.toggle('hidden', !mostrarEnvio);

    // El panel completo solo aparece si hay al menos un dato
    const hayInfo = ['perfil-ubicacion-wrap', 'perfil-horario-wrap', 'perfil-medios-pago-wrap', 'perfil-envio-wrap']
        .some((id) => !$(id).classList.contains('hidden'));
    $('perfil-info-panel').classList.toggle('hidden', !hayInfo);
    $('seccion-catalogo').classList.remove('hidden');
}

// ------------------------------------------------------------
// CATÁLOGO
// Se muestran TODOS los productos del comercio: los que tienen activo = false
// (o todas sus variantes sin stock) salen con el aviso "Sin stock" y no se pueden
// pedir. Requiere SELECT público (RLS) sobre productos, variantes y categorias.
// ------------------------------------------------------------
let productosTienda = [];
let filtroCategoria = '';
let categoriasTiendaPublica = [];   // filas de categorias_tienda de este comercio (árbol)
let filtroTexto = '';
let productoAbierto = null;          // producto que se ve en el modal
let seleccionVariantes = {};         // { grupo: id de variante }
let cantidadModal = 1;
let productoDeLaURL = new URLSearchParams(window.location.search).get('producto');

// ¿El producto está sin stock? En el panel, "sin stock" = producto con activo = false
// (también se desactiva solo cuando todas sus variantes están sin stock).
function productoSinStock(p) {
    if (!p) return false;
    if (p.activo === false) return true;
    const v = p.variantes || [];
    return v.length > 0 && v.every(x => x.disponible === false);
}

function el(tag, clase, texto) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
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
        console.error('Error cargando el catálogo:', error);
        const v = $('catalogo-vacio');
        $('catalogo-armando').classList.add('hidden');
        v.textContent = 'No pudimos cargar los productos. Probá de nuevo en unos segundos';
        v.classList.remove('hidden');
        $('catalogo-contenido').replaceChildren();
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

    // Categorías propias del comercio (las que arma en el dashboard)
    const rc = await supabase
        .from('categorias_tienda')
        .select('*')
        .eq('emprendedor_id', emprendedorId)
        .order('orden')
        .order('nombre');
    if (rc.error) {
        console.error('Error cargando categorias_tienda (¿falta policy SELECT pública?):', rc.error);
        categoriasTiendaPublica = [];
    } else {
        categoriasTiendaPublica = rc.data || [];
    }

    // Los disponibles primero; los sin stock al final (se conserva el orden de cada grupo)
    productosTienda = [...productos.filter(p => !productoSinStock(p)), ...productos.filter(productoSinStock)];
    renderFiltrosCatalogo();
    renderCatalogo();

    // Link directo a un producto (?producto=<id>)
    if (productoDeLaURL) {
        const id = productoDeLaURL;
        productoDeLaURL = null;
        if (productosTienda.some(p => String(p.id) === String(id))) abrirModalProducto(id);
    }
}

// ---- Categorías de la tienda (categorias_tienda) ----
// Se usan si el comercio tiene categorías y al menos un producto asignado
// (categoria_tienda_id). Si no, se cae a las categorías globales (categorias).
function usaCategoriasTienda() {
    return categoriasTiendaPublica.length > 0 &&
        productosTienda.some(p => p.categoria_tienda_id != null);
}

function hijosCategoriaTienda(padreId) {   // padreId: null (raíz) o string
    return categoriasTiendaPublica
        .filter(c => (c.parent_id == null ? null : String(c.parent_id)) === padreId)
        .sort((a, b) => ((a.orden || 0) - (b.orden || 0)) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

// ids (string) de una categoría y todas sus descendientes
function idsSubarbolTienda(id) {
    const ids = new Set([String(id)]);
    let crecio = true;
    while (crecio) {
        crecio = false;
        categoriasTiendaPublica.forEach(c => {
            if (c.parent_id != null && ids.has(String(c.parent_id)) && !ids.has(String(c.id))) {
                ids.add(String(c.id));
                crecio = true;
            }
        });
    }
    return ids;
}

function cantidadProductosCategoriaTienda(id) {
    const ids = idsSubarbolTienda(id);
    return productosTienda.filter(p => p.categoria_tienda_id != null && ids.has(String(p.categoria_tienda_id))).length;
}

// Camino desde la raíz hasta la categoría: [raíz, ..., categoría]
function rutaCategoriaTienda(id) {
    const ruta = [];
    let actual = categoriasTiendaPublica.find(c => String(c.id) === String(id));
    let guarda = 0;
    while (actual && guarda++ < 10) {
        ruta.unshift(actual);
        const pid = actual.parent_id;
        actual = pid == null ? null : categoriasTiendaPublica.find(c => String(c.id) === String(pid));
    }
    return ruta;
}

// Nombre a mostrar en la card / modal: la categoría de la tienda más específica,
// o la categoría global si el producto no tiene una de la tienda.
function nombreCategoriaProducto(p) {
    if (p.categoria_tienda_id != null) {
        const c = categoriasTiendaPublica.find(x => String(x.id) === String(p.categoria_tienda_id));
        if (c) return c.nombre;
    }
    return p.categorias?.nombre || '';
}

let catAbierta = '';   // id de la categoría cuyo panel de subcategorías está abierto

const SVG_CHEVRON = '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';

function renderFiltrosCatalogo() {
    $('catalogo-filtros').classList.toggle('hidden', productosTienda.length === 0);

    const cont = $('catalogo-categorias');
    cont.replaceChildren();
    // Una fila de píldoras (solo títulos) y, debajo, el panel de subcategorías si hay uno abierto
    cont.className = 'flex flex-col gap-3 mb-6 sm:mb-8';

    const elegir = (id) => { filtroCategoria = id; catAbierta = ''; renderFiltrosCatalogo(); renderCatalogo(); };

    if (usaCategoriasTienda()) {
        if (filtroCategoria && !categoriasTiendaPublica.some(c => String(c.id) === filtroCategoria)) filtroCategoria = '';
        // Solo se muestran categorías que tienen productos (ellas o sus subcategorías)
        const visibles = (padreId) => hijosCategoriaTienda(padreId).filter(c => cantidadProductosCategoriaTienda(c.id) > 0);
        const ruta = filtroCategoria ? rutaCategoriaTienda(filtroCategoria) : [];
        const raices = visibles(null);

        cont.classList.toggle('hidden', raices.length === 0);
        if (!raices.length) return;
        if (catAbierta && !raices.some(c => String(c.id) === catAbierta)) catAbierta = '';

        // --- Fila de píldoras: Todo + una por categoría principal ---
        const row = el('div', 'flex gap-2 overflow-x-auto scrollbar-hide pb-1');

        const todo = el('button', 'cat-chip' + (!filtroCategoria ? ' activa' : ''), 'Todo');
        todo.type = 'button';
        todo.onclick = () => elegir('');
        row.appendChild(todo);

        raices.forEach(c => {
            const id = String(c.id);
            const tieneHijos = visibles(id).length > 0;
            const activa = ruta[0] && String(ruta[0].id) === id;
            const abierta = catAbierta === id;

            const b = el('button', 'cat-chip' + (activa ? ' activa' : '') + (abierta ? ' abierta' : ''));
            b.type = 'button';
            b.appendChild(el('span', null, c.nombre));
            // Si hay una subcategoría elegida, se ve en la píldora aunque el panel esté cerrado
            if (activa && ruta.length > 1) b.appendChild(el('span', 'cat-chip-sub', ruta[ruta.length - 1].nombre));
            if (tieneHijos) {
                const chev = el('span', 'cat-chevron');
                chev.innerHTML = SVG_CHEVRON;
                b.appendChild(chev);
                b.setAttribute('aria-expanded', abierta ? 'true' : 'false');
                b.setAttribute('aria-controls', 'cat-panel');
            }
            b.onclick = () => {
                if (!tieneHijos) return elegir(id);
                catAbierta = abierta ? '' : id;
                renderFiltrosCatalogo();
            };
            row.appendChild(b);
        });
        cont.appendChild(row);

        // --- Panel de subcategorías de la píldora abierta ---
        if (catAbierta) {
            const raiz = raices.find(c => String(c.id) === catAbierta);
            const panel = el('div', 'cat-panel');
            panel.id = 'cat-panel';

            const head = el('div', 'cat-panel-head');
            head.appendChild(el('span', 'cat-panel-titulo', raiz.nombre));
            const acciones = el('div', 'flex items-center gap-2');
            const verTodo = el('button', 'cat-sub cat-sub-todo' + (filtroCategoria === catAbierta ? ' activa' : ''), 'Ver todo');
            verTodo.type = 'button';
            verTodo.onclick = () => elegir(catAbierta);
            const cerrar = el('button', 'cat-panel-cerrar');
            cerrar.type = 'button';
            cerrar.setAttribute('aria-label', 'Cerrar subcategorías');
            cerrar.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18"/></svg>';
            cerrar.onclick = () => { catAbierta = ''; renderFiltrosCatalogo(); };
            acciones.append(verTodo, cerrar);
            head.appendChild(acciones);
            panel.appendChild(head);

            // Subcategorías; si alguna tiene a su vez hijos, se muestran anidadas debajo
            const nivel = (padreId, destino, prof) => {
                visibles(padreId).forEach(c => {
                    const id = String(c.id);
                    const b = el('button', 'cat-sub' + (filtroCategoria === id ? ' activa' : ''));
                    b.type = 'button';
                    b.append(el('span', null, c.nombre), el('span', 'cat-sub-n', String(cantidadProductosCategoriaTienda(c.id))));
                    b.onclick = () => elegir(id);
                    destino.appendChild(b);
                    if (prof < 4 && visibles(id).length) {
                        const anidado = el('div', 'cat-panel-anidado');
                        nivel(id, anidado, prof + 1);
                        destino.appendChild(anidado);
                    }
                });
            };
            const lista = el('div', 'cat-panel-lista');
            nivel(catAbierta, lista, 0);
            panel.appendChild(lista);
            cont.appendChild(panel);
        }
        return;
    }

    // Respaldo: categorías globales (sin subcategorías, píldoras simples como antes)
    const cats = new Map();
    productosTienda.forEach(p => { if (p.categorias) cats.set(String(p.categorias.id), p.categorias.nombre); });
    if (filtroCategoria && !cats.has(filtroCategoria)) filtroCategoria = '';
    cont.classList.toggle('hidden', cats.size < 2);
    if (cats.size > 1) {
        const row = el('div', 'flex gap-2 overflow-x-auto scrollbar-hide pb-1');
        [['', 'Todo'], ...cats].forEach(([id, nombre]) => {
            const b = el('button', 'cat-chip' + (filtroCategoria === id ? ' activa' : ''), nombre);
            b.type = 'button';
            b.onclick = () => elegir(id);
            row.appendChild(b);
        });
        cont.appendChild(row);
    }
}

// El panel de subcategorías se cierra al tocar fuera o con Escape
// (composedPath porque el click re-renderiza y el target ya no está en el DOM)
document.addEventListener('click', (ev) => {
    if (!catAbierta) return;
    if (ev.composedPath().includes($('catalogo-categorias'))) return;
    catAbierta = '';
    renderFiltrosCatalogo();
});
document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && catAbierta) { catAbierta = ''; renderFiltrosCatalogo(); }
});

// ------------------------------------------------------------
// BUSCADOR (mismo funcionamiento que el de la home)
// Mientras se escribe solo se actualiza el panel de sugerencias; el catálogo
// de abajo no se toca. Se filtra recién con Enter o con "Ver los N resultados".
// ------------------------------------------------------------
const MAX_SUGERENCIAS = 6;
const SVG_FLECHA = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';

const inputBuscar = $('catalogo-buscar');
const panelSugerencias = $('catalogo-sugerencias');
const btnLimpiarBusqueda = $('catalogo-buscar-clear');
let timerSugerencias = null;

function textoBusqueda() { return inputBuscar.value.trim(); }

// La X de "borrar" aparece solo si hay texto
function actualizarBotonLimpiar() {
    const hayTexto = inputBuscar.value !== '';
    btnLimpiarBusqueda.classList.toggle('hidden', !hayTexto);
    btnLimpiarBusqueda.classList.toggle('flex', hayTexto);
}

function cerrarSugerencias() {
    panelSugerencias.classList.add('hidden');
    panelSugerencias.replaceChildren();
}

// Bloques grises "pulsando" al instante, para que se vea que el buscador reaccionó
function mostrarSkeletonBusqueda() {
    panelSugerencias.replaceChildren();
    const lista = el('div', 'divide-y divide-zinc-200/60');
    for (let i = 0; i < 3; i++) {
        const fila = el('div', 'flex items-center gap-3 px-3.5 py-3');
        fila.appendChild(el('div', 'cp-skeleton w-11 h-11 rounded-xl flex-shrink-0'));
        const textos = el('div', 'flex-1 min-w-0 space-y-1.5');
        textos.append(el('div', 'cp-skeleton h-3 rounded w-3/4'), el('div', 'cp-skeleton h-2 rounded w-1/3'));
        fila.append(textos, el('div', 'cp-skeleton h-3 w-10 rounded flex-shrink-0'));
        lista.appendChild(fila);
    }
    panelSugerencias.appendChild(lista);
    panelSugerencias.classList.remove('hidden');
}

function crearFilaSugerencia(p) {
    const fila = el('button', 'group/sug w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/[0.04] focus-visible:bg-zinc-900/[0.04] focus-visible:outline-none transition-colors text-left');
    fila.type = 'button';
    fila.setAttribute('role', 'option');
    fila.onclick = () => { cerrarSugerencias(); abrirModalProducto(p.id); };

    const img = el('img', 'w-11 h-11 rounded-lg object-contain p-0.5 flex-shrink-0 bg-zinc-100/70');
    img.alt = '';
    img.loading = 'lazy';
    img.src = urlSegura(urlGrillaProducto(p, 60)) || IMAGEN_PRODUCTO_DEFAULT;
    img.onerror = () => { img.onerror = null; img.src = IMAGEN_PRODUCTO_DEFAULT; };

    const textos = el('div', 'flex-1 min-w-0');
    const sinStock = productoSinStock(p);
    if (sinStock) img.className += ' grayscale opacity-50';
    textos.appendChild(el('p', 'text-[13px] font-semibold leading-tight truncate ' + (sinStock ? 'text-zinc-400' : 'text-zinc-900'), p.nombre || ''));
    const cat = nombreCategoriaProducto(p);
    if (cat) textos.appendChild(el('p', 'text-[11px] font-medium text-zinc-500 truncate mt-0.5', cat));

    const flecha = el('span', 'text-zinc-300 group-hover/sug:text-zinc-700 group-hover/sug:translate-x-0.5 transition-all flex-shrink-0');
    flecha.innerHTML = SVG_FLECHA;

    const derecha = sinStock
        ? el('span', 'text-[10px] font-semibold uppercase tracking-wide bg-zinc-100 text-zinc-600 rounded-md px-2 py-1 flex-shrink-0', 'Sin stock')
        : el('span', 'text-sm font-semibold text-zinc-900 tabular-nums flex-shrink-0', formatoPrecio(p.precio));
    fila.append(img, textos, derecha, flecha);
    return fila;
}

function mostrarSugerencias() {
    const original = textoBusqueda();
    const q = original.toLowerCase();
    if (!q) { cerrarSugerencias(); return; }

    const coincidencias = productosTienda.filter(p => (p.nombre || '').toLowerCase().includes(q));
    panelSugerencias.replaceChildren();

    if (!coincidencias.length) {
        const caja = el('div', 'px-6 py-8 text-center');
        caja.appendChild(el('p', 'text-sm font-semibold text-zinc-900 break-words', `Sin resultados para "${original}"`));
        caja.appendChild(el('p', 'text-xs font-medium text-zinc-500 mt-1', 'Probá con otra palabra o revisá cómo lo escribiste.'));
        panelSugerencias.appendChild(caja);
        panelSugerencias.classList.remove('hidden');
        return;
    }

    const lista = el('div', 'divide-y divide-zinc-200/60');
    coincidencias.slice(0, MAX_SUGERENCIAS).forEach(p => lista.appendChild(crearFilaSugerencia(p)));
    panelSugerencias.appendChild(lista);

    const n = coincidencias.length;
    const pie = el('button', 'w-full flex items-center justify-between gap-2 px-4 py-3 bg-zinc-900/[0.03] hover:bg-zinc-900/[0.06] border-t border-zinc-200/70 text-xs font-semibold text-zinc-800 transition-colors');
    pie.type = 'button';
    pie.appendChild(el('span', null, `Ver ${n === 1 ? 'el' : 'los'} ${n} resultado${n === 1 ? '' : 's'}`));
    const flecha = el('span', 'inline-flex text-zinc-500');
    flecha.innerHTML = SVG_FLECHA;
    pie.appendChild(flecha);
    pie.onclick = verTodosResultados;
    panelSugerencias.appendChild(pie);
    panelSugerencias.classList.remove('hidden');
}

// Lleva el catálogo al inicio de la grilla, dejando lugar al buscador pegado arriba
// (el header ya no acompaña el scroll, así que no suma al tope)
function irAlCatalogo() {
    const cats = $('catalogo-categorias');
    const destino = cats && !cats.classList.contains('hidden') ? cats : $('catalogo-contenido');
    const barra = $('catalogo-filtros');
    const tope = (barra ? barra.offsetHeight : 0) + 24;
    const y = destino.getBoundingClientRect().top + window.scrollY - tope;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

// Recién acá el catálogo se filtra por el texto buscado
function verTodosResultados() {
    cerrarSugerencias();
    inputBuscar.blur();
    filtroTexto = textoBusqueda().toLowerCase();
    renderCatalogo();
    irAlCatalogo();
}

function limpiarBusqueda() {
    inputBuscar.value = '';
    actualizarBotonLimpiar();
    cerrarSugerencias();
    if (filtroTexto) { filtroTexto = ''; renderCatalogo(); }
    inputBuscar.focus();
}

inputBuscar.addEventListener('input', () => {
    clearTimeout(timerSugerencias);
    actualizarBotonLimpiar();
    if (textoBusqueda() === '') {
        // Borraron todo: el catálogo vuelve a mostrarse completo
        cerrarSugerencias();
        if (filtroTexto) { filtroTexto = ''; renderCatalogo(); }
        return;
    }
    mostrarSkeletonBusqueda();
    timerSugerencias = setTimeout(mostrarSugerencias, 500);
});

// Si ya hay texto y vuelven a tocar el input, se reabren las sugerencias
inputBuscar.addEventListener('focus', () => {
    if (textoBusqueda() !== '') mostrarSugerencias();
});

inputBuscar.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
        cerrarSugerencias();
        inputBuscar.blur();
    } else if (ev.key === 'Enter') {
        ev.preventDefault();
        clearTimeout(timerSugerencias);
        verTodosResultados();
    }
});

btnLimpiarBusqueda.addEventListener('click', limpiarBusqueda);

// Tocar fuera del buscador cierra las sugerencias
document.addEventListener('click', (ev) => {
    if (!ev.target.closest('#catalogo-buscar') && !ev.target.closest('#catalogo-sugerencias')) cerrarSugerencias();
});

function renderCatalogo() {
    const grid = $('catalogo-contenido');
    const vacio = $('catalogo-vacio');
    grid.replaceChildren();

    let coincideCategoria = () => true;
    if (filtroCategoria) {
        if (usaCategoriasTienda()) {
            const ids = idsSubarbolTienda(filtroCategoria);
            coincideCategoria = p => p.categoria_tienda_id != null && ids.has(String(p.categoria_tienda_id));
        } else {
            coincideCategoria = p => String(p.categoria_id) === filtroCategoria;
        }
    }

    const lista = productosTienda.filter(p =>
        coincideCategoria(p) &&
        (!filtroTexto || (p.nombre || '').toLowerCase().includes(filtroTexto))
    );

    // Tienda recién creada, sin ningún producto: mensaje amable en vez de un cartel seco
    const armando = $('catalogo-armando');
    if (productosTienda.length === 0) {
        armando.classList.remove('hidden');
        vacio.classList.add('hidden');
        return;
    }
    armando.classList.add('hidden');

    if (lista.length === 0) {
        vacio.textContent = 'No encontramos productos con esa búsqueda';
        vacio.classList.remove('hidden');
        return;
    }
    vacio.classList.add('hidden');
    lista.forEach(p => grid.appendChild(crearCardProducto(p)));
}

// ------------------------------------------------------------
// CARD DE PRODUCTO
// El botón "agregar" lleva la clase "solo-pedidos": el CSS lo oculta
// cuando la tienda está en modo catálogo. La card siempre abre el modal.
// ------------------------------------------------------------
function crearCardProducto(p) {
    const pct = calcularDescuentoPorcentaje(p.precio_anterior, p.precio);

    const sinStock = productoSinStock(p);

    const card = el('article', 'prod-card group relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col cursor-pointer animate-fade-in');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Ver ${p.nombre || 'producto'}`);
    card.onclick = () => abrirModalProducto(p.id);
    card.onkeydown = (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrirModalProducto(p.id); }
    };

    // Imagen + badges
    const wrap = el('div', 'relative aspect-square bg-gray-50 overflow-hidden');
    const img = el('img', 'prod-img w-full h-full object-contain p-2 sm:p-3' + (sinStock ? ' grayscale opacity-50' : ''));
    img.loading = 'lazy';
    img.alt = p.nombre || 'Producto';
    img.src = urlSegura(urlGrillaProducto(p, 400)) || IMAGEN_PRODUCTO_DEFAULT;
    img.onerror = () => { img.onerror = null; img.src = IMAGEN_PRODUCTO_DEFAULT; };
    wrap.appendChild(img);

    // Cartel "Sin stock" sobre la foto
    if (sinStock) {
        const cartel = el('span', 'absolute inset-x-0 bottom-0 z-[1] bg-black/85 text-white text-center text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em] py-1.5', 'Sin stock');
        cartel.setAttribute('role', 'status');
        wrap.appendChild(cartel);
    }

    const badges = el('div', 'absolute top-2 left-2 flex flex-col items-start gap-1');
    if (!sinStock && esProductoNuevoVigente(p)) badges.appendChild(el('span', 'bg-blue-800 text-white text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm', 'Nuevo'));
    if (!sinStock && pct > 0) badges.appendChild(el('span', 'bg-red-600 text-white text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm', `-${pct}%`));
    if (badges.children.length) wrap.appendChild(badges);

    if (p.destacado && !sinStock) {
        const star = el('span', 'absolute top-2 right-2 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-blue-800 text-white flex items-center justify-center shadow-md shadow-blue-800/40');
        star.title = 'Destacado';
        star.innerHTML = '<svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 15.8l-5.2 2.72.99-5.8-4.21-4.1 5.82-.85L12 2.5z"/></svg>';
        wrap.appendChild(star);
    }

    // Cuerpo
    const body = el('div', 'p-3 sm:p-4 flex flex-col gap-1 flex-1');
    if (nombreCategoriaProducto(p)) body.appendChild(el('span', 'text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-gray-400 truncate', nombreCategoriaProducto(p)));
    body.appendChild(el('h3', 'text-[13px] sm:text-[15px] font-black uppercase italic leading-tight line-clamp-2 break-words ' + (sinStock ? 'text-zinc-400' : 'text-zinc-900'), p.nombre || ''));

    const fila = el('div', 'mt-auto pt-2 flex items-end justify-between gap-2');
    const precios = el('div', 'min-w-0');
    if (!sinStock && pct > 0) precios.appendChild(el('p', 'text-[11px] sm:text-xs font-bold text-gray-400 line-through leading-none', formatoPrecio(p.precio_anterior)));
    precios.appendChild(el('p', 'text-base sm:text-xl font-black tracking-tight leading-tight ' + (sinStock ? 'text-zinc-400' : 'text-zinc-900'), formatoPrecio(p.precio)));
    fila.appendChild(precios);

    // Sin stock: no hay botón de agregar (la card igual abre el detalle)
    if (sinStock) {
        body.appendChild(fila);
        card.append(wrap, body);
        return card;
    }

    const add = el('button', 'solo-pedidos flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black text-white flex items-center justify-center hover:bg-blue-800 hover:text-white transition-all active:scale-90');
    add.type = 'button';
    add.setAttribute('aria-label', `Agregar ${p.nombre || 'producto'} al carrito`);
    add.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.8" aria-hidden="true"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>';
    add.onclick = (ev) => { ev.stopPropagation(); agregarRapido(p); };
    fila.appendChild(add);

    body.appendChild(fila);
    card.append(wrap, body);
    return card;
}

// Sin variantes se agrega directo; con variantes hay que elegir en el modal.
function agregarRapido(p) {
    if (!pedidosActivos() || productoSinStock(p)) return;
    if (p.variantes && p.variantes.length) { abrirModalProducto(p.id); return; }
    agregarItem(p, 1, []);
}

// ------------------------------------------------------------
// VARIANTES (precio_adicional > 0 = precio final de esa variante)
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// MODAL DE PRODUCTO (se abre siempre; el carrito solo si recibe pedidos)
// ------------------------------------------------------------
function abrirModalProducto(id) {
    const p = productosTienda.find(x => String(x.id) === String(id));
    if (!p) return;
    productoAbierto = p;
    seleccionVariantes = {};
    cantidadModal = 1;

    const e = emprendedorActual || {};
    const pedidos = pedidosActivos();
    const pct = calcularDescuentoPorcentaje(p.precio_anterior, p.precio);

    const img = $('modal-img');
    img.alt = p.nombre || '';
    img.onerror = () => { img.onerror = null; img.src = IMAGEN_PRODUCTO_DEFAULT; };
    img.src = urlSegura(p.imagen_url) || IMAGEN_PRODUCTO_DEFAULT;

    $('modal-tienda').textContent = (e.nombre_tienda || 'Tienda').trim();
    $('modal-nombre').textContent = p.nombre || '';
    $('modal-categoria').textContent = nombreCategoriaProducto(p);
    const sinStock = productoSinStock(p);
    $('modal-badge-nuevo').classList.toggle('hidden', sinStock || !esProductoNuevoVigente(p));
    $('modal-badge-sin-stock').classList.toggle('hidden', !sinStock);
    const dest = $('modal-badge-destacado');
    dest.classList.toggle('hidden', !p.destacado || sinStock);
    dest.classList.toggle('inline-flex', !!p.destacado && !sinStock);

    const desc = (p.descripcion || '').trim();
    $('modal-desc').textContent = desc;
    $('modal-desc').classList.add('whitespace-pre-line');
    $('modal-desc-wrap').classList.toggle('hidden', !desc);

    // Medios de pago: los del producto, o los de la tienda si no definió
    const medios = mediosDelProducto(p);
    const wrapMedios = $('modal-medios-pago-wrap');
    wrapMedios.classList.toggle('hidden', medios.length === 0);
    wrapMedios.classList.toggle('inline-flex', medios.length > 0);

    // Variantes: si un grupo tiene una sola opción disponible, queda elegida
    if (!sinStock) {
        gruposDeVariantes(p).forEach((lista, g) => {
            const disp = lista.filter(v => v.disponible !== false);
            if (disp.length === 1) seleccionVariantes[g] = String(disp[0].id);
        });
    }
    renderVariantesModal();

    $('modal-cantidad').textContent = '1';
    actualizarPrecioModal();

    // Acciones: pedidos = carrito + consulta; catálogo = solo consulta.
    // Sin stock: no hay carrito, solo la consulta por WhatsApp.
    const conCarrito = pedidos && !sinStock;
    const wsp = soloDigitos(e.whatsapp);
    const filaCarrito = $('modal-btn-agregar').parentElement;
    filaCarrito.classList.toggle('hidden', !conCarrito);
    let avisoSinStock = $('modal-aviso-sin-stock');
    if (!avisoSinStock) {
        avisoSinStock = el('p', 'mb-3 rounded-xl bg-zinc-100 text-zinc-600 text-[13px] font-medium leading-snug px-3.5 py-2.5');
        avisoSinStock.id = 'modal-aviso-sin-stock';
        $('modal-acciones').prepend(avisoSinStock);
    }
    avisoSinStock.textContent = wsp
        ? 'Este producto está sin stock por el momento. Podés consultar si va a volver a estar disponible.'
        : 'Este producto está sin stock por el momento.';
    avisoSinStock.classList.toggle('hidden', !sinStock);
    const link = $('modal-whatsapp');
    if (wsp) {
        const msg = `Hola ${(e.nombre_tienda || '').trim()}, vi "${p.nombre}" en su catálogo online y quiero consultarles.\n${urlProductoTienda(p.id)}`;
        link.href = `https://wa.me/${wsp}?text=${encodeURIComponent(msg)}`;
        // Con pedidos: botón secundario (la acción principal es "Agregar al carrito").
        // Solo catálogo: la consulta por WhatsApp pasa a ser la acción principal.
        const iconoWsp = '<svg class="w-[18px] h-[18px] flex-shrink-0' + (conCarrito ? ' text-[#25D366]' : '') + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.48 1.32 4.99L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.005c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.13-2.9-7C17.17 3.03 14.69 2 12.04 2zm5.8 14.13c-.24.68-1.4 1.32-1.93 1.4-.5.08-1.11.11-1.79-.11-.41-.13-.94-.31-1.61-.6-2.83-1.22-4.67-4.06-4.81-4.25-.14-.19-1.15-1.53-1.15-2.92s.72-2.07.98-2.35c.26-.28.56-.35.75-.35h.53c.17 0 .4-.02.62.48.24.55.81 1.9.88 2.04.07.14.11.3.02.49-.09.19-.14.31-.28.48-.14.16-.29.36-.42.48-.14.14-.28.29-.13.57.16.28.7 1.16 1.51 1.88 1.04.93 1.92 1.22 2.2 1.36.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.19-.28.37-.23.62-.14.26.1 1.63.77 1.91.91.28.14.47.21.53.33.07.12.07.68-.17 1.36z"/></svg>';
        link.innerHTML = iconoWsp + '<span>¿Dudas? Consultar por el producto</span>';
        link.className = conCarrito
            ? 'mt-3 inline-flex items-center justify-center gap-2 w-full h-11 rounded-xl border border-zinc-300 bg-white text-zinc-800 text-sm font-semibold hover:bg-zinc-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2'
            : 'inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-zinc-900 text-white text-sm font-semibold hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2';
        link.rel = 'noopener';
    } else {
        link.removeAttribute('href');
        link.classList.add('hidden');
    }
    $('modal-acciones').classList.toggle('hidden', !conCarrito && !wsp && !sinStock);

    $('modal-producto-overlay').classList.add('abierto');
    $('modal-producto').classList.add('abierto');
    actualizarBloqueoScroll();

    // Link compartible
    try {
        const u = new URL(window.location.href);
        u.searchParams.set('producto', p.id);
        history.replaceState(null, '', u.href);
    } catch { /* noop */ }
}

function cerrarModal() {
    $('modal-producto-overlay').classList.remove('abierto');
    $('modal-producto').classList.remove('abierto');
    productoAbierto = null;
    actualizarBloqueoScroll();
    try {
        const u = new URL(window.location.href);
        if (u.searchParams.has('producto')) {
            u.searchParams.delete('producto');
            history.replaceState(null, '', u.href);
        }
    } catch { /* noop */ }
}

function mediosDelProducto(p) {
    if (Array.isArray(p.medios_pago) && p.medios_pago.length) return p.medios_pago;
    return Array.isArray(emprendedorActual?.medios_pago) ? emprendedorActual.medios_pago : [];
}

function renderVariantesModal() {
    const cont = $('modal-variantes');
    cont.replaceChildren();
    if (!productoAbierto) return;

    gruposDeVariantes(productoAbierto).forEach((lista, grupo) => {
        const bloque = el('div');
        const elegida = lista.find(v => String(v.id) === seleccionVariantes[grupo]);

        // "Talle" o "Talle: M" cuando ya hay una opción elegida
        const titulo = el('p', 'text-[13px] font-medium text-zinc-500 mb-2', grupo);
        if (elegida) titulo.appendChild(el('span', 'text-zinc-900', ': ' + ((elegida.valor || '').trim() || '—')));
        bloque.appendChild(titulo);

        const opciones = el('div', 'flex flex-wrap gap-2');
        lista.forEach(v => {
            const sinStock = v.disponible === false;
            const activa = seleccionVariantes[grupo] === String(v.id);
            const b = el('button',
                'min-w-[2.75rem] px-3.5 py-2 rounded-lg border text-sm font-medium transition-colors ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 ' +
                (sinStock ? 'border-zinc-200 bg-zinc-50 text-zinc-300 line-through cursor-not-allowed'
                    : activa ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-300 bg-white text-zinc-800 hover:border-zinc-900'),
                (v.valor || '').trim() || '—');
            b.type = 'button';
            b.disabled = sinStock;
            b.setAttribute('aria-pressed', activa ? 'true' : 'false');
            if (sinStock) b.title = 'Sin stock';
            b.onclick = () => {
                seleccionVariantes[grupo] = activa ? undefined : String(v.id);
                if (activa) delete seleccionVariantes[grupo];
                renderVariantesModal();
                actualizarPrecioModal();
            };
            opciones.appendChild(b);
        });
        bloque.appendChild(opciones);
        cont.appendChild(bloque);
    });
}

function actualizarPrecioModal() {
    const p = productoAbierto;
    if (!p) return;
    const elegidas = variantesElegidas();
    const final = precioUnitario(p, elegidas);
    const conPrecioPropio = elegidas.some(v => (Number(v.precio_adicional) || 0) > 0);
    const pct = calcularDescuentoPorcentaje(p.precio_anterior, p.precio);
    const oferta = pct > 0 && !conPrecioPropio;

    $('modal-precio').textContent = formatoPrecio(final);
    $('modal-precio-anterior').textContent = oferta ? formatoPrecio(p.precio_anterior) : '';
    $('modal-precio-anterior').classList.toggle('hidden', !oferta);
    $('modal-badge-oferta').textContent = `-${pct}%`;
    $('modal-badge-oferta').classList.toggle('hidden', !oferta);

    const completa = seleccionCompleta();
    $('modal-btn-agregar').disabled = !completa || productoSinStock(p);
    $('modal-btn-agregar-texto').textContent = completa ? 'Agregar al carrito' : 'Elegí una opción';
}

function modificarCantidadModal(delta) {
    cantidadModal = Math.min(99, Math.max(1, cantidadModal + delta));
    $('modal-cantidad').textContent = String(cantidadModal);
}

function agregarAlCarrito() {
    const p = productoAbierto;
    if (!p || !pedidosActivos() || productoSinStock(p) || !seleccionCompleta()) return;
    if (agregarItem(p, cantidadModal, variantesElegidas())) cerrarModal();
}

async function copiarEnlaceProductoModal() {
    if (!productoAbierto) return;
    const u = new URL(window.location.href);
    u.searchParams.set('producto', productoAbierto.id);
    await copiarAlPortapapeles(u.href, 'Enlace copiado.');
    const btn = $('modal-btn-copiar-enlace');
    btn.querySelector('.icono-enlace').classList.add('hidden');
    btn.querySelector('.icono-copiado').classList.remove('hidden');
    setTimeout(() => {
        btn.querySelector('.icono-enlace').classList.remove('hidden');
        btn.querySelector('.icono-copiado').classList.add('hidden');
    }, 1500);
}

function abrirModalMediosPago() {
    if (!productoAbierto) return;
    const lista = $('modal-medios-pago-lista');
    lista.replaceChildren();
    mediosDelProducto(productoAbierto).forEach(id => {
        const chip = el('span', 'chip');
        const ic = el('span', 'inline-flex');
        ic.innerHTML = iconoMedioPago(id);
        chip.append(ic, el('span', null, nombreMedioPago(id)));
        lista.appendChild(chip);
    });
    $('modal-medios-pago-modal').classList.remove('hidden');
}
function cerrarModalMediosPago() { $('modal-medios-pago-modal').classList.add('hidden'); }

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
    img.src = urlSegura(productoAbierto.imagen_url) || IMAGEN_PRODUCTO_DEFAULT;
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
            imagen: urlSegura(urlGrillaProducto(p, 160)) || '',
            detalle: textoVariantes(elegidas),
        });
    }
    guardarCarrito();
    actualizarCarritoUI();
    mostrarToastCarrito('Agregado al carrito');
    return true;
}

function confirmarReemplazoCarrito() {
    const c = conflictoPendiente;
    cerrarConflictoCarrito();
    if (!c) return;
    carrito = { emprendedorId: null, tienda: '', items: [] };
    agregarItem(c.p, c.cantidad, c.elegidas);
    if (productoAbierto) cerrarModal();
}
function cerrarConflictoCarrito() {
    conflictoPendiente = null;
    $('modal-conflicto-carrito').classList.add('hidden');
    actualizarBloqueoScroll();
}

function cambiarCantidadItem(key, delta) {
    const it = carrito.items.find(i => i.key === key);
    if (!it) return;
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
function subtotalCarrito() { return carrito.items.reduce((s, i) => s + i.precio * i.cantidad, 0); }
function totalCarrito() { return subtotalCarrito() + (modalidadEnvio === true ? costoEnvio() : 0); }

function seleccionarModalidadEntrega(envio) {
    modalidadEnvio = envio;
    actualizarCarritoUI();
}

function actualizarCarritoUI() {
    const cant = carrito.items.reduce((s, i) => s + i.cantidad, 0);
    const badge = $('badge-carrito');
    badge.textContent = String(cant);
    badge.classList.toggle('hidden', cant === 0);

    if (cant === 0 && pasoCarrito === 2) { mostrarPasoCarrito(1); return; }
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
        const fila = el('div', 'flex gap-3.5 py-4');
        const img = el('img', 'w-[68px] h-[68px] rounded-xl object-contain p-1 bg-zinc-50 border border-zinc-100 flex-shrink-0');
        img.alt = '';
        img.src = it.imagen || IMAGEN_PRODUCTO_DEFAULT;
        img.onerror = () => { img.onerror = null; img.src = IMAGEN_PRODUCTO_DEFAULT; };

        const centro = el('div', 'flex-1 min-w-0 flex flex-col');
        centro.appendChild(el('p', 'text-sm font-semibold text-zinc-900 leading-snug line-clamp-2 break-words', it.nombre));
        if (it.detalle) centro.appendChild(el('p', 'text-xs text-zinc-500 mt-0.5 break-words', it.detalle));

        const pie = el('div', 'mt-auto pt-2.5 flex items-center justify-between gap-2');
        const stepper = el('div', 'inline-flex items-center rounded-lg border border-zinc-200 h-8 overflow-hidden');
        const botonStepper = 'w-8 h-full flex items-center justify-center text-base leading-none text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 transition-colors active:bg-zinc-100';
        const menos = el('button', botonStepper, '−');
        const mas = el('button', botonStepper, '+');
        menos.type = mas.type = 'button';
        menos.setAttribute('aria-label', 'Menos'); mas.setAttribute('aria-label', 'Más');
        menos.onclick = () => cambiarCantidadItem(it.key, -1);
        mas.onclick = () => cambiarCantidadItem(it.key, 1);
        stepper.append(menos, el('span', 'min-w-[1.75rem] text-center text-xs font-semibold tabular-nums text-zinc-900', String(it.cantidad)), mas);
        pie.append(stepper, el('span', 'text-sm font-semibold text-zinc-900 tabular-nums', formatoPrecio(it.precio * it.cantidad)));
        centro.appendChild(pie);

        const quitar = el('button', 'self-start w-8 h-8 -mt-1 -mr-1.5 rounded-full text-zinc-300 hover:bg-zinc-100 hover:text-zinc-700 flex items-center justify-center flex-shrink-0 transition-colors');
        quitar.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>';
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
    $('carrito-subtotal').textContent = formatoPrecio(subtotalCarrito());
    $('carrito-envio').textContent = formatoPrecio(envio);
    $('carrito-total').textContent = formatoPrecio(totalCarrito());
    $('carrito-whatsapp-btn').disabled = !carrito.items.length;
    $('carrito-whatsapp-btn').classList.toggle('opacity-40', !carrito.items.length);
}

function abrirCarrito() {
    mostrarPasoCarrito(1);
    $('carrito-overlay').classList.remove('hidden');
    void $('carrito-drawer').offsetWidth;
    $('carrito-drawer').classList.remove('translate-x-full');
    actualizarBloqueoScroll();
}
function cerrarCarrito() {
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
        return d && typeof d === 'object' ? d : {};
    } catch { return {}; }
}

function borrarDatosGuardados() {
    try { localStorage.removeItem(CLAVE_DATOS_CLIENTE); } catch { /* noop */ }
    ['co-nombre', 'co-calle', 'co-localidad', 'co-referencia', 'co-notas'].forEach(id => { $(id).value = ''; });
    medioPagoElegido = '';
    renderMediosPagoCheckout();
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
    if (d.envio) {
        if (d.calle.length < 3) errores.push(['calle', 'Ingresá la calle y el número.']);
        if (d.localidad.length < 2) errores.push(['localidad', 'Ingresá tu localidad o barrio.']);
    }
    if (mediosDelCarrito().length && !d.pago) errores.push(['pago', 'Elegí cómo vas a pagar.']);

    ['nombre', 'calle', 'localidad', 'pago'].forEach(c => marcarErrorCheckout(c, ''));
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
            (activo ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400'));
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', activo ? 'true' : 'false');
        const ic = el('span', 'inline-flex flex-shrink-0');
        ic.innerHTML = iconoMedioPago(id);
        b.append(ic, el('span', 'truncate', nombreMedioPago(id)));
        b.onclick = () => { medioPagoElegido = id; marcarErrorCheckout('pago', ''); renderMediosPagoCheckout(); };
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
    fila(`${cant} producto${cant === 1 ? '' : 's'}`, formatoPrecio(subtotalCarrito()));
    if (conEnvioADomicilio()) fila('Envío', formatoPrecio(costoEnvio()));
    fila('Total', formatoPrecio(totalCarrito()), true);
}

// Rellena el formulario con lo que el cliente guardó la vez anterior (una sola vez por visita)
function precargarCheckout() {
    const g = leerDatosGuardados();
    if (!checkoutPrecargado) {
        checkoutPrecargado = true;
        $('co-nombre').value = limpiarTexto(g.nombre);
        $('co-calle').value = limpiarTexto(g.calle);
        $('co-localidad').value = limpiarTexto(g.localidad);
        $('co-referencia').value = limpiarTexto(g.referencia);
        if (typeof g.pago === 'string') medioPagoElegido = g.pago;
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
    if (!pedidosActivos() || !wsp || String(carrito.emprendedorId) !== String(e.id)) {
        $('sin-whatsapp-tienda').textContent = (e?.nombre_tienda || '').trim() || 'Este emprendedor';
        $('modal-sin-whatsapp').classList.remove('hidden');
        actualizarBloqueoScroll();
        return false;
    }
    return true;
}

function irACheckout() {
    if (!carrito.items.length) return;
    if (!verificarPedidoPosible()) return;
    if (costoEnvio() > 0 && modalidadEnvio === null) {
        mostrarToastCarrito('Elegí cómo lo recibís');
        return;
    }
    mostrarPasoCarrito(2);
}

// Los errores se limpian apenas el cliente corrige el campo
['nombre', 'calle', 'localidad'].forEach(c => {
    $('co-' + c).addEventListener('input', () => marcarErrorCheckout(c, ''));
});

function guardarDatosSiCorresponde() {
    try {
        if (!$('co-recordar').checked) { localStorage.removeItem(CLAVE_DATOS_CLIENTE); return; }
        const d = datosCheckout();
        localStorage.setItem(CLAVE_DATOS_CLIENTE, JSON.stringify({
            nombre: d.nombre, calle: d.calle, localidad: d.localidad, referencia: d.referencia, pago: d.pago,
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
function urlProductoTienda(id) {
    try {
        const actual = new URL(window.location.href);
        const u = new URL(actual.origin + actual.pathname);
        const t = actual.searchParams.get('t');
        if (t) u.searchParams.set('t', t);
        u.searchParams.set('producto', id);
        return u.href;
    } catch {
        return '';
    }
}

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
    if (costoEnvio() > 0) {
        lineas.push(modalidadEnvio ? 'Entrega: envío a domicilio' : 'Entrega: retiro en el local');
        if (modalidadEnvio) {
            lineas.push(`Subtotal: ${formatoPrecio(subtotalCarrito())}`);
            lineas.push(`Envío: ${formatoPrecio(costoEnvio())}`);
        }
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

function enviarPedidoWhatsapp() {
    if (!carrito.items.length) return;
    const e = emprendedorActual;
    const wsp = soloDigitos(e?.whatsapp);
    if (!verificarPedidoPosible()) return;
    if (costoEnvio() > 0 && modalidadEnvio === null) {
        mostrarToastCarrito('Elegí cómo lo recibís');
        mostrarPasoCarrito(1);
        return;
    }
    if (!validarCheckout()) return;
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
let temporizadorToast = null;
function mostrarToastCarrito(texto) {
    const t = $('toast-carrito');
    $('toast-carrito-texto').textContent = texto;
    t.classList.remove('hidden');
    t.classList.add('flex');
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => { t.classList.add('hidden'); t.classList.remove('flex'); }, 2200);
}

function actualizarBloqueoScroll() {
    const hayCapa =
        $('modal-producto').classList.contains('abierto') ||
        !$('carrito-drawer').classList.contains('translate-x-full') ||
        !$('lightbox-imagen').classList.contains('hidden') ||
        ['modal-medios-pago-modal', 'modal-qr-pedido', 'modal-conflicto-carrito', 'modal-sin-whatsapp']
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
    if (!$('modal-sin-whatsapp').classList.contains('hidden')) return cerrarModalSinWhatsapp();
    if (!$('modal-conflicto-carrito').classList.contains('hidden')) return cerrarConflictoCarrito();
    if (!$('modal-qr-pedido').classList.contains('hidden')) return intentarCerrarModalQr();
    if (!$('modal-medios-pago-modal').classList.contains('hidden')) return cerrarModalMediosPago();
    if (!$('carrito-drawer').classList.contains('translate-x-full')) return cerrarCarrito();
    if ($('modal-producto').classList.contains('abierto')) return cerrarModal();
});

document.addEventListener('DOMContentLoaded', () => {
    // El stepper y el botón "Agregar" del modal solo existen en tiendas con pedidos
    $('modal-btn-agregar').classList.add('solo-pedidos');
    $('modal-cantidad').parentElement.classList.add('solo-pedidos');
    iniciarLightbox();
    actualizarCarritoUI();
});
