import type {Metadata} from 'next';
export const description='A calm personal workspace for your day, tasks, goals, learning roadmap and agent-reported activity, with context you can review.';
export function brandMetadata(env:Record<string,string|undefined>=process.env):Metadata{
  // Explicitly verified public origin only. Never infer a production domain from
  // a proposed name, request Host, or Vercel preview environment.
  let base:URL|undefined;
  if(env.WORKSPACE_PUBLIC_ORIGIN){
    const url=new URL(env.WORKSPACE_PUBLIC_ORIGIN);
    if(url.protocol!=='https:'||url.origin!==env.WORKSPACE_PUBLIC_ORIGIN||url.username||url.password)throw new Error('Invalid verified public origin');
    base=url;
  }else if(env.WORKSPACE_ORIGIN){
    const url=new URL(env.WORKSPACE_ORIGIN);
    if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.origin===env.WORKSPACE_ORIGIN)base=url;
  }
  return {
    ...(base?{metadataBase:base}:{}),
    applicationName:'Workspace',title:{default:'Workspace — a little space for your day',template:'%s | Workspace'},description,
    openGraph:{type:'website',siteName:'Workspace',title:'Workspace — a little space for your day',description,locale:'en_US'},
    twitter:{card:'summary_large_image',title:'Workspace — a little space for your day',description},
    // No site-wide noindex: a future public landing can remain discoverable.
    // Private workspace/login pages each declare their own robots policy.
  };
}
