# Gastos Mensuales — versión iPhone (app web)

Esta carpeta es la app. **No contiene ningún dato personal**: tus datos viven solo en el iPhone
y se cargan restaurando una copia de seguridad (.json).

## Publicarla (una sola vez)
Subí el contenido de esta carpeta a cualquier hosting estático con **HTTPS** (es obligatorio
para que funcione sin internet). Por ejemplo:
- GitHub Pages: repo nuevo › subir estos archivos › Settings › Pages › Deploy from branch `main` / root.
- Cloudflare Pages o Netlify: arrastrar la carpeta.
- Un servidor propio: copiar la carpeta a un directorio servido por HTTPS.

Tiene `noindex` para que no aparezca en buscadores.

## Instalarla en el iPhone
1. Abrir el link en **Safari** (no en Chrome).
2. Compartir › **Agregar a pantalla de inicio**.
3. Abrir desde el ícono › **Restaurar una copia** › elegir el .json.

## Actualizarla
Reemplazar los archivos en el hosting y cambiar `VERSION` en `sw.js` (ej. `gastos-v2`).
Los datos no se tocan.
