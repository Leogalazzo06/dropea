// ============================================================
// INICIO (index.html) · Comercios adheridos + botones de WhatsApp
// Lista los comercios activos (logo + nombre); cada uno enlaza a /tienda/<usuario>.
// Depende de supabase-client.js (cargado antes), que aporta `supabase`.
// En local, sin la regla de Vercel, cambiá RUTA_TIENDA por 'tienda.html?t='.
// ============================================================

const RUTA_TIENDA = '/tienda/';

// WhatsApp de contacto de Dropea: número completo, sin + ni espacios (ej.: '5493644123456').
// Si queda vacío, los botones de WhatsApp se ocultan solos.
const WHATSAPP_NUMERO = '5493644539325';
const WHATSAPP_TEXTO = 'Hola! Quiero armar el catálogo de mi comercio en Dropea.';

const grid = document.getElementById('comercios-grid');
const msg = document.getElementById('comercios-msg');

// ---------- Botones de WhatsApp ----------
function configurarWhatsApp() {
    const links = document.querySelectorAll('[data-wa]');
    const numero = WHATSAPP_NUMERO.replace(/\D/g, '');
    links.forEach(a => {
        if (!numero) { a.classList.add('hidden'); return; }
        a.href = `https://wa.me/${numero}?text=${encodeURIComponent(WHATSAPP_TEXTO)}`;
    });
}

// ---------- Logos ----------
// Los logos los carga cada comercio: solo se aceptan links http/https.
// Si viene sin protocolo, se completa solo cuando parece un dominio (ej.: "i.ibb.co/x.png").
function urlSegura(valor) {
    let v = String(valor || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) {
        if (v.startsWith('//')) v = 'https:' + v;
        else if (/^[^\/\s]+\.[^\/\s]+\//.test(v)) v = 'https://' + v;
        else return '';
    }
    try {
        const u = new URL(v);
        return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch { return ''; }
}

function mostrarMensaje(texto) {
    grid.replaceChildren();
    msg.textContent = texto;
    msg.classList.remove('hidden');
}

function crearTarjeta(c) {
    const usuario = c.usuarios?.usuario;
    if (!usuario) return null;
    const nombre = (c.nombre_tienda || '').trim() || 'Tienda';

    const a = document.createElement('a');
    a.href = RUTA_TIENDA + encodeURIComponent(usuario);
    a.title = nombre;
    a.setAttribute('aria-label', `Ver el catálogo de ${nombre}`);
    a.className = 'group flex flex-col gap-2';

    const caja = document.createElement('div');
    caja.className = 'relative flex items-center justify-center aspect-square rounded-2xl bg-white border-2 border-black shadow-[4px_4px_0_0_#000] transition-all group-hover:translate-x-[3px] group-hover:translate-y-[3px] group-hover:shadow-none group-hover:bg-yellow-50 overflow-hidden';

    // Inicial del comercio: queda de fondo y se tapa cuando el logo carga
    const inicial = document.createElement('span');
    inicial.className = 'text-4xl font-black italic text-zinc-300 select-none';
    inicial.textContent = nombre.charAt(0).toUpperCase();
    caja.appendChild(inicial);

    const logo = urlSegura(c.logo_url);
    if (logo) {
        const img = document.createElement('img');
        img.alt = `Logo de ${nombre}`;
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        // Sin loading="lazy" ni display:none: un <img> oculto con lazy nunca se descarga.
        img.className = 'absolute inset-0 w-full h-full object-contain p-3 bg-white opacity-0 transition-opacity duration-200';
        img.onload = () => { img.classList.remove('opacity-0'); };
        img.onerror = () => { console.warn('No se pudo cargar el logo de', nombre, logo); img.remove(); };
        img.src = logo;
        caja.appendChild(img);
    } else if (c.logo_url) {
        console.warn('logo_url con formato no válido para', nombre, c.logo_url);
    }
    a.appendChild(caja);

    const etiqueta = document.createElement('p');
    etiqueta.className = 'text-xs font-bold text-center text-zinc-700 truncate px-1';
    etiqueta.textContent = nombre;
    a.appendChild(etiqueta);
    return a;
}

async function cargarComercios() {
    const { data, error } = await supabase
        .from('emprendedores')
        .select('id, nombre_tienda, logo_url, usuarios!inner(usuario)')
        .eq('activo', true)
        .order('nombre_tienda', { ascending: true });

    if (error) {
        console.error('Error cargando comercios:', error);
        mostrarMensaje('No pudimos cargar los comercios. Probá de nuevo en un rato.');
        return;
    }

    const tarjetas = (data || []).map(crearTarjeta).filter(Boolean);
    if (!tarjetas.length) {
        mostrarMensaje('Pronto vas a ver acá a los primeros comercios.');
        return;
    }
    grid.replaceChildren(...tarjetas, crearTarjetaTuLocal());
    const n = document.getElementById('stat-comercios');
    if (n) n.textContent = tarjetas.length + (tarjetas.length >= 10 ? '+' : '');
}

// Último casillero de la grilla: invita a sumar el comercio
function crearTarjetaTuLocal() {
    const a = document.createElement('a');
    a.href = 'registro.html';
    a.className = 'group flex flex-col gap-2';
    a.setAttribute('aria-label', 'Sumá tu comercio a Dropea');
    a.innerHTML = '<div class="flex items-center justify-center aspect-square rounded-2xl bg-yellow-400 border-2 border-black shadow-[4px_4px_0_0_#000] transition-all group-hover:translate-x-[3px] group-hover:translate-y-[3px] group-hover:shadow-none text-4xl font-black">+</div><p class="text-xs font-black text-center uppercase">Tu comercio</p>';
    return a;
}

document.addEventListener('DOMContentLoaded', () => {
    configurarWhatsApp();
    cargarComercios();
});