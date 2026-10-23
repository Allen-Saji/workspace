'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
export default function Login() {
  const router=useRouter();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[signup,setSignup]=useState(false),[sent,setSent]=useState(false);
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    const element=event.currentTarget,form=new FormData(element);
    try{
      const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'local-ui'},body:JSON.stringify({action:signup?'signup':'signin',email:form.get('email'),password:form.get('password')})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error?.code==='configuration_required'?'Hosted sign-in is not configured. The local workspace needs no account.':signup?'Signup could not complete. Check the details or try later; confirmation remains required.':'Unable to sign in. Confirm your email and check your details.');
      element.reset();
      if(signup)setSent(true);else{router.replace('/');router.refresh();}
    }catch{setError(signup?'Unable to confirm signup completion. Check your inbox before trying again; no automatic retry is sent.':'Unable to sign in. Confirm your email, check your details or try later.');}
    finally{setBusy(false);}
  }
  return <main className="panel" style={{maxWidth:480,margin:'5vh auto',padding:32}}>
    <Link href="/">Back to Workspace</Link><h1>{signup?'Make a little space.':'Welcome back.'}</h1>
    <p>{signup?'Create your hosted account using your own email and password. Your local data will not be uploaded.':'Sign in to your hosted workspace. Local development data stays on this computer.'}</p>
    <p className="muted">If a confirmation link failed or was already used, return here to sign in after confirming your email. Open new confirmation links in the same browser that started signup.</p>
    {sent?<div role="status" className="callout"><h2>Check your inbox</h2><p>If signup is eligible, a confirmation email will arrive. No session is claimed until confirmation succeeds. Existing accounts can sign in. Workspace access may still need owner provisioning.</p><button className="secondary" onClick={()=>{setSent(false);setSignup(false);}}>Back to sign in</button></div>:<>
    <form key={String(signup)} className="editor" onSubmit={submit}>
      <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254}/></label>
      <label>Password<input name="password" type="password" autoComplete={signup?'new-password':'current-password'} required minLength={signup?12:1} maxLength={1024}/></label>
      {signup?<p>Use at least 12 characters. Only you enter this password. Sending the form requests a confirmation email.</p>:null}
      {error?<p role="alert" className="error">{error}</p>:null}
      <button className="primary" disabled={busy}>{busy?'Please wait…':signup?'Send confirmation email':'Sign in'}</button>
    </form><button className="text-button" disabled={busy} onClick={()=>{setSignup(!signup);setError('');}}>{signup?'Cancel signup · back to sign in':'Create an account'}</button></>}
    <p className="muted">No automatic retries or password storage in browser drafts. Password recovery is not yet available here.</p>
  </main>;
}
