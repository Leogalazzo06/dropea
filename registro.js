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
    ['contacto', 'Ingresá un WhatsApp o un email válido.'],
    ['negocio', 'Ingresá el nombre de tu negocio.'],
    ['ciudad', 'Ingresá tu ciudad.'],
    ['categoria', 'Ingresá el rubro o categoría.'],
];

const valor = (id) => document.getElementById(id).value.trim().replace(/\s+/g, ' ');

// Contacto: si tiene "@" se guarda como email; si no, como WhatsApp (8 a 15 dígitos)
function clasificarContacto(texto) {
    if (texto.includes('@')) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(texto) ? { email: texto.toLowerCase(), whatsapp: '' } : null;
    }
    const digitos = texto.replace(/\D/g, '');
    return /^[\d\s()+\-.]+$/.test(texto) && digitos.length >= 8 && digitos.length <= 15
        ? { email: '', whatsapp: texto } : null;
}

function marcarError(id, texto) {
    const campo = document.getElementById(id);
    campo.classList.toggle('error', !!texto);
    campo.parentElement.querySelector('.msg-error')?.remove();
    if (texto) {
        const p = document.createElement('p');
        p.className = 'msg-error';
        p.textContent = texto;
        campo.parentElement.appendChild(p);
    }
}

form.addEventListener('input', (ev) => { if (ev.target.id) marcarError(ev.target.id, ''); });

form.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    // Honeypot: un bot lo completa; se simula el éxito sin guardar nada
    if (document.getElementById('web').value) { mostrarExito(); return; }

    let primerError = null;
    REGLAS.forEach(([id, texto]) => {
        const v = valor(id);
        const malo = v.length < 2 || (id === 'contacto' && !clasificarContacto(v));
        marcarError(id, malo ? texto : '');
        if (malo && !primerError) primerError = id;
    });
    if (primerError) { document.getElementById(primerError).focus(); return; }

    btn.disabled = true;
    btn.textContent = 'Enviando...';

    const { error } = await supabase.from('postulaciones').insert({
        nombre: valor('nombre'),
        nombre_negocio: valor('negocio'),
        ciudad: valor('ciudad'),
        categoria: valor('categoria'),
        ...clasificarContacto(valor('contacto')),
    });

    if (error) {
        console.error('Error enviando la postulación:', error);
        mostrarToast('No pudimos enviar tu postulación. Probá de nuevo en un rato.', 'error');
        btn.disabled = false;
        btn.textContent = 'Enviar postulación';
        return;
    }
    mostrarExito();
});

function mostrarExito() {
    form.classList.add('hidden');
    document.getElementById('exito').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}