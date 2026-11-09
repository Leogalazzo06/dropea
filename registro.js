// ============================================================
// REGISTRO (registro.html) · Alta automática por pasos
//
//   Paso 1  Negocio (nombre, rubro, ciudad)
//   Paso 2  Datos personales (nombre y WhatsApp) -> acá se comprueba que el WhatsApp no esté repetido
//   Paso 3  Email -> acá se envía el código
//   Paso 4  Código de 6 dígitos (se verifica solo, sin crear nada todavía)
//   Paso 5  Contraseña -> acá se crea la cuenta y la tienda (15 días de prueba)
//
// Depende de supabase-client.js (aporta `mostrarToast` y `SITIO_PUBLICO`).
// ============================================================

const API_REGISTRO = 'https://authdropea.leonelgalazzoaz.workers.dev/';
// Cloudflare > Turnstile > tu widget > Site key (es pública)
const TURNSTILE_SITE_KEY = '0x4AAAAAAF5OANAfdRrIZgb4';
const ESPERA_REENVIO = 60;          // segundos hasta poder pedir otro código
const VIGENCIA_CODIGO_MS = 9 * 60 * 1000; // el código dura 10 min; con 9 evitamos usar uno por vencer

const TOTAL_PASOS = 5;
const TEXTO_BOTON = {
    1: 'Continuar',
    2: 'Continuar',
    3: 'Enviar código por email',
    4: 'Confirmar código',
    5: 'Crear mi tienda',
};
const TEXTO_CARGANDO = {
    2: 'Verificando...',
    3: 'Enviando código...',
    4: 'Verificando...',
    5: 'Creando tu tienda...',
};

// Campos de cada paso (los que se validan antes de avanzar) y paso al que pertenece cada campo
const CAMPOS_POR_PASO = {
    1: ['negocio', 'categoria', 'ciudad'],
    2: ['nombre', 'contacto'],
    3: ['email'],
};
const PASO_DE_CAMPO = {
    negocio: 1, categoria: 1, ciudad: 1,
    nombre: 2, contacto: 2,
    email: 3, codigo: 4, password: 5,
};

const MENSAJES = {
    nombre: 'Ingresá tu nombre y apellido.',
    contacto: 'Ingresá característica + número, 10 dígitos en total (ej.: 3644 123456).',
    email: 'Ingresá un email válido.',
    negocio: 'Ingresá el nombre de tu negocio.',
    ciudad: 'Ingresá tu ciudad.',
    categoria: 'Ingresá el rubro o categoría.',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const $ = (id) => document.getElementById(id);
const form = $('form-registro');
const btnSiguiente = $('btn-siguiente');
const btnAtras = $('btn-atras');
const btnReenviar = $('btn-reenviar');

const valor = (id) => $(id).value.trim().replace(/\s+/g, ' ');

// WhatsApp: el "+54 9" ya viene fijo en el campo, la persona escribe solo
// característica + número (10 dígitos en total). Si pega el número completo
// ("+54 9 364 4123456" o "0364 4123456") se limpian el 54, el 9 y el 0 sobrantes.
// Devuelve el número listo para guardar ("+54 9 3644123456") o null si no es válido.
function validarWhatsapp(texto) {
    if (!/^[\d\s()\-.+]+$/.test(texto)) return null;
    let d = texto.replace(/\D/g, '');
    if (d.startsWith('54') && d.length > 10) d = d.slice(2);
    if (d.startsWith('9') && d.length > 10) d = d.slice(1);
    if (d.startsWith('0') && d.length > 10) d = d.slice(1);
    return d.length === 10 ? `+54 9 ${d}` : null;
}

// Se recuerda en este dispositivo para mostrar la pantalla de "ya tenés tienda".
// El bloqueo real de duplicados (WhatsApp y email) lo hacen el Worker y la base.
const CLAVE_ENVIADA = 'dropea_postulacion_enviada';
const yaEnvioAntes = () => { try { return localStorage.getItem(CLAVE_ENVIADA) === '1'; } catch { return false; } };
const recordarEnvio = () => { try { localStorage.setItem(CLAVE_ENVIADA, '1'); } catch {} };
const olvidarEnvio = () => { try { localStorage.removeItem(CLAVE_ENVIADA); } catch {} };

function marcarError(id, texto) {
    const campo = $(id);
    if (!campo) return;
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

// ---------- Estado ----------
let pasoActual = 1;
let ocupado = false;
let datosActuales = null;   // lo enviado en el paso 3 (sirve para reenviar el código)
let codigoVerificado = '';  // código ya comprobado en el paso 4, se reenvía al crear la cuenta
let codigoEnviadoEn = 0;
let temporizador = null;
let whatsappVerificado = ''; // último WhatsApp que el Worker confirmó como libre (evita consultar de más)

function setOcupado(si) {
    ocupado = si;
    btnSiguiente.disabled = si;
    btnAtras.disabled = si;
    btnSiguiente.textContent = si ? (TEXTO_CARGANDO[pasoActual] || 'Un momento...') : TEXTO_BOTON[pasoActual];
}

function irAPaso(n, { enfocar = true } = {}) {
    pasoActual = n;
    form.querySelectorAll('[data-paso]').forEach((s) => s.classList.toggle('hidden', Number(s.dataset.paso) !== n));

    $('progreso-texto').textContent = `Paso ${n} de ${TOTAL_PASOS}`;
    $('progreso-barra').style.width = `${(n / TOTAL_PASOS) * 100}%`;
    $('progreso-aria').setAttribute('aria-valuenow', String(n));

    btnAtras.classList.toggle('hidden', n === 1);
    $('hero').classList.toggle('hidden', n !== 1);
    $('acciones-codigo').classList.toggle('hidden', n !== 4);
    btnSiguiente.textContent = TEXTO_BOTON[n];

    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (enfocar) {
        const primero = form.querySelector(`[data-paso="${n}"] input`);
        if (primero) setTimeout(() => primero.focus({ preventScroll: true }), 60);
    }
}

// Valida los campos del paso. Devuelve true si todo está bien.
function validarPaso(n) {
    let primerError = null;
    (CAMPOS_POR_PASO[n] || []).forEach((id) => {
        const v = valor(id);
        const malo = v.length < 2
            || (id === 'contacto' && !validarWhatsapp(v))
            || (id === 'email' && !EMAIL_RE.test(v));
        marcarError(id, malo ? MENSAJES[id] : '');
        if (malo && !primerError) primerError = id;
    });
    if (primerError) {
        const el = $(primerError);
        el.focus({ preventScroll: true });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
    }
    return true;
}

// Lleva a la persona al paso del campo con error y muestra el mensaje ahí
function irAlCampoConError(campo, texto) {
    const paso = PASO_DE_CAMPO[campo];
    if (!paso) return false;
    irAPaso(paso);
    marcarError(campo, texto);
    return true;
}

// ---------- Turnstile (captcha invisible de Cloudflare) ----------
let tsWidgetId = null;
let tsToken = '';

// El script de Turnstile (al final de registro.html) la llama cuando termina de cargar
window.iniciarTurnstile = () => {
    tsWidgetId = window.turnstile.render('#turnstile', {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: 'interaction-only', // solo se ve si Cloudflare duda de que sea una persona
        callback: (t) => { tsToken = t; },
        'expired-callback': () => { tsToken = ''; },
        'error-callback': () => { tsToken = ''; },
    });
};

async function esperarTokenTurnstile(ms = 10000) {
    const fin = Date.now() + ms;
    while (!tsToken && Date.now() < fin) await new Promise((r) => setTimeout(r, 200));
    return tsToken;
}

// Cada token sirve una sola vez
function renovarTurnstile() {
    tsToken = '';
    if (window.turnstile && tsWidgetId !== null) window.turnstile.reset(tsWidgetId);
}

// ---------- Llamadas al Worker ----------
async function llamarApi(payload) {
    try {
        const res = await fetch(API_REGISTRO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    } catch (err) {
        console.error('Error de red en el registro:', err);
        return { ok: false, status: 0, data: { error: 'No pudimos conectarnos. Revisá tu internet e intentá de nuevo.' } };
    }
}

// Pregunta al Worker si el WhatsApp ya está en uso (paso 2).
// Solo bloquea si el Worker responde 409 (duplicado). Ante cualquier otro problema
// (red, captcha, límite) deja avanzar: el paso 3 y la base vuelven a validar.
async function consultarWhatsapp(whatsapp) {
    const token = await esperarTokenTurnstile(6000);
    if (!token) return { disponible: true };

    const { status, data } = await llamarApi({
        accion: 'registro_verificar_whatsapp',
        turnstile: token,
        whatsapp,
    });
    renovarTurnstile(); // el token se gastó; el paso 3 espera uno nuevo

    if (status === 409) return { disponible: false, error: data.error };
    return { disponible: true };
}

// Pide el código por email. Devuelve true si se envió.
async function pedirCodigo(payload, esReenvio = false) {
    const token = await esperarTokenTurnstile();
    if (!token) {
        mostrarToast('No pudimos verificar que sos una persona. Recargá la página e intentá de nuevo.', 'error', 6000);
        return false;
    }
    const { ok, data } = await llamarApi({ accion: 'registro_iniciar', turnstile: token, ...payload });
    renovarTurnstile();

    if (!ok) {
        const mensaje = data.error || 'No pudimos enviar el código. Probá de nuevo en un rato.';
        // Si el error es de un dato (ej.: WhatsApp repetido) se vuelve al paso de ese dato
        if (!esReenvio && data.campo && irAlCampoConError(data.campo, mensaje)) return false;
        mostrarToast(mensaje, 'error', 6000);
        return false;
    }
    codigoEnviadoEn = Date.now();
    return true;
}

// ---------- Cuenta regresiva del reenvío ----------
function iniciarCuentaRegresiva() {
    clearInterval(temporizador);
    let restante = ESPERA_REENVIO;
    btnReenviar.disabled = true;
    const pintar = () => { btnReenviar.textContent = `Reenviar código (${restante}s)`; };
    pintar();
    temporizador = setInterval(() => {
        restante--;
        if (restante <= 0) habilitarReenvio();
        else pintar();
    }, 1000);
}

function habilitarReenvio() {
    clearInterval(temporizador);
    btnReenviar.disabled = false;
    btnReenviar.textContent = 'Reenviar código';
}

// ---------- Acciones de cada paso ----------
// Paso 2: comprueba el WhatsApp contra el Worker antes de dejar avanzar
async function continuarDesdePaso2() {
    if (!validarPaso(2)) return;

    const whatsapp = validarWhatsapp(valor('contacto'));
    // Si ya se confirmó este mismo número, no se vuelve a consultar
    if (whatsapp !== whatsappVerificado) {
        setOcupado(true);
        const r = await consultarWhatsapp(whatsapp);
        setOcupado(false);

        if (!r.disponible) {
            marcarError('contacto', r.error || 'Ya recibimos una postulación con este WhatsApp. Si ya tenés cuenta, ingresá a tu panel.');
            const el = $('contacto');
            el.focus({ preventScroll: true });
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        whatsappVerificado = whatsapp;
    }
    irAPaso(3);
}

async function enviarCodigo() {
    const datos = {
        nombre: valor('nombre'),
        negocio: valor('negocio'),
        ciudad: valor('ciudad'),
        categoria: valor('categoria'),
        whatsapp: validarWhatsapp(valor('contacto')),
        email: valor('email').toLowerCase(),
    };

    // Si volvió atrás sin cambiar nada y el código sigue vigente, no se manda otro
    const sinCambios = datosActuales && JSON.stringify(datos) === JSON.stringify(datosActuales);
    if (sinCambios && Date.now() - codigoEnviadoEn < VIGENCIA_CODIGO_MS) {
        $('codigo-email').textContent = datos.email;
        irAPaso(4);
        return;
    }

    setOcupado(true);
    const enviado = await pedirCodigo(datos);
    setOcupado(false);
    if (!enviado) return;

    datosActuales = datos;
    codigoVerificado = '';
    $('codigo').value = '';
    marcarError('codigo', '');
    $('codigo-email').textContent = datos.email;
    iniciarCuentaRegresiva();
    irAPaso(4);
}

async function verificarCodigo() {
    const codigo = $('codigo').value.replace(/\D/g, '');
    if (codigo.length !== 6) {
        marcarError('codigo', 'Ingresá los 6 dígitos del código.');
        return;
    }
    setOcupado(true);
    const { ok, data } = await llamarApi({ accion: 'registro_verificar', email: datosActuales.email, codigo });
    setOcupado(false);

    if (!ok) {
        marcarError('codigo', data.error || 'No pudimos verificar el código. Probá de nuevo.');
        if (data.reiniciar) habilitarReenvio();
        return;
    }
    codigoVerificado = codigo;
    irAPaso(5);
}

async function crearCuenta() {
    const password = $('password').value;
    if (password.length < 8) {
        marcarError('password', 'La contraseña debe tener al menos 8 caracteres.');
        return;
    }

    setOcupado(true);
    const { ok, data } = await llamarApi({
        accion: 'registro_confirmar',
        email: datosActuales.email,
        codigo: codigoVerificado,
        password,
    });
    setOcupado(false);

    if (!ok) {
        const mensaje = data.error || 'No pudimos crear tu cuenta. Probá de nuevo en un rato.';
        if (data.reiniciar) {
            // El código venció mientras elegía la contraseña: vuelve al paso del código
            codigoVerificado = '';
            $('codigo').value = '';
            irAPaso(4);
            marcarError('codigo', mensaje);
            habilitarReenvio();
        } else if (data.campo && irAlCampoConError(data.campo, mensaje)) {
            // volvió al paso del dato con problema (ej.: email o WhatsApp ya registrados)
        } else {
            mostrarToast(mensaje, 'error', 6000);
        }
        return;
    }

    recordarEnvio();
    mostrarExito(data.usuario);
}

// ---------- Eventos ----------
form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (ocupado) return;

    // Honeypot: un bot lo completa; se simula el éxito sin hacer nada
    if ($('web').value) { mostrarExito(); return; }

    if (pasoActual === 1) {
        if (validarPaso(1)) irAPaso(2);
    } else if (pasoActual === 2) {
        await continuarDesdePaso2();
    } else if (pasoActual === 3) {
        if (validarPaso(3)) await enviarCodigo();
    } else if (pasoActual === 4) {
        await verificarCodigo();
    } else if (pasoActual === 5) {
        await crearCuenta();
    }
});

form.addEventListener('input', (ev) => {
    const id = ev.target.id;
    if (!id) return;
    // El campo WhatsApp solo admite números y los símbolos habituales de un teléfono
    if (id === 'contacto') ev.target.value = ev.target.value.replace(/[^\d\s()+\-.]/g, '');
    // El código son solo 6 números; al completarlo se verifica solo
    if (id === 'codigo') {
        ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 6);
        if (ev.target.value.length === 6 && !ocupado) {
            if (form.requestSubmit) form.requestSubmit();
            else btnSiguiente.click();
        }
    }
    marcarError(id, '');
});

btnAtras.addEventListener('click', () => {
    if (ocupado || pasoActual === 1) return;
    irAPaso(pasoActual - 1);
});

$('btn-ver-password').addEventListener('click', (ev) => {
    const input = $('password');
    const oculto = input.type === 'password';
    input.type = oculto ? 'text' : 'password';
    ev.currentTarget.textContent = oculto ? 'Ocultar' : 'Mostrar';
});

btnReenviar.addEventListener('click', async () => {
    if (!datosActuales || ocupado) return;
    btnReenviar.disabled = true;
    btnReenviar.textContent = 'Enviando...';
    const enviado = await pedirCodigo(datosActuales, true);
    if (enviado) {
        mostrarToast('Te enviamos un código nuevo.', 'success');
        codigoVerificado = '';
        $('codigo').value = '';
        marcarError('codigo', '');
        iniciarCuentaRegresiva();
        $('codigo').focus({ preventScroll: true });
    } else {
        habilitarReenvio();
    }
});

// ---------- Éxito ----------
function mostrarExito(usuario) {
    clearInterval(temporizador);
    form.classList.add('hidden');
    $('hero').classList.add('hidden');
    $('exito').classList.remove('hidden');

    const datos = $('exito-datos');
    const tienda = $('exito-tienda');
    if (usuario) {
        $('exito-titulo').textContent = '¡Tu tienda está lista!';
        $('exito-texto').textContent = 'Ya podés ingresar a tu panel y cargar tus productos. Tenés 15 días de prueba gratis.';
        $('exito-usuario').textContent = usuario;
        tienda.href = `${SITIO_PUBLICO}/tienda?t=${encodeURIComponent(usuario)}`;
        tienda.classList.remove('hidden');
        datos.classList.remove('hidden');
    } else {
        // Volvió a entrar al registro desde un dispositivo que ya creó una tienda
        $('exito-titulo').textContent = 'Ya creaste una tienda';
        $('exito-texto').textContent = 'Ingresá a tu panel con tu usuario y contraseña, o registrá otro negocio.';
        tienda.classList.add('hidden');
        datos.classList.add('hidden');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Registrar otro negocio (o sumar a otra persona): vuelve al paso 1 con todo limpio
function registrarOtro() {
    olvidarEnvio();
    clearInterval(temporizador);
    datosActuales = null;
    codigoVerificado = '';
    codigoEnviadoEn = 0;
    whatsappVerificado = '';

    form.reset();
    form.querySelectorAll('.msg-error').forEach((p) => p.remove());
    form.querySelectorAll('.campo.error').forEach((c) => c.classList.remove('error'));
    $('password').type = 'password';
    $('btn-ver-password').textContent = 'Mostrar';
    renovarTurnstile();

    $('exito').classList.add('hidden');
    form.classList.remove('hidden');
    irAPaso(1);
}
$('btn-otro').addEventListener('click', registrarOtro);

// Si este navegador ya creó una tienda, se muestra la pantalla con las dos opciones
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
