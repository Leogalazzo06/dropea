// ============================================================
// REGISTRO (registro.html) · Solicitud de alta
// Guarda la postulación en la tabla `postulaciones` (ver postulaciones.sql),
// que el admin ve en su sección "Postulación".
// Depende de supabase-client.js (aporta `supabase` y `mostrarToast`).
// ============================================================

const form = document.getElementById('form-registro');
const btn = document.getElementById('btn-enviar');

const REGLAS = [
    ['nombre', 'Ingresá tu nombre y apellido.'],
    ['contacto', 'Ingresá característica + número, 10 dígitos en total (ej.: 3644 123456).'],
    ['negocio', 'Ingresá el nombre de tu negocio.'],
    ['ciudad', 'Ingresá tu ciudad.'],
    ['categoria', 'Ingresá el rubro o categoría.'],
];

const valor = (id) => document.getElementById(id).value.trim().replace(/\s+/g, ' ');

// WhatsApp: el "+54 9" ya viene fijo en el campo, la persona escribe solo
// característica + número (10 dígitos en total). Si pega el número completo
// ("+54 9 364 4123456" o "0364 4123456") se limpian el 54, el 9 y el 0 sobrantes.
// Devuelve el número listo para guardar ("+54 9 3644123456") o null si no es válido.
// La base compara por los últimos 10 dígitos, así que no se pueden repetir números.
function validarWhatsapp(texto) {
    if (!/^[\d\s()\-.+]+$/.test(texto)) return null;
    let d = texto.replace(/\D/g, '');
    if (d.startsWith('54') && d.length > 10) d = d.slice(2);
    if (d.startsWith('9') && d.length > 10) d = d.slice(1);
    if (d.startsWith('0') && d.length > 10) d = d.slice(1);
    return d.length === 10 ? `+54 9 ${d}` : null;
}

// Una postulación por navegador: se recuerda en este dispositivo (el bloqueo real
// por número lo hace la base con un índice único, ver postulaciones_unico.sql).
const CLAVE_ENVIADA = 'dropea_postulacion_enviada';
const yaEnvioAntes = () => { try { return localStorage.getItem(CLAVE_ENVIADA) === '1'; } catch { return false; } };
const recordarEnvio = () => { try { localStorage.setItem(CLAVE_ENVIADA, '1'); } catch {} };

function marcarError(id, texto) {
    const campo = document.getElementById(id);
    const grupo = campo.closest('[data-grupo]') || campo.parentElement;
    campo.classList.toggle('error', !!texto);
    grupo.querySelector('.msg-error')?.remove();
    if (texto) {
        const p = document.createElement('p');
        p.className = 'msg-error';
        p.textContent = texto;
        grupo.appendChild(p);
    }
}

form.addEventListener('input', (ev) => {
    if (!ev.target.id) return;
    // El campo WhatsApp solo admite números y los símbolos habituales de un teléfono
    if (ev.target.id === 'contacto') ev.target.value = ev.target.value.replace(/[^\d\s()+\-.]/g, '');
    marcarError(ev.target.id, '');
});

form.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    // Honeypot: un bot lo completa; se simula el éxito sin guardar nada
    if (document.getElementById('web').value) { mostrarExito(); return; }

    let primerError = null;
    REGLAS.forEach(([id, texto]) => {
        const v = valor(id);
        const malo = v.length < 2 || (id === 'contacto' && !validarWhatsapp(v));
        marcarError(id, malo ? texto : '');
        if (malo && !primerError) primerError = id;
    });
    if (primerError) {
        const el = document.getElementById(primerError);
        el.focus({ preventScroll: true });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Enviando...';

    const { error } = await supabase.from('postulaciones').insert({
        nombre: valor('nombre'),
        nombre_negocio: valor('negocio'),
        ciudad: valor('ciudad'),
        categoria: valor('categoria'),
        whatsapp: validarWhatsapp(valor('contacto')),
        email: '',
    });

    if (error) {
        // 23505 = índice único: ya hay una postulación con ese WhatsApp
        if (error.code === '23505') {
            marcarError('contacto', 'Ya recibimos una postulación con este WhatsApp. Revisá tu WhatsApp: puede que ya te hayamos escrito.');
            document.getElementById('contacto').scrollIntoView({ behavior: 'smooth', block: 'center' });
            btn.disabled = false;
            btn.textContent = 'Enviar postulación';
            return;
        }
        console.error('Error enviando la postulación:', error);
        mostrarToast('No pudimos enviar tu postulación. Probá de nuevo en un rato.', 'error');
        btn.disabled = false;
        btn.textContent = 'Enviar postulación';
        return;
    }
    recordarEnvio();
    mostrarExito();
});

function mostrarExito() {
    form.classList.add('hidden');
    document.getElementById('exito').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Si este navegador ya envió una postulación, se muestra directo la confirmación
if (yaEnvioAntes()) mostrarExito();

// ---------- WhatsApp (footer: "Más información") ----------
// Mismo número y texto que en index.js
const WHATSAPP_NUMERO = '5493644539325';
const WHATSAPP_TEXTO = 'Hola! Quiero armar el catálogo de mi comercio en Dropea.';

function configurarWhatsApp() {
    const numero = WHATSAPP_NUMERO.replace(/\D/g, '');
    document.querySelectorAll('[data-wa]').forEach(a => {
        if (!numero) { a.classList.add('hidden'); return; }
        a.href = `https://wa.me/${numero}?text=${encodeURIComponent(WHATSAPP_TEXTO)}`;
    });
}
configurarWhatsApp();
