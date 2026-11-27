// ============================================================
// Previsualización de links (WhatsApp, Instagram, Facebook, Telegram...)
//
// Los bots de las redes NO ejecutan JavaScript: leen el HTML tal como sale
// del servidor. Esta Function inyecta las etiquetas Open Graph en:
//   - /tienda/<usuario>  y  /tienda?t=<usuario>          -> logo de la tienda
//   - /producto?t=<usuario>&p=<id>  (y /producto.html)    -> FOTO DEL PRODUCTO
//   - /tienda?t=<usuario>&producto=<id> (links viejos)    -> FOTO DEL PRODUCTO
// Para las personas no cambia nada: los .js siguen armando la página igual.
//
// Ubicación en el repo: este archivo se llama _worker.js y va en la MISMA
// carpeta que tienda.html y producto.html (sin subcarpetas).
// ============================================================

const SUPABASE_URL = 'https://hyfkynnkppgxityeuvjv.supabase.co';
// Publishable key: es pública por diseño (la protege el RLS). Se puede
// sobreescribir con variables de entorno en Cloudflare Pages.
const SUPABASE_KEY = 'sb_publishable_tWjhlwAFPcUPcLG3l_9U1Q_GkpfT3R9';

// Imagen de respaldo si no hay foto del producto, logo ni portada
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

const formatoPrecio = (n) => {
  const num = Number(n);
  if (!isFinite(num)) return '';
  return '$' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(num);
};

function obtenerSlug(url) {
  const m = url.pathname.match(/^\/tienda\/([^/]+)/i);
  if (m) {
    try { return decodeURIComponent(m[1]).trim().toLowerCase(); } catch { return ''; }
  }
  return (url.searchParams.get('t') || '').trim().toLowerCase();
}

function obtenerIdProducto(url) {
  const q = url.searchParams;
  return (q.get('p') || q.get('producto') || q.get('id') || '').trim();
}

// Devuelve el .html estático (ruta: '/tienda' o '/producto') sin pasar por la Function otra vez
async function paginaBase(request, env, ruta) {
  const base = new URL(ruta, request.url);
  let res = await env.ASSETS.fetch(new Request(base, { headers: request.headers }));
  if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
    res = await env.ASSETS.fetch(new Request(new URL(res.headers.get('Location'), base)));
  }
  return res;
}

// Consulta a Supabase (devuelve el primer registro o null)
async function consultar(env, ruta) {
  try {
    const key = env.SUPABASE_ANON_KEY || SUPABASE_KEY;
    const r = await fetch(`${env.SUPABASE_URL || SUPABASE_URL}/rest/v1/${ruta}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!r.ok) return null;
    const [fila] = await r.json();
    return fila || null;
  } catch { return null; } // si falla, se sirve la página genérica
}

// Reescribe <title>, descripción y etiquetas OG/Twitter sobre la página base
function inyectarMeta(base, { titulo, descripcion, imagen, url, card }) {
  const tags = `
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Dropea">
    <meta property="og:title" content="${esc(titulo)}">
    <meta property="og:description" content="${esc(descripcion)}">
    <meta property="og:image" content="${esc(imagen)}">
    <meta property="og:url" content="${esc(url)}">
    <meta name="twitter:card" content="${card}">
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

// ---------- Producto: foto, nombre y precio del producto ----------
async function productoHandler(request, env, url, slug, id, rutaBase) {
  const base = await paginaBase(request, env, rutaBase);
  if (!slug || !id) return base;

  const p = await consultar(env,
    `productos?select=nombre,descripcion,precio,imagen_url,activo,`
    + `emprendedores!inner(nombre_tienda,logo_url,banner_url,activo,usuarios!inner(usuario))`
    + `&id=eq.${encodeURIComponent(id)}`
    + `&emprendedores.usuarios.usuario=eq.${encodeURIComponent(slug)}`
    + `&emprendedores.activo=eq.true&limit=1`);
  if (!p || p.activo === false) return base;

  const e = p.emprendedores || {};
  const tienda = (e.nombre_tienda || '').trim() || 'Tienda';
  const nombre = (p.nombre || '').trim() || 'Producto';
  const desc = (p.descripcion || '').trim().replace(/\s+/g, ' ');
  const descripcion = [formatoPrecio(p.precio), desc].filter(Boolean).join(' · ').slice(0, 200)
    || `Mirá este producto de ${tienda}`;
  const imagen = urlSegura(p.imagen_url) || urlSegura(e.logo_url) || urlSegura(e.banner_url) || IMAGEN_DEFAULT;

  return inyectarMeta(base, {
    titulo: `${nombre} | ${tienda}`,
    descripcion,
    imagen,
    url: url.href,
    card: 'summary_large_image'
  });
}

// ---------- Tienda: logo, nombre y bio ----------
async function tiendaHandler(request, env) {
  const url = new URL(request.url);
  const slug = obtenerSlug(url);

  // Links viejos tienda?producto=<id>: la preview muestra el producto
  const idViejo = (url.searchParams.get('producto') || '').trim();
  if (slug && idViejo) return productoHandler(request, env, url, slug, idViejo, '/tienda');

  const base = await paginaBase(request, env, '/tienda');
  if (!slug) return base;

  const tienda = await consultar(env,
    `emprendedores?select=nombre_tienda,bio,logo_url,banner_url,usuarios!inner(usuario)`
    + `&usuarios.usuario=eq.${encodeURIComponent(slug)}`
    + `&activo=eq.true&limit=1`);
  if (!tienda) return base;

  const nombre = (tienda.nombre_tienda || '').trim() || 'Tienda';
  const bio = (tienda.bio || '').trim();
  return inyectarMeta(base, {
    titulo: `${nombre} | Catálogo`,
    descripcion: bio ? bio.slice(0, 160) : `Catálogo online de ${nombre}`,
    imagen: urlSegura(tienda.logo_url) || urlSegura(tienda.banner_url) || IMAGEN_DEFAULT,
    url: url.href,
    card: 'summary'
  });
}

// Punto de entrada: solo /tienda, /tienda/<usuario> y /producto pasan por acá;
// todo lo demás (HTML, JS, imágenes) se sirve igual que siempre.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (request.method === 'GET') {
      if (pathname === '/tienda' || pathname.startsWith('/tienda/')) return tiendaHandler(request, env);
      if (pathname === '/producto' || pathname === '/producto.html') {
        return productoHandler(request, env, url, obtenerSlug(url), obtenerIdProducto(url), '/producto');
      }
    }
    return env.ASSETS.fetch(request);
  }
};
