import {readFile,writeFile,mkdir} from 'node:fs/promises';
import sharp from 'sharp';
const navy='#172c49',ivory='#fffaf0',yellow='#f8d970',coral='#f58e78',sky='#acd7ee';
const icon=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="17" fill="${yellow}"/><path d="M13 16 Q23 13 32 20 Q43 13 52 17 L50 47 Q40 44 32 51 Q23 44 14 47Z" fill="${ivory}" stroke="${navy}" stroke-width="4" stroke-linejoin="round"/><path d="M32 21V49" stroke="${navy}" stroke-width="3"/><path d="M41 17v16l4-3 4 2V16" fill="${coral}"/><path d="M19 26l3 12 4-7 4 9" fill="none" stroke="${navy}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
await writeFile('app/icon.svg',icon);
await sharp(Buffer.from(icon)).resize(180,180).png().toFile('app/apple-icon.png');
const png=await sharp(Buffer.from(icon)).resize(32,32).png().toBuffer();
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=32;header[7]=32;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
await writeFile('app/favicon.ico',Buffer.concat([header,png]));
const artwork=await sharp(await readFile('public/illustrations/learning-notebook.png')).resize(445,360,{fit:'inside'}).png().toBuffer();
const layout=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${ivory}"/><rect x="28" y="28" width="1144" height="574" rx="32" fill="none" stroke="${navy}" stroke-opacity=".13" stroke-width="2"/>
<path d="M742 126Q1022 73 1118 232L1091 463Q919 553 736 466Z" fill="${sky}" opacity=".52"/>
<path d="M775 117l58-14 12 35-62 12z" fill="${yellow}"/><path d="M1074 453l55-14 12 35-58 15z" fill="${coral}"/>
<g transform="translate(74 71) scale(.9)">${icon.replace(/<svg[^>]*>|<\/svg>/g,'')}</g>
<text x="146" y="116" font-family="Arial, sans-serif" font-size="33" font-weight="700" fill="${navy}">Workspace</text>
<text x="74" y="246" font-family="Georgia, serif" font-size="67" font-weight="700" fill="${navy}">A little space.</text>
<text x="74" y="326" font-family="Georgia, serif" font-size="67" font-weight="700" fill="${navy}">A clearer day.</text>
<path d="M78 349Q296 363 549 346" fill="none" stroke="${yellow}" stroke-width="13" stroke-linecap="round"/>
<text x="78" y="411" font-family="Arial, sans-serif" font-size="24" fill="${navy}">Your plans, progress and agent reports.</text>
<text x="78" y="445" font-family="Arial, sans-serif" font-size="24" fill="${navy}">Together, with room to breathe.</text>
<rect x="76" y="501" width="111" height="43" rx="18" fill="${yellow}"/><text x="99" y="530" font-family="Arial, sans-serif" font-size="20" fill="${navy}">Today</text>
<rect x="201" y="501" width="139" height="43" rx="18" fill="${coral}"/><text x="221" y="530" font-family="Arial, sans-serif" font-size="20" fill="${navy}">Learning</text>
<rect x="354" y="501" width="147" height="43" rx="18" fill="${sky}"/><text x="376" y="530" font-family="Arial, sans-serif" font-size="20" fill="${navy}">Agent notes</text>
<path d="M1100 102v28m-14-14h28M702 433v20m-10-10h20" stroke="${navy}" stroke-width="4" stroke-linecap="round"/>
</svg>`;
await sharp(Buffer.from(layout)).composite([{input:artwork,left:715,top:175}]).png().toFile('app/opengraph-image.png');
await writeFile('app/opengraph-image.alt.txt','Workspace — a little space, a clearer day. An illustrated notebook beside Today, Learning and Agent notes.');
await mkdir('artifacts',{recursive:true});
await sharp(Buffer.from(icon)).resize(256,256).png().toFile('artifacts/workspace-icon-preview.png');
console.log('Generated icon.svg, favicon.ico, apple-icon.png (180x180), opengraph-image.png (1200x630).');
