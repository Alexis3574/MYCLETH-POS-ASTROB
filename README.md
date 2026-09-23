# Ejecución del proyecto en local

Esta sección explica cómo configurar y ejecutar el proyecto **POSMYCLETH** en un entorno local de desarrollo.

## Requisitos previos

Antes de comenzar, asegúrate de tener instaladas las siguientes herramientas:

* [Node.js](https://nodejs.org/) en una versión compatible con el proyecto.
* npm.
* PostgreSQL.
* Git.
* Un editor de código, por ejemplo Visual Studio Code.

Puedes verificar las instalaciones con:

```bash
node -v
npm -v
git --version
psql --version
```

---

## 1. Clonar el repositorio

Clona el repositorio desde GitHub:

```bash
git clone <URL_DEL_REPOSITORIO>
```

Ingresa a la carpeta del proyecto:

```bash
cd POSMYCLETH
```

Si ya tienes el repositorio clonado, únicamente actualiza tu rama:

```bash
git pull
```

---

## 2. Configurar PostgreSQL

Asegúrate de que el servicio de PostgreSQL se encuentre iniciado.

Puedes acceder a PostgreSQL desde consola con:

```bash
psql -U postgres
```

Si la base de datos todavía no existe, créala:

```sql
CREATE DATABASE pos_novnix
WITH
OWNER = postgres
ENCODING = 'UTF8'
TEMPLATE = template0;
```

Para salir de PostgreSQL:

```sql
\q
```

---

## 3. Configurar el backend

Desde la raíz del proyecto, ingresa al backend:

```bash
cd apps/api
```

Instala las dependencias:

```bash
npm install
```

Si se desea instalar exactamente las versiones registradas en `package-lock.json`, se puede utilizar:

```bash
npm ci
```

---

## 4. Configurar variables de entorno

Dentro de:

```text
apps/api
```

crea un archivo llamado:

```text
.env
```

Configura las variables necesarias para el proyecto.

Ejemplo:

```env
DATABASE_URL="postgresql://postgres:TU_PASSWORD@localhost:5432/pos_novnix"
PORT=3000
```

Reemplaza:

```text
TU_PASSWORD
```

por la contraseña local de tu usuario de PostgreSQL.

> El archivo `.env` contiene información sensible y no debe subirse al repositorio de GitHub.

Asegúrate de que esté incluido en `.gitignore`.

---

## 5. Validar la configuración de Prisma

Desde:

```text
apps/api
```

ejecuta:

```bash
npx prisma validate
```

Si la configuración es correcta, Prisma mostrará un mensaje indicando que el esquema es válido.

---

## 6. Generar Prisma Client

Ejecuta:

```bash
npx prisma generate
```

Esto genera el cliente que utiliza el backend para comunicarse con PostgreSQL.

---

## 7. Aplicar la estructura de la base de datos

Si el proyecto utiliza migraciones de Prisma, ejecuta:

```bash
npx prisma migrate dev
```

Este comando aplica las migraciones pendientes sobre la base de datos local.

Si las migraciones ya existen y únicamente se necesita aplicarlas:

```bash
npx prisma migrate deploy
```

---

## 8. Verificar TypeScript

Antes de levantar el servidor se recomienda comprobar que no existan errores de tipos:

```bash
npm run typecheck
```

Si el comando termina sin mostrar errores, la validación de TypeScript fue correcta.

---

## 9. Levantar el backend

Ejecuta el script de desarrollo configurado en el proyecto:

```bash
npm run dev
```

El servidor debería quedar disponible en:

```text
http://localhost:3000
```

La API utiliza como ruta base:

```text
http://localhost:3000/api/v1
```

---

## 10. Verificar la conexión con PostgreSQL

Con el backend ejecutándose, se puede comprobar la conexión a la base de datos utilizando el endpoint de prueba del proyecto:

```text
http://localhost:3000/api/v1/db-test
```

También se puede consultar desde Git Bash:

```bash
curl http://localhost:3000/api/v1/db-test
```

Si la conexión es correcta, la API deberá devolver una respuesta satisfactoria.

---

## 11. Probar la API

Con el servidor funcionando se pueden probar los endpoints desde:

* Navegador, para peticiones `GET`.
* `curl`.
* Postman.
* Insomnia.
* Thunder Client.

Por ejemplo:

```bash
curl http://localhost:3000/api/v1/db-test
```

---

## Comandos principales

Los comandos más utilizados durante el desarrollo del backend son:

```bash
cd apps/api
npm install
npx prisma validate
npx prisma generate
npm run typecheck
npm run dev
```

Para trabajar con migraciones:

```bash
npx prisma migrate dev
```

Para visualizar la base de datos mediante Prisma Studio:

```bash
npx prisma studio
```

---

## Flujo rápido para ejecutar el proyecto

Después de haber configurado PostgreSQL y el archivo `.env`, normalmente sólo será necesario ejecutar:

```bash
cd POSMYCLETH/apps/api
npm install
npx prisma generate
npm run typecheck
npm run dev
```

Y acceder a:

```text
http://localhost:3000
```

---

## Solución de problemas frecuentes

### Error de conexión con PostgreSQL

Verifica que:

* PostgreSQL esté iniciado.
* La base de datos `pos_novnix` exista.
* El usuario de PostgreSQL sea correcto.
* La contraseña del archivo `.env` sea correcta.
* El puerto de PostgreSQL sea `5432`, salvo que se haya configurado otro.

Puedes validar Prisma con:

```bash
npx prisma validate
```

### El puerto 3000 está ocupado

Verifica si otro proceso está utilizando el puerto o modifica la variable correspondiente en `.env`.

### Prisma Client no está generado

Ejecuta:

```bash
npx prisma generate
```

### Existen errores de TypeScript

Ejecuta:

```bash
npm run typecheck
```

y corrige los errores antes de iniciar el servidor.

### Las dependencias no están instaladas

Ejecuta:

```bash
npm install
```

o:

```bash
npm ci
```

---

## Seguridad

Nunca deben subirse al repositorio archivos que contengan credenciales o información sensible, incluyendo:

```text
.env
node_modules/
contraseñas
tokens
credenciales de servicios externos
```

Las variables necesarias para ejecutar el proyecto deben documentarse mediante un archivo como:

```text
.env.example
```

sin incluir contraseñas reales.
