import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuthSession } from '../auth/useAuthSession'
import { usePermission } from '../commercial/commercial.hooks'
import { useRemoteResource } from '../../hooks/useRemoteResource'
import Pagination from '../commercial/Pagination'
import QueryFeedback from '../commercial/QueryFeedback'
import { accessService } from './access.service'
import { parseUser } from './access.logic'
import { identifier, record } from '../quotations/document.logic'
import { useSafeMutation } from '../quotations/useSafeMutation'
import UserForm from './UserForm'
import '../../pages/SalesPage.css'
import '../../pages/CommercialPage.css'
import '../purchases/purchases.css'
import '../quotations/workflows.css'
export default function UsersWorkspace(){const auth=useAuthSession();return auth?<Users key={auth.accessToken}/>:null}
function Users(){
 const auth=useAuthSession()!,company=auth.user.empresa.id,currentId=auth.user.id,{userId=''}=useParams(),navigate=useNavigate(),allowed=usePermission('USUARIOS.VER'),canWrite=usePermission('USUARIOS.GESTIONAR')
 const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[mode,setMode]=useState<'view'|'edit'|'password'>('view'),[roleId,setRoleId]=useState(''),[notice,setNotice]=useState(''),mutation=useSafeMutation()
 let valid=true;try{if(userId&&userId!=='new')identifier(userId)}catch{valid=false}
 const listLoad=useCallback((token:string,signal:AbortSignal)=>accessService.users(token,page,signal),[page]),detailLoad=useCallback((token:string,signal:AbortSignal)=>accessService.user(token,userId,signal),[userId]),rolesLoad=useCallback((token:string,signal:AbortSignal)=>accessService.roles(token,signal),[]),assignmentsLoad=useCallback((token:string,signal:AbortSignal)=>accessService.userRoles(token,userId,signal),[userId])
 const list=useRemoteResource('users:'+page+':'+revision,allowed&&!userId,listLoad),detail=useRemoteResource('user:'+userId+':'+revision,allowed&&!!userId&&userId!=='new'&&valid,detailLoad),user=detail.data
 const roles=useRemoteResource('user-role-catalog:'+revision,allowed&&!!user&&canWrite,rolesLoad),assignments=useRemoteResource('user-roles:'+userId+':'+revision,allowed&&!!user,assignmentsLoad)
 const canManage=canWrite&&user?.empresa_id===company
 function proposeUser(body:Record<string,unknown>,passwordOnly=false){
  if(!canWrite||mutation.blocked||user&&user.empresa_id!==company)return
  const creating=userId==='new',path=`/users${creating?'':'/'+userId}${passwordOnly?'/password':''}` as `/${string}`
  mutation.propose({path,method:creating?'POST':'PATCH',body,label:passwordOnly?'Confirmar cambio de contraseña':creating?'Confirmar alta de usuario':'Confirmar edición de usuario',review:<><p>Usuario: <strong>{String(body.username??user?.username)}</strong> · Empresa actual {company}</p>{!passwordOnly&&<><p>Nombre: {String(body.nombre)} {String(body.apellido??'')}</p><p>Correo: {String(body.email??'Sin correo')} · Teléfono: {String(body.telefono??'Sin teléfono')}</p><p>Estado: <strong>{body.activo?'Activo':'Inactivo'}</strong></p></>}<p>{passwordOnly?'Se cambiará la credencial del usuario seleccionado. No se mostrará ni conservará la contraseña en el resultado.':'Se actualizará su perfil y estado. La asignación de roles se realiza por separado.'}</p></>,check:value=>{
   if(passwordOnly){if(value!==undefined)throw new Error('Respuesta de contraseña fuera del contrato esperado.');return{id:userId}}
   const result=parseUser(value);if(result.empresa_id!==company||result.username!==body.username||!creating&&result.id!==userId||(['nombre','apellido','email','telefono','activo']as const).some(key=>key in body&&result[key]!==body[key]))throw new Error('Usuario confirmado distinto al solicitado.');return result
  },success:value=>{const result=record(value);setNotice('Operación de usuario confirmada.');setMode('view');setRevision(x=>x+1);navigate('/users/'+result.id)}})
 }
 function roleChange(assignedId:string,remove:boolean){
  if(!canManage||userId===currentId||mutation.blocked)return
  const role=roles.data?.find(row=>row.id===assignedId)??assignments.data?.find(row=>row.id===assignedId);if(!role)return
  mutation.propose({path:`/users/${userId}/roles/${role.id}`,method:remove?'DELETE':'POST',label:(remove?'Retirar':'Asignar')+' rol de usuario',review:<><p>{user?.username} · {role.nombre} ({role.codigo})</p><p>La asignación modifica los accesos efectivos del usuario según los permisos del rol.</p></>,check:value=>{const result=record(value);if(result.usuario_id!==userId||(remove?result.rol_id:record(result.rol).id)!==role.id)throw new Error('Asignación de usuario ajena a la operación.');return result},success:()=>{setNotice('Roles actualizados.');setRevision(x=>x+1);setRoleId('')}})
 }
 return <section className="commercial-page"><header className="sales-heading"><div><p className="sales-eyebrow">ADMINISTRACIÓN</p><h1>Usuarios</h1><p>Perfiles y asignaciones de roles.</p></div>{!userId&&canWrite&&<Link className="sales-button" to="/users/new">Crear usuario</Link>}</header>
 {!allowed?<p role="alert">No tienes permiso para consultar usuarios.</p>:<>{notice&&<p role="status" className="commercial-notice">{notice}</p>}{mutation.gate}
 {userId&&<Link className="sales-button sales-button--secondary" to="/users">Volver a usuarios</Link>}
 {userId==='new'?(canWrite?<UserForm company={company} currentId={currentId} passwordOnly={false} disabled={mutation.blocked} onCancel={()=>navigate('/users')} onReview={body=>proposeUser(body)}/>:<p role="alert">No tienes permiso para crear usuarios.</p>):userId?<>
 {!valid?<p role="alert">Ruta de usuario inválida.</p>:<><QueryFeedback resource={detail}/>{user&&<>
 <section className="commercial-panel"><h2>{user.nombre} {user.apellido}</h2><p>@{user.username} · Empresa {user.empresa_id} · {user.activo?'Activo':'Inactivo'} · {user.bloqueado?'Bloqueado':'Sin bloqueo'}</p><p>{user.email??'Sin correo'} · {user.telefono??'Sin teléfono'}</p><p>Último acceso: {user.ultimo_acceso??'Sin registro'}</p><button type="button" className="sales-button sales-button--secondary" onClick={()=>setRevision(x=>x+1)}>Actualizar usuario</button>
 {canManage&&<div className="commercial-actions"><button type="button" className="sales-button" disabled={mutation.blocked} onClick={()=>setMode('edit')}>Editar usuario</button><button type="button" className="sales-button sales-button--secondary" disabled={mutation.blocked} onClick={()=>setMode('password')}>Cambiar contraseña</button></div>}
 {user.empresa_id!==company&&<p>La API devolvió un registro del catálogo global. Este formulario solo permite gestionar usuarios de tu empresa.</p>}
 </section>
 {canManage&&mode!=='view'&&<UserForm key={user.id+mode+revision} user={user} company={company} currentId={currentId} passwordOnly={mode==='password'} disabled={mutation.blocked} onCancel={()=>setMode('view')} onReview={body=>proposeUser(body,mode==='password')}/>}
 <section className="commercial-panel"><h2>Roles del usuario</h2><QueryFeedback resource={assignments}/>{assignments.data?.map(role=><p key={role.id}>{role.nombre} · {role.codigo} · {role.activo?'Activo':'Inactivo'} {canManage&&userId!==currentId&&<button type="button" className="sales-button sales-button--secondary" disabled={mutation.blocked} onClick={()=>roleChange(role.id,true)}>Retirar rol {role.codigo}</button>}</p>)}{assignments.data&&!assignments.data.length&&<p>Sin roles asignados.</p>}
 {userId===currentId?<p>Para modificar tus propios roles utiliza otra sesión administradora.</p>:canManage&&<><QueryFeedback resource={roles}/><label>Rol para asignar<select value={roleId} disabled={mutation.blocked} onChange={e=>setRoleId(e.target.value)}><option value="">Selecciona un rol</option>{roles.data?.filter(role=>role.activo&&!assignments.data?.some(item=>item.id===role.id)).map(role=><option key={role.id} value={role.id}>{role.nombre} ({role.codigo})</option>)}</select></label><button type="button" className="sales-button" disabled={!roleId||mutation.blocked||!assignments.data} onClick={()=>roleChange(roleId,false)}>Asignar rol seleccionado</button></>}
 </section>
 </>}</>}
 </>:<><p className="sales-muted">Catálogo global paginado. Cada registro indica su empresa; desde esta pantalla se gestionan usuarios de la empresa actual.</p><QueryFeedback resource={list}/>{list.data&&<section className="commercial-panel"><div className="sales-table-scroll"><table className="sales-table"><caption>Usuarios registrados</caption><thead><tr><th>Usuario</th><th>Nombre / contacto</th><th>Empresa</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>{list.data.items.map(row=><tr key={row.id}><td>{row.username}</td><td>{row.nombre} {row.apellido}<small>{row.email??'Sin correo'}</small></td><td>{row.empresa_id}</td><td>{row.activo?'Activo':'Inactivo'}{row.bloqueado?' · Bloqueado':''}</td><td><Link to={'/users/'+row.id}>Ver usuario {row.username}</Link></td></tr>)}</tbody></table></div><Pagination {...list.data} onChange={setPage}/></section>}</>}
 </>}
 </section>
}
