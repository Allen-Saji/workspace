import type { Metadata } from 'next';
import Workspace from '../src/ui/Workspace';
export const metadata:Metadata={robots:{index:false,follow:false,nocache:true}};
export default function Page() { return <Workspace/>; }
