POSMYCLETH - cierre final del módulo sales

Este paquete contiene únicamente archivos nuevos o modificados.
No requiere migración de Prisma ni nuevas dependencias npm.

Aplicación:
1. Coloca el contenido del paquete en ~/Documentos/POSMYCLETH/apps/api conservando las rutas.
2. Permite sobrescribir los archivos existentes incluidos en el paquete.
3. Ejecuta:

   npm run typecheck
   npx prisma validate
   npm run test:sales

4. Levanta el API con:

   npm run dev

5. Con un TOKEN válido que tenga VENTAS.VER, VENTAS.CREAR, VENTAS.CANCELAR y VENTAS.DEVOLVER, ejecuta en Git Bash:

   export SALES_TEST_TOKEN="$TOKEN"
   export SALES_TEST_API_URL="http://localhost:3000/api/v1"
   npm run test:sales:integration

La prueba de integración crea registros de prueba en la BD de desarrollo. Las ventas usadas para devoluciones permanecen como historial con devolución total.

No ejecutes la prueba de integración contra producción.
