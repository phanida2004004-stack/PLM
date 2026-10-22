import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss3';
const out='pl/public/assets';fs.mkdirSync(out,{recursive:true});
const config={content:['./pl/public/*.{html,js}'],darkMode:'class',theme:{extend:{fontFamily:{sans:['Noto Sans Thai','sans-serif'],mono:['Consolas','monospace'],display:['Noto Sans Thai','sans-serif']},colors:{brand:{50:'#f0f7ff',100:'#e0effe',500:'#0284c7',600:'#0369a1',700:'#075985',900:'#0c2d48'}}}}};
const fonts=[400,500,600,700].map(w=>{
  for(const subset of ['thai','latin'])fs.copyFileSync(`node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-${subset}-${w}-normal.woff2`,`${out}/${subset}-${w}.woff2`);
  return `@font-face{font-family:'Noto Sans Thai';font-style:normal;font-weight:${w};font-display:swap;src:url('/pl/assets/thai-${w}.woff2') format('woff2');unicode-range:U+0E00-0E7F}@font-face{font-family:'Noto Sans Thai';font-style:normal;font-weight:${w};font-display:swap;src:url('/pl/assets/latin-${w}.woff2') format('woff2');unicode-range:U+0000-00FF}`;
}).join('\n');
const css=await postcss([tailwind(config)]).process('@tailwind base;\n@tailwind components;\n@tailwind utilities;',{from:undefined});
fs.writeFileSync(path.join(out,'pl.css'),fonts+'\n'+css.css);
fs.copyFileSync('node_modules/lucide/dist/umd/lucide.min.js',out+'/lucide.min.js');
fs.copyFileSync('node_modules/sweetalert2/dist/sweetalert2.all.min.js',out+'/sweetalert2.all.min.js');
console.log('PL styles, icons, dialogs and Thai fonts built locally');
