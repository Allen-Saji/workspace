import { DomainError, idField, keys, object, validateReport } from '../domain/contracts.ts';
import type { RpcClient } from '../storage/supabase-repository.ts';
export type ConnectionView={id:string;displayName:string;requestedScopes:string[];grantedScopes:string[];status:string;expiresAt:string;lastReportedAt?:string|null;lastReceivedAt?:string|null};
const known=new Set(['connections_disabled','rate_limited','auth_required','scope_denied','workspace_not_provisioned','invalid_schema','invalid_text','invalid_enum','invalid_id','registration_closed','idempotency_conflict','capture_conflict','payload_too_large','invalid_timestamp','duplicate_capture_id','invalid_revision']);
/** No admin key. Owner client carries verified Auth; agent client is sessionless.
 * Database independently authorizes every operation and stays activation-gated. */
export function hostedConnections(client:RpcClient){
  async function call(name:string,args:Record<string,unknown>){
    const {data,error}=await client.rpc(name,args);
    if(error)throw new DomainError('storage_unavailable');
    const result=object(data);
    if(typeof result.error==='string')throw new DomainError(known.has(result.error)?result.error:'storage_unavailable');
    return result;
  }
  return {
    async control(input:unknown){
      const command=object(input);keys(command,['action','id','scopes']);
      if(!['list','pair','approve','reject','revoke'].includes(String(command.action)))throw new DomainError('invalid_schema');
      if(command.id!==undefined)idField(command.id);
      return call('workspace_agent_control',{command});
    },
    async transport(action:string,credential:string|null,input:unknown){
      if(!['registrations','exchange','rotate','events','receipts'].includes(action))throw new DomainError('scope_denied');
      const payload=action==='events'?validateReport(input):object(input);
      return call('workspace_agent_transport',{action,credential,payload});
    }
  };
}
