import { apiRequest } from '../../services/api'
import { docConfig, identifier, parseDocument, record } from './document.logic'
import type { DocKind, Document } from './document.logic'
export async function getData(path: `/${string}`, token: string, signal?: AbortSignal): Promise<unknown> {
  const response=record(await apiRequest(path,{token,signal}));if(response.ok!==true)throw new Error('La API no confirmó la consulta.');return response.data
}
export const documentService={
  async list(token:string,kind:DocKind,company:string,state:string,query:string,page:number,signal:AbortSignal){
    if(!Number.isSafeInteger(page)||page<1||page>1000000)throw new Error('Página inválida.')
    const params=new URLSearchParams({page:String(page),pageSize:'20'});if(state)params.set('estado',state);if(query)params.set('q',query)
    const result=record(await getData(`/${kind}?${params}`,token,signal))
    if(!Array.isArray(result.rows)||result.page!==page||result.pageSize!==20||!Number.isSafeInteger(result.total)||Number(result.total)<0)throw new Error('Listado de documentos inválido.')
    const items=result.rows.map(row=>parseDocument(row,kind,company));if(new Set(items.map(row=>row.id)).size!==items.length)throw new Error('Documentos duplicados.')
    return{items,page,size:20,total:Number(result.total)}
  },
  async detail(token:string,kind:DocKind,company:string,id:string,signal?:AbortSignal):Promise<Document>{const doc=parseDocument(await getData(`/${kind}/${identifier(id)}`,token,signal),kind,company);if(doc.id!==id)throw new Error('Documento ajeno a la consulta.');return doc},
}
export function documentLabel(kind:DocKind){return docConfig[kind].singular}
