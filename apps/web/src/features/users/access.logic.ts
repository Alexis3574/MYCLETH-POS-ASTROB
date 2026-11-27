import { identifier, record, text } from '../quotations/document.logic.ts'
export interface ManagedUser { id:string;empresa_id:string;username:string;nombre:string;apellido:string|null;email:string|null;telefono:string|null;activo:boolean;bloqueado:boolean;ultimo_acceso:string|null }
export interface ManagedRole { id:string;codigo:string;nombre:string;descripcion:string|null;activo:boolean;usuarios_asignados?:number;permisos_asignados?:number }
export interface ManagedPermission { id:string;codigo:string;modulo:string;descripcion:string|null }
const nullable=(value:unknown,max:number)=>value===null?null:text(value,max,true)
export function parseUser(value:unknown):ManagedUser{
 const row=record(value);if(typeof row.activo!=='boolean'||typeof row.bloqueado!=='boolean'||row.ultimo_acceso!==null&&(typeof row.ultimo_acceso!=='string'||Number.isNaN(Date.parse(row.ultimo_acceso))))throw new Error('Usuario recibido no válido.')
 return{id:identifier(row.id),empresa_id:identifier(row.empresa_id),username:text(row.username,80),nombre:text(row.nombre,100),apellido:nullable(row.apellido,120),email:nullable(row.email,180),telefono:nullable(row.telefono,30),activo:row.activo,bloqueado:row.bloqueado,ultimo_acceso:row.ultimo_acceso as string|null}
}
export function parseRole(value:unknown):ManagedRole{
 const row=record(value);if(typeof row.activo!=='boolean')throw new Error('Rol no válido.')
 for(const name of ['usuarios_asignados','permisos_asignados'])if(row[name]!==undefined&&(!Number.isSafeInteger(row[name])||Number(row[name])<0))throw new Error('Conteo de rol no válido.')
 return{id:identifier(row.id),codigo:text(row.codigo,60),nombre:text(row.nombre,100),descripcion:nullable(row.descripcion,10000),activo:row.activo,...(row.usuarios_asignados!==undefined?{usuarios_asignados:Number(row.usuarios_asignados)}:{}),...(row.permisos_asignados!==undefined?{permisos_asignados:Number(row.permisos_asignados)}:{})}
}
export function parsePermission(value:unknown):ManagedPermission{const row=record(value);return{id:identifier(row.id),codigo:text(row.codigo,120),modulo:text(row.modulo,80),descripcion:nullable(row.descripcion,10000)}}
export function parseArray<T extends {id:string}>(value:unknown,parse:(row:unknown)=>T):T[]{if(!Array.isArray(value))throw new Error('Catálogo no válido.');const rows=value.map(parse);if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('Catálogo con duplicados.');return rows}
export function validatePassword(password:string,repeat:string){if(password!==repeat||password.length<8||new TextEncoder().encode(password).length>72)throw new Error('Las contraseñas deben coincidir, tener al menos 8 caracteres y hasta 72 bytes UTF-8.');return password}
export function userInput(values:{username:string;nombre:string;apellido:string;email:string;telefono:string;activo:boolean},company:string,creating:boolean,password?:string){
 const username=text(values.username,80);if(username.length<3)throw new Error('El usuario requiere al menos 3 caracteres.')
 const email=text(values.email,180,true);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Correo no válido.')
 const body:Record<string,unknown>={username,nombre:text(values.nombre,100),activo:values.activo}
 for(const [name,max]of [['apellido',120],['email',180],['telefono',30]]as const){const value=text(values[name],max,true);if(value)body[name]=name==='email'?value.toLowerCase():value;else if(!creating)body[name]=null}
 if(creating){body.empresa_id=identifier(company);body.password=validatePassword(password??'',password??'')}
 return body
}
export function roleInput(values:{codigo:string;nombre:string;descripcion:string;activo:boolean}){return{codigo:text(values.codigo,60),nombre:text(values.nombre,100),descripcion:values.descripcion.trim()||null,activo:values.activo}}
