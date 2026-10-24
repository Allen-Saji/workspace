import {handleJournal} from '../../../../../src/journal/http.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{path:string}>}){return handleJournal(request,(await context.params).path);}
export async function POST(request:Request,context:{params:Promise<{path:string}>}){return handleJournal(request,(await context.params).path);}
