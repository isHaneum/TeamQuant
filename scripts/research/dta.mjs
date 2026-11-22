import fs from 'fs';
export function parseDta118(buf){
  const s=buf.toString('latin1');
  const tag=(t)=>{const i=s.indexOf(`<${t}>`);return i<0?-1:i+t.length+2};
  const rel=s.slice(tag('release'),s.indexOf('</release>'));
  const bo=s.slice(tag('byteorder'),s.indexOf('</byteorder>')); const LE=bo==='LSF';
  const rd16=(o)=>LE?buf.readUInt16LE(o):buf.readUInt16BE(o);
  const kOff=tag('K'); const K=rd16(kOff);
  const nOff=tag('N'); const N=Number(LE?buf.readBigUInt64LE(nOff):buf.readBigUInt64BE(nOff));
  let o=tag('variable_types'); const types=[];for(let i=0;i<K;i++)types.push(rd16(o+2*i));
  o=tag('varnames'); const names=[];for(let i=0;i<K;i++){const nm=buf.slice(o+129*i,o+129*(i+1)).toString('utf8');names.push(nm.split('\0')[0])}
  const d=tag('data');
  const sz=t=>t===65526?8:t===65527?4:t===65528?4:t===65529?2:t===65530?1:t===32768?8:t;
  const rowLen=types.reduce((a,t)=>a+sz(t),0);
  const rows=[];
  for(let r=0;r<N;r++){let p=d+r*rowLen;const row={};
    for(let i=0;i<K;i++){const t=types[i];let v;
      if(t===65526){v=LE?buf.readDoubleLE(p):buf.readDoubleBE(p); if(v>8.98e307)v=null}
      else if(t===65527){v=LE?buf.readFloatLE(p):buf.readFloatBE(p); if(v>1.7e38)v=null}
      else if(t===65528){v=LE?buf.readInt32LE(p):buf.readInt32BE(p); if(v>2147483620)v=null}
      else if(t===65529){v=LE?buf.readInt16LE(p):buf.readInt16BE(p); if(v>32740)v=null}
      else if(t===65530){v=buf.readInt8(p); if(v>100)v=null}
      else if(t===32768){v=null}
      else {v=buf.slice(p,p+t).toString('utf8').split('\0')[0]}
      row[names[i]]=v;p+=sz(t)}
    rows.push(row)}
  return {release:rel,K,N,names,types,rows};
}
if(process.argv[2]){const b=fs.readFileSync(process.argv[2]);const d=parseDta118(b);console.log(d.release,d.K,d.N,d.names,d.types);console.log(d.rows[0]);console.log(d.rows[d.N-1]);}
