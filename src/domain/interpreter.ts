import type { Proposal, Operation } from './commands';
export interface Interpreter { propose(text:string):Proposal }
// Narrow grammar, not an AI model. Proposals never execute or resolve named targets.
export const deterministicInterpreter:Interpreter={propose(text){
  if(!text.trim()||text.length>12000)throw new Error('Enter up to 12,000 characters.');
  const lines=text.trim().split(/\r?\n/).filter(l=>l.trim());if(lines.length>10)throw new Error('Use at most ten lines.');
  const operations:Operation[]=lines.map((line,index)=>{
    const match=/^(task|note|meeting):\s*(.+)$/i.exec(line.trim());
    if(!match)throw new Error(`Line ${index+1}: use task:, note:, or meeting:. Free-form requests and destructive actions are not interpreted.`);
    const kind=match[1].toLowerCase() as Operation['kind'], parts=match[2].split('|').map(s=>s.trim());
    let data:Record<string,unknown>;
    if(kind==='task'&&parts.length===1)data={title:parts[0],status:'ready',dueDate:''};
    else if(kind==='note'&&parts.length===2&&parts[1])data={title:parts[0],content:parts[1]};
    else if(kind==='meeting'&&parts.length===3){
      const times=parts.slice(1).map(v=>{
        if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v))throw new Error(`Line ${index+1}: specify both dates and 24-hour times as YYYY-MM-DD HH:mm in Asia/Kolkata. Relative dates and AM/PM ambiguity need clarification.`);
        const iso=v.replace(' ','T')+':00+05:30', n=Date.parse(iso);
        if(!Number.isFinite(n)||new Date(n+19800000).toISOString().slice(0,16)!==v.replace(' ','T'))throw new Error(`Line ${index+1}: invalid calendar time.`);
        return iso;
      });
      if(Date.parse(times[1])<=Date.parse(times[0]))throw new Error('Meeting end must follow its start.');
      data={title:parts[0],start:times[0],end:times[1]};
    }else throw new Error(`Line ${index+1}: check the documented format. Nothing has been saved.`);
    return {id:crypto.randomUUID(),kind,expectedRevision:0,data};
  });
  return {commandId:crypto.randomUUID(),timezone:'Asia/Kolkata',operations};
}};
