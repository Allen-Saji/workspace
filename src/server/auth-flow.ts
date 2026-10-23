import { DomainError } from '../domain/contracts.ts';
import { requireUser } from './supabase.ts';
import type { UserVerifier } from './supabase.ts';
type ConfirmationClient=UserVerifier & {auth:UserVerifier['auth'] & {exchangeCodeForSession(code:string):Promise<{error:unknown}>}};
export async function requestSignup(client:{auth:{signUp(input:{email:string;password:string;options:{emailRedirectTo:string}}):Promise<{error:unknown}>}},email:string,password:string,origin:string){
  if(password.length<12)throw new DomainError('password_too_short');
  const {error}=await client.auth.signUp({email,password,options:{emailRedirectTo:origin+'/auth/callback'}});
  if(error)throw new DomainError('signup_unavailable');
}
export async function completeConfirmation(client:ConfirmationClient,request:Request,origin:string){
  const code=confirmationCode(request,origin);
  const {error}=await client.auth.exchangeCodeForSession(code);
  if(error)throw new DomainError('confirmation_failed');
  await requireUser(client);
}
// Fixed destination: never reflect next/redirect URLs or provider error strings.
export function confirmationCode(request:Request,origin:string):string {
  if(request.headers.get('host')!==new URL(origin).host)throw new DomainError('host_denied');
  const q=new URL(request.url).searchParams;
  if([...q.keys()].some(k=>k!=='code')||q.getAll('code').length!==1)throw new DomainError('confirmation_failed');
  const code=q.get('code');
  if(!code||code.length>2048||!/^[-a-zA-Z0-9_]+$/.test(code))throw new DomainError('confirmation_failed');
  return code;
}
