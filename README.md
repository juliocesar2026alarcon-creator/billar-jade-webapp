
# Billar Jade — App Web (deploy en Render)

Este paquete está listo para subirse a **GitHub** y publicarse en **Render** como **Static Site**.

## 1) Probar localmente (opcional)
```bash
npm ci
npm run dev
```
Abre el enlace que te muestra (ej.: http://localhost:5173).

## 2) Subir a GitHub
1. Crea un repo nuevo llamado `billar-jade-webapp` en GitHub.
2. En esta carpeta, ejecuta:
```bash
git init
git add -A
git commit -m "Primera versión Billar Jade"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/billar-jade-webapp.git
git push -u origin main
```

## 3) Publicar en Render (Static Site)
1. Entra a https://render.com y regístrate con GitHub.
2. **New → Static Site**.
3. Selecciona tu repo `billar-jade-webapp`.
4. Configura:
   - **Branch:** `main`
   - **Build Command:** `npm run build`
   - **Publish Directory:** `dist`
5. Crea el sitio y espera que termine el deploy. Render te dará una URL `onrender.com`.

> Documentación de Render sobre Static Sites (build y publish directory, actualizaciones automáticas por push): https://render.com/docs/static-sites  
> Guía “Your First Deploy” (elegir Static Site vs Web Service): https://render.com/docs/your-first-deploy

## 4) Opcional: Blueprint (render.yaml)
Si prefieres crear el servicio con “Blueprints (IaC)”, edita `render.yaml` (cambia `TU_USUARIO`) y en Render usa **New → Blueprint**.

> Documentación de Blueprints: https://render.com/docs/infrastructure-as-code y referencia YAML: https://render.com/docs/blueprint-spec

## 5) Notas de impresión directa ESC/POS
- La app intenta usar `http://localhost:18401/print` cuando activas el switch de **Impresión directa** en Configuración. Si no hay agente, cae al diálogo del navegador.

## 6) Logo
- Sube el logo desde **Configuración → Logo del ticket** dentro de la app.

