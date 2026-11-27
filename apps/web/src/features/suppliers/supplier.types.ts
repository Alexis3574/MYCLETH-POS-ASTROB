export interface Supplier {
  id: string; empresa_id: string; codigo: string; razon_social: string; nombre_comercial: string | null
  rfc: string | null; email: string | null; telefono: string | null; contacto: string | null; dias_credito: number; activo: boolean
}
export interface SupplierAddress { id: string; proveedor_id: string; tipo: string; calle: string | null; numero_exterior: string | null; numero_interior: string | null; colonia: string | null; municipio: string | null; estado: string | null; codigo_postal: string | null; pais: string; es_principal: boolean }
export interface SupplierDetail extends Supplier { proveedor_direccion: SupplierAddress[] }
