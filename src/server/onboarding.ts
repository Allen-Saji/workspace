import {DomainError} from '../domain/contracts.ts';
import {requireUser} from './supabase.ts';
import type {UserVerifier} from './supabase.ts';
import type {RpcClient} from '../storage/supabase-repository.ts';
// Activation is deliberate and separate from deploying code. Candidate migration
// remains unapplied; no current user receives a grant through this disabled path.
export async function initializeOwnWorkspace(client:UserVerifier & RpcClient,enabled=process.env.WORKSPACE_SELF_ONBOARDING==='enabled'){
 if(!enabled)return;
 await requireUser(client);
 const {error}=await client.rpc('workspace_ensure_own'); // No owner or workspace args.
 if(error)throw new DomainError(error.message==='email_confirmation_required'?'email_confirmation_required':'workspace_initialization_failed');
}
