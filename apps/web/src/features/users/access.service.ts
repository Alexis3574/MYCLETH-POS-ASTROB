import { getData } from '../quotations/document.service'
import { record, identifier } from '../quotations/document.logic'
import { parseArray, parseUser, parseRole, parsePermission } from './access.logic'
import { apiRequest } from '../../services/api'
export const accessService={
 async users(token:string,page:number,signal:AbortSignal){
  const response=record(await apiRequest(`/users?page=${page}&limit=20`,{token,signal})),paging=record(response.pagination)
  if(response.ok!==true||paging.page!==page||paging.limit!==20||!Number.isSafeInteger(paging.total)||Number(paging.total)<0)throw new Error('Paginación de usuarios no válida.')
  return{items:parseArray(response.data,parseUser),page,size:20,total:Number(paging.total)}
 },
 async user(token:string,id:string,signal:AbortSignal){const row=parseUser(await getData(`/users/${identifier(id)}`,token,signal));if(row.id!==id)throw new Error('Usuario ajeno a la consulta.');return row},
 async roles(token:string,signal:AbortSignal){return parseArray(await getData('/roles',token,signal),parseRole)},
 async userRoles(token:string,id:string,signal:AbortSignal){return parseArray(await getData(`/users/${identifier(id)}/roles`,token,signal),parseRole)},
 async permissions(token:string,signal:AbortSignal){return parseArray(await getData('/permissions',token,signal),parsePermission)},
 async rolePermissions(token:string,id:string,signal:AbortSignal){const data=record(await getData(`/roles/${identifier(id)}/permissions`,token,signal)),role=record(data.rol);if(role.id!==id)throw new Error('Rol ajeno a la consulta.');return parseArray(data.permisos,parsePermission)},
}
