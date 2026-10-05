// ============================================================
// Previsualización de links (WhatsApp, Instagram, Facebook, Telegram...)
//
// Los bots de las redes NO ejecutan JavaScript: leen el HTML tal como sale
// del servidor. Esta Function atiende /tienda/<usuario> y /tienda?t=<usuario>,
// busca el comercio en Supabase y le inyecta a tienda.html las etiquetas
// Open Graph (nombre, bio y logo) antes de responder.
// Para las personas no cambia nada: emprendedor.js sigue armando la página igual.
//
// Ubicación en el repo: este archivo se llama _worker.js y va en la MISMA
// carpeta que tienda.html (sin subcarpetas).
// ============================================================

const SUPABASE_URL = 'https://hyfkynnkppgxityeuvjv.supabase.co';
// Publishable key: es pública por diseño (la protege el RLS). Se puede
// sobreescribir con variables de entorno en Cloudflare Pages.
const SUPABASE_KEY = 'sb_publishable_tWjhlwAFPcUPcLG3l_9U1Q_GkpfT3R9';

// Imagen de respaldo si el comercio no tiene logo ni portada
const IMAGEN_DEFAULT = 'https://dropea.com.ar/dropea-logo.png';

function urlSegura(valor) {
  let v = String(valor || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
  } catch { return ''; }
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

function obtenerSlug(url) {
  const m = url.pathname.match(/^\/tienda\/([^/]+)/i);
  if (m) {
    try { return decodeURIComponent(m[1]).trim().toLowerCase(); } catch { return ''; }
  }
  return (url.searchParams.get('t') || '').trim().toLowerCase();
}

// Devuelve el tienda.html estático sin pasar por la Function otra vez
async function paginaBase(request, env) {
  const base = new URL('/tienda', request.url);
  let res = await env.ASSETS.fetch(new Request(base, { headers: request.headers }));
  if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
    res = await env.ASSETS.fetch(new Request(new URL(res.headers.get('Location'), base)));
  }
  return res;
}

async function tiendaHandler(request, env) {
  const url = new URL(request.url);
  const base = await paginaBase(request, env);
  const slug = obtenerSlug(url);
  if (!slug) return base;

  let tienda = null;
  try {
    const key = env.SUPABASE_ANON_KEY || SUPABASE_KEY;
    const api = `${env.SUPABASE_URL || SUPABASE_URL}/rest/v1/emprendedores`
      + `?select=nombre_tienda,bio,logo_url,banner_url,usuarios!inner(usuario)`
      + `&usuarios.usuario=eq.${encodeURIComponent(slug)}`
      + `&activo=eq.true&limit=1`;
    const r = await fetch(api, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (r.ok) [tienda] = await r.json();
  } catch { /* si falla, se sirve la página genérica */ }
  if (!tienda) return base;

  const nombre = (tienda.nombre_tienda || '').trim() || 'Tienda';
  const bio = (tienda.bio || '').trim();
  const descripcion = bio ? bio.slice(0, 160) : `Catálogo online de ${nombre}`;
  const imagen = urlSegura(tienda.logo_url) || urlSegura(tienda.banner_url) || IMAGEN_DEFAULT;
  const titulo = `${nombre} | Catálogo`;

  const tags = `
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Dropea">
    <meta property="og:title" content="${esc(titulo)}">
    <meta property="og:description" content="${esc(descripcion)}">
    <meta property="og:image" content="${esc(imagen)}">
    <meta property="og:url" content="${esc(url.href)}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${esc(titulo)}">
    <meta name="twitter:description" content="${esc(descripcion)}">
    <meta name="twitter:image" content="${esc(imagen)}">
    <meta name="description" content="${esc(descripcion)}">`;

  const res = new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(titulo); } })
    .on('meta[name="description"]', { element(el) { el.remove(); } })
    .on('head', { element(el) { el.append(tags, { html: true }); } })
    .transform(base);

  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'public, max-age=60');
  return out;
}

// Punto de entrada: solo /tienda y /tienda/<usuario> pasan por acá;
// todo lo demás (HTML, JS, imágenes) se sirve igual que siempre.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const esTienda = pathname === '/tienda' || pathname.startsWith('/tienda/');
    if (request.method === 'GET' && esTienda) return tiendaHandler(request, env);
    return env.ASSETS.fetch(request);
  }
};
