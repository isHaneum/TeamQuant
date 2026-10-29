// Conservative lexical relevance, not an LLM classification or a causal claim.
export function briefingQuery(position){return position.symbol?.startsWith('035420')?'네이버 실적':position.name;}
export function relevantArticles(position,items){
  const aliases=position.symbol?.startsWith('035420')?['네이버','NAVER']:[position.name];
  return items.filter(item=>{
    const text=(item.title+' '+item.description).replace(/[\w.+-]+@[\w.,-]+/gi,'');
    return aliases.some(alias=>text.toLocaleLowerCase().includes(alias.toLocaleLowerCase()));
  }).filter((item,index,all)=>all.findIndex(x=>x.link===item.link)===index);
}
