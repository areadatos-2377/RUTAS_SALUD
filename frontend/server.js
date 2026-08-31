// Servidor de produccion: sirve el build estatico (dist/) y reenvia /api/*
// al backend por la red privada de Railway. Esto pone a frontend y backend
// en el mismo origen desde el punto de vista del navegador -- necesario
// porque up.railway.app esta en la Public Suffix List (cada subdominio
// *.up.railway.app es un "sitio" distinto para el navegador), asi que sin
// este proxy la cookie de sesion del backend es de tercero y navegadores
// con bloqueo de cookies de terceros nunca la guardan. Ver la nota en
// src/api/client.js.
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const backendTarget = process.env.BACKEND_INTERNAL_URL;
if (!backendTarget) {
  throw new Error('Falta configurar BACKEND_INTERNAL_URL (URL interna del backend en Railway).');
}

// pathFilter (no el path de app.use) para que req.url le llegue intacto al
// proxy -- app.use('/api', ...) le recorta el prefijo antes de pasarselo
// (Express monta submiddleware con paths relativos al punto de montaje),
// y el backend terminaria recibiendo /jornadas/ en vez de /api/jornadas/.
app.use(
  createProxyMiddleware({
    target: backendTarget,
    changeOrigin: true,
    pathFilter: '/api',
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('X-Forwarded-Proto', 'https');
        proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
      },
    },
  }),
);

app.use(express.static(path.join(__dirname, 'dist')));

// SPA: cualquier ruta que no sea /api ni un archivo estatico cae en index.html.
// Express 5 ya no acepta '*' como patron de ruta (path-to-regexp v8) --
// un middleware sin path sirve como catch-all.
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Frontend + proxy escuchando en el puerto ${port}, backend en ${backendTarget}`);
});
